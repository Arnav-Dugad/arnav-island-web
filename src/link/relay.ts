// Paired devices on different networks meet through free public MQTT brokers (HiveMQ, EMQX and Eclipse Mosquitto), over
// secure WebSockets, exactly as the Windows island's ShareRelay and the Android app's Relay.kt do. Topics are named from each
// pair's own secret (SHA-256 of the pair's static ECDH, which only the two devices can compute), and every message is
// sealed with AES-256-GCM under a key from it, so a broker sees only random-looking topics and sealed bytes.
//
// A connection is a tunnel: the session protocol runs over it unchanged, and its bytes travel in numbered messages with a
// window of acknowledgements, sent again when a broker drops one. A browser can't open UDP, so there is no direct path:
// this app says so in its hellos (no direct flag), and the island keeps to the brokers for it.
import { Bytes, Reader, concat, equal, fromUtf8, hex, utf8 } from './bytes';
import { Seal, randomBytes, sha256 } from './crypto';
import { Closed, Inbound, type Pipe } from './stream';

export interface PairLink { code: string; key: Uint8Array | null }
export interface Presence { here: boolean; phone: boolean; revision: number; name: string }
/** How a paired device is reached: kind 0 not at all, 1 through the brokers; the relay's round trip (ms, 0 unknown); brokers it's heard on. */
export interface Path { kind: number; rtt: number; brokers: number }
export interface RelayPair { peer: Uint8Array; agreed: Uint8Array }

const VERSION = 1;
const KIND_HELLO = 1, KIND_OPEN = 2, KIND_DATA = 3, KIND_ACK = 4, KIND_CLOSE = 5, KIND_PROBE = 7, KIND_PROBE_ACK = 8;
const HELLO_REPLY = 1, HELLO_PHONE = 2, HELLO_LEAVING = 4;
const CHUNK = 48 * 1024, WINDOW = 64, ACK_EVERY = 24;
const RTO_BASE = 1_500, RTO_MOST = 8_000, NACK_EVERY = 300, RESEND_BATCH = 8, DATA_FLAGS = 2 + 16 + 8 + 4;
const RELAY_PROBE_EVERY = 20_000;
const PREFIX = 'arnavisland/r1/';
export const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const DEFAULT_BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];

const topic = (hash: Uint8Array) => PREFIX + hex(hash).substring(0, 40);

/** A typed code made canonical ("7k2p mx4q" becomes "7K2PMX4Q"), or null when it can't be one. */
export function canonicalCode(typed: string): string | null {
  let s = '';
  for (const ch of typed) { if (ch === ' ' || ch === '-') continue; const c = ch.toUpperCase(); if (!ALPHABET.includes(c)) return null; s += c; }
  return s.length === 8 ? s : null;
}

/** The pairing link in an island's QR code, "arnavisland://pair/7K2PMX4Q?k=<20 hex digits>" (or this site's /pair/ link). */
export function pairLink(text: string): PairLink | null {
  let t = text.trim();
  const web = t.match(/^https:\/\/[^/]+\/(?:#\/)?pair\/(.*)$/i);
  if (web) t = 'arnavisland://pair/' + web[1];
  const prefix = 'arnavisland://pair/';
  if (t.slice(0, prefix.length).toLowerCase() !== prefix) return null;
  const rest = t.slice(prefix.length).split('#')[0];
  const code = canonicalCode(rest.split('?')[0].replace(/\/+$/, ''));
  if (!code) return null;
  const q = rest.includes('?') ? rest.slice(rest.indexOf('?') + 1) : '';
  const k = q.split('&').find((p) => p.toLowerCase().startsWith('k='))?.slice(2);
  const key = k && /^[0-9a-f]{20}$/i.test(k) ? Uint8Array.from(k.match(/../g)!.map((h) => parseInt(h, 16))) : null;
  return { code, key };
}

function mqttString(s: string): Uint8Array { const b = utf8(s); return concat(Uint8Array.of(b.length >> 8, b.length & 0xff), b); }
function packet(head: number, body: Uint8Array): Uint8Array {
  const len: number[] = []; let n = body.length;
  do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; len.push(d); } while (n > 0);
  return concat(Uint8Array.of(head), Uint8Array.from(len), body);
}
const connectPacket = (client: string) => packet(0x10, concat(mqttString('MQTT'), Uint8Array.of(4, 2, 0, 60), mqttString(client)));

class Route {
  heard: number[]; helloed = 0; presence: Presence = { here: false, phone: false, revision: 0, name: '' };
  relayRtt = 0; relayProbedAt = 0;
  constructor(public peer: string, public seal: Seal, public outbox: string, brokers: number, public code = false, public host = false) { this.heard = new Array(brokers).fill(0); }
}

/** One tunnel: a stream this side reads and writes, carried as numbered messages on one broker. */
class Tunnel implements Pipe {
  readonly inbound = new Inbound();
  sent = 0; acked = 0; expected = 0; acknowledged = 0;
  dead = false; closeSent = false; inEnd = false; heard = false;
  unacked = new Map<number, Uint8Array>(); early = new Map<number, Uint8Array>();
  rto = RTO_BASE; progressAt = 0; resendAt = 0; resentAt = 0; nackedFor = -1; nackedAt = 0; dupAckAt = 0; gapSince = 0;
  private queue: Uint8Array[] = []; private queued = 0; private pumping = false; private windowWait: (() => void) | null = null;
  private endAsked = false;
  constructor(private relay: Relay, public conn: bigint, public outbox: string, public seal: Seal, public broker: number, public open: Uint8Array | null, public route: string) {}

  /** Bytes written and not yet sent (the window is full). */
  backlog(): number { return this.queued; }
  write(b: Uint8Array): boolean {
    if (this.dead || this.endAsked) return false;
    if (b.length) { this.queue.push(b); this.queued += b.length; }
    void this.pump();
    return true;
  }
  /** Ends this side once everything written has gone (and been acknowledged, or 20 s have passed). */
  close(): void { if (this.endAsked) return; this.endAsked = true; void this.pump(); }
  /** Ends it now, both ways. */
  kill(): void { if (this.dead) return; this.dead = true; this.inbound.end(); this.wakeWindow(); void this.sendClose(); this.relay.finished(this); }
  wakeWindow(): void { const w = this.windowWait; this.windowWait = null; w?.(); }
  async sendClose(): Promise<void> { if (this.closeSent) return; this.closeSent = true; await this.relay.publishTo(this.outbox, this.seal, this.relay.envelope(KIND_CLOSE).u64(this.conn).build(), this.broker); }
  private waitWindow(ms: number): Promise<void> { return new Promise((resolve) => { const t = setTimeout(() => { this.windowWait = null; resolve(); }, ms); this.windowWait = () => { clearTimeout(t); resolve(); }; }); }

  private async pump(): Promise<void> {
    if (this.pumping) return; this.pumping = true;
    try {
      while (!this.dead && this.queued > 0) {
        // Never more than the window ahead of the acknowledgements.
        const until = Date.now() + 60_000;
        while (!this.dead && this.sent - this.acked >= WINDOW && Date.now() < until) await this.waitWindow(until - Date.now());
        if (this.dead || this.sent - this.acked >= WINDOW) { this.kill(); break; }
        const chunk = this.take(CHUNK);
        const seq = this.sent++;
        // The end of what the protocol wrote for now: the other side is asked to say it has it all.
        const ackNow = this.queued === 0 || this.sent - this.acked >= ACK_EVERY;
        const b = this.relay.envelope(KIND_DATA).u64(this.conn).u32(seq).u8(ackNow ? 1 : 0).raw(chunk).build();
        const now = Date.now();
        if (this.unacked.size === 0) { this.progressAt = now; this.resendAt = now + this.rto; }
        this.unacked.set(seq, b);
        if (this.relay.loseEvery > 0 && ++this.relay.lost % this.relay.loseEvery === 0) continue;
        if (!(await this.relay.publishTo(this.outbox, this.seal, b, this.broker))) { this.kill(); break; }
      }
      if (this.endAsked && !this.dead && this.queued === 0) {
        // Everything written arrives before the end is said, unless the other side ended first.
        const until = Date.now() + 20_000;
        while (!this.dead && !this.inEnd && this.acked < this.sent && Date.now() < until) await this.waitWindow(until - Date.now());
        this.kill();
      }
    } finally { this.pumping = false; }
  }
  private take(n: number): Uint8Array {
    let size = 0; const parts: Uint8Array[] = [];
    while (this.queue.length && size < n) {
      const c = this.queue[0]; const k = Math.min(c.length, n - size);
      parts.push(k === c.length ? c : c.subarray(0, k)); size += k;
      if (k === c.length) this.queue.shift(); else this.queue[0] = c.subarray(k);
    }
    this.queued -= size;
    return parts.length === 1 ? parts[0] : concat(...parts);
  }
  /** The first few unacknowledged messages, the last asking to be acknowledged. */
  resendable(): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (const [, v] of [...this.unacked.entries()].sort((a, b) => a[0] - b[0])) { out.push(v.slice()); if (out.length >= RESEND_BATCH) break; }
    const last = out[out.length - 1];
    if (last && last.length > DATA_FLAGS) last[DATA_FLAGS] |= 1;
    return out;
  }
}

/** One broker's connection: a WebSocket speaking MQTT 3.1.1, kept up with backoff. */
class Broker {
  ws: WebSocket | null = null; up = false; lastIn = 0; lastPing = 0; fails = 0; timer: ReturnType<typeof setTimeout> | null = null;
  private buffer: Uint8Array = new Uint8Array(0);
  /** Messages are handled one at a time, in order (opening a seal is asynchronous). */
  chain: Promise<void> = Promise.resolve();
  constructor(public index: number, public url: string) {}
  get host(): string { try { return new URL(this.url).hostname; } catch { return this.url; } }
  write(p: Uint8Array): boolean {
    const ws = this.ws; if (!ws || ws.readyState !== 1) return false;
    try { ws.send(p as unknown as ArrayBuffer); return true; } catch { return false; }
  }
  /** Bytes in; whole packets out. */
  feed(b: Uint8Array, on: (head: number, body: Uint8Array) => void): boolean {
    this.buffer = this.buffer.length ? concat(this.buffer, b) : b;
    for (;;) {
      if (this.buffer.length < 2) return true;
      let n = 0, mult = 1, at = 1;
      for (;;) {
        if (at >= this.buffer.length) return true;
        const d = this.buffer[at++]; n += (d & 127) * mult;
        if ((d & 128) === 0) break;
        mult *= 128; if (at > 4) return false;
      }
      if (this.buffer.length < at + n) return true;
      const head = this.buffer[0]; const body = this.buffer.slice(at, at + n);
      this.buffer = this.buffer.subarray(at + n);
      on(head, body);
    }
  }
  reset(): void { this.buffer = new Uint8Array(0); }
}

export interface RelayOptions {
  id: Uint8Array; name: () => string; phone: boolean; revision: number;
  /** A tunnel the other device opened: the stream, and whose it is ("" for a code's). */
  incoming: (t: Pipe & { inbound: Inbound }, peer: string) => void;
  changed: () => void;
  brokers?: string[];
  /** Tests: the first sending of every Nth data message is left out (as a broker might drop it). */
  loseEvery?: number;
}

export class Relay {
  private brokers: Broker[];
  private routes = new Map<string, Route>();
  private tunnels = new Map<bigint, Tunnel>();
  private ended = new Map<bigint, number>();
  private code: string | null = null; private codeUntil = 0;
  private stopping = false; private nextPacket = 1;
  private subacks = new Map<string, (ok: boolean) => void>();
  private ticker: ReturnType<typeof setInterval> | null = null;
  private resender: ReturnType<typeof setInterval> | null = null;
  readonly loseEvery: number; lost = 0;
  private id: Uint8Array;

  constructor(private o: RelayOptions) {
    this.id = o.id;
    this.brokers = (o.brokers ?? DEFAULT_BROKERS).slice(0, 6).map((u, i) => new Broker(i, u));
    this.loseEvery = o.loseEvery ?? 0;
  }

  get connected(): boolean { return this.brokers.some((b) => b.up); }
  get brokersUp(): number { return this.brokers.filter((b) => b.up).length; }
  get broker(): string | null { const up = this.brokers.filter((b) => b.up).map((b) => b.host); return up.length ? up.join(', ') : null; }

  start(): void {
    this.stopping = false;
    for (const b of this.brokers) this.dial(b);
    this.ticker = setInterval(() => this.tick(), 5_000);
    this.resender = setInterval(() => this.resend(), 200);
  }
  stop(): void {
    if (this.connected) {
      for (const [inbox, r] of this.routes) if (!r.code) void this.hello(inbox, false, true, -1);
      setTimeout(() => this.writeTo(-1, Uint8Array.of(0xe0, 0)), 150);
    }
    this.stopping = true;
    if (this.ticker) clearInterval(this.ticker); if (this.resender) clearInterval(this.resender);
    setTimeout(() => { for (const b of this.brokers) { if (b.timer) clearTimeout(b.timer); try { b.ws?.close(); } catch { /* gone */ } b.ws = null; b.up = false; } }, 300);
    this.dropAll();
  }
  /** The page came back (or the network changed): brokers that went quiet are dialled again at once. */
  kick(): void {
    if (this.stopping) return;
    const now = Date.now();
    for (const b of this.brokers) {
      if (b.up && now - b.lastIn < 40_000) { b.lastPing = now; b.write(Uint8Array.of(0xc0, 0)); continue; }
      if (b.timer) { clearTimeout(b.timer); b.timer = null; }
      try { b.ws?.close(); } catch { /* gone */ }
      b.fails = 0; if (!b.ws || b.ws.readyState > 1) this.dial(b);
    }
  }

  // ---- the brokers ----
  private writeTo(broker: number, p: Uint8Array): boolean {
    if (broker >= 0) { const b = this.brokers[broker]; return !!b && b.up && b.write(p); }
    let any = false; for (const b of this.brokers) if (b.up && b.write(p)) any = true; return any;
  }
  private dial(b: Broker): void {
    if (this.stopping) return;
    let ws: WebSocket;
    try { ws = new WebSocket(b.url, 'mqtt'); } catch { this.redial(b, false); return; }
    ws.binaryType = 'arraybuffer';
    b.ws = ws; b.reset(); b.lastIn = Date.now();
    let worked = false;
    const opened = setTimeout(() => { if (!b.up) try { ws.close(); } catch { /* gone */ } }, 12_000);
    ws.onopen = () => { b.write(connectPacket('ai' + hex(randomBytes(10)))); };
    ws.onmessage = (e) => {
      if (b.ws !== ws) return;
      b.lastIn = Date.now();
      const ok = b.feed(new Uint8Array(e.data as ArrayBuffer), (head, body) => {
        const kind = head >> 4;
        if (kind === 2) { if (body.length >= 2 && body[1] === 0 && !b.up) { b.up = true; worked = true; b.fails = 0; clearTimeout(opened); this.onConnected(b); } }
        else if (kind === 9) { if (body.length >= 2) { const key = `${b.index}/${(body[0] << 8) | body[1]}`; const w = this.subacks.get(key); if (w) { this.subacks.delete(key); w(body.length < 3 || body[2] !== 0x80); } } }
        else if (kind === 3) {
          if (body.length < 2) return;
          const tn = (body[0] << 8) | body[1]; if (body.length < 2 + tn) return;
          let at = 2 + tn; if (((head >> 1) & 3) !== 0) at += 2; if (at > body.length) return;
          const t = fromUtf8(body.subarray(2, 2 + tn)); const payload = body.slice(at);
          b.chain = b.chain.then(() => this.onPublish(b.index, t, payload)).catch(() => {});
        }
      });
      if (!ok) try { ws.close(); } catch { /* gone */ }
    };
    ws.onclose = ws.onerror = () => {
      if (b.ws !== ws) return;
      clearTimeout(opened);
      const was = b.up; b.up = false; b.ws = null;
      this.brokerDown(b.index);
      if (was) this.o.changed();
      this.redial(b, worked);
    };
  }
  private redial(b: Broker, worked: boolean): void {
    if (this.stopping || b.timer) return;
    b.fails = worked ? 0 : b.fails + 1;
    // A broker that can't be reached is tried less and less often, at most every minute.
    const wait = worked ? 1_000 : Math.min(60_000, 1_000 * 2 ** Math.min(b.fails, 6));
    b.timer = setTimeout(() => { b.timer = null; this.dial(b); }, wait);
  }
  /** A broker went: its tunnels end, and what was heard there no longer counts. */
  private brokerDown(index: number): void {
    const now = Date.now();
    for (const r of this.routes.values()) { r.heard[index] = 0; r.presence = { ...r.presence, here: this.hereAnywhere(r, now) }; }
    for (const [k, w] of this.subacks) if (k.startsWith(`${index}/`)) { this.subacks.delete(k); w(false); }
    for (const t of [...this.tunnels.values()]) if (t.broker === index) { t.closeSent = true; t.kill(); }
  }
  /** Present: heard on a broker (that is up) within the last 150 s; each device says hello on each once a minute. */
  private hereAnywhere(r: Route, now: number): boolean { return this.brokers.some((b) => b.up && r.heard[b.index] !== 0 && now - r.heard[b.index] <= 150_000); }
  /** The broker to open a tunnel on: the one the other device was heard on most lately (and this one is on). */
  private bestBroker(r: Route): number { let best = -1, at = 0; for (const b of this.brokers) if (b.up && r.heard[b.index] > at) { at = r.heard[b.index]; best = b.index; } return best; }

  private tick(): void {
    if (this.stopping) return;
    const now = Date.now();
    for (const b of this.brokers) {
      if (b.up && now - b.lastPing >= 30_000) { b.lastPing = now; b.write(Uint8Array.of(0xc0, 0)); }
      // A socket gone silent past two pings is dead (a phone asleep leaves them hanging).
      if (b.up && now - b.lastIn > 75_000) try { b.ws?.close(); } catch { /* gone */ }
    }
    if (!this.connected) return;
    let gone = false; const hello: string[] = [];
    for (const [inbox, r] of this.routes) {
      if (r.code) continue;
      if (now - r.helloed >= 60_000) hello.push(inbox);
      const here = this.hereAnywhere(r, now);
      if (r.presence.here !== here) { r.presence = { ...r.presence, here }; gone = true; }
      // The relay's round trip, for the connection's quality.
      if (r.presence.here && now - r.relayProbedAt >= RELAY_PROBE_EVERY) {
        const b = this.bestBroker(r);
        if (b >= 0) { r.relayProbedAt = now; void this.publishTo(r.outbox, r.seal, this.envelope(KIND_PROBE).raw(randomBytes(8)).u64(now).build(), b); }
      }
    }
    if (this.code && now > this.codeUntil) { const left = this.stopHostingNow(); if (left.length) this.unsubscribe(left); }
    for (const h of hello) void this.hello(h, false, false, -1);
    if (gone) this.o.changed();
  }
  private onConnected(b: Broker): void {
    const inboxes = [...this.routes.keys()];
    if (inboxes.length) void this.subscribe(inboxes, false, b.index);
    for (const [inbox, r] of this.routes) if (!r.code) void this.hello(inbox, true, false, b.index);
    this.o.changed();
  }
  /** Subscribes on one broker, or on all that are up; waiting (up to 8 s) for them to confirm, true when one did. */
  private async subscribe(topics: string[], wait: boolean, only = -1): Promise<boolean> {
    const waits: Promise<boolean>[] = [];
    for (const b of this.brokers) {
      if ((only >= 0 && b.index !== only) || !b.up) continue;
      const pid = this.nextPacket++; if (this.nextPacket > 65535) this.nextPacket = 1;
      const body = new Bytes().u8(pid >> 8).u8(pid & 0xff); for (const t of topics) body.raw(mqttString(t)).u8(0);
      const key = `${b.index}/${pid}`;
      if (wait) waits.push(new Promise<boolean>((resolve) => { const t = setTimeout(() => { this.subacks.delete(key); resolve(false); }, 8_000); this.subacks.set(key, (ok) => { clearTimeout(t); resolve(ok); }); }));
      if (!b.write(packet(0x82, body.build()))) { const w = this.subacks.get(key); if (w) { this.subacks.delete(key); w(false); } }
    }
    if (!wait) return true;
    if (!waits.length) return false;
    // True as soon as one confirms.
    return new Promise<boolean>((resolve) => { let left = waits.length; for (const w of waits) void w.then((ok) => { if (ok) resolve(true); else if (--left === 0) resolve(false); }); });
  }
  private unsubscribe(topics: string[]): void {
    for (const b of this.brokers) {
      if (!b.up) continue;
      const pid = this.nextPacket++; if (this.nextPacket > 65535) this.nextPacket = 1;
      const body = new Bytes().u8(pid >> 8).u8(pid & 0xff); for (const t of topics) body.raw(mqttString(t));
      b.write(packet(0xa2, body.build()));
    }
  }

  // ---- messages ----
  envelope(kind: number): Bytes { return new Bytes().u8(VERSION).u8(kind).raw(this.id); }
  async publishTo(t: string, seal: Seal, plain: Uint8Array, broker: number): Promise<boolean> {
    const sealed = await seal.seal(plain, t);
    return this.writeTo(broker, packet(0x30, concat(mqttString(t), sealed)));
  }
  private async hello(inbox: string, reply: boolean, leaving: boolean, broker: number): Promise<void> {
    const r = this.routes.get(inbox); if (!r) return;
    if (broker < 0) r.helloed = Date.now();
    let n = utf8(this.o.name()); if (n.length > 120) n = n.slice(0, 120);
    const flags = (reply ? HELLO_REPLY : 0) | (this.o.phone ? HELLO_PHONE : 0) | (leaving ? HELLO_LEAVING : 0);
    await this.publishTo(r.outbox, r.seal, this.envelope(KIND_HELLO).u8(flags).u8(this.o.revision).u8(n.length).raw(n).build(), broker);
  }
  /** A tunnel's messages count only on its own broker (the first to carry one from the other side, when it had none). */
  private tunnelFor(conn: bigint, from: number): Tunnel | null {
    const t = this.tunnels.get(conn); if (!t) return null;
    if (t.broker < 0) t.broker = from;
    return t.broker === from ? t : null;
  }
  private async onPublish(from: number, t: string, payload: Uint8Array): Promise<void> {
    const r = this.routes.get(t); if (!r) return;
    const plain = await r.seal.open(payload, t); if (!plain) return;
    if (plain.length < 18 || plain[0] !== VERSION) return;
    const sender = plain.subarray(2, 18); if (equal(sender, this.id)) return; if (!r.code && hex(sender) !== r.peer) return;
    const p = plain.subarray(18); const rd = new Reader(p);
    switch (plain[1]) {
      case KIND_HELLO: {
        if (r.code || p.length < 3) return;
        const flags = p[0]; const size = Math.min(p[2], p.length - 3);
        const now = Date.now();
        // A goodbye is said on every broker: the device has gone from all of them.
        if (flags & HELLO_LEAVING) r.heard.fill(0); else r.heard[from] = now;
        const presence: Presence = { here: this.hereAnywhere(r, now), phone: (flags & HELLO_PHONE) !== 0, revision: p[1], name: fromUtf8(p.subarray(3, 3 + size)) };
        const was = r.presence; r.presence = presence;
        const changed = was.here !== presence.here || was.phone !== presence.phone || was.revision !== presence.revision || was.name !== presence.name;
        // Answered on the broker it came by, so the other device learns this one is there too.
        if (flags & HELLO_REPLY) void this.hello(t, false, false, from);
        if (changed) this.o.changed();
        return;
      }
      case KIND_OPEN: {
        const conn = rd.u64(); if (conn === null || this.tunnels.has(conn) || this.ended.has(conn)) return;
        const tunnel = this.startTunnel(conn, r.outbox, r.seal, from, null, t); if (!tunnel) return;
        this.o.incoming(tunnel, r.code ? '' : r.peer);
        return;
      }
      case KIND_DATA: {
        if (p.length < 13) return;
        const conn = rd.u64()!; const seq = rd.u32()!; const flags = rd.u8()!;
        const tn = this.tunnelFor(conn, from); if (!tn) return;
        let reply = -1; const now = Date.now(); tn.heard = true;
        if (seq < tn.expected) {
          // Had already (its acknowledgement was lost): said again, so the sender stops sending it.
          if (now - tn.dupAckAt >= NACK_EVERY) { tn.dupAckAt = now; reply = tn.expected; }
        } else if (seq > tn.expected) {
          // Something before it was lost: this one is kept, and the sender told what's missing.
          if (seq - tn.expected < 2 * WINDOW) tn.early.set(seq, p.slice(13));
          if (tn.gapSince === 0) tn.gapSince = now;
          if (tn.nackedFor !== tn.expected || now - tn.nackedAt >= NACK_EVERY) { tn.nackedFor = tn.expected; tn.nackedAt = now; reply = tn.expected; }
        } else {
          tn.inbound.push(p.slice(13)); tn.expected++;
          let filled = false;
          for (;;) { const next = tn.early.get(tn.expected); if (!next) break; tn.early.delete(tn.expected); tn.inbound.push(next); tn.expected++; filled = true; }
          tn.gapSince = tn.early.size === 0 ? 0 : now;
          if ((flags & 1) !== 0 || filled || tn.expected - tn.acknowledged >= ACK_EVERY) reply = tn.expected;
        }
        if (reply >= 0) { tn.acknowledged = Math.max(tn.acknowledged, reply); await this.publishTo(tn.outbox, tn.seal, this.envelope(KIND_ACK).u64(conn).u32(reply).build(), tn.broker); }
        return;
      }
      case KIND_ACK: {
        const conn = rd.u64(); const next = rd.u32(); if (conn === null || next === null) return;
        const tn = this.tunnelFor(conn, from); if (!tn) return;
        const now = Date.now(); tn.heard = true; let again: Uint8Array[] = [];
        if (next > tn.acked && next <= tn.sent) {
          for (let s = tn.acked; s < next; s++) tn.unacked.delete(s);
          tn.acked = next; tn.progressAt = now; tn.rto = RTO_BASE; tn.resendAt = now + RTO_BASE;
          tn.wakeWindow();
        } else if (next === tn.acked && next < tn.sent && now - tn.resentAt >= NACK_EVERY) {
          // The other side is missing this one: sent again at once, with a few after it.
          tn.resentAt = now; again = tn.resendable();
        }
        for (const m of again) await this.publishTo(tn.outbox, tn.seal, m, tn.broker);
        return;
      }
      case KIND_CLOSE: {
        const conn = rd.u64(); if (conn === null) return;
        const tn = this.tunnelFor(conn, from); if (!tn) return;
        tn.inEnd = true; tn.closeSent = true; tn.inbound.end(); tn.wakeWindow();
        return;
      }
      case KIND_PROBE: {
        // Answered on its broker (the relay's round trip, for the connection's quality).
        if (r.code || p.length < 16) return;
        await this.publishTo(r.outbox, r.seal, this.envelope(KIND_PROBE_ACK).raw(p.slice(0, 16)).build(), from);
        return;
      }
      case KIND_PROBE_ACK: {
        if (r.code || p.length < 16) return;
        rd.u64(); const sentAt = rd.u64n()!;
        const rtt = Date.now() - sentAt; if (rtt < 0 || rtt > 30_000) return;
        const before = r.relayRtt; r.relayRtt = before > 0 ? before * 0.7 + rtt * 0.3 : rtt;
        if (before <= 0 || Math.abs(r.relayRtt - before) > before * 0.15) this.o.changed();
        return;
      }
    }
  }

  // ---- tunnels ----
  private startTunnel(conn: bigint, outbox: string, seal: Seal, broker: number, open: Uint8Array | null, route: string): Tunnel | null {
    if (!this.connected) return null;
    const t = new Tunnel(this, conn, outbox, seal, broker, open, route);
    this.tunnels.set(conn, t);
    return t;
  }
  finished(t: Tunnel): void { this.tunnels.delete(t.conn); this.ended.set(t.conn, Date.now()); }
  /**
   * Five times a second: what wasn't acknowledged in time is sent again (with its OPEN while nothing was heard back), the
   * wait doubling up to 8 s; a tunnel that got nowhere for 45 s (or kept a gap 30 s) ends.
   */
  private resend(): void {
    const now = Date.now();
    for (const [k, at] of this.ended) if (now - at > 120_000) this.ended.delete(k);
    for (const t of [...this.tunnels.values()]) {
      if (t.dead) continue;
      let again: Uint8Array[] = []; let open: Uint8Array | null = null; let end = false;
      if (t.unacked.size && now >= t.resendAt) {
        if (now - t.progressAt > 45_000) end = true;
        else { again = t.resendable(); if (!t.heard) open = t.open; t.resentAt = now; t.rto = Math.min(t.rto * 2, RTO_MOST); t.resendAt = now + t.rto; }
      }
      if (t.gapSince > 0 && now - t.gapSince > 30_000) end = true;
      if (end) { t.kill(); continue; }
      void (async () => {
        if (open) await this.publishTo(t.outbox, t.seal, open, t.broker);
        for (const m of again) await this.publishTo(t.outbox, t.seal, m, t.broker);
      })();
    }
  }
  private dropAll(): void {
    for (const t of [...this.tunnels.values()]) { t.closeSent = true; t.kill(); }
    for (const r of this.routes.values()) { r.heard.fill(0); r.presence = { ...r.presence, here: false }; }
  }
  private async openTunnel(outbox: string, seal: Seal, broker: number, route: string): Promise<Tunnel | null> {
    const conn = new Reader(randomBytes(8)).u64()!;
    const open = this.envelope(KIND_OPEN).u64(conn).build();
    const t = this.startTunnel(conn, outbox, seal, broker, open, route); if (!t) return null;
    if (!(await this.publishTo(outbox, seal, open, broker))) { t.kill(); return null; }
    return t;
  }

  // ---- what the link asks ----
  async pairs(list: RelayPair[]): Promise<void> {
    const added: string[] = []; const next = new Map<string, Route>();
    for (const p of list) {
      if (p.peer.length !== 16 || p.agreed.length !== 32) continue;
      const secret = await sha256('arnav-relay-v1', p.agreed);
      const inbox = topic(await sha256('inbox', secret, this.id)); const outbox = topic(await sha256('inbox', secret, p.peer));
      const old = this.routes.get(inbox);
      if (old && !old.code) { next.set(inbox, old); continue; }
      next.set(inbox, new Route(hex(p.peer), await Seal.create(await sha256('arnav-relay-key', secret)), outbox, this.brokers.length)); added.push(inbox);
    }
    for (const [k, v] of this.routes) if (v.code) next.set(k, v);
    const left = [...this.routes.keys()].filter((k) => !next.has(k));
    this.routes = next;
    if (this.connected && left.length) this.unsubscribe(left);
    if (this.connected && added.length) { await this.subscribe(added, false); for (const a of added) void this.hello(a, true, false, -1); }
  }
  presence(peer: string): Presence {
    for (const r of this.routes.values()) if (!r.code && r.peer === peer) return r.presence;
    return { here: false, phone: false, revision: 0, name: '' };
  }
  path(peer: string): Path {
    const now = Date.now();
    for (const r of this.routes.values()) {
      if (r.code || r.peer !== peer) continue;
      const heard = this.brokers.filter((b) => b.up && r.heard[b.index] !== 0 && now - r.heard[b.index] <= 150_000).length;
      return r.presence.here && heard > 0 ? { kind: 1, rtt: r.relayRtt, brokers: heard } : { kind: 0, rtt: 0, brokers: heard };
    }
    return { kind: 0, rtt: 0, brokers: 0 };
  }
  /** Through the broker the device was heard on most lately. */
  async open(peer: string): Promise<[Tunnel | null, string]> {
    let entry: [string, Route] | null = null;
    for (const e of this.routes) if (!e[1].code && e[1].peer === peer) { entry = e; break; }
    if (!entry) return [null, 'Pair with it first'];
    const r = entry[1];
    if (!this.connected) return [null, "You're not connected to the internet"];
    const broker = this.bestBroker(r);
    if (!r.presence.here || broker < 0) return [null, `${r.presence.name || 'It'} isn't online`];
    const t = await this.openTunnel(r.outbox, r.seal, broker, entry[0]);
    return t ? [t, ''] : [null, 'The connection through the internet failed'];
  }
  /** Offers a pairing code for ten minutes, listened for on every broker; null when no broker can be reached. */
  async host(): Promise<string | null> {
    if (!this.connected) return null;
    let c = ''; const r = randomBytes(8);
    for (let i = 0; i < 8; i++) c += ALPHABET[r[i] % 31];
    const secret = await sha256('arnav-pair-code-v1', utf8(c));
    const inbox = topic(await sha256('host', secret)); const outbox = topic(await sha256('guest', secret));
    const left = this.stopHostingNow();
    this.routes.set(inbox, new Route('', await Seal.create(await sha256('arnav-pair-code-key', secret)), outbox, this.brokers.length, true, true));
    this.code = c; this.codeUntil = Date.now() + 600_000;
    if (left.length) this.unsubscribe(left);
    if (!(await this.subscribe([inbox], true))) { this.stopHosting(); return null; }
    return c.slice(0, 4) + '-' + c.slice(4);
  }
  stopHosting(): void { const left = this.stopHostingNow(); if (left.length) this.unsubscribe(left); }
  get hosting(): string | null { return this.code ? this.code.slice(0, 4) + '-' + this.code.slice(4) : null; }
  private stopHostingNow(): string[] {
    this.code = null;
    const left = [...this.routes.entries()].filter(([, v]) => v.host).map(([k]) => k);
    for (const k of left) this.routes.delete(k);
    return left;
  }
  /** A tunnel to the device showing this code: opened on every broker, it keeps to whichever the other device answers on. */
  async openCode(typed: string): Promise<[Tunnel | null, string]> {
    const c = canonicalCode(typed); if (!c) return [null, "That isn't a pairing code"];
    if (!this.connected) return [null, "You're not connected to the internet"];
    const secret = await sha256('arnav-pair-code-v1', utf8(c));
    const inbox = topic(await sha256('guest', secret)); const outbox = topic(await sha256('host', secret));
    const seal = await Seal.create(await sha256('arnav-pair-code-key', secret));
    this.routes.set(inbox, new Route('', seal, outbox, this.brokers.length, true));
    if (!(await this.subscribe([inbox], true))) return [null, 'The connection through the internet failed'];
    const t = await this.openTunnel(outbox, seal, -1, inbox);
    return t ? [t, ''] : [null, 'The connection through the internet failed'];
  }
  /** Waits (up to [ms]) for a broker. */
  async ready(ms: number): Promise<boolean> {
    const until = Date.now() + ms;
    while (!this.connected && Date.now() < until) await new Promise((r) => setTimeout(r, 150));
    return this.connected;
  }
}

export { Closed };
