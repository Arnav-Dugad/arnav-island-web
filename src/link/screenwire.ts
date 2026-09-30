// The pieces of a screen's frames (revision 7, island 0.24), either way, as the Android app's ScreenWire.kt has them.
import { Bytes, Reader, concat } from './bytes';
import { Proto } from './proto';

export const SCREEN_CHUNK = 128 * 1024;

/** Asking for the PC's screen here: the largest picture shown (long side first), fps, and bits a second (0: as the path allows). */
export const askPc = (longest: number, shortest: number, fps: number, bitrate = 0) => new Bytes().u8(Proto.SCREEN_REQUEST).u8(1).u16(longest).u16(shortest).u8(fps).u32(bitrate).build();
/** Offering this device's picture (here, its camera) to the PC: its size, fps and name. */
export const offerPhone = (width: number, height: number, fps: number, name: string) => new Bytes().u8(Proto.SCREEN_REQUEST).u8(2).u16(width).u16(height).u8(fps).string(name).build();

export interface ScreenReply { status: number; width: number; height: number; fps: number; bitrate: number; encoder: string }
export function screenReply(f: Uint8Array): ScreenReply | null {
  const r = new Reader(f); if (r.u8() !== Proto.SCREEN_REPLY) return null;
  const status = r.u8(); if (status === null) return null;
  return { status, width: r.u16() ?? 0, height: r.u16() ?? 0, fps: r.u8() ?? 0, bitrate: r.u32() ?? 0, encoder: r.string(512) ?? '' };
}
/** One encoded frame as the frames that carry it (128 KB at most each). */
export function videoFrames(number: number, key: boolean, pts100ns: bigint, data: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = []; let at = 0;
  do {
    const n = Math.min(SCREEN_CHUNK, data.length - at); const last = at + n >= data.length;
    out.push(new Bytes().u8(Proto.SCREEN_VIDEO).u8((key ? 1 : 0) | (at === 0 ? 2 : 0) | (last ? 4 : 0)).u32(number).u64(pts100ns).raw(data.subarray(at, at + n)).build());
    at += n;
  } while (at < data.length);
  return out;
}
export const feedback = (last: number, decodeMs: number, kbps: number, fps: number) => new Bytes().u8(Proto.SCREEN_FEEDBACK).u32(last).u16(Math.max(0, Math.min(65535, Math.round(decodeMs)))).u32(Math.max(0, Math.round(kbps))).u8(Math.max(0, Math.min(255, Math.round(fps)))).build();
export const screenInput = (frame: Uint8Array) => concat(Uint8Array.of(Proto.SCREEN_INPUT), frame);
export const limits = (w: number, h: number, fps: number) => new Bytes().u8(Proto.SCREEN_LIMITS).u16(w).u16(h).u8(fps).build();

export interface Frame { number: number; key: boolean; pts: bigint; data: Uint8Array }
/** Frames put back together: whole ones come out with whether they're key frames, their number and time. */
export class Assembler {
  private parts: Uint8Array[] = []; private current = -1; private key = false; private pts = 0n;
  add(f: Uint8Array): Frame | null {
    if (f.length < 14 || f[0] !== Proto.SCREEN_VIDEO) return null;
    const r = new Reader(f); r.u8(); const flags = r.u8()!; const n = r.u32()!; const t = r.u64()!;
    if (flags & 2) { this.parts = []; this.current = n; this.key = (flags & 1) !== 0; this.pts = t; }
    else if (n !== this.current) { this.parts = []; this.current = -1; return null; }
    this.parts.push(f.subarray(14));
    if (!(flags & 4)) return null;
    const whole = { number: n, key: this.key, pts: this.pts, data: this.parts.length === 1 ? this.parts[0] : concat(...this.parts) };
    this.parts = []; this.current = -1; return whole;
  }
}

/** NAL units of an Annex B frame: [type, start after the start code, end]. */
export function nals(d: Uint8Array): [number, number, number][] {
  const out: [number, number, number][] = [];
  const code = (i: number) => (i + 3 <= d.length && d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 1 ? 3 : i + 4 <= d.length && d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0 && d[i + 3] === 1 ? 4 : 0);
  let i = 0; while (i < d.length && code(i) === 0) i++;
  while (i < d.length) { const s = i + code(i); let j = s; while (j < d.length && code(j) === 0) j++; if (s < j) out.push([d[s] & 0x1f, s, j]); i = j; }
  return out;
}
/** The codec string for a frame's SPS ("avc1.64002a"): profile, constraints and level. */
export function codecOf(d: Uint8Array): string | null {
  const sps = nals(d).find((n) => n[0] === 7); if (!sps || sps[2] - sps[1] < 4) return null;
  const h = (b: number) => b.toString(16).padStart(2, '0');
  return `avc1.${h(d[sps[1] + 1])}${h(d[sps[1] + 2])}${h(d[sps[1] + 3])}`;
}
