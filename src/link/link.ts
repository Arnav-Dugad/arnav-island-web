// Arnav Island's sharing protocol in the browser, exactly as the Windows island speaks it and the Android app's Link.kt does:
// two devices pair once (each showing the same six-digit code, or this app scanning the PC's QR code), and after that
// everything goes between them sealed with AES-256-GCM under a key from both sides' static ECDH keys and fresh nonces. A
// browser can't open sockets, so every connection runs through the relay's tunnels (see relay.ts).
import { Bytes, Reader, cleanName, equal, fromUtf8, hex, safeName, safePath, unhex } from './bytes';
import { Channel, agree, keyPrint, randomBytes, sha256 } from './crypto';
import {
  type AudioOutput, type CommandOutcome, type CommandResults, type Handoff, type IslandSettings, type PcBattery, type PcControls, type PcStats,
  type PcStatus, type PeerView, type RemoteReply, type ShelfItem, type ShelfList,
  parseBattery, parseCommands, parseControls, parseOutcome, parseOutputs, parseSettings, parseStats, parseStatus, parseValue,
} from './island';
import { Proto } from './proto';
import { Relay, type RelayPair } from './relay';
import { Sha256 } from './sha256';
import { Closed, Inbound, type Pipe, TimedOut, framed } from './stream';

export interface StoredPeer { id: string; key: Uint8Array; name: string; phone: boolean; revision: number }
/** Keeps the identity and the paired devices (see store.ts: IndexedDB, sealed at rest). */
export interface LinkStore {
  loadIdentity(): Promise<{ id: Uint8Array; pub: Uint8Array; key: CryptoKey } | null>;
  saveIdentity(id: Uint8Array, pub: Uint8Array, key: CryptoKey): Promise<boolean>;
  loadPeers(): Promise<StoredPeer[]>;
  savePeers(peers: StoredPeer[]): Promise<void>;
}

/** Something to send: its path as the other side will keep it ("Photos/a.jpg"), its size and its bytes. */
export interface Source { rel: string; size: number; blob: Blob }
/** A file that arrived. */
export interface Arrived { name: string; parts: string[]; blob: Blob; type: string }

export type LinkEvent =
  | { kind: 'peers'; peers: PeerView[] }
  | { kind: 'pairCode'; peer: string; name: string; code: number; confirmed: boolean }
  | { kind: 'paired'; peer: string; name: string; ok: boolean; detail: string }
  | { kind: 'offer'; transfer: number; peer: string; name: string; title: string; count: number; size: number; folder: boolean }
  | { kind: 'progress'; transfer: number; peer: string; name: string; title: string; done: number; total: number; outgoing: boolean }
  | { kind: 'received'; transfer: number; peer: string; name: string; title: string; count: number; size: number; files: Arrived[]; taken: boolean }
  | { kind: 'sent'; transfer: number; peer: string; name: string; title: string; count: number; size: number }
  | { kind: 'failed'; transfer: number; peer: string; name: string; title: string; detail: string; outgoing: boolean }
  | { kind: 'music'; transfer: number; peer: string; name: string; music: Handoff }
  | { kind: 'musicFile'; transfer: number; peer: string; name: string; music: Handoff; file: Arrived }
  | { kind: 'ring'; peer: string; name: string }
  | { kind: 'photoRequested'; peer: string; name: string }
  | { kind: 'clipboard'; peer: string; name: string; text: string; sensitive: boolean }
  | { kind: 'internet'; up: boolean };

class Session {
  peerId: Uint8Array = new Uint8Array(0); peerPub: Uint8Array = new Uint8Array(0); peerName = ''; channel: Channel | null = null; code = 0; rejected = false; outdated = false;
}

/** A connection: frames out (sealed in order, one at a time) and in. */
class Conn {
  private chain: Promise<unknown> = Promise.resolve();
  closed = false;
  constructor(public pipe: Pipe & { inbound: Inbound }) {}
  send(frame: Uint8Array): boolean { if (this.closed) return false; return this.pipe.write(framed(frame)); }
  recv(ms: number): Promise<Uint8Array> { return this.pipe.inbound.frame(ms); }
  /** Seals and sends in the order asked, so a frame's nonce matches its place in the stream. */
  sealed(ss: Session, plain: Uint8Array): Promise<boolean> {
    const next = this.chain.then(async () => {
      if (this.closed || !ss.channel) return false;
      const c = await ss.channel.seal(plain);
      return this.send(c);
    }).catch(() => false);
    this.chain = next;
    return next;
  }
  async opened(ss: Session, ms: number): Promise<Uint8Array | null> {
    try { const f = await this.recv(ms); return ss.channel ? await ss.channel.open(f) : null; } catch { return null; }
  }
  close(): void { if (this.closed) return; this.closed = true; this.pipe.close(); }
  /** The other side ended the stream. */
  get ended(): boolean { return this.pipe.inbound.done; }
}

interface Deferred<T> { promise: Promise<T>; resolve: (v: T) => void; done: boolean }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const d: Deferred<T> = { promise: new Promise<T>((r) => { resolve = r; }), resolve: (v) => { if (!d.done) { d.done = true; resolve(v); } }, done: false };
  return d;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Peer { name: string; key: Uint8Array | null; phone: boolean; revision: number }
interface Target { name: string; key: Uint8Array; revision: number }

export interface LinkOptions { brokers?: string[]; loseEvery?: number; phone?: boolean }

export class Link {
  displayName: string;
  private id: Uint8Array = new Uint8Array(0);
  private pub: Uint8Array = new Uint8Array(0);
  private key: CryptoKey | null = null;
  private peers = new Map<string, Peer>();
  private pairing: Deferred<number> | null = null;
  private decisions = new Map<number, Deferred<number>>();
  private live = new Map<number, { stop: boolean; conn: Conn | null }>();
  private nextTransfer = 1;
  private relay: Relay | null = null;
  private kept = new Map<string, { c: Conn; ss: Session; used: number }>();
  private keptLocks = new Map<string, Promise<unknown>>();
  lastRemoteError = '';
  failure: string | null = null;
  /** Revision 6: what a PC asks this device (peer, command, payload): the answer's payload, or null when it can't. */
  onQuery: ((peer: string, command: number, payload: Uint8Array) => Promise<Uint8Array | null>) | null = null;

  constructor(private store: LinkStore, name: string, private onEvent: (e: LinkEvent) => void, private options: LinkOptions = {}) {
    this.displayName = cleanName(name);
  }

  get identity(): string { return hex(this.id); }
  get publicKey(): Uint8Array { return this.pub; }
  get internet(): boolean { return this.relay?.connected === true; }
  get relayBroker(): string | null { return this.relay?.broker ?? null; }
  get relayBrokersUp(): number { return this.relay?.brokersUp ?? 0; }

  // ---- life ----
  async start(): Promise<boolean> {
    if (!(await this.loadIdentity())) { this.failure = "The sharing key couldn't be created"; return false; }
    for (const p of await this.store.loadPeers()) {
      if (unhex(p.id)?.length !== 16 || p.key.length !== 64) continue;
      this.peers.set(p.id, { name: cleanName(p.name), key: p.key, phone: p.phone, revision: p.revision });
    }
    let wasUp = false;
    this.relay = new Relay({
      id: this.id, name: () => this.displayName, phone: this.options.phone ?? true, revision: Proto.REVISION,
      incoming: (t) => { const c = new Conn(t); void this.incoming(c).catch(() => {}).finally(() => c.close()); },
      changed: () => { const up = this.internet; if (up !== wasUp) { wasUp = up; this.onEvent({ kind: 'internet', up }); } this.postPeers(); },
      brokers: this.options.brokers, loseEvery: this.options.loseEvery,
    });
    this.relay.start();
    await this.syncRelay();
    return true;
  }
  stop(): void {
    this.dropKept(); this.relay?.stop(); this.relay = null;
    this.pairing?.resolve(0); for (const d of this.decisions.values()) d.resolve(0);
    for (const l of this.live.values()) { l.stop = true; l.conn?.close(); }
  }
  /** The page came back to the front, or the network changed. */
  wake(): void { this.relay?.kick(); }
  async ready(ms: number): Promise<boolean> { return (await this.relay?.ready(ms)) ?? false; }

  private async loadIdentity(): Promise<boolean> {
    const saved = await this.store.loadIdentity();
    if (saved && saved.id.length === 16 && saved.pub.length === 64) { this.id = saved.id; this.pub = saved.pub; this.key = saved.key; return true; }
    // A new identity: the private key is created non-extractable, so it can never leave this browser.
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])) as CryptoKeyPair;
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    this.id = randomBytes(16); this.pub = raw.slice(1, 65); this.key = pair.privateKey;
    return this.store.saveIdentity(this.id, this.pub, pair.privateKey);
  }
  /** The relay listens for every paired device; each pair's secret is the static ECDH of the two keys. */
  private async syncRelay(): Promise<void> {
    const r = this.relay, k = this.key; if (!r || !k) return;
    const pairs: RelayPair[] = [];
    for (const [peer, p] of this.peers) {
      if (!p.key) continue;
      const agreed = await agree(k, p.key); const id = unhex(peer);
      if (agreed && id) pairs.push({ peer: id, agreed });
    }
    await r.pairs(pairs);
  }
  private async savePeers(): Promise<void> {
    const list: StoredPeer[] = [];
    for (const [id, p] of this.peers) if (p.key) list.push({ id, key: p.key, name: p.name, phone: p.phone, revision: p.revision });
    await this.store.savePeers(list);
  }
  private postPeers(): void { this.onEvent({ kind: 'peers', peers: this.peerViews() }); }

  peerViews(): PeerView[] {
    const out: PeerView[] = [];
    for (const [id, p] of this.peers) {
      if (!p.key) continue;
      const r = this.relay?.presence(id); const path = this.relay?.path(id);
      out.push({
        id, name: p.name || 'A PC', paired: true, online: r?.here === true, phone: p.phone || r?.phone === true, version: Proto.VERSION,
        revision: r?.here ? r.revision : p.revision, internet: true, path: path?.kind ?? 0, rtt: path?.rtt ?? 0, relays: path?.brokers ?? 0,
      });
    }
    return out.sort((a, b) => (a.online === b.online ? a.name.localeCompare(b.name) : a.online ? -1 : 1));
  }

  // ---- sessions ----
  private async keys(ss: Session, initiator: boolean, mine: Uint8Array, theirs: Uint8Array): Promise<boolean> {
    if (!this.key) return false;
    const secret = await agree(this.key, ss.peerPub); if (!secret) return false;
    const nc = initiator ? mine : theirs, ns = initiator ? theirs : mine;
    const pc = initiator ? this.pub : ss.peerPub, ps = initiator ? ss.peerPub : this.pub;
    const ic = initiator ? this.id : ss.peerId, is = initiator ? ss.peerId : this.id;
    const k = await sha256('arnav-share-v1', secret, nc, ns, ic, is);
    const c = await sha256('arnav-pair-v1', pc, ps, nc, ns);
    secret.fill(0);
    ss.code = ((c[0] | (c[1] << 8) | (c[2] << 16) | (c[3] << 24)) >>> 0) % 1_000_000;
    ss.channel = await Channel.create(k, initiator); k.fill(0);
    return true;
  }
  /** The opener commits to its nonce (a hash) before it sees the other's, so neither side can steer the code. */
  private async greet(c: Conn, mode: number, ss: Session, ms: number): Promise<boolean> {
    const nonce = randomBytes(32);
    c.send(new Bytes().raw(Proto.MAGIC).u8(Proto.VERSION).u8(mode).raw(this.id).raw(this.pub).raw(await sha256(nonce)).text(this.displayName).build());
    const reply = await c.recv(ms);
    if (reply.length < 6 || !equal(reply.subarray(0, 4), Proto.MAGIC)) return false;
    if (reply[4] !== Proto.VERSION || reply[5] === 2) { ss.outdated = true; return false; }
    if (reply[5] !== 0) { ss.rejected = true; return false; }
    if (reply.length < 6 + 16 + 64 + 32) return false;
    ss.peerId = reply.slice(6, 22); ss.peerPub = reply.slice(22, 86); const theirs = reply.slice(86, 118);
    ss.peerName = cleanName(fromUtf8(reply.subarray(118)));
    c.send(nonce);
    return this.keys(ss, true, nonce, theirs);
  }
  private async welcome(c: Conn, ss: Session): Promise<[number, Deferred<number> | null] | null> {
    const hello = await c.recv(15_000);
    if (hello.length < 6 || !equal(hello.subarray(0, 4), Proto.MAGIC)) return null;
    if (hello[4] !== Proto.VERSION) { c.send(new Bytes().raw(Proto.MAGIC).u8(Proto.VERSION).u8(2).build()); return null; }
    if (hello.length < 6 + 16 + 64 + 32) return null;
    const mode = hello[5];
    ss.peerId = hello.slice(6, 22); ss.peerPub = hello.slice(22, 86); const commit = hello.slice(86, 118);
    ss.peerName = cleanName(fromUtf8(hello.subarray(118))); if (equal(ss.peerId, this.id)) return null;
    let claim: Deferred<number> | null = null; let allowed = false;
    if (mode === Proto.MODE_PAIR && !this.pairing) { claim = deferred<number>(); this.pairing = claim; allowed = true; }
    else if ([Proto.MODE_SEND, Proto.MODE_MUSIC, Proto.MODE_FIND, Proto.MODE_LIST, Proto.MODE_TAKE, Proto.MODE_ACTION, Proto.MODE_CLIP, Proto.MODE_CAMERA, Proto.MODE_QUERY].includes(mode as never)) {
      const k = this.peers.get(hex(ss.peerId))?.key; allowed = !!k && equal(k, ss.peerPub);
    }
    if (!allowed) { c.send(new Bytes().raw(Proto.MAGIC).u8(Proto.VERSION).u8(1).build()); return null; }
    const nonce = randomBytes(32);
    c.send(new Bytes().raw(Proto.MAGIC).u8(Proto.VERSION).u8(0).raw(this.id).raw(this.pub).raw(nonce).text(this.displayName).build());
    let theirs: Uint8Array;
    try { theirs = await c.recv(15_000); } catch { if (claim) this.release(claim); return null; }
    if (theirs.length !== 32 || !equal(await sha256(theirs), commit)) { if (claim) this.release(claim); return null; }
    if (!(await this.keys(ss, false, nonce, theirs))) { if (claim) this.release(claim); return null; }
    return [mode, claim];
  }
  private release(d: Deferred<number>): void { if (this.pairing === d) this.pairing = null; }

  private async incoming(c: Conn): Promise<void> {
    const ss = new Session();
    const w = await this.welcome(c, ss); if (!w) return;
    const [mode, claim] = w;
    switch (mode) {
      case Proto.MODE_PAIR: return this.pairSession(c, ss, claim!, false);
      case Proto.MODE_MUSIC: return this.receiveMusic(c, ss);
      case Proto.MODE_FIND: return this.ringed(c, ss);
      case Proto.MODE_SEND: return this.receive(c, ss);
      // A phone keeps no Shelf of its own to show: it says so, and gives nothing.
      case Proto.MODE_LIST: await c.sealed(ss, new Bytes().u8(Proto.FRAME_SHELF).u8(0).u32(0).build()); await sleep(300); return;
      case Proto.MODE_TAKE: await c.sealed(ss, new Bytes().u8(Proto.FRAME_OFFER).u32(0).build()); await sleep(300); return;
      case Proto.MODE_ACTION: {
        // Notifications' actions are the Android app's: this device has none to run (1: gone).
        const f = await c.opened(ss, 15_000); if (!f || f[0] !== Proto.FRAME_ACTION) return;
        await c.sealed(ss, Uint8Array.of(Proto.FRAME_ACTION_ACK, 1)); await sleep(300); return;
      }
      case Proto.MODE_CLIP: {
        const f = await c.opened(ss, 15_000); if (!f) return; const r = new Reader(f); if (r.u8() !== Proto.FRAME_CLIP) return;
        const sensitive = (r.u8() ?? 0) !== 0; const text = r.string(256 * 1024); if (text === null) return;
        // A browser can write the clipboard only from a tap: the app shows it, ready to copy.
        this.onEvent({ kind: 'clipboard', peer: hex(ss.peerId), name: this.nameOf(hex(ss.peerId), ss.peerName), text, sensitive });
        await c.sealed(ss, Uint8Array.of(Proto.FRAME_CLIP_ACK, 0)); await sleep(300); return;
      }
      // Revision 6: a PC's questions, on a connection it keeps open while it asks (a minute apart at most).
      case Proto.MODE_QUERY: {
        const peer = hex(ss.peerId);
        for (;;) {
          const f = await c.opened(ss, 60_000); if (!f || f.length < 2 || f[0] !== Proto.FRAME_QUERY) break;
          let answer: Uint8Array | null = null;
          try { answer = (await this.onQuery?.(peer, f[1], f.slice(2))) ?? null; } catch { answer = null; }
          if (!(await c.sealed(ss, new Bytes().u8(Proto.FRAME_QUERY_REPLY).u8(answer ? Proto.OK : Proto.FAILED).raw(answer ?? new Uint8Array(0)).build()))) break;
        }
        return;
      }
      case Proto.MODE_CAMERA: {
        const f = await c.opened(ss, 15_000); if (!f || f.length !== 1 || f[0] !== Proto.FRAME_CAMERA) return;
        await c.sealed(ss, Uint8Array.of(Proto.FRAME_CAMERA_ACK, 0));
        this.onEvent({ kind: 'photoRequested', peer: hex(ss.peerId), name: this.nameOf(hex(ss.peerId), ss.peerName) });
        await sleep(300); return;
      }
    }
  }

  // ---- pairing ----
  /** Both devices show the code; each person's answer goes to the other, sealed. Paired only when both said yes. */
  private async pairSession(c: Conn, ss: Session, d: Deferred<number>, confirmed: boolean): Promise<void> {
    const peer = hex(ss.peerId);
    this.onEvent({ kind: 'pairCode', peer, name: ss.peerName, code: ss.code, confirmed });
    const mine = await Promise.race([d.promise, sleep(60_000).then(() => 0)]);
    const theirs = (await c.sealed(ss, Uint8Array.of(mine === 1 ? 1 : 0))) ? await c.opened(ss, 90_000) : null;
    const talked = !!theirs && theirs.length === 1;
    const both = talked && mine === 1 && theirs![0] === 1;
    if (both) {
      const p = this.peers.get(peer) ?? { name: '', key: null, phone: false, revision: 0 };
      p.key = ss.peerPub; if (!p.name || p.name === 'A PC') p.name = ss.peerName;
      this.peers.set(peer, p);
      await this.savePeers(); await this.syncRelay(); this.relay?.stopHosting();
    }
    this.release(d);
    this.onEvent({ kind: 'paired', peer, name: ss.peerName, ok: both, detail: both ? 'Paired' : !talked ? 'The other device stopped answering' : mine !== 1 ? 'Not paired' : 'Not confirmed on the other device' });
    this.postPeers();
  }
  confirmPair(yes: boolean): void { this.pairing?.resolve(yes ? 1 : 0); }
  get pairingBusy(): boolean { return this.pairing !== null; }
  async forget(peer: string): Promise<void> { const p = this.peers.get(peer); if (p) p.key = null; this.peers.delete(peer); await this.savePeers(); await this.syncRelay(); this.postPeers(); }
  rename(peer: string, name: string): void { const p = this.peers.get(peer); if (p) { p.name = cleanName(name); void this.savePeers(); this.postPeers(); } }

  /** Offers a pairing code for ten minutes; null when the relay can't be reached. */
  async hostPairing(): Promise<string | null> { return (await this.relay?.host()) ?? null; }
  stopHosting(): void { this.relay?.stopHosting(); }
  get hostingCode(): string | null { return this.relay?.hosting ?? null; }
  /**
   * Pairs with the device showing this code, through the relay: pairCode, then paired. [key], from its QR code: the start of
   * that device's key fingerprint. A device with another key is refused, and this device's yes is given at once (the PC
   * itself still asks). False when another pairing is under way.
   */
  pairWithCode(code: string, key: Uint8Array | null = null): boolean {
    if (this.pairing) return false;
    const d = deferred<number>(); this.pairing = d;
    void (async () => {
      // Just started (a pairing link opened the app): the relay gets a few seconds to connect.
      await this.relay?.ready(15_000);
      // Asked up to three times: the other device may join a broker a moment after this one asked on it.
      for (let attempt = 1; attempt <= 3; attempt++) {
        const [t, why] = (await this.relay?.openCode(code)) ?? [null, 'Connecting over the internet is off'];
        if (!t) { this.release(d); this.onEvent({ kind: 'paired', peer: '', name: '', ok: false, detail: why }); return; }
        const c = new Conn(t); const ss = new Session();
        try {
          let greeted = false;
          try { greeted = await this.greet(c, Proto.MODE_PAIR, ss, 8_000); } catch { greeted = false; }
          if (greeted) {
            if (!key) { await this.pairSession(c, ss, d, false); return; }
            if (equal(await keyPrint(ss.peerPub), key)) { d.resolve(1); await this.pairSession(c, ss, d, true); return; }
            // Not the PC whose code was scanned: someone else is answering it. Nothing more is said to them.
            this.release(d); this.onEvent({ kind: 'paired', peer: '', name: '', ok: false, detail: 'Another device answered that code, so nothing was paired. Make a new code on your PC' }); return;
          }
          if (ss.rejected || attempt === 3) { this.release(d); this.onEvent({ kind: 'paired', peer: '', name: '', ok: false, detail: ss.rejected ? 'That device is busy pairing' : 'No device is showing that code. Check it, or make a new one' }); return; }
        } finally { c.close(); }
      }
    })();
    return true;
  }

  // ---- connecting to a paired device ----
  private target(peer: string): [Target | null, string] {
    const p = this.peers.get(peer);
    if (!p?.key) return [null, 'Pair with this PC first'];
    const r = this.relay?.presence(peer);
    if (!r?.here) return [null, `${p.name} isn't reachable right now`];
    if (r.revision !== p.revision) { p.revision = r.revision; void this.savePeers(); }
    return [{ name: p.name, key: p.key, revision: r.revision }, ''];
  }
  /** Reached, greeted and checked against the pairing: the connection and session, or why not. */
  private async reach(peer: string, mode: number, transfer: number | null): Promise<[Conn | null, Session, string]> {
    const ss = new Session(); const [t, whyNot] = this.target(peer); if (!t) return [null, ss, whyNot];
    const [pipe, why] = (await this.relay?.open(peer)) ?? [null, `Couldn't reach ${t.name}`];
    if (!pipe) return [null, ss, why || `Couldn't reach ${t.name}`];
    const c = new Conn(pipe);
    if (transfer !== null) { const l = this.live.get(transfer); if (!l || l.stop) { c.close(); return [null, ss, 'You stopped it']; } l.conn = c; }
    let greeted = false;
    try { greeted = await this.greet(c, mode, ss, 15_000); } catch { greeted = false; }
    if (!greeted) { c.close(); return [null, ss, ss.outdated ? `Update Arnav Island on ${t.name} to share with it` : ss.rejected ? `${t.name} doesn't have this device paired. Pair again.` : `Couldn't reach ${t.name}`]; }
    if (hex(ss.peerId) !== peer || !equal(ss.peerPub, t.key)) { c.close(); return [null, ss, `${t.name} answered with a different key. Pair again.`]; }
    return [c, ss, ''];
  }
  private nameOf(peer: string, fallback: string): string { return this.peers.get(peer)?.name || cleanName(fallback); }
  private newTransfer(): number { const t = this.nextTransfer++; this.live.set(t, { stop: false, conn: null }); return t; }
  private stopped(t: number): boolean { return this.live.get(t)?.stop ?? true; }
  private finish(t: number): void { this.live.delete(t); this.decisions.delete(t); }
  cancel(transfer: number): void { const l = this.live.get(transfer); if (l) { l.stop = true; this.decisions.get(transfer)?.resolve(0); l.conn?.close(); } }

  private progress(transfer: number, peer: string, name: string, title: string, total: number, outgoing: boolean) {
    let done = 0, shown = -1, at = 0;
    return {
      get done() { return done; },
      add: (n: number) => {
        done += n; const percent = total > 0 ? Math.floor((done * 100) / total) : 100; const now = Date.now();
        if (percent !== shown && (now - at >= 100 || done === total)) { shown = percent; at = now; this.onEvent({ kind: 'progress', transfer, peer, name, title, done, total, outgoing }); }
      },
    };
  }

  // ---- sending files ----
  /** Sends these items to a paired PC in one transfer; returns its id (for cancel). [preview]: a small JPEG shown as it arrives. */
  send(peer: string, items: Source[], title: string, opts: { folder?: boolean; toShelf?: boolean; preview?: Uint8Array | null; ask?: number } = {}): number {
    const transfer = this.newTransfer();
    void (async () => {
      const total = items.reduce((a, b) => a + b.size, 0);
      const [c, ss, why0] = await this.reach(peer, Proto.MODE_SEND, transfer);
      let why = why0; let sent = false; const name = this.nameOf(peer, '');
      const revision = this.target(peer)[0]?.revision ?? 0;
      const picture = opts.preview && revision >= 8 && opts.preview.length > 0 && opts.preview.length <= 96 * 1024 ? opts.preview : null;
      const ask = opts.ask ?? 0;
      const flags = (opts.folder ? Proto.OFFER_FOLDER : 0) | (opts.toShelf && revision >= 3 ? Proto.OFFER_SHELF : 0) | (picture ? Proto.OFFER_PICTURE : 0) | (ask !== 0 && revision >= 8 ? Proto.OFFER_ASKED : 0);
      if (c) { try { const failed = await this.offerBatch(c, ss, items, total, flags, title, peer, name, transfer, picture, ask); sent = failed === null; if (failed !== null) why = failed; } finally { c.close(); } }
      this.finish(transfer);
      this.onEvent(sent ? { kind: 'sent', transfer, peer, name, title, count: items.length, size: total } : { kind: 'failed', transfer, peer, name, title, detail: why || "It didn't go", outgoing: true });
    })();
    return transfer;
  }
  private async offerBatch(c: Conn, ss: Session, items: Source[], total: number, flags: number, title: string, peer: string, name: string, transfer: number, picture: Uint8Array | null, ask: number): Promise<string | null> {
    // Revision 8: with a picture or an ask, each part carries its length (before, the title ran to the end).
    const offer = new Bytes().u8(Proto.FRAME_OFFER).u32(items.length).u64(total).u8(flags);
    if (flags & (Proto.OFFER_PICTURE | Proto.OFFER_ASKED)) { offer.string(title.slice(0, 1000)); if (flags & Proto.OFFER_PICTURE) offer.blob(picture ?? new Uint8Array(0)); if (flags & Proto.OFFER_ASKED) offer.u32(ask); }
    else offer.text(title);
    const reply = (await c.sealed(ss, offer.build())) ? await c.opened(ss, 90_000) : null;
    if (!reply || reply.length !== 1) return this.stopped(transfer) ? 'You stopped it' : `${name} didn't answer`;
    if (reply[0] === 2) return `There isn't room on ${name}`;
    if (reply[0] !== 1) return `${name} declined it`;
    const progress = this.progress(transfer, peer, name, title, total, true);
    for (const item of items) if (!(await this.streamFile(c, ss, item, progress, transfer))) return this.stopped(transfer) ? 'You stopped it' : `The transfer to ${name} didn't finish`;
    const ack = (await c.sealed(ss, Uint8Array.of(Proto.FRAME_BATCH_END))) ? await c.opened(ss, 60_000) : null;
    if (!ack || ack.length !== 1 || ack[0] !== 1) return `The transfer to ${name} didn't finish`;
    return null;
  }
  /** One file into the sealed stream: its header, its data in chunks, then its size and SHA-256. */
  private async streamFile(c: Conn, ss: Session, item: Source, progress: { add: (n: number) => void }, transfer: number): Promise<boolean> {
    if (!(await c.sealed(ss, new Bytes().u8(Proto.FRAME_HEADER).u64(item.size).text(item.rel).build()))) return false;
    const hash = new Sha256(); let done = 0;
    try {
      while (done < item.size) {
        if (this.stopped(transfer)) return false;
        const want = Math.min(Proto.CHUNK, item.size - done);
        const chunk = new Uint8Array(await item.blob.slice(done, done + want).arrayBuffer());
        if (chunk.length !== want) return false;
        const frame = new Uint8Array(1 + want); frame[0] = Proto.FRAME_DATA; frame.set(chunk, 1);
        if (!(await c.sealed(ss, frame))) return false;
        hash.update(chunk); done += want; progress.add(want);
        // Keeps what waits to go small: the relay's window paces the rest.
        await this.drain(c);
      }
    } catch { return false; }
    return c.sealed(ss, new Bytes().u8(Proto.FRAME_END).u64(item.size).raw(hash.digest()).build());
  }
  /** Waits while more than a few megabytes wait to go out. */
  private async drain(c: Conn): Promise<void> {
    const t = c.pipe as unknown as { backlog?: () => number };
    while (t.backlog && t.backlog() > 4 * 1024 * 1024 && !c.closed) await sleep(20);
  }

  // ---- receiving files ----
  private async receive(c: Conn, ss: Session): Promise<void> {
    const peer = hex(ss.peerId); const from = this.nameOf(peer, ss.peerName);
    const offer = await c.opened(ss, 15_000); if (!offer) return;
    const r = new Reader(offer); if (r.u8() !== Proto.FRAME_OFFER) return;
    const count = r.u32(); const total = r.u64n(); const flags = r.u8(); if (count === null || total === null || flags === null) return;
    let title: string;
    if (flags & (Proto.OFFER_PICTURE | Proto.OFFER_ASKED)) { title = cleanName(r.string(4096) ?? ''); }
    else title = cleanName(fromUtf8(r.rest()));
    if (count === 0 || count > Proto.MAX_FILES || total < 0 || total > Proto.MAX_TOTAL) return;
    const transfer = this.newTransfer(); this.live.get(transfer)!.conn = c;
    const d = deferred<number>(); this.decisions.set(transfer, d);
    this.onEvent({ kind: 'offer', transfer, peer, name: from, title, count, size: total, folder: (flags & Proto.OFFER_FOLDER) !== 0 });
    let yes = await this.decide(c, d);
    this.decisions.delete(transfer);
    if (yes === -1) { this.finish(transfer); this.onEvent({ kind: 'failed', transfer, peer, name: from, title, detail: `${from} stopped sending it`, outgoing: false }); return; }
    if (yes === 1 && !(await this.room(total))) yes = 2;
    const told = await c.sealed(ss, Uint8Array.of(yes));
    if (!told || yes !== 1) {
      const mine = this.stopped(transfer); this.finish(transfer);
      if (yes === 2) this.onEvent({ kind: 'failed', transfer, peer, name: from, title, detail: "There isn't room on this device", outgoing: false });
      else if (yes === 1) this.onEvent({ kind: 'failed', transfer, peer, name: from, title, detail: mine ? 'You stopped it' : `${from} stopped sending it`, outgoing: false });
      return;
    }
    await this.takeBatch(c, ss, peer, from, title, count, total, transfer, false);
  }
  private async room(bytes: number): Promise<boolean> {
    try { const e = await navigator.storage?.estimate?.(); if (e?.quota && e.usage !== undefined) return e.quota - e.usage > bytes * 1.1; } catch { /* unknown */ }
    return bytes < 2 * 2 ** 30;
  }
  /** Waits (up to a minute) for the person's answer; -1 if the other side closes the connection meanwhile. */
  private async decide(c: Conn, d: Deferred<number>): Promise<number> {
    for (let i = 0; i < 240; i++) {
      const v = await Promise.race([d.promise, sleep(250).then(() => null)]);
      if (v !== null) return v;
      if (c.ended) { d.resolve(0); return -1; }
    }
    d.resolve(0); return 0;
  }
  private async takeBatch(c: Conn, ss: Session, peer: string, from: string, title: string, count: number, total: number, transfer: number, taken: boolean): Promise<void> {
    const progress = this.progress(transfer, peer, from, title, total, false);
    const files: Arrived[] = []; let whole = false;
    for (;;) {
      if (this.stopped(transfer)) break;
      const f = await c.opened(ss, 30_000); if (!f || f.length === 0) break;
      if (f[0] === Proto.FRAME_BATCH_END) { whole = files.length === count && progress.done === total; break; }
      if (f[0] !== Proto.FRAME_HEADER || f.length < 10 || files.length >= count) break;
      const r = new Reader(f, 1); const size = r.u64n()!; const parts = safePath(fromUtf8(r.rest()));
      if (!parts.length || size < 0 || size > Proto.MAX_FILE || progress.done + size > total) break;
      const got = await this.takeFile(c, ss, size, parts, progress, transfer); if (!got) break;
      files.push(got);
    }
    const here = this.stopped(transfer);
    if (whole) await c.sealed(ss, Uint8Array.of(1));
    this.finish(transfer);
    if (!whole) { this.onEvent({ kind: 'failed', transfer, peer, name: from, title, detail: here ? 'You stopped it' : files.length > 0 ? `${files.length} of ${count} files arrived from ${from}` : `It didn't arrive whole from ${from}`, outgoing: false }); return; }
    this.onEvent({ kind: 'received', transfer, peer, name: from, title, count, size: total, files, taken });
  }
  /** One incoming file (after its header), checked against its size and SHA-256 before it's kept. */
  private async takeFile(c: Conn, ss: Session, size: number, parts: string[], progress: { add: (n: number) => void }, transfer: number): Promise<Arrived | null> {
    const chunks: Uint8Array[] = []; const hash = new Sha256(); let got = 0; let done = false;
    while (!this.stopped(transfer)) {
      const f = await c.opened(ss, 30_000); if (!f || f.length === 0) break;
      if (f[0] === Proto.FRAME_DATA) { const n = f.length - 1; if (got + n > size) break; const d = f.subarray(1); chunks.push(d); hash.update(d); got += n; progress.add(n); }
      else if (f[0] === Proto.FRAME_END && f.length === 1 + 8 + 32) { done = new Reader(f, 1).u64n() === size && got === size && equal(hash.digest(), f.subarray(9, 41)); break; }
      else break;
    }
    if (!done) return null;
    const name = parts[parts.length - 1]; const type = mimeOf(name);
    return { name, parts, blob: new Blob(chunks as BlobPart[], { type }), type };
  }

  // ---- music ----
  private async receiveMusic(c: Conn, ss: Session): Promise<void> {
    const peer = hex(ss.peerId); const from = this.nameOf(peer, ss.peerName);
    const offer = await c.opened(ss, 15_000); if (!offer) return; const r = new Reader(offer);
    if (r.u8() !== Proto.FRAME_MUSIC || offer.length < 1 + 8 + 8 + 1 + 8) return;
    const position = Math.max(0, r.f64()!); const duration = Math.max(0, r.f64()!); const playing = r.u8()! !== 0; const size = r.u64n()!;
    const rest = r.rest(); const nul = rest.indexOf(0);
    const cover = nul >= 0 && rest.length - nul - 1 <= Proto.COVER_LIMIT ? rest.slice(nul + 1) : null;
    const lines = [...fromUtf8(rest.subarray(0, nul >= 0 ? nul : rest.length)).split('\n').map((s) => s.slice(0, 512)), '', '', '', '', ''];
    const music: Handoff = { title: lines[0], artist: lines[1], album: lines[2], app: lines[3], fileName: size > 0 ? safeName(lines[4]) : '', position, duration, playing, fileSize: size, cover: cover && cover.length ? cover : null };
    if (!music.title || size < 0 || size > 2 * 2 ** 30) return;
    const transfer = this.newTransfer(); this.live.get(transfer)!.conn = c;
    const d = deferred<number>(); this.decisions.set(transfer, d);
    this.onEvent({ kind: 'music', transfer, peer, name: from, music });
    let code = await this.decide(c, d); this.decisions.delete(transfer);
    if (code === -1) { this.finish(transfer); this.onEvent({ kind: 'failed', transfer, peer, name: from, title: music.title, detail: `${from} took the music back`, outgoing: false }); return; }
    if (code < 0 || code > 2 || (code === 2 && size === 0)) code = code === 2 ? 1 : 0;
    if (code === 2 && !(await this.room(size))) code = 1;
    if (!(await c.sealed(ss, Uint8Array.of(code))) || code !== 2) { this.finish(transfer); await sleep(300); return; }
    const progress = this.progress(transfer, peer, from, music.title, size, false);
    const f = await c.opened(ss, 30_000);
    let saved: Arrived | null = null;
    if (f && f.length >= 10 && f[0] === Proto.FRAME_HEADER && new Reader(f, 1).u64n() === size) saved = await this.takeFile(c, ss, size, [music.fileName || 'song'], progress, transfer);
    const end = saved ? await c.opened(ss, 30_000) : null;
    const whole = !!saved && !!end && end.length === 1 && end[0] === Proto.FRAME_BATCH_END;
    if (whole) await c.sealed(ss, Uint8Array.of(1));
    this.finish(transfer);
    if (!whole) { this.onEvent({ kind: 'failed', transfer, peer, name: from, title: music.title, detail: `The song didn't arrive whole from ${from}`, outgoing: false }); return; }
    this.onEvent({ kind: 'musicFile', transfer, peer, name: from, music, file: saved! });
  }
  /** Answers music offered to this device: 0 no, 1 yes, 2 yes and send the song's file. */
  answerMusic(transfer: number, code: number): void { this.decisions.get(transfer)?.resolve(Math.min(2, Math.max(0, code))); }
  /** Answers files offered to this device. */
  answer(transfer: number, accept: boolean): void { this.decisions.get(transfer)?.resolve(accept ? 1 : 0); }

  /** Offers what plays here to a paired PC (no file: the PC finds the song itself). The PC's answer, or null. */
  async handoff(peer: string, music: Handoff): Promise<number | null> {
    const [c, ss] = await this.reach(peer, Proto.MODE_MUSIC, null); if (!c) return null;
    try {
      const text = [music.title, music.artist, music.album, music.app, ''].map((s) => s.slice(0, 512).replace(/[\n\r\0]/g, ' ')).join('\n');
      const b = new Bytes().u8(Proto.FRAME_MUSIC).f64(music.position).f64(music.duration).u8(music.playing ? 1 : 0).u64(0).text(text);
      if (music.cover && music.cover.length && music.cover.length <= Proto.COVER_LIMIT) b.u8(0).raw(music.cover);
      if (!(await c.sealed(ss, b.build()))) return null;
      const reply = await c.opened(ss, 90_000);
      return reply && reply.length === 1 ? reply[0] : null;
    } finally { c.close(); }
  }

  // ---- a PC's Shelf ----
  async shelf(peer: string): Promise<ShelfList> {
    const [t, why0] = this.target(peer); if (!t) return { shared: false, items: [], error: why0 };
    if (t.revision < 1) return { shared: false, items: [], error: `Update Arnav Island on ${t.name} to see its Shelf` };
    const [c, ss, why] = await this.reach(peer, Proto.MODE_LIST, null); if (!c) return { shared: false, items: [], error: why };
    try {
      const list = await c.opened(ss, 15_000); if (!list) return { shared: false, items: [], error: `${t.name} didn't answer` };
      const r = new Reader(list); if (r.u8() !== Proto.FRAME_SHELF) return { shared: false, items: [], error: `${t.name} didn't answer` };
      const shared = (r.u8() ?? 0) !== 0; const n = Math.min(r.u32() ?? 0, Proto.SHELF_MAX);
      const items: ShelfItem[] = [];
      for (let i = 0; i < n; i++) {
        const size = r.u64n(); const folder = r.u8(); const len = r.u8(); if (size === null || folder === null || len === null) break;
        const nb = r.bytes(len); if (!nb) break; const pl = r.u32(); if (pl === null || pl > Proto.PREVIEW_LIMIT) break;
        const preview = r.bytes(pl); if (!preview) break;
        items.push({ name: fromUtf8(nb), size, folder: folder !== 0, preview: preview.length ? preview : null });
      }
      return { shared, items };
    } finally { c.close(); }
  }
  /** Takes a PC's Shelf item (by its place in the list and its name) onto this device. */
  take(peer: string, index: number, name: string): number {
    const transfer = this.newTransfer();
    void (async () => {
      const [t, why0] = this.target(peer); let why = why0; let taken = false; const pcName = t?.name ?? this.nameOf(peer, '');
      if (t && t.revision < 1) why = `Update Arnav Island on ${t.name} to take from its Shelf`;
      else if (t) {
        const [c, ss, w] = await this.reach(peer, Proto.MODE_TAKE, transfer); why = w;
        if (c) try {
          const offer = (await c.sealed(ss, new Bytes().u8(Proto.FRAME_TAKE).u32(index).text(name).build())) ? await c.opened(ss, 90_000) : null;
          const r = offer ? new Reader(offer) : null;
          if (!offer || offer.length < 5 || r!.u8() !== Proto.FRAME_OFFER) why = this.stopped(transfer) ? 'You stopped it' : `${pcName} didn't answer`;
          else {
            const count = r!.u32() ?? 0;
            if (offer.length < 14 || count === 0) why = `It's no longer on ${pcName}'s Shelf`;
            else {
              const total = r!.u64n()!; r!.u8(); const title = cleanName(fromUtf8(r!.rest()));
              if (count > Proto.MAX_FILES || total > Proto.MAX_TOTAL) why = 'That is too much to take at once';
              else {
                const room = await this.room(total);
                if (!(await c.sealed(ss, Uint8Array.of(room ? 1 : 2)))) why = `${pcName} stopped answering`;
                else if (!room) why = "There isn't room on this device";
                else { await this.takeBatch(c, ss, peer, pcName, title, count, total, transfer, true); taken = true; }
              }
            }
          }
        } finally { c.close(); }
      }
      if (!taken) { this.finish(transfer); this.onEvent({ kind: 'failed', transfer, peer, name: pcName, title: name, detail: why || "It didn't come", outgoing: false }); }
    })();
    return transfer;
  }

  // ---- revision 2 and 4: the remote, on a connection kept open ----
  private async onKept<T>(peer: string, mode: number, ask: (c: Conn, ss: Session) => Promise<T | null>): Promise<[T | null, string]> {
    const key = `${peer}/${mode}`;
    const before = this.keptLocks.get(key) ?? Promise.resolve();
    let release!: () => void; const mine = new Promise<void>((r) => { release = r; });
    this.keptLocks.set(key, before.then(() => mine));
    await before;
    try {
      for (let attempt = 0; attempt <= 1; attempt++) {
        const now = Date.now();
        let e = this.kept.get(key);
        if (e && (now - e.used > 45_000 || e.c.closed || e.c.ended)) { e.c.close(); this.kept.delete(key); e = undefined; }
        const fresh = !e;
        if (!e) { const [c, ss, why] = await this.reach(peer, mode, null); if (!c) return [null, why]; e = { c, ss, used: now }; this.kept.set(key, e); }
        let result: T | null = null;
        try { result = await ask(e.c, e.ss); } catch { result = null; }
        if (result !== null) { e.used = Date.now(); return [result, '']; }
        e.c.close(); if (this.kept.get(key) === e) this.kept.delete(key);
        if (fresh) return [null, ''];
      }
      return [null, ''];
    } finally { release(); }
  }
  private dropKept(): void { for (const e of this.kept.values()) e.c.close(); this.kept.clear(); }

  /** One remote command to a paired PC: its answer, or null when it couldn't be asked (with why in lastRemoteError). */
  async remote(peer: string, command: number, payload: Uint8Array = new Uint8Array(0)): Promise<RemoteReply | null> {
    const [t, why0] = this.target(peer); if (!t) { this.lastRemoteError = why0; return null; }
    if (t.revision < 2) { this.lastRemoteError = `Update Arnav Island on ${t.name} to control it from your phone`; return null; }
    const request = new Bytes().u8(Proto.FRAME_REQUEST).u8(command).raw(payload).build();
    if (t.revision >= 4) {
      const [reply, why] = await this.onKept(peer, Proto.MODE_REMOTE, async (c, ss) => {
        if (!(await c.sealed(ss, request))) return null;
        const f = await c.opened(ss, 10_000); if (!f) return null;
        const r = new Reader(f); if (r.u8() !== Proto.FRAME_REPLY) return null;
        const status = r.u8(); return status === null ? null : ({ status, payload: r.rest() } as RemoteReply);
      });
      if (!reply) this.lastRemoteError = why || `${t.name} didn't answer`;
      return reply;
    }
    const [c, ss, why] = await this.reach(peer, Proto.MODE_REMOTE, null); if (!c) { this.lastRemoteError = why; return null; }
    try {
      if (!(await c.sealed(ss, request))) return null;
      const reply = await c.opened(ss, 10_000); if (!reply) { this.lastRemoteError = `${t.name} didn't answer`; return null; }
      const r = new Reader(reply); if (r.u8() !== Proto.FRAME_REPLY) return null;
      const status = r.u8(); if (status === null) return null;
      return { status, payload: r.rest() };
    } finally { c.close(); }
  }
  private async ask(peer: string, command: number, payload: Uint8Array = new Uint8Array(0)): Promise<Uint8Array | null> {
    const r = await this.remote(peer, command, payload); return r && r.status === Proto.OK ? r.payload : null;
  }
  /** The PC's status for the remote. [haveCover]: the hash of the cover shown here (so it isn't sent again). */
  async status(peer: string, haveCover: Uint8Array | null, previous: PcStatus | null): Promise<PcStatus | null> {
    const reply = await this.remote(peer, Proto.CMD_STATUS, haveCover && haveCover.length === 32 ? haveCover : new Uint8Array(32)); if (!reply) return null;
    if (reply.status !== Proto.OK) { this.lastRemoteError = reply.status === Proto.NOT_ALLOWED ? 'Remote control is off on that PC' : "That PC couldn't answer"; return null; }
    return parseStatus(reply.payload, previous);
  }
  async stats(peer: string): Promise<PcStats | null> { const p = await this.ask(peer, Proto.CMD_STATS); return p ? parseStats(p) : null; }
  async battery(peer: string): Promise<PcBattery | null> { const p = await this.ask(peer, Proto.CMD_BATTERY); return p ? parseBattery(p) : null; }
  async islandSettings(peer: string): Promise<IslandSettings | null> { const p = await this.ask(peer, Proto.CMD_SETTINGS, Uint8Array.of(0)); return p ? parseSettings(p) : null; }
  /** Changes one of the island's settings; the value it has now (the island may keep it within its range), or null. */
  async setIslandSetting(peer: string, key: string, value: number): Promise<number | null> { const p = await this.ask(peer, Proto.CMD_SETTINGS, new Bytes().u8(1).string(key).u32(value).build()); return p ? parseValue(p) : null; }
  async islandSettingAction(peer: string, action: number): Promise<boolean> { return (await this.ask(peer, Proto.CMD_SETTINGS, new Bytes().u8(2).u8(action).build())) !== null; }
  async controls(peer: string): Promise<PcControls | null> { const p = await this.ask(peer, Proto.CMD_CONTROLS, Uint8Array.of(0)); return p ? parseControls(p) : null; }
  async setControl(peer: string, control: number, value: number): Promise<PcControls | null> { const p = await this.ask(peer, Proto.CMD_CONTROLS, new Bytes().u8(1).u8(control).u32(value).build()); return p ? parseControls(p) : null; }
  async queryCommands(peer: string, text: string): Promise<CommandResults | null> { const p = await this.ask(peer, Proto.CMD_COMMAND, new Bytes().u8(0).string(text).build()); return p ? parseCommands(p) : null; }
  async runCommand(peer: string, text: string, index: number, title: string, confirmed: boolean): Promise<CommandOutcome | null> {
    const p = await this.ask(peer, Proto.CMD_COMMAND, new Bytes().u8(1).string(text).u8(index).string(title).u8(confirmed ? 1 : 0).build()); return p ? parseOutcome(p) : null;
  }
  async outputs(peer: string): Promise<AudioOutput[] | null> { const p = await this.ask(peer, Proto.CMD_AUDIO, Uint8Array.of(0)); return p ? parseOutputs(p) : null; }
  /** Makes an output the PC's default: the status (NOT_ALLOWED when the island's direct output switching is off). */
  async selectOutput(peer: string, id: string): Promise<number> { return (await this.remote(peer, Proto.CMD_AUDIO, new Bytes().u8(1).string(id).build()))?.status ?? Proto.FAILED; }
  async openIslandPage(peer: string, page: number): Promise<boolean> { return (await this.ask(peer, Proto.CMD_ISLAND, Uint8Array.of(0, page))) !== null; }
  async closeIsland(peer: string): Promise<boolean> { return (await this.ask(peer, Proto.CMD_ISLAND, Uint8Array.of(1))) !== null; }

  async notice(peer: string, frame: Uint8Array): Promise<boolean> {
    const [t] = this.target(peer); if (!t || t.revision < 2) return false;
    if (t.revision >= 4) {
      const [ok] = await this.onKept(peer, Proto.MODE_NOTICE, async (c, ss) => {
        if (!(await c.sealed(ss, frame))) return null;
        const a = await c.opened(ss, 10_000); return a && a.length > 0 && a[0] === Proto.FRAME_NOTICE_ACK ? true : null;
      });
      return ok === true;
    }
    const [c, ss] = await this.reach(peer, Proto.MODE_NOTICE, null); if (!c) return false;
    try { if (!(await c.sealed(ss, frame))) return false; const a = await c.opened(ss, 10_000); return !!a && a.length > 0 && a[0] === Proto.FRAME_NOTICE_ACK; }
    finally { c.close(); }
  }
  /** A PC rang this device (find my phone). */
  private async ringed(c: Conn, ss: Session): Promise<void> {
    const f = await c.opened(ss, 15_000); if (!f || f[0] !== Proto.FRAME_RING) return;
    await c.sealed(ss, Uint8Array.of(Proto.FRAME_RING_ACK));
    this.onEvent({ kind: 'ring', peer: hex(ss.peerId), name: this.nameOf(hex(ss.peerId), ss.peerName) });
    await sleep(300);
  }

  // ---- the trackpad and keyboard (revision 3) ----
  async openInput(peer: string): Promise<InputSession | null> {
    const [t] = this.target(peer); if (!t || t.revision < 3) return null;
    const [c, ss] = await this.reach(peer, Proto.MODE_INPUT, null);
    return c ? new InputSession(c, ss) : null;
  }

  // ---- revision 7: screens ----
  /** Opens a screen with a PC (island 0.24): its answer to [request], and the session; null when it can't be reached. */
  async openScreen(peer: string, request: Uint8Array): Promise<[ScreenSession, Uint8Array] | null> {
    const [t] = this.target(peer); if (!t || t.revision < 7) return null;
    const [c, ss] = await this.reach(peer, Proto.MODE_MIRROR, null); if (!c) return null;
    const s = new ScreenSession(c, ss);
    if (!(await s.send(request))) return null;
    let reply: Uint8Array | null = null; const end = Date.now() + 10_000;
    while (!reply && s.open && Date.now() < end) reply = await s.receive(1000);
    if (!reply || reply.length === 0 || reply[0] !== Proto.SCREEN_REPLY) { s.close(); return null; }
    return [s, reply];
  }
}

/** A session of input frames to a PC, kept open while the trackpad shows. */
export class InputSession {
  open = true;
  constructor(private c: Conn, private ss: Session) {}
  async send(frame: Uint8Array): Promise<boolean> { if (!this.open) return false; const ok = await this.c.sealed(this.ss, frame); if (!ok) this.close(); return ok; }
  close(): void { this.open = false; this.c.close(); }
  get alive(): boolean { return this.open && !this.c.ended; }
}
/** A screen's connection: sends are sealed in order; one loop receives. */
export class ScreenSession {
  open = true;
  constructor(private c: Conn, private ss: Session) {}
  async send(frame: Uint8Array): Promise<boolean> { if (!this.open) return false; const ok = await this.c.sealed(this.ss, frame); if (!ok) this.close(); return ok; }
  /** Waits only for a frame to start; once one has, it's read whole. */
  async receive(timeoutMs: number): Promise<Uint8Array | null> {
    if (!this.open) return null;
    try {
      if (!(await this.c.pipe.inbound.waitForFrame(Math.max(1, timeoutMs)))) return null;
      const f = await this.c.opened(this.ss, 20_000);
      if (!f) { this.close(); return null; }
      return f;
    } catch (e) { if (!(e instanceof TimedOut)) this.close(); return null; }
  }
  close(): void { this.open = false; this.c.close(); }
}

export function mimeOf(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const m: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp', svg: 'image/svg+xml',
    mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm', mkv: 'video/x-matroska',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg',
    pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', zip: 'application/zip',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', key: 'application/x-iwork-keynote-sffkey', pages: 'application/x-iwork-pages-sffpages',
  };
  return m[ext] ?? 'application/octet-stream';
}

export { Closed };
