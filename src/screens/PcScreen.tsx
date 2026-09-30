// Your PC's screen here (island 0.24), as sharp and smooth as the path allows: decoded by the browser's own video decoder
// (WebCodecs, the iPhone's hardware H.264). Touch it like a touchscreen: a tap clicks, a long press right-clicks, a drag
// drags, two fingers scroll, and pinching zooms in here (not on the PC). The screen stays awake while it shows.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Frames } from '../link/island';
import type { ScreenSession } from '../link/link';
import { Proto } from '../link/proto';
import { Assembler, askPc, codecOf, feedback, screenInput, screenReply } from '../link/screenwire';
import { getLink, peers } from '../state/hub';
import { GlassButton, GlassIconButton, Icon, Radar, quality } from '../ui/components';
import { Keys, type Typist, Typing, pressKey } from '../ui/keys';
import { haptic } from '../ui/motion';

type State = { kind: 'connecting' } | { kind: 'showing'; width: number; height: number } | { kind: 'failed'; why: string } | { kind: 'ended' };

class Streamer implements Typist {
  session: ScreenSession | null = null; stopped = false;
  onState: (s: State) => void = () => {}; onStats: (s: { fps: number; kbps: number; decodeMs: number }) => void = () => {};
  private decoder: VideoDecoder | null = null; private waitingKey = true; private askedKey = 0;
  constructor(private peer: string, private canvas: HTMLCanvasElement) {}
  private send(f: Uint8Array) { void this.session?.send(f); }
  frame(f: Uint8Array) { this.send(screenInput(f)); }
  key(vk: number, ...mods: number[]) { pressKey(this, vk, ...mods); }
  point(x: number, y: number) { this.frame(Frames.point(x, y)); }
  button(b: number, s: number) { this.frame(Frames.button(b, s)); }
  scroll(v: number, h: number) { this.frame(Frames.scroll(v, h)); }
  stop() {
    this.stopped = true; const s = this.session; this.session = null;
    try { this.decoder?.close(); } catch { /* closed */ } this.decoder = null;
    if (s) void s.send(Uint8Array.of(Proto.SCREEN_STOP)).finally(() => setTimeout(() => s.close(), 200));
  }
  private askKey() { const now = Date.now(); if (now - this.askedKey > 500) { this.askedKey = now; this.send(Uint8Array.of(Proto.SCREEN_KEYFRAME)); } }

  async run() {
    const link = getLink(); const pcName = peers.value.find((p) => p.id === this.peer)?.name ?? 'Your PC';
    if (!link) { this.onState({ kind: 'failed', why: 'Arnav Island isn’t connected yet' }); return; }
    if (typeof VideoDecoder === 'undefined') { this.onState({ kind: 'failed', why: 'This browser can’t decode video. It needs iOS 16.4 or later' }); return; }
    const longest = Math.round(Math.max(screen.width, screen.height) * Math.min(3, devicePixelRatio)), shortest = Math.round(Math.min(screen.width, screen.height) * Math.min(3, devicePixelRatio));
    const opened = await link.openScreen(this.peer, askPc(longest, shortest, 60));
    if (this.stopped) { opened?.[0].close(); return; }
    if (!opened) { this.onState({ kind: 'failed', why: (peers.value.find((p) => p.id === this.peer)?.revision ?? 0) < 7 ? `Update Arnav Island on ${pcName} to 0.24 or later` : `Couldn’t reach ${pcName}` }); return; }
    const [s, answer] = opened; this.session = s;
    const r = screenReply(answer);
    if (!r || r.status !== 0) { this.onState({ kind: 'failed', why: r?.status === 1 ? `Turn on “My phone can control this PC” on ${pcName}’s island` : r?.status === 2 ? `Update Arnav Island on ${pcName}` : `${pcName} couldn’t show its screen` }); s.close(); return; }
    this.onState({ kind: 'showing', width: r.width, height: r.height });
    const ctx = this.canvas.getContext('2d', { alpha: false, desynchronized: true } as CanvasRenderingContext2DSettings)!;
    const assembler = new Assembler();
    let last = 0, shown = 0, bytes = 0, told = Date.now(), decodeMs = 0, heard = Date.now(), codec = '';
    const pending = new Map<number, number>();
    const make = (c: string) => {
      codec = c;
      this.decoder = new VideoDecoder({
        output: (frame) => {
          const t0 = pending.get(frame.timestamp); if (t0 !== undefined) { decodeMs = decodeMs * 0.8 + (performance.now() - t0) * 0.2; pending.delete(frame.timestamp); }
          if (this.canvas.width !== frame.displayWidth || this.canvas.height !== frame.displayHeight) { this.canvas.width = frame.displayWidth; this.canvas.height = frame.displayHeight; this.onState({ kind: 'showing', width: frame.displayWidth, height: frame.displayHeight }); }
          ctx.drawImage(frame, 0, 0); frame.close(); shown++;
        },
        error: () => { this.decoder = null; this.waitingKey = true; this.askKey(); },
      });
      this.decoder.configure({ codec: c, optimizeForLatency: true, hardwareAcceleration: 'prefer-hardware' });
    };
    try {
      while (!this.stopped && s.open) {
        const now = Date.now();
        if (now - told >= 500) {
          const secs = (now - told) / 1000;
          this.send(feedback(last, decodeMs, (bytes * 8) / 1000 / secs, shown / secs));
          this.onStats({ fps: Math.round(shown / secs), kbps: Math.round((bytes * 8) / 1000 / secs), decodeMs: Math.round(decodeMs) }); told = now; shown = 0; bytes = 0;
        }
        // The PC says something every second at least (frames, or a word when its screen is still).
        if (now - heard > 6000) { this.onState({ kind: 'failed', why: `Lost ${pcName}` }); break; }
        const f = await s.receive(250); if (!f || !f.length) continue;
        heard = Date.now();
        if (f[0] === Proto.SCREEN_STOP) { this.onState({ kind: 'ended' }); break; }
        if (f[0] !== Proto.SCREEN_VIDEO) continue;
        bytes += f.length;
        const frame = assembler.add(f); if (!frame) continue; last = frame.number;
        if (!this.decoder || this.decoder.state === 'closed') {
          if (!frame.key) { this.askKey(); continue; }
          const c = codecOf(frame.data) ?? codec; if (!c) { this.askKey(); continue; }
          try { make(c); } catch { this.onState({ kind: 'failed', why: 'This iPhone can’t decode the PC’s screen' }); break; }
          this.waitingKey = true;
        }
        if (this.waitingKey && !frame.key) { this.askKey(); continue; }
        // A decoder that's full: this frame goes, and the next key frame starts afresh.
        if (this.decoder!.decodeQueueSize > 6) { this.waitingKey = true; this.askKey(); continue; }
        this.waitingKey = false;
        const ts = Number(frame.pts / 10n); pending.set(ts, performance.now()); if (pending.size > 30) pending.delete(pending.keys().next().value!);
        try { this.decoder!.decode(new EncodedVideoChunk({ type: frame.key ? 'key' : 'delta', timestamp: ts, data: frame.data })); }
        catch { try { this.decoder?.close(); } catch { /* closed */ } this.decoder = null; this.waitingKey = true; this.askKey(); }
      }
      if (!s.open && !this.stopped) this.onState({ kind: 'failed', why: `Lost ${pcName}` });
    } finally { try { this.decoder?.close(); } catch { /* closed */ } this.decoder = null; s.close(); }
  }
}

export function PcScreen({ peer, onClose }: { peer: string; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null); const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>({ kind: 'connecting' });
  const [stats, setStats] = useState({ fps: 0, kbps: 0, decodeMs: 0 });
  const [zoom, setZoom] = useState(1); const [pan, setPan] = useState({ x: 0, y: 0 });
  const [bar, setBar] = useState(true); const [touched, setTouched] = useState(Date.now());
  const [typing, setTyping] = useState(false); const [attempt, setAttempt] = useState(0);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const streamer = useRef<Streamer | null>(null);
  const typingField = useRef<HTMLInputElement | null>(null);
  const pc = peers.value.find((p) => p.id === peer);

  useEffect(() => {
    const s = new Streamer(peer, canvas.current!); streamer.current = s; s.onState = setState; s.onStats = setStats; setState({ kind: 'connecting' });
    void s.run();
    return () => s.stop();
  }, [peer, attempt]);
  // The screen stays awake while the PC's screen shows.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null; let gone = false;
    const take = async () => { try { lock = await navigator.wakeLock?.request('screen'); } catch { /* not allowed now */ } if (gone) void lock?.release(); };
    void take(); const again = () => { if (document.visibilityState === 'visible') void take(); };
    document.addEventListener('visibilitychange', again);
    return () => { gone = true; document.removeEventListener('visibilitychange', again); void lock?.release(); };
  }, []);
  useEffect(() => { const r = () => setSize({ w: window.innerWidth, h: window.innerHeight }); window.addEventListener('resize', r); return () => window.removeEventListener('resize', r); }, []);
  useEffect(() => { if (typing) return; const t = setTimeout(() => setBar(false), 3500); return () => clearTimeout(t); }, [touched, typing]);
  useEffect(() => { if (typing) setTimeout(() => typingField.current?.focus(), 150); }, [typing]);

  const video = state.kind === 'showing' ? state : null;
  const contentRect = () => {
    const vw = video?.width ?? 16, vh = video?.height ?? 9; const s = Math.min(size.w / vw, size.h / vh); const w = vw * s, h = vh * s;
    return { x: (size.w - w) / 2, y: (size.h - h) / 2, w, h };
  };
  const toScreen = (px: number, py: number) => {
    const r = contentRect(); const cx = size.w / 2, cy = size.h / 2;
    const qx = (px - pan.x - cx) / zoom + cx, qy = (py - pan.y - cy) / zoom + cy;
    return { x: Math.max(0, Math.min(1, (qx - r.x) / r.w)), y: Math.max(0, Math.min(1, (qy - r.y) / r.h)) };
  };
  const g = useRef({ pts: new Map<number, { x: number; y: number }>(), mode: 0, start: { x: 0, y: 0 }, t0: 0, longTimer: 0 as unknown as ReturnType<typeof setTimeout>, spanStart: 0, zoomStart: 1, panStart: { x: 0, y: 0 }, cStart: { x: 0, y: 0 }, cLast: { x: 0, y: 0 }, wheel: 0, zooming: false });
  const rect = contentRect(); const sw = streamer.current;
  const sideways = video && video.width > video.height && size.h > size.w;
  return (
    <div class="pcscreen" ref={box} role="application" aria-label={`${pc?.name ?? 'Your PC'}’s screen`}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('.pcs-ui')) return;
        const s = g.current; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setTouched(Date.now());
        s.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (s.pts.size === 1) {
          s.mode = 0; s.start = { x: e.clientX, y: e.clientY }; s.t0 = Date.now(); s.wheel = 0; s.zooming = false;
          clearTimeout(s.longTimer);
          // Held still: a right click.
          s.longTimer = setTimeout(() => { if (s.mode === 0 && s.pts.size === 1 && sw) { s.mode = 3; const p = toScreen(s.start.x, s.start.y); sw.point(p.x, p.y); sw.button(1, 2); haptic('long'); } }, 450);
        } else if (s.pts.size === 2) {
          clearTimeout(s.longTimer);
          const [a, b] = [...s.pts.values()]; if (s.mode === 1 && sw) sw.button(0, 0);
          s.mode = 2; s.spanStart = Math.hypot(a.x - b.x, a.y - b.y); s.zoomStart = zoom; s.panStart = pan; s.cStart = s.cLast = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        }
      }}
      onPointerMove={(e) => {
        const s = g.current; if (!s.pts.has(e.pointerId)) return; s.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (!sw) return;
        if (s.pts.size >= 2 && s.mode === 2) {
          const [a, b] = [...s.pts.values()]; const span = Math.hypot(a.x - b.x, a.y - b.y); const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          // Spreading or pinching zooms the picture here; moving together scrolls on the PC (or pans a zoomed picture).
          if (!s.zooming && Math.abs(span / s.spanStart - 1) > 0.08) s.zooming = true;
          if (s.zooming) { const z = Math.max(1, Math.min(4, (s.zoomStart * span) / s.spanStart)); setZoom(z); setPan(z <= 1.01 ? { x: 0, y: 0 } : { x: s.panStart.x + c.x - s.cStart.x, y: s.panStart.y + c.y - s.cStart.y }); }
          else if (zoom > 1.01) setPan({ x: s.panStart.x + c.x - s.cStart.x, y: s.panStart.y + c.y - s.cStart.y });
          else { s.wheel += (c.y - s.cLast.y) * 3; const w = Math.trunc(s.wheel / 40); if (w) { sw.scroll(w * 40, 0); s.wheel -= w * 40; } }
          s.cLast = c; return;
        }
        if (s.mode === 0 && Math.hypot(e.clientX - s.start.x, e.clientY - s.start.y) > 8) { s.mode = 1; clearTimeout(s.longTimer); const p0 = toScreen(s.start.x, s.start.y); sw.point(p0.x, p0.y); sw.button(0, 1); }
        if (s.mode === 1) { const p = toScreen(e.clientX, e.clientY); sw.point(p.x, p.y); }
      }}
      onPointerUp={(e) => {
        const s = g.current; if (!s.pts.has(e.pointerId)) return; s.pts.delete(e.pointerId);
        if (s.pts.size > 0) return; clearTimeout(s.longTimer); if (!sw) return;
        if (s.mode === 0 && Date.now() - s.t0 < 450) { const p = toScreen(s.start.x, s.start.y); sw.point(p.x, p.y); sw.button(0, 2); haptic('click'); }
        if (s.mode === 1) { const p = toScreen(e.clientX, e.clientY); sw.point(p.x, p.y); sw.button(0, 0); }
      }}
      onPointerCancel={(e) => { const s = g.current; s.pts.delete(e.pointerId); clearTimeout(s.longTimer); if (s.mode === 1 && s.pts.size === 0) sw?.button(0, 0); }}>
      <div style={{ position: 'absolute', inset: 0, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'center' }}>
        <canvas ref={canvas} width={16} height={9} style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, opacity: video ? 1 : 0, transition: 'opacity 300ms ease' }} />
      </div>
      {state.kind === 'connecting' && <div class="pcs-center col"><Radar size={56} /><div class="t-body" style={{ marginTop: 12 }}>Opening {pc?.name ?? 'your PC'}’s screen…</div><div class="t-caption muted" style={{ marginTop: 4 }}>Through the relay: it takes a moment to start</div></div>}
      {state.kind === 'failed' && (
        <div class="pcs-center col pcs-ui" style={{ padding: 32 }}>
          <span style={{ color: 'var(--warn)' }}><Icon name="desktopAccessDisabled" size={44} /></span>
          <div class="t-headline center" style={{ marginTop: 12 }}>{state.why}</div>
          <div class="row gap12" style={{ marginTop: 16 }}><GlassButton onClick={onClose} floating><span class="t-strong">Close</span></GlassButton><GlassButton onClick={() => setAttempt(attempt + 1)} prominent floating><span class="t-strong">Try again</span></GlassButton></div>
        </div>
      )}
      {state.kind === 'ended' && <div class="pcs-center col pcs-ui"><div class="t-headline">{pc?.name ?? 'Your PC'} stopped showing its screen</div><div style={{ marginTop: 16 }}><GlassButton onClick={onClose} floating><span class="t-strong">Close</span></GlassButton></div></div>}
      {sideways && bar && <div class="pcs-hint pcs-ui t-caption glass bar capsule"><Icon name="screenRotation" size={16} /> Turn your iPhone sideways for a bigger picture</div>}
      <div class={`pcs-bar pcs-ui glass bar capsule ${bar || state.kind !== 'showing' ? 'in' : ''}`}>
        <GlassIconButton icon="arrowBack" description="Close" onClick={onClose} size={40} floating />
        <div class="col grow" style={{ marginLeft: 10 }}>
          <span class="t-strong ellipsis">{pc?.name ?? 'Your PC'}</span>
          <span class="t-caption muted ellipsis">{[pc ? quality(pc).text : '', video ? `${video.width}×${video.height}` : '', stats.fps ? `${stats.fps} fps` : '', stats.kbps ? `${(stats.kbps / 1000).toFixed(1)} Mbps` : ''].filter(Boolean).join('  ·  ')}</span>
        </div>
        {zoom > 1.01 && <GlassIconButton icon="zoomOutMap" description="Fit the screen" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} size={40} floating />}
        <span style={{ width: 6 }} />
        <GlassIconButton icon="keyboard" description={typing ? 'Hide the keyboard' : 'Type'} onClick={() => { setTyping(!typing); setTouched(Date.now()); }} size={40} prominent={typing} floating />
      </div>
      {!bar && state.kind === 'showing' && <button type="button" class="pcs-handle pcs-ui" aria-label="Show the bar" onPointerDown={(e) => { e.stopPropagation(); setBar(true); setTouched(Date.now()); }}><i /></button>}
      {typing && sw && (
        <div class="pcs-typing pcs-ui col gap8">
          <Keys input={sw} />
          <Typing input={sw} pcName={pc?.name ?? 'your PC'} inputRef={(el) => { typingField.current = el; }} />
        </div>
      )}
    </div>
  );
}
