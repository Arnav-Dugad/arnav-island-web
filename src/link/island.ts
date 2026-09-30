// What a PC tells this app, and the frames this app sends it: the payloads are the island's (ShareService.h), read exactly as
// the Android app's Island.kt, Link.kt and Models.kt read them.
import { Bytes, Reader } from './bytes';
import { Proto } from './proto';

export interface PeerView {
  id: string; name: string; paired: boolean; online: boolean; phone: boolean; version: number; revision: number;
  /** Always through the relay here: [path] 1 when it's heard, its round trip (ms, 0 unknown), brokers it's heard on. */
  internet: boolean; path: number; rtt: number; relays: number;
}
export const remoteCapable = (p: PeerView) => p.version >= Proto.VERSION && p.revision >= 2;

export interface Handoff { title: string; artist: string; album: string; app: string; fileName: string; position: number; duration: number; playing: boolean; fileSize: number; cover: Uint8Array | null }
export interface ShelfItem { name: string; size: number; folder: boolean; preview: Uint8Array | null }
export interface ShelfList { shared: boolean; items: ShelfItem[]; error?: string }
export interface RemoteReply { status: number; payload: Uint8Array }

export interface PcStatus {
  available: boolean; playing: boolean; canPrevious: boolean; canNext: boolean; canToggle: boolean; canSeek: boolean;
  muted: boolean; charging: boolean; batteryPresent: boolean;
  position: number; duration: number; volume: number; battery: number; cpu: number;
  title: string; artist: string; app: string; pcName: string; weather: string;
  cover: Uint8Array | null; coverHash: Uint8Array | null; at: number; clipboard: boolean;
}
export function positionNow(s: PcStatus, now = Date.now()): number {
  return s.playing && s.duration > 0 ? Math.min(s.duration, s.position + (now - s.at) / 1000) : s.position;
}

export interface LyricsLine { time: number; text: string; words: [number, number][] }
/** The song's lyrics from the PC (revision 3): state 0 off there, 1 being looked for, 2 found, 3 none; key "title<TAB>artist". */
export interface Lyrics { state: number; key: string; lines: LyricsLine[] }

export interface PcStats {
  cpu: number; gpu: number; ramUsedGiB: number; ramTotalGiB: number; ramPercent: number;
  diskUsedPercent: number; diskFreeGiB: number; diskTotalGiB: number; download: number; upload: number;
  uptime: number; logical: number; battery: number; charging: boolean; batteryMinutes: number;
  cpuHistory: number[]; gpuHistory: number[]; downloadHistory: number[];
  name: string; model: string; os: string; cpuName: string; gpuName: string; cores: number[];
}
export interface PcBattery {
  percent: number; present: boolean; online: boolean; charging: boolean; saver: boolean; critical: boolean;
  minutesLeft: number; minutesToFull: number; designMwh: number; fullMwh: number; remainingMwh: number; rateMw: number; voltageMv: number;
  cycles: number; temperatureDeciK: number; health: number; healthBefore: number; chemistry: string; manufacturer: string; name: string;
  day: [number, number, boolean][];
}
export interface FocusState { mode: number; running: boolean; finished: boolean; shown: number; duration: number; pcName: string; at: number }
export interface IslandSetting {
  section: number; control: number; key: string; title: string; detail: string;
  lo: number; hi: number; step: number; value: number; action: number; unit: string; options: string[]; colours: number[];
}
export interface IslandSettings { sections: string[]; items: IslandSetting[] }
export interface PcControls {
  wifi: number; bluetooth: number; dark: number; brightness: number; volume: number; muted: boolean; micAvailable: boolean; micMuted: boolean;
  focusRunning: boolean; focusFinished: boolean; focusMode: number; focusDuration: number; focusShown: number; busy: number;
}
export const airplane = (c: PcControls) => c.wifi === 0 && (c.bluetooth === 0 || c.bluetooth === -2);
export interface CommandRow { kind: number; confirm: boolean; title: string; detail: string; answer: string }
export interface CommandResults { final: boolean; rows: CommandRow[] }
/** What running one did: 0 done, 1 needs a yes first (message asks), 2 failed, 3 the results changed. */
export interface CommandOutcome { outcome: number; message: string }
export interface AudioOutput { id: string; name: string; current: boolean; form: number }

export const IslandWire = {
  WIFI: 1, BLUETOOTH: 2, DARK: 3, AIRPLANE: 4, BRIGHTNESS: 5, VOLUME: 6, MUTE: 7, MIC: 8, LOCK: 9, SLEEP: 10, RESTART: 11, SHUT_DOWN: 12, EMPTY_BIN: 13,
  FOCUS: 15, BREAK: 16, FOCUS_TOGGLE: 17, FOCUS_RESET: 18, STOPWATCH: 19,
  PAGES: ['Home', 'Media', 'Stats', 'Focus', 'Settings', 'Shelf', 'Audio', 'Controls', 'Phone'],
};

type R = Reader;
function list<T>(n: number | null, f: () => T | null): T[] | null {
  if (n === null) return null;
  const out: T[] = [];
  for (let i = 0; i < n; i++) { const v = f(); if (v === null) return null; out.push(v); }
  return out;
}
const pct = (b: number) => (b === 255 ? -1 : b);

export function parseStats(p: Uint8Array): PcStats | null {
  const r: R = new Reader(p); if (r.u8() !== 1) return null;
  const v = list(10, () => r.f64()); if (!v) return null;
  const uptime = r.u64n(); const logical = r.u16(); const battery = r.i8(); const charging = r.u8();
  const minutes = r.f64(); const n = r.u8();
  if (uptime === null || logical === null || battery === null || charging === null || minutes === null || n === null) return null;
  const cpu = list(n, () => { const b = r.u8(); return b === null ? null : pct(b); });
  const gpu = list(n, () => { const b = r.u8(); return b === null ? null : pct(b); });
  const down = list(n, () => r.u32());
  const texts = list(5, () => r.string(4096));
  if (!cpu || !gpu || !down || !texts) return null;
  // Revision 6: the cores, when the island sends them.
  let cores: number[] = [];
  const c = r.u8(); if (c !== null) cores = list(c, () => { const b = r.u8(); return b === null ? null : pct(b); }) ?? [];
  return {
    cpu: v[0], gpu: v[1], ramUsedGiB: v[2], ramTotalGiB: v[3], ramPercent: v[4], diskUsedPercent: v[5], diskFreeGiB: v[6], diskTotalGiB: v[7], download: v[8], upload: v[9],
    uptime, logical, battery, charging: charging !== 0, batteryMinutes: minutes, cpuHistory: cpu, gpuHistory: gpu, downloadHistory: down,
    name: texts[0], model: texts[1], os: texts[2], cpuName: texts[3], gpuName: texts[4], cores,
  };
}
export function parseBattery(p: Uint8Array): PcBattery | null {
  const r = new Reader(p); if (r.u8() !== 1) return null;
  const percent = r.i8(); const flags = r.u8(); const left = r.i32(); const toFull = r.i32();
  const caps = list(5, () => r.u64n()); const cycles = r.u32(); const temp = r.i32();
  const health = r.f64(); const before = r.f64(); const texts = list(3, () => r.string(1024));
  const n = r.u16();
  if (percent === null || flags === null || left === null || toFull === null || !caps || cycles === null || temp === null || health === null || before === null || !texts || n === null) return null;
  const day = list(n, () => { const t = r.u64n(); const pc = r.u8(); const ch = r.u8(); return t === null || pc === null || ch === null ? null : ([t, pc, ch !== 0] as [number, number, boolean]); });
  if (!day) return null;
  return {
    percent, present: (flags & 1) !== 0, online: (flags & 2) !== 0, charging: (flags & 4) !== 0, saver: (flags & 8) !== 0, critical: (flags & 16) !== 0,
    minutesLeft: left, minutesToFull: toFull, designMwh: caps[0], fullMwh: caps[1], remainingMwh: caps[2], rateMw: caps[3] > 2 ** 63 ? caps[3] - 2 ** 64 : caps[3], voltageMv: caps[4],
    cycles, temperatureDeciK: temp, health, healthBefore: before, chemistry: texts[0], manufacturer: texts[1], name: texts[2], day,
  };
}
export function parseFocus(p: Uint8Array, at = Date.now()): FocusState | null {
  const r = new Reader(p); const mode = r.u8(); const running = r.u8(); const finished = r.u8();
  const shown = r.f64(); const duration = r.f64(); const pcName = r.string(512);
  if (mode === null || running === null || finished === null || shown === null || duration === null || pcName === null) return null;
  return { mode, running: running !== 0, finished: finished !== 0, shown, duration, pcName, at };
}
export function parseSettings(p: Uint8Array): IslandSettings | null {
  const r = new Reader(p); if (r.u8() !== 1) return null;
  const sections = list(r.u8(), () => r.string(1024)); if (!sections) return null;
  const items = list(r.u16(), () => {
    const section = r.u8(), control = r.u8(), key = r.string(256), title = r.string(1024), detail = r.string(2048);
    const lo = r.i32(), hi = r.i32(), step = r.i32(), value = r.i32(), action = r.u8(), unit = r.string(128);
    const options = list(r.u8(), () => r.string(512)); const colours = list(r.u8(), () => r.u32());
    if (section === null || control === null || key === null || title === null || detail === null || lo === null || hi === null || step === null || value === null || action === null || unit === null || !options || !colours) return null;
    return { section, control, key, title, detail, lo, hi, step, value, action, unit, options, colours } as IslandSetting;
  });
  return items ? { sections, items } : null;
}
export function parseControls(p: Uint8Array): PcControls | null {
  const r = new Reader(p); if (r.u8() !== 1) return null;
  const wifi = r.i8(), bt = r.i8(), dark = r.i8(), brightness = r.i8(), volume = r.u8();
  const flags = r.u8(), mode = r.u8(), duration = r.f64(), shown = r.f64(), busy = r.u8();
  if (wifi === null || bt === null || dark === null || brightness === null || volume === null || flags === null || mode === null || duration === null || shown === null || busy === null) return null;
  return { wifi, bluetooth: bt, dark, brightness, volume, muted: (flags & 1) !== 0, micAvailable: (flags & 2) !== 0, micMuted: (flags & 4) !== 0, focusRunning: (flags & 8) !== 0, focusFinished: (flags & 16) !== 0, focusMode: mode, focusDuration: duration, focusShown: shown, busy };
}
export function parseCommands(p: Uint8Array): CommandResults | null {
  const r = new Reader(p); if (r.u8() !== 1) return null; const f = r.u8(); if (f === null) return null;
  const rows = list(r.u8(), () => {
    const kind = r.u8(), confirm = r.u8(), title = r.string(2048), detail = r.string(2048), answer = r.string(512);
    return kind === null || confirm === null || title === null || detail === null || answer === null ? null : { kind, confirm: confirm !== 0, title, detail, answer };
  });
  return rows ? { final: f !== 0, rows } : null;
}
export function parseOutcome(p: Uint8Array): CommandOutcome | null { const r = new Reader(p); const o = r.u8(); const m = r.string(2048); return o === null || m === null ? null : { outcome: o, message: m }; }
export function parseOutputs(p: Uint8Array): AudioOutput[] | null {
  const r = new Reader(p); if (r.u8() !== 1) return null;
  return list(r.u8(), () => { const id = r.string(2048), name = r.string(1024), cur = r.u8(), form = r.i8(); return id === null || name === null || cur === null || form === null ? null : { id, name, current: cur !== 0, form }; });
}
export function parseValue(p: Uint8Array): number | null { return new Reader(p).i32(); }

/**
 * The status payload: u16 flags, f64 position, f64 duration, u8 volume, i8 battery, u8 cpu (255 unknown), then the cover
 * (u8 0 none / 1 included with 32-byte hash and u32 length / 2 unchanged), then u32 length and UTF-8 lines: title, artist,
 * app, the PC's name, a weather line.
 */
export function parseStatus(p: Uint8Array, previous: PcStatus | null): PcStatus | null {
  const r = new Reader(p);
  const flags = r.u16(), position = r.f64(), duration = r.f64(), volume = r.u8(), battery = r.i8(), cpu = r.u8();
  if (flags === null || position === null || duration === null || volume === null || battery === null || cpu === null) return null;
  let cover: Uint8Array | null = null, hash: Uint8Array | null = null;
  const kind = r.u8(); if (kind === null) return null;
  if (kind === 1) { hash = r.bytes(32); cover = r.blob(Proto.COVER_LIMIT); if (!hash || !cover) return null; }
  else if (kind === 2) { cover = previous?.cover ?? null; hash = previous?.coverHash ?? null; }
  const text = r.string(64 * 1024); if (text === null) return null;
  const lines = [...text.split('\n'), '', '', '', '', ''];
  const bit = (i: number) => (flags & (1 << i)) !== 0;
  return {
    available: bit(0), playing: bit(1), canPrevious: bit(2), canNext: bit(3), canToggle: bit(4), canSeek: bit(7), muted: bit(5), charging: bit(6), batteryPresent: bit(8),
    position: Math.max(0, position), duration: Math.max(0, duration), volume: Math.min(100, Math.max(0, volume)), battery, cpu: cpu === 255 ? -1 : cpu,
    title: lines[0], artist: lines[1], app: lines[2], pcName: lines[3], weather: lines[4], cover: cover && cover.length ? cover : null, coverHash: hash, at: Date.now(), clipboard: bit(9),
  };
}
export function parseLyrics(p: Uint8Array): Lyrics | null {
  const r = new Reader(p); const state = r.u8(); const key = r.string(4096); const n = r.u32();
  if (state === null || key === null || n === null || n > 400) return null;
  const lines: LyricsLine[] = [];
  for (let i = 0; i < n; i++) {
    const time = r.f64(); const text = r.string(4096); const wn = r.u8();
    if (time === null || text === null || wn === null) return null;
    const words: [number, number][] = [];
    for (let j = 0; j < wn; j++) { const wt = r.f64(); const at = r.u16(); if (wt === null || at === null) return null; words.push([wt, at]); }
    lines.push({ time, text, words });
  }
  return { state, key, lines };
}

// ---- frames this app sends ----
export const Frames = {
  status: (battery: number, charging: boolean) => new Bytes().u8(Proto.FRAME_NOTICE).u8(Proto.NOTICE_STATUS).u8(battery).u8(charging ? 1 : 0).build(),
  details: (d: [string, string][]) => new Bytes().u8(Proto.FRAME_NOTICE).u8(Proto.NOTICE_DETAILS)
    .string(d.map(([k, v]) => k.replace(/[\t\n]/g, ' ') + '\t' + v.replace(/[\t\n]/g, ' ')).join('\n').slice(0, 12_000)).build(),
  notification: (app: string, title: string, text: string, phone: string, urgent: boolean) => {
    const lines = [app.slice(0, 80), title.slice(0, 200), text.slice(0, 600), phone.slice(0, 64)].map((s) => s.replace(/\n/g, ' ')).join('\n');
    return new Bytes().u8(Proto.FRAME_NOTICE).u8(Proto.NOTICE_NOTIFICATION).u8(urgent ? 1 : 0).string(lines).blob(new Uint8Array(0)).string('').u8(0).build();
  },
  gone: (key: string) => new Bytes().u8(Proto.FRAME_NOTICE).u8(Proto.NOTICE_GONE).string(key.slice(0, 200)).build(),
  photo: (id: bigint, name: string, size: number, width: number, height: number, picture: Uint8Array) =>
    new Bytes().u8(Proto.FRAME_NOTICE).u8(Proto.NOTICE_PHOTO).u64(id).string(name.slice(0, 200)).u64(size).u16(Math.min(65535, Math.max(0, width))).u16(Math.min(65535, Math.max(0, height))).blob(picture).build(),
  /** A web page where it was scrolled to (scroll 0..1, below 0 unknown). */
  page: (url: string, title: string, scroll: number) => new Bytes().f32(scroll).string(url.slice(0, 4000)).string(title.slice(0, 300)).build(),
  move: (dx: number, dy: number) => new Bytes().u8(Proto.INPUT_MOVE).u16(clamp16(dx) & 0xffff).u16(clamp16(dy) & 0xffff).build(),
  /** button: 0 left, 1 right, 2 middle; state: 0 up, 1 down, 2 a click. */
  button: (button: number, state: number) => new Bytes().u8(Proto.INPUT_BUTTON).u8(button).u8(state).build(),
  /** In wheel units (120 a notch). */
  scroll: (vertical: number, horizontal: number) => new Bytes().u8(Proto.INPUT_SCROLL).u16(clamp16(vertical) & 0xffff).u16(clamp16(horizontal) & 0xffff).build(),
  text: (text: string) => new Bytes().u8(Proto.INPUT_TEXT).text(text.slice(0, 2000)).build(),
  /** A Windows virtual-key code, pressed and let go (state 2), or down (1) or up (0). */
  key: (vk: number, state = 2) => new Bytes().u8(Proto.INPUT_KEY).u16(vk).u8(state).build(),
  /** A point on the PC's screen as it's shown here (0 to 1 each way). */
  point: (x: number, y: number) => new Bytes().u8(Proto.INPUT_POINT).u16(Math.round(Math.min(1, Math.max(0, x)) * 65535)).u16(Math.round(Math.min(1, Math.max(0, y)) * 65535)).build(),
};
function clamp16(v: number): number { return Math.max(-32768, Math.min(32767, Math.round(v))); }
