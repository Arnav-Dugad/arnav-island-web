// The iPhone as the PC's trackpad and keyboard. One finger moves the pointer (faster the faster it goes), a tap clicks, two
// fingers scroll and a two-finger tap right-clicks; a double tap held down drags. Below: the two buttons, the keys a phone's
// keyboard lacks, and a field whose typing goes straight to the PC. Moves and scrolls are gathered and sent 30 times a
// second (through the relay); clicks and keys go at once, in order after the movement before them.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { PeerView } from '../link/island';
import { Frames } from '../link/island';
import type { InputSession } from '../link/link';
import { getLink } from '../state/hub';
import { Icon, LiveDot, glassClass } from '../ui/components';
import { Keys, type Typist, Typing, pressKey } from '../ui/keys';
import { rgbOf } from '../ui/ambient';
import { haptic } from '../ui/motion';
import { GlassSheet } from '../ui/sheet';

class InputLink implements Typist {
  state = 0; // 0 connecting, 1 ready, 2 couldn't connect
  onState: (s: number) => void = () => {};
  private session: InputSession | null = null;
  private dx = 0; private dy = 0; private wheel = 0; private hwheel = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  constructor(private peer: string) {}
  start() {
    this.chain = this.open().then((ok) => this.set(ok ? 1 : 2));
    this.timer = setInterval(() => this.flush(), 33);
  }
  private set(s: number) { this.state = s; this.onState(s); }
  private async open(): Promise<boolean> { if (this.closed) return false; this.session = (await getLink()?.openInput(this.peer)) ?? null; return !!this.session; }
  private deliver(f: Uint8Array) {
    this.chain = this.chain.then(async () => {
      if (this.closed) return;
      if (this.session?.alive && (await this.session.send(f))) return;
      // The PC closed an idle session: once more, freshly opened.
      this.session?.close();
      if ((await this.open()) && (await this.session!.send(f))) this.set(1); else this.set(2);
    });
  }
  move(x: number, y: number) { this.dx += x; this.dy += y; }
  scroll(v: number, h: number) { this.wheel += v; this.hwheel += h; }
  frame(f: Uint8Array) { this.flush(); this.deliver(f); }
  key(vk: number, ...mods: number[]) { pressKey(this, vk, ...mods); }
  private flush() {
    const mx = Math.trunc(this.dx), my = Math.trunc(this.dy), w = Math.trunc(this.wheel), h = Math.trunc(this.hwheel);
    this.dx -= mx; this.dy -= my; this.wheel -= w; this.hwheel -= h;
    if (mx || my) this.deliver(Frames.move(mx, my));
    if (w || h) this.deliver(Frames.scroll(w, h));
  }
  close() { this.closed = true; if (this.timer) clearInterval(this.timer); this.session?.close(); }
}

export function TrackpadSheet({ visible, pc, onDismiss }: { visible: boolean; pc: PeerView | null; onDismiss: () => void }) {
  return (
    <GlassSheet visible={visible} onDismiss={onDismiss} class="sheet-tall" label="Trackpad">
      {pc ? <TrackpadBody pc={pc} /> : <div class="t-body muted">Pair with your PC first</div>}
    </GlassSheet>
  );
}

function TrackpadBody({ pc }: { pc: PeerView }) {
  const [state, setState] = useState(0);
  const input = useRef<InputLink | null>(null);
  if (!input.current) { input.current = new InputLink(pc.id); input.current.onState = setState; input.current.start(); }
  useEffect(() => () => input.current?.close(), []);
  const i = input.current;
  return (
    <div class="col" style={{ width: '100%', height: '100%', minHeight: 0 }}>
      <div class="row" style={{ width: '100%' }}>
        <div class="col grow">
          <div class="t-title">Trackpad</div>
          <div class={`t-caption ${state === 2 ? 'danger' : 'muted'} clamp3`}>{state === 0 ? `Connecting to ${pc.name}…` : state === 1 ? `Controlling ${pc.name}  ·  through the relay` : 'Couldn’t connect. On the island: Settings › Privacy & productivity › My phone can control this PC'}</div>
        </div>
        <LiveDot on={state === 1} />
      </div>
      <div style={{ height: 14 }} />
      <Pad input={i} />
      <div style={{ height: 10 }} />
      <div class="row gap10" style={{ width: '100%', height: 54 }}>
        <MouseButton label="Left click" onState={(d) => i.frame(Frames.button(0, d ? 1 : 0))} />
        <MouseButton label="Right click" onState={(d) => i.frame(Frames.button(1, d ? 1 : 0))} />
      </div>
      <div style={{ height: 10 }} />
      <Keys input={i} />
      <div style={{ height: 10 }} />
      <Typing input={i} pcName={pc.name} />
    </div>
  );
}

function Pad({ input }: { input: InputLink }) {
  const ref = useRef<HTMLDivElement>(null); const canvas = useRef<HTMLCanvasElement>(null);
  const [used, setUsed] = useState(false);
  const g = useRef({ touches: new Map<number, { x: number; y: number; t: number }>(), first: null as null | { x: number; y: number; t: number }, most: 1, travelled: 0, holding: false, lastTap: 0, lastTapAt: { x: 0, y: 0 }, ripple: null as null | { x: number; y: number; t: number }, raf: 0 });
  const draw = () => {
    const c = canvas.current, el = ref.current; if (!c || !el) return; const s = g.current;
    const dpr = Math.min(2, devicePixelRatio); const w = el.clientWidth, h = el.clientHeight;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const ctx = c.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const accent = rgbOf(getComputedStyle(document.documentElement).getPropertyValue('--accent'));
    const r = el.getBoundingClientRect();
    for (const t of s.touches.values()) {
      const x = t.x - r.left, y = t.y - r.top; const gr = ctx.createRadialGradient(x, y, 0, x, y, 46);
      gr.addColorStop(0, `rgba(${accent},.42)`); gr.addColorStop(0.5, `rgba(${accent},.1)`); gr.addColorStop(1, `rgba(${accent},0)`);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, 46, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
    }
    const rp = s.ripple;
    if (rp) {
      const a = Math.min(1, (performance.now() - rp.t) / 420);
      if (a < 1) { ctx.strokeStyle = `rgb(${accent})`; ctx.globalAlpha = (1 - a) * 0.6; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(rp.x - r.left, rp.y - r.top, 12 + 44 * (1 - Math.pow(1 - a, 3)), 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
      else s.ripple = null;
    }
    if (s.touches.size || s.ripple) s.raf = requestAnimationFrame(draw); else s.raf = 0;
  };
  const kick = () => { if (!g.current.raf) g.current.raf = requestAnimationFrame(draw); };
  return (
    <div ref={ref} class={`pad no-drag ${glassClass('control')}`} aria-label="Trackpad" style={{ width: '100%', flex: '1 1 auto', minHeight: 180, touchAction: 'none', position: 'relative', overflow: 'hidden' }}
      onPointerDown={(e) => {
        const s = g.current; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setUsed(true);
        const p = { x: e.clientX, y: e.clientY, t: e.timeStamp };
        if (s.touches.size === 0) {
          s.first = p; s.most = 1; s.travelled = 0;
          // A tap, then down again at the same place: held, it drags.
          s.holding = p.t - s.lastTap < 300 && Math.hypot(p.x - s.lastTapAt.x, p.y - s.lastTapAt.y) < 48;
          if (s.holding) { input.frame(Frames.button(0, 1)); haptic('long'); }
        }
        s.touches.set(e.pointerId, p); s.most = Math.max(s.most, s.touches.size); kick();
      }}
      onPointerMove={(e) => {
        const s = g.current; const prev = s.touches.get(e.pointerId); if (!prev) return;
        const cur = { x: e.clientX, y: e.clientY, t: e.timeStamp }; s.touches.set(e.pointerId, cur);
        const dx = cur.x - prev.x, dy = cur.y - prev.y; const dist = Math.hypot(dx, dy);
        if (s.touches.size === 1 && s.most === 1) {
          s.travelled += dist;
          // Pointer acceleration: slow moves are precise, quick ones cross the screen.
          const speed = dist / Math.max(1, cur.t - prev.t); const gain = 1.6 * (1 + Math.min(speed * 1.4, 2.6));
          input.move(dx * gain, dy * gain);
        } else if (s.touches.size >= 2) {
          // Two fingers: the content follows them, 120 a notch every 20 points.
          s.travelled += dist; input.scroll((dy / s.touches.size) * 6 * 2, (-dx / s.touches.size) * 6 * 2);
        }
        kick();
      }}
      onPointerUp={(e) => {
        const s = g.current; if (!s.touches.has(e.pointerId)) return; s.touches.delete(e.pointerId);
        if (s.touches.size > 0) return;
        const quick = e.timeStamp - (s.first?.t ?? 0) < 280;
        if (s.holding) input.frame(Frames.button(0, 0));
        else if (s.travelled < 9 && quick) {
          if (s.most >= 2) { input.frame(Frames.button(1, 2)); haptic('click'); }
          else { input.frame(Frames.button(0, 2)); haptic('tick'); s.lastTap = e.timeStamp; s.lastTapAt = { x: s.first!.x, y: s.first!.y }; }
          s.ripple = { x: s.first!.x, y: s.first!.y, t: performance.now() };
        }
        kick();
      }}
      onPointerCancel={(e) => { g.current.touches.delete(e.pointerId); kick(); }}>
      <canvas ref={canvas} class="overlay-canvas" />
      {!used && (
        <div class="col center" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', padding: 24, color: 'var(--faint)', pointerEvents: 'none' }}>
          <Icon name="mouse" size={34} />
          <div class="t-caption" style={{ marginTop: 10, whiteSpace: 'pre-line' }}>{'One finger moves  ·  tap to click\nTwo fingers scroll  ·  two-finger tap for right-click\nDouble-tap and hold to drag'}</div>
        </div>
      )}
    </div>
  );
}

/** A mouse button: pressed while the finger is on it (so it can hold a drag). */
function MouseButton({ label, onState }: { label: string; onState: (down: boolean) => void }) {
  const [down, setDown] = useState(false);
  return (
    <button type="button" aria-label={label} class={`press no-drag ${down ? 'down' : ''} ${glassClass('control', 'inner', down)}`} style={{ flex: 1, height: '100%', color: down ? 'var(--text)' : 'var(--muted)', touchAction: 'none' }}
      onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDown(true); haptic('tick'); onState(true); }}
      onPointerUp={() => { if (down) { setDown(false); onState(false); } }} onPointerCancel={() => { if (down) { setDown(false); onState(false); } }}
      onContextMenu={(e) => e.preventDefault()}>
      <span class="t-caption">{label}</span>
    </button>
  );
}
