// A byte stream with the shape of a socket: bytes written go out in order, bytes read come in order, and either side can end
// it. A relay tunnel is one; the session protocol reads frames from it exactly as it would from TCP.
import { Proto } from './proto';

export class Closed extends Error { constructor(why = 'closed') { super(why); } }
export class TimedOut extends Error { constructor() { super('timed out'); } }

export interface Pipe {
  /** Queues bytes to go; false once the stream is closed. */
  write(b: Uint8Array): boolean;
  close(): void;
}

/** What arrives, read as frames (u32 little-endian length, then the bytes). */
export class Inbound {
  private chunks: Uint8Array[] = [];
  private have = 0;
  private ended = false;
  private waiter: (() => void) | null = null;

  push(b: Uint8Array): void { if (this.ended || b.length === 0) return; this.chunks.push(b); this.have += b.length; this.wake(); }
  end(): void { this.ended = true; this.wake(); }
  get done(): boolean { return this.ended && this.have === 0; }
  get available(): number { return this.have; }
  private wake(): void { const w = this.waiter; this.waiter = null; w?.(); }

  /** Waits until [n] bytes are here (or the stream ends, or [ms] pass). */
  private async need(n: number, ms: number): Promise<void> {
    const until = Date.now() + ms;
    while (this.have < n) {
      if (this.ended) throw new Closed();
      const left = until - Date.now();
      if (left <= 0) throw new TimedOut();
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => { if (this.waiter === done) this.waiter = null; resolve(); }, left);
        const done = () => { clearTimeout(t); resolve(); };
        this.waiter = done;
      });
    }
  }
  private take(n: number): Uint8Array {
    const out = new Uint8Array(n); let at = 0;
    while (at < n) {
      const c = this.chunks[0]; const k = Math.min(c.length, n - at);
      out.set(c.subarray(0, k), at); at += k;
      if (k === c.length) this.chunks.shift(); else this.chunks[0] = c.subarray(k);
    }
    this.have -= n; return out;
  }
  /** Waits (up to [ms]) only for a frame to begin; once one has, it's read whole (giving up halfway would lose the place). */
  async waitForFrame(ms: number): Promise<boolean> {
    try { await this.need(1, ms); return true; } catch (e) { if (e instanceof TimedOut) return false; throw e; }
  }
  async frame(ms: number): Promise<Uint8Array> {
    await this.need(4, ms);
    const h = this.take(4);
    const n = (h[0] | (h[1] << 8) | (h[2] << 16) | (h[3] << 24)) >>> 0;
    if (n > Proto.MAX_FRAME) throw new Closed('frame too large');
    await this.need(n, Math.max(ms, 20_000));
    return this.take(n);
  }
}

export function framed(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + b.length);
  new DataView(out.buffer).setUint32(0, b.length, true);
  out.set(b, 4);
  return out;
}
