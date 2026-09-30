// Everything the app knows, for every screen: the link with your PCs, what it reports, and the actions the screens take
// (the Android app's Hub, for the web). State lives in signals, so any part of the app can read it and redraws follow.
import { batch, computed, signal } from '@preact/signals';
import { Bytes, Reader, hex } from '../link/bytes';
import {
  type AudioOutput, type CommandOutcome, type CommandResults, type FocusState, type Handoff, type IslandSettings, type Lyrics, type PcBattery,
  type PcControls, type PcStats, type PcStatus, type PeerView, type RemoteReply, Frames, parseFocus, parseLyrics, remoteCapable,
} from '../link/island';
import { type Arrived, Link, type LinkEvent, type LinkStore, type Source, type StoredPeer, mimeOf } from '../link/link';
import { Proto } from '../link/proto';
import { idb, openFrom, openVault, sealTo, vaultKey } from './db';
import { lockConfig } from './lock';
import { deviceDetails, deviceName } from './device';

/** A transfer under way, either way. rate: bytes a second, smoothed. */
export interface Transfer { id: number; peer: string; name: string; title: string; done: number; total: number; outgoing: boolean; rate: number; sampledAt: number; sampledDone: number }
/** Something that happened between this device and a PC. kind: 0 received, 1 sent, 2 taken from a Shelf. files: kept here (ids). */
export interface Moment { kind: number; title: string; from: string; count: number; size: number; at: number; files: string[] }
export type BannerKind = 'received' | 'sent' | 'failed' | 'paired' | 'info' | 'music' | 'ring' | 'update' | 'clipboard' | 'photo' | 'internet' | 'lock';
export interface Banner { kind: BannerKind; title: string; detail?: string }
export interface Prefs {
  appearance: number; glass: boolean; weather: boolean; tilt: boolean; autoAccept: boolean; details: boolean; pc: string | null; name: string;
  haptics: boolean; sounds: boolean; keepAwake: boolean; autoLock: number; installSeen: boolean; welcomed: boolean; quality: number;
}
export interface StatsPoint { at: number; cpu: number; gpu: number; download: number; upload: number }
export interface PageArrived { url: string; title: string; scroll: number; from: string; at: number }
export interface ClipArrived { text: string; sensitive: boolean; from: string }
export interface PlayingHere { music: Handoff; peer: string; from: string; url: string }
/** Something another app (or a Shortcut) handed this app: files, text or a link, for a PC. */
export interface ShareRequest { files: File[]; text: string | null; target: string | null }

const DEFAULTS: Prefs = {
  appearance: 0, glass: true, weather: true, tilt: false, autoAccept: false, details: true, pc: null, name: '', haptics: true, sounds: true,
  keepAwake: true, autoLock: 0, installSeen: false, welcomed: false, quality: 0,
};

// ---- state ----
export const ready = signal(false);
export const locked = signal(false);
export const running = signal(false);
export const failure = signal<string | null>(null);
export const internet = signal(false);
export const peers = signal<PeerView[]>([]);
export const prefs = signal<Prefs>({ ...DEFAULTS });
export const pairCode = signal<Extract<LinkEvent, { kind: 'pairCode' }> | null>(null);
export const pairResult = signal<Extract<LinkEvent, { kind: 'paired' }> | null>(null);
/** The code this device is pairing with (typed, scanned or opened as a link), until its digits or an answer come. */
export const codePairing = signal<string | null>(null);
export const offers = signal<Extract<LinkEvent, { kind: 'offer' }>[]>([]);
export const music = signal<Extract<LinkEvent, { kind: 'music' }> | null>(null);
export const transfers = signal<Map<number, Transfer>>(new Map());
export const outcomes = signal<{ transfer: number; ok: boolean; n: number } | null>(null);
export const moments = signal<Moment[]>([]);
export const banner = signal<Banner | null>(null);
export const ringing = signal<{ from: string; at: number } | null>(null);
export const status = signal<PcStatus | null>(null);
export const statusError = signal<string | null>(null);
export const lyrics = signal<Lyrics | null>(null);
export const pcStats = signal<PcStats | null>(null);
export const pcControls = signal<PcControls | null>(null);
export const controlsAt = signal(0);
export const islandSettings = signal<IslandSettings | null>(null);
export const outputs = signal<AudioOutput[]>([]);
export const pcBattery = signal<PcBattery | null>(null);
export const statsTrail = signal<StatsPoint[]>([]);
export const focus = signal<FocusState | null>(null);
export const pageArrived = signal<PageArrived | null>(null);
export const clipArrived = signal<ClipArrived | null>(null);
/** A PC asked for a photo for its Shelf (its id). */
export const photoFor = signal<string | null>(null);
export const playingHere = signal<PlayingHere | null>(null);
export const shareRequest = signal<ShareRequest | null>(null);
/** Things a screen should open now ("island", "trackpad", "pair", "camera"...). */
export const requests = signal<{ what: string; n: number } | null>(null);
export const visible = signal(typeof document === 'undefined' ? true : document.visibilityState === 'visible');

let link: Link | null = null;
export const getLink = () => link;

/** The PC the remote and sends go to: the chosen one while it is paired, else the first paired PC that is here. */
export function pickPc(list: PeerView[] = peers.value, chosen: string | null = prefs.value.pc): PeerView | null {
  return list.find((p) => p.id === chosen && p.paired) ?? list.find((p) => p.paired && p.online && !p.phone) ?? list.find((p) => p.paired && !p.phone) ?? null;
}
export const pc = computed(() => pickPc(peers.value, prefs.value.pc));
export const islandReady = (p: PeerView | null = pc.value) => !!p && p.online && p.revision >= 5;

let requestN = 0;
export function request(what: string) { requests.value = { what, n: ++requestN }; }

// ---- banners: one at a time, each for a moment ----
const bannerQueue: Banner[] = [];
let bannerBusy = false;
export function say(b: Banner) {
  bannerQueue.push(b); if (bannerQueue.length > 4) bannerQueue.shift();
  if (!bannerBusy) void showBanners();
}
async function showBanners() {
  bannerBusy = true;
  while (bannerQueue.length) {
    const next = bannerQueue.shift()!; banner.value = next;
    await new Promise((r) => setTimeout(r, next.kind === 'failed' ? 3600 : 2600));
    banner.value = null;
    await new Promise((r) => setTimeout(r, 380));
  }
  bannerBusy = false;
}

// ---- prefs, kept sealed ----
export function setPrefs(change: Partial<Prefs>) { prefs.value = { ...prefs.value, ...change }; void sealTo('prefs', prefs.value); }

// ---- the store the link keeps its keys in ----
const store: LinkStore = {
  async loadIdentity() {
    const v = await idb.get<{ id: Uint8Array; pub: Uint8Array; key: CryptoKey }>('identity');
    return v && v.id && v.pub && v.key ? v : null;
  },
  async saveIdentity(id, pub, key) { return idb.set('identity', { id, pub, key }); },
  async loadPeers() {
    const list = (await openFrom<{ id: string; key: string; name: string; phone: boolean; revision: number }[]>('peers')) ?? [];
    return list.map((p) => ({ ...p, key: Uint8Array.from((p.key.match(/../g) ?? []).map((h) => parseInt(h, 16))) }));
  },
  async savePeers(list: StoredPeer[]) { await sealTo('peers', list.map((p) => ({ ...p, key: hex(p.key) }))); },
};

// ---- life ----
/** Opens the vault (after Face ID when the lock is on) and starts the link. */
export async function boot(): Promise<void> {
  const lock = await lockConfig();
  if (lock?.on && lock.prf) { locked.value = true; ready.value = true; return; }
  if (!lock?.prf) await openVault();
  if (lock?.on) locked.value = true;
  await afterUnlock();
}
/** The vault is open: what it keeps is read, and the link starts. */
export async function afterUnlock(): Promise<void> {
  if (!vaultKey.get()) await openVault();
  const saved = await openFrom<Prefs>('prefs');
  batch(() => {
    prefs.value = { ...DEFAULTS, ...(saved ?? {}), name: saved?.name || deviceName() };
    ready.value = true;
  });
  moments.value = (await openFrom<Moment[]>('moments')) ?? [];
  focus.value = (() => { const f = focus.value; return f && (!f.running || f.mode === 2 || focusEnd(f) > Date.now()) ? f : null; })();
  if (!locked.value) await start();
}
export function focusEnd(f: FocusState) { return f.at + Math.max(0, f.shown) * 1000; }

export async function start(): Promise<void> {
  if (link) return;
  const l = new Link(store, prefs.value.name || deviceName(), onEvent);
  l.onQuery = async (peer, command, payload) => (peers.value.some((p) => p.id === peer && p.paired) ? answerQuery(peer, command, payload) : null);
  link = l;
  if (!(await l.start())) { failure.value = l.failure ?? "The link couldn't start"; link = null; return; }
  batch(() => { running.value = true; failure.value = null; peers.value = l.peerViews(); });
  pickDefault();
}
export function stop() { link?.stop(); link = null; batch(() => { running.value = false; internet.value = false; peers.value = []; }); }
/** The page came back to the front (or the network changed): brokers that went quiet are dialled again. */
export function wake() { link?.wake(); }
export function rename(name: string) { const n = name.trim().slice(0, 40) || deviceName(); setPrefs({ name: n }); if (link) link.displayName = n; }

function pickDefault() { const p = pickPc(); if (p && p.id !== prefs.value.pc) choose(p.id); }
export function choose(peer: string) {
  if (prefs.value.pc !== peer) clearIsland();
  setPrefs({ pc: peer }); status.value = null;
}

const lastOnline = new Set<string>();
function onEvent(e: LinkEvent) {
  switch (e.kind) {
    case 'peers': {
      batch(() => { peers.value = e.peers; internet.value = link?.internet === true; });
      pickDefault();
      // A PC that just came online hears this device's details at once.
      const online = new Set(e.peers.filter((p) => p.paired && p.online && remoteCapable(p)).map((p) => p.id));
      let arrived = false; for (const id of online) if (!lastOnline.has(id)) arrived = true;
      lastOnline.clear(); online.forEach((id) => lastOnline.add(id));
      if (arrived) sendDetails(true);
      return;
    }
    case 'internet': internet.value = e.up; return;
    case 'pairCode': batch(() => { codePairing.value = null; pairCode.value = e; }); return;
    case 'paired':
      batch(() => { codePairing.value = null; pairCode.value = null; pairResult.value = e; });
      if (e.ok) { if (!pc.value || !prefs.value.pc) choose(e.peer); say({ kind: 'paired', title: `Paired with ${e.name}`, detail: 'Files, music and the remote are ready, on any network' }); sendDetails(true); }
      else say({ kind: 'failed', title: e.name ? `Not paired with ${e.name}` : 'Not paired', detail: e.detail });
      return;
    case 'offer':
      if (prefs.value.autoAccept) { link?.answer(e.transfer, true); return; }
      offers.value = [...offers.value, e]; return;
    case 'progress': {
      const map = new Map(transfers.value); const now = Date.now(); const old = map.get(e.transfer);
      let t: Transfer = old ? { ...old, done: e.done, total: e.total, title: e.title } : { id: e.transfer, peer: e.peer, name: e.name, title: e.title, done: e.done, total: e.total, outgoing: e.outgoing, rate: 0, sampledAt: now, sampledDone: e.done };
      if (old && now - old.sampledAt >= 300 && e.done >= old.sampledDone) {
        const speed = ((e.done - old.sampledDone) * 1000) / (now - old.sampledAt);
        t = { ...t, rate: old.rate > 0 ? old.rate * 0.7 + speed * 0.3 : speed, sampledAt: now, sampledDone: e.done };
      }
      map.set(e.transfer, t); transfers.value = map; return;
    }
    case 'received': {
      dropTransfer(e.transfer); offers.value = offers.value.filter((o) => o.transfer !== e.transfer);
      void keepFiles(e.files).then((ids) => remember({ kind: e.taken ? 2 : 0, title: e.title, from: e.name, count: e.count, size: e.size, at: Date.now(), files: ids }));
      say({ kind: 'received', title: e.taken ? `Took ${e.title}` : `Received ${e.title}`, detail: `From ${e.name}  ·  ${sizeText(e.size)}` });
      lastArrived.value = { files: e.files, title: e.title, from: e.name, n: ++arrivedN };
      return;
    }
    case 'sent':
      dropTransfer(e.transfer); outcomes.value = { transfer: e.transfer, ok: true, n: ++outcomeN };
      remember({ kind: 1, title: e.title, from: e.name, count: e.count, size: e.size, at: Date.now(), files: [] });
      say({ kind: 'sent', title: `Sent ${e.title}`, detail: `To ${e.name}  ·  ${sizeText(e.size)}` });
      return;
    case 'failed':
      if (e.outgoing) outcomes.value = { transfer: e.transfer, ok: false, n: ++outcomeN };
      dropTransfer(e.transfer); offers.value = offers.value.filter((o) => o.transfer !== e.transfer);
      if (music.value?.transfer === e.transfer) music.value = null;
      if (e.detail !== 'You stopped it') say({ kind: 'failed', title: e.title ? `Couldn't share ${e.title}` : "Couldn't share", detail: e.detail });
      return;
    case 'music': musicOfferedAt = Date.now(); music.value = e; return;
    case 'musicFile': {
      dropTransfer(e.transfer);
      const start = Math.max(0, e.music.position + Math.min(600_000, Math.max(0, musicAnsweredAt - musicOfferedAt)) / 1000);
      playHere({ ...e.music, position: start }, e.peer, e.name, e.file);
      return;
    }
    case 'ring': ringing.value = { from: e.name, at: Date.now() }; return;
    case 'photoRequested': photoFor.value = e.peer; request('camera'); return;
    case 'clipboard': clipArrived.value = { text: e.text, sensitive: e.sensitive, from: e.name }; return;
  }
}
let outcomeN = 0, arrivedN = 0;
/** The files that just arrived (the Received sheet shows them, ready to save or share). */
export const lastArrived = signal<{ files: Arrived[]; title: string; from: string; n: number } | null>(null);
function dropTransfer(id: number) { if (!transfers.value.has(id)) return; const m = new Map(transfers.value); m.delete(id); transfers.value = m; }

// ---- files kept here (for Recent) ----
const KEEP_BYTES = 768 * 2 ** 20;
async function keepFiles(files: Arrived[]): Promise<string[]> {
  const ids: string[] = [];
  for (const f of files.slice(0, 20)) {
    const id = hex(crypto.getRandomValues(new Uint8Array(8)));
    if (await idb.set('file:' + id, { name: f.name, type: f.type, blob: f.blob, at: Date.now() })) ids.push(id);
  }
  // What's kept stays within its room: the oldest go first.
  let total = files.reduce((a, f) => a + f.blob.size, 0);
  moments.value = moments.value.map((m) => { total += m.size; if (total <= KEEP_BYTES || !m.files.length) return m; for (const id of m.files) void idb.del('file:' + id); return { ...m, files: [] }; });
  return ids;
}
export async function keptFile(id: string): Promise<{ name: string; type: string; blob: Blob } | null> { return (await idb.get<{ name: string; type: string; blob: Blob }>('file:' + id)) ?? null; }
function remember(m: Moment) { moments.value = [m, ...moments.value].slice(0, 40); void sealTo('moments', moments.value); }
export function clearMoments() { for (const m of moments.value) for (const id of m.files) void idb.del('file:' + id); moments.value = []; void sealTo('moments', []); }

// ---- music from a PC ----
let musicOfferedAt = 0, musicAnsweredAt = 0;
/** Continues a PC's music here: from the song's own file when the PC has one, else in a music app by searching for it. */
export function answerMusic(e: Extract<LinkEvent, { kind: 'music' }>, play: boolean) {
  const l = link; if (!l) return; musicAnsweredAt = Date.now();
  if (!play) { l.answerMusic(e.transfer, 0); music.value = null; return; }
  if (e.music.fileSize > 0) { l.answerMusic(e.transfer, 2); return; }
  l.answerMusic(e.transfer, 1); music.value = null; playFromSearch(e.music);
}
function playFromSearch(m: Handoff) {
  const q = encodeURIComponent([m.title, m.artist].filter((s) => s.trim()).join(' '));
  const app = m.app.toLowerCase();
  const url = app.includes('spotify') ? `https://open.spotify.com/search/${q}` : app.includes('youtube') ? `https://music.youtube.com/search?q=${q}` : `https://music.apple.com/search?term=${q}`;
  const where = app.includes('spotify') ? 'In Spotify' : app.includes('youtube') ? 'In YouTube Music' : 'In Apple Music';
  window.open(url, '_blank', 'noopener,noreferrer');
  say({ kind: 'music', title: `Continuing ${m.title}`, detail: where });
}
let audio: HTMLAudioElement | null = null;
export const playerState = signal<{ playing: boolean; position: number; duration: number; at: number }>({ playing: false, position: 0, duration: 0, at: 0 });
function publishPlayer() {
  const a = audio; if (!a) return;
  playerState.value = { playing: !a.paused, position: a.currentTime, duration: Number.isFinite(a.duration) ? a.duration : 0, at: Date.now() };
}
function playHere(m: Handoff, peer: string, from: string, file: Arrived) {
  closePlayer();
  const url = URL.createObjectURL(file.blob);
  const a = new Audio(); a.src = url; a.preload = 'auto';
  a.addEventListener('loadedmetadata', () => { if (m.position > 0 && m.position < a.duration - 2) a.currentTime = m.position; publishPlayer(); });
  for (const ev of ['play', 'pause', 'ended', 'seeked', 'durationchange']) a.addEventListener(ev, publishPlayer);
  audio = a;
  playingHere.value = { music: m, peer, from, url };
  music.value = null;
  // The lock screen's player (Media Session): the song, its cover, and its controls.
  try {
    const ms = navigator.mediaSession;
    const artwork = m.cover ? [{ src: URL.createObjectURL(new Blob([m.cover as BlobPart], { type: 'image/jpeg' })), sizes: '512x512', type: 'image/jpeg' }] : [];
    ms.metadata = new MediaMetadata({ title: m.title, artist: m.artist, album: m.album || `From ${from}`, artwork });
    ms.setActionHandler('play', () => void a.play());
    ms.setActionHandler('pause', () => a.pause());
    ms.setActionHandler('seekto', (d) => { if (d.seekTime !== undefined) a.currentTime = d.seekTime; });
    ms.setActionHandler('seekbackward', () => { a.currentTime = Math.max(0, a.currentTime - 10); });
    ms.setActionHandler('seekforward', () => { a.currentTime = Math.min(a.duration || 0, a.currentTime + 10); });
  } catch { /* no Media Session */ }
  a.play().then(() => say({ kind: 'music', title: 'Playing here', detail: m.title })).catch(() => say({ kind: 'music', title: `${m.title} is ready`, detail: 'Tap play below to start it' }));
}
export function togglePlayer() { const a = audio; if (!a) return; if (a.paused) void a.play(); else a.pause(); }
export function closePlayer() {
  if (audio) { audio.pause(); audio.src = ''; audio = null; }
  const p = playingHere.value; if (p) URL.revokeObjectURL(p.url);
  playingHere.value = null;
  try { navigator.mediaSession.metadata = null; } catch { /* none */ }
}
/** Sends what plays back to the PC it came from, from where it has got to, and stops here. */
export function sendBack() {
  const p = playingHere.value; const a = audio; if (!p || !a) return;
  const d = Number.isFinite(a.duration) ? a.duration : 0; const position = d > 0 && a.currentTime >= d - 1 ? 0 : a.currentTime;
  void handBack({ ...p.music, position, playing: true }, p.peer); closePlayer();
}
export async function handBack(m: Handoff, peer: string) {
  const code = await link?.handoff(peer, m);
  say(code == null ? { kind: 'failed', title: "Couldn't reach the PC" } : code === 0 ? { kind: 'info', title: 'The PC said not now' } : { kind: 'music', title: 'Playing on your PC', detail: m.title });
}

// ---- pairing ----
const BUSY = 'Another pairing is under way. Finish it first';
/** Pairs with the PC showing this code on its island (any network). [key], from its QR code: that PC is known for sure. */
export function pairWithCode(code: string, key: Uint8Array | null = null) {
  pairResult.value = null; codePairing.value = code;
  void (async () => {
    for (let i = 0; i < 50 && !link; i++) await new Promise((r) => setTimeout(r, 100));
    const why = !link ? 'Starting… try again in a moment' : !link.pairWithCode(code, key) ? BUSY : null;
    if (why) batch(() => { codePairing.value = null; pairResult.value = { kind: 'paired', peer: '', name: '', ok: false, detail: why }; });
  })();
}
export function confirmPair(yes: boolean) { link?.confirmPair(yes); if (!yes) pairCode.value = null; }
export async function forget(peer: string) { await link?.forget(peer); if (prefs.value.pc === peer) { setPrefs({ pc: null }); pickDefault(); } }

// ---- files ----
export function answer(offer: Extract<LinkEvent, { kind: 'offer' }>, accept: boolean) { link?.answer(offer.transfer, accept); offers.value = offers.value.filter((o) => o.transfer !== offer.transfer); }
export function cancel(transfer: number) { link?.cancel(transfer); }
/** Files to a PC, in one transfer; [toShelf]: onto its island's Shelf. Returns the transfer, or null. */
export async function send(peer: string, files: File[], opts: { toShelf?: boolean; ask?: number } = {}): Promise<number | null> {
  const l = link; if (!l) { say({ kind: 'failed', title: 'Not connected', detail: 'Open Arnav Island and try again' }); return null; }
  if (!files.length) return null;
  const used = new Set<string>();
  const sources: Source[] = files.map((f) => {
    let name = cleanFileName(f.name || 'file', f.type); let n = 2;
    while (used.has(name.toLowerCase())) { const dot = name.lastIndexOf('.'); name = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`; n++; }
    used.add(name.toLowerCase());
    return { rel: name, size: f.size, blob: f };
  });
  const title = sources.length === 1 ? sources[0].rel : `${sources[0].rel} and ${sources.length - 1} more`;
  const target = peers.value.find((p) => p.id === peer);
  // A picture of the first one, for the island to show as it arrives.
  const preview = await previewOf(files[0]);
  const id = l.send(peer, sources, title, { toShelf: opts.toShelf, preview, ask: opts.ask });
  const map = new Map(transfers.value);
  map.set(id, { id, peer, name: target?.name ?? 'your PC', title, done: 0, total: sources.reduce((a, s) => a + s.size, 0), outgoing: true, rate: 0, sampledAt: Date.now(), sampledDone: 0 });
  transfers.value = map;
  return id;
}
function cleanFileName(name: string, type: string): string {
  let n = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'file';
  // Photos from the library come named "image.jpg"; a time makes each distinct.
  if (/^image\.(jpe?g|png|heic)$/i.test(n)) { const d = new Date(); n = `Photo ${d.toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.')}.${n.split('.').pop()}`; }
  if (!n.includes('.') && type) { const ext = type.split('/')[1]?.replace('jpeg', 'jpg').replace('quicktime', 'mov'); if (ext && /^[a-z0-9]{2,5}$/.test(ext)) n += '.' + ext; }
  return n.slice(0, 120);
}
/** A small JPEG of a picture (at most 96 KB), or null. */
export async function previewOf(f: File | Blob | undefined, side = 480): Promise<Uint8Array | null> {
  if (!f || !f.type.startsWith('image/') || f.size > 80 * 2 ** 20) return null;
  try {
    const bmp = await createImageBitmap(f);
    const s = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(bmp, 0, 0, w, h); bmp.close();
    for (const q of [0.8, 0.65, 0.5, 0.35]) {
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', q));
      if (blob && blob.size <= 96 * 1024) return new Uint8Array(await blob.arrayBuffer());
    }
  } catch { /* not a picture this browser decodes */ }
  return null;
}
/** A photo taken for a PC: onto its Shelf (the PC that asked, else the chosen one). */
export async function sendPhoto(file: File) {
  const target = (photoFor.value ? peers.value.find((p) => p.id === photoFor.value && p.paired) : null) ?? pc.value;
  photoFor.value = null;
  if (!target) { say({ kind: 'failed', title: 'No PC yet', detail: 'Pair with your PC first' }); return; }
  await send(target.id, [file], { toShelf: target.revision >= 3 });
  say({ kind: 'photo', title: `On its way to ${target.name}`, detail: target.revision >= 3 ? 'It lands on the island’s Shelf' : 'It goes to the PC’s Downloads' });
}

// ---- the remote ----
/** One remote command to the chosen PC; null (with a banner saying why) when it couldn't be done. */
export async function command(cmd: number, payload: Uint8Array = new Uint8Array(0), quiet = false): Promise<RemoteReply | null> {
  const l = link; const p = pc.value;
  if (!l || !p) { if (!quiet) say({ kind: 'failed', title: 'No PC yet', detail: 'Pair with your PC first' }); return null; }
  if (!remoteCapable(p) && p.online) { if (!quiet) say({ kind: 'failed', title: `Update Arnav Island on ${p.name}`, detail: 'The remote needs version 0.19 or later' }); return null; }
  const reply = await l.remote(p.id, cmd, payload);
  if (!reply) { if (!quiet) say({ kind: 'failed', title: `${p.name} didn't answer`, detail: l.lastRemoteError || 'Is Arnav Island running there?' }); }
  else if (reply.status === Proto.NOT_ALLOWED) { if (!quiet) say({ kind: 'failed', title: `${p.name} said no`, detail: 'Turn on “My phone can control this PC” in the island’s Settings' }); }
  else if (reply.status !== Proto.OK && !quiet) say({ kind: 'failed', title: `${p.name} couldn't do that` });
  return reply;
}
export const utf8 = (s: string) => new TextEncoder().encode(s);
export function f64(v: number): Uint8Array { return new Bytes().f64(v).build(); }

let refreshing = false;
/** The chosen PC's status (its media with the cover, sound, battery...), refreshed while the app is on screen. */
export async function refreshStatus(): Promise<PcStatus | null> {
  const l = link; const p = pc.value; if (!l || !p || refreshing) return null;
  if (!p.online) { statusError.value = `${p.name} is away`; return null; }
  if (!remoteCapable(p)) { statusError.value = `Update Arnav Island on ${p.name} for the remote`; return null; }
  refreshing = true;
  try {
    const previous = status.value?.pcName ? status.value : null;
    const s = await l.status(p.id, previous?.coverHash ?? null, previous);
    if (!s) statusError.value = l.lastRemoteError || `${p.name} didn't answer`;
    else { batch(() => { statusError.value = null; status.value = s; }); lyricsFor(p, s); }
    return s;
  } finally { refreshing = false; }
}

// ---- the whole island (revision 5) ----
let trailPc: string | null = null; let batteryTick = 0;
const statsCache = new Map<string, PcStats>();
export const cachedStats = (peer: string) => statsCache.get(peer) ?? null;
export async function refreshIsland(withStats: boolean) {
  const l = link; const p = pc.value; if (!l || !p || !islandReady(p)) return;
  if (withStats) {
    const s = await l.stats(p.id);
    if (s) {
      if (trailPc !== p.id) { trailPc = p.id; statsTrail.value = []; }
      statsCache.set(p.id, s);
      batch(() => { pcStats.value = s; statsTrail.value = [...statsTrail.value, { at: Date.now(), cpu: s.cpu, gpu: s.gpu, download: s.download, upload: s.upload }].slice(-300); });
    }
  }
  const c = await l.controls(p.id); if (c) batch(() => { pcControls.value = c; controlsAt.value = Date.now(); });
  if (withStats && p.revision >= 6 && batteryTick++ % 3 === 0) { const b = await l.battery(p.id); if (b) pcBattery.value = b; }
}
export function clearIsland() {
  batch(() => { pcBattery.value = null; islandSettings.value = null; outputs.value = []; statsTrail.value = []; });
  trailPc = null; batteryTick = 0;
}
/** Changes a control at once here ([seen]: what it looks like meanwhile), then on the PC; what the PC says wins. */
export function setControl(control: number, value: number, seen: (c: PcControls) => PcControls = (c) => c) {
  if (pcControls.value) pcControls.value = seen(pcControls.value);
  void (async () => {
    const l = link; const p = pc.value; if (!l || !p || !islandReady(p)) return;
    const c = await l.setControl(p.id, control, value);
    if (c) batch(() => { pcControls.value = c; controlsAt.value = Date.now(); });
    else { say({ kind: 'failed', title: `${p.name} couldn't do that`, detail: l.lastRemoteError || 'Try again in a moment' }); const now = await l.controls(p.id); if (now) pcControls.value = now; }
  })();
}
export async function loadIslandSettings(): Promise<IslandSettings | null> {
  const l = link; const p = pc.value; if (!l || !p || !islandReady(p)) return null;
  const s = await l.islandSettings(p.id); if (s) islandSettings.value = s; return s;
}
export function setIslandSetting(key: string, value: number) {
  const show = (v: number) => { const s = islandSettings.value; if (s) islandSettings.value = { ...s, items: s.items.map((i) => (i.key === key ? { ...i, value: v } : i)) }; };
  const before = islandSettings.value?.items.find((i) => i.key === key)?.value; show(value);
  void (async () => {
    const l = link; const p = pc.value; if (!l || !p || !islandReady(p)) return;
    const now = await l.setIslandSetting(p.id, key, value);
    if (now !== null) show(now); else { if (before !== undefined) show(before); say({ kind: 'failed', title: `${p.name} couldn't change that`, detail: l.lastRemoteError || 'Try again in a moment' }); }
  })();
}
export function islandSettingAction(action: number, done: string) {
  void (async () => {
    const l = link; const p = pc.value; if (!l || !p || !islandReady(p)) return;
    say((await l.islandSettingAction(p.id, action)) ? { kind: 'info', title: done, detail: `On ${p.name}` } : { kind: 'failed', title: `${p.name} couldn't do that` });
  })();
}
/** The PC's command bar, asked again (briefly) until its results answer this text. */
export async function queryCommands(text: string): Promise<CommandResults | null> {
  const l = link; const p = pc.value; if (!l || !p || !islandReady(p)) return null;
  let r = await l.queryCommands(p.id, text); let tries = 0;
  while (r && !r.final && tries++ < 12) { await new Promise((res) => setTimeout(res, 120)); r = await l.queryCommands(p.id, text); }
  return r;
}
export async function runCommand(text: string, index: number, title: string, confirmed: boolean): Promise<CommandOutcome | null> {
  const l = link; const p = pc.value; if (!l || !p || !islandReady(p)) return null;
  return l.runCommand(p.id, text, index, title, confirmed);
}
export async function loadOutputs() { const l = link; const p = pc.value; if (!l || !p || !islandReady(p)) return; const o = await l.outputs(p.id); if (o) outputs.value = o; }
export function selectOutput(id: string) {
  outputs.value = outputs.value.map((o) => ({ ...o, current: o.id === id }));
  void (async () => {
    const l = link; const p = pc.value; if (!l || !p || !islandReady(p)) return;
    const s = await l.selectOutput(p.id, id);
    if (s === Proto.NOT_ALLOWED) say({ kind: 'info', title: 'Direct output switching is off', detail: 'Turn it on below, in Media & sound' });
    else if (s !== Proto.OK) say({ kind: 'failed', title: `${p.name} couldn't switch the sound` });
    await new Promise((r) => setTimeout(r, 600)); const o = await l.outputs(p.id); if (o) outputs.value = o;
  })();
}
export function openIslandPage(page: number) { void (async () => { const l = link; const p = pc.value; if (!l || !p || !islandReady(p)) return; if (!(await l.openIslandPage(p.id, page))) say({ kind: 'failed', title: `${p.name} couldn't open that` }); })(); }
export function closeIsland() { void (async () => { const l = link; const p = pc.value; if (!l || !p || !islandReady(p)) return; await l.closeIsland(p.id); })(); }

// ---- lyrics, find my PC ----
let lyricsKey: string | null = null, lyricsAsked = 0, lyricsTries = 0;
function lyricsFor(p: PeerView, s: PcStatus) {
  if (!s.available || p.revision < 3) { lyrics.value = null; lyricsKey = null; return; }
  const key = s.title + '\t' + s.artist; const now = Date.now(); const current = lyrics.value;
  const again = key === lyricsKey && current?.state === 1 && now - lyricsAsked > 2500 && lyricsTries < 12;
  if (key === lyricsKey && !again) return;
  if (key !== lyricsKey) { lyricsKey = key; lyricsTries = 0; if (current?.key !== key) lyrics.value = null; }
  lyricsAsked = now; lyricsTries++;
  void (async () => {
    const reply = await command(Proto.CMD_LYRICS, new Uint8Array(0), true); if (!reply || reply.status !== Proto.OK) return;
    const l = parseLyrics(reply.payload); if (l && lyricsKey === key) lyrics.value = { ...l, key };
  })();
}
export async function ringPc(): Promise<boolean> {
  const p = pc.value; if (!p) return false;
  if (p.online && p.revision < 3) { say({ kind: 'failed', title: `Update Arnav Island on ${p.name}`, detail: 'Find my PC needs version 0.20 or later' }); return false; }
  const ok = (await command(Proto.CMD_RING_PC))?.status === Proto.OK;
  if (ok) say({ kind: 'ring', title: `Ringing ${p.name}`, detail: 'Its island chimes and lights up' });
  return ok;
}

// ---- the clipboard ----
export async function pasteOnPc(text: string) {
  const p = pc.value; if (!text.trim()) { say({ kind: 'info', title: 'Your clipboard is empty', detail: 'Copy something first' }); return; }
  if ((await command(Proto.CMD_CLIP_SET, utf8(text)))?.status === Proto.OK) say({ kind: 'clipboard', title: `On ${p?.name}’s clipboard`, detail: firstLine(text) });
}
export async function copyFromPc(): Promise<string | null> {
  const p = pc.value; const reply = await command(Proto.CMD_CLIP_GET); if (!reply || reply.status !== Proto.OK) return null;
  const text = new Reader(reply.payload).string(256 * 1024) ?? '';
  if (!text) { say({ kind: 'info', title: `${p?.name}’s clipboard is empty` }); return null; }
  return text;
}
export const firstLine = (s: string) => s.split('\n')[0].slice(0, 60);

// ---- what a PC asks this device (revision 6) ----
async function answerQuery(peer: string, cmd: number, payload: Uint8Array): Promise<Uint8Array | null> {
  switch (cmd) {
    case Proto.QUERY_READINGS: {
      if (!prefs.value.details) return null;
      const text = new TextEncoder().encode((await deviceDetails()).map(([k, v]) => k.replace(/[\t\n]/g, ' ') + '\t' + v.replace(/[\t\n]/g, ' ')).join('\n').slice(0, 12_000));
      return new Bytes().u32(text.length).raw(text).u32(0).build();
    }
    case Proto.QUERY_FOCUS: { const f = parseFocus(payload); if (!f) return null; focus.value = f; return new Uint8Array(0); }
    // Photos just taken are the Android app's (a browser can't see new photos): this device has none to give.
    case Proto.QUERY_PHOTO: return null;
    case Proto.QUERY_PAGE: {
      const r = new Reader(payload); const scroll = r.f32() ?? -1; const url = r.string(4096); const title = r.string(400) ?? '';
      if (!url || !/^https?:\/\//i.test(url)) return null;
      pageArrived.value = { url, title, scroll, from: peers.value.find((p) => p.id === peer)?.name ?? 'your PC', at: Date.now() };
      return new Uint8Array(0);
    }
  }
  return null;
}

// ---- this device, for the island ----
let sentDetails = ''; let detailsAt = 0;
/** This device's details to every paired island that shows them, when they changed (and when a PC arrives). */
export function sendDetails(force = false) {
  const l = link; if (!l || !prefs.value.details) return;
  const targets = peers.value.filter((p) => p.paired && p.online && p.revision >= 3 && !p.phone); if (!targets.length) return;
  void (async () => {
    const d = await deviceDetails(); const compared = JSON.stringify(d.filter(([k]) => k !== 'Open for')); const now = Date.now();
    if (!force && compared === sentDetails && now - detailsAt < 300_000) return;
    sentDetails = compared; detailsAt = now;
    const frame = Frames.details(d);
    for (const t of targets) await l.notice(t.id, frame);
  })();
}

export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 2 ** 30) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}
export { mimeOf };
