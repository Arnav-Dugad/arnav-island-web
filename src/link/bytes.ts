// Little-endian bytes, as the island's protocol has them (ShareService.cpp, and the Android app's Wire.kt).

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

export const utf8 = (s: string): Uint8Array => encoder.encode(s);
export const fromUtf8 = (b: Uint8Array): string => decoder.decode(b);

export function concat(...parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export function hex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

export function unhex(s: string): Uint8Array | null {
  if (s.length % 2 !== 0 || /[^0-9a-f]/i.test(s)) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

export function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

/** A little-endian byte builder. */
export class Bytes {
  private chunks: Uint8Array[] = [];
  private scratch = new DataView(new ArrayBuffer(8));
  u8(v: number): this { this.chunks.push(Uint8Array.of(v & 0xff)); return this; }
  u16(v: number): this { this.chunks.push(Uint8Array.of(v & 0xff, (v >>> 8) & 0xff)); return this; }
  u32(v: number): this { this.scratch.setUint32(0, v >>> 0, true); this.chunks.push(new Uint8Array(this.scratch.buffer.slice(0, 4))); return this; }
  u64(v: bigint | number): this { this.scratch.setBigUint64(0, BigInt.asUintN(64, BigInt(v)), true); this.chunks.push(new Uint8Array(this.scratch.buffer.slice(0, 8))); return this; }
  f32(v: number): this { this.scratch.setFloat32(0, v, true); this.chunks.push(new Uint8Array(this.scratch.buffer.slice(0, 4))); return this; }
  f64(v: number): this { this.scratch.setFloat64(0, v, true); this.chunks.push(new Uint8Array(this.scratch.buffer.slice(0, 8))); return this; }
  raw(b: Uint8Array): this { this.chunks.push(b); return this; }
  text(s: string): this { return this.raw(utf8(s)); }
  /** A UTF-8 string with a 32-bit length first. */
  string(s: string): this { const b = utf8(s); return this.u32(b.length).raw(b); }
  blob(b: Uint8Array): this { return this.u32(b.length).raw(b); }
  build(): Uint8Array { return concat(...this.chunks); }
}

/** Reads a little-endian frame; every read fails (null) rather than overrunning. */
export class Reader {
  private view: DataView;
  constructor(public b: Uint8Array, public at = 0) { this.view = new DataView(b.buffer, b.byteOffset, b.byteLength); }
  get left(): number { return this.b.length - this.at; }
  u8(): number | null { return this.left >= 1 ? this.b[this.at++] : null; }
  i8(): number | null { const v = this.u8(); return v === null ? null : (v << 24) >> 24; }
  u16(): number | null { if (this.left < 2) return null; const v = this.view.getUint16(this.at, true); this.at += 2; return v; }
  i16(): number | null { if (this.left < 2) return null; const v = this.view.getInt16(this.at, true); this.at += 2; return v; }
  u32(): number | null { if (this.left < 4) return null; const v = this.view.getUint32(this.at, true); this.at += 4; return v; }
  i32(): number | null { if (this.left < 4) return null; const v = this.view.getInt32(this.at, true); this.at += 4; return v; }
  u64(): bigint | null { if (this.left < 8) return null; const v = this.view.getBigUint64(this.at, true); this.at += 8; return v; }
  /** A u64 that fits in a JS number (sizes, times). */
  u64n(): number | null { const v = this.u64(); return v === null ? null : Number(v); }
  f32(): number | null { if (this.left < 4) return null; const v = this.view.getFloat32(this.at, true); this.at += 4; return Number.isFinite(v) ? v : 0; }
  /** A double; a value that isn't finite reads as 0 (as Windows does), a missing one as null. */
  f64(): number | null { if (this.left < 8) return null; const v = this.view.getFloat64(this.at, true); this.at += 8; return Number.isFinite(v) ? v : 0; }
  bytes(n: number): Uint8Array | null { if (n < 0 || this.left < n) return null; const r = this.b.slice(this.at, this.at + n); this.at += n; return r; }
  rest(): Uint8Array { const r = this.b.slice(this.at); this.at = this.b.length; return r; }
  string(limit = 1 << 20): string | null { const n = this.u32(); if (n === null || n > limit) return null; const b = this.bytes(n); return b ? fromUtf8(b) : null; }
  blob(limit: number): Uint8Array | null { const n = this.u32(); if (n === null || n > limit) return null; return this.bytes(n); }
}

/** A peer's name as shown: printable, at most 64 characters. */
export function cleanName(n: string): string {
  let out = '';
  for (const ch of n) { const c = ch.codePointAt(0)!; if (c >= 32 && c !== 127) out += ch; if (out.length >= 64) break; }
  return out || 'A PC';
}

/** A file name made safe for any file system. */
export function safeName(name: string): string {
  let n = name.split(/[\\/]/).pop() ?? '';
  n = Array.from(n, (c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || '<>:"/\\|?*'.includes(c) ? '_' : c)).join('').replace(/^[ .]+|[ .]+$/g, '');
  if (n.length > 120) { const dot = n.lastIndexOf('.'); const ext = dot >= 0 && n.length - dot <= 12 ? n.slice(dot) : ''; n = n.slice(0, 120 - ext.length) + ext; }
  if (!n) return 'file';
  const stem = n.split('.')[0].toUpperCase();
  const reserved = new Set(['CON', 'PRN', 'AUX', 'NUL', ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`), ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)]);
  return reserved.has(stem) ? `_${n}` : n;
}

/** A received relative path, each part made safe; "." and ".." dropped, at most 24 parts. */
export function safePath(path: string): string[] {
  return path.split(/[\\/]/).map((p) => p.trim().replace(/\.+$/, '')).filter((p) => p && p !== '.' && p !== '..').map(safeName).slice(0, 24);
}
