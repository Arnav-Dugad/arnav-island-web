// The PC's volume as a dial: twist it (from anywhere on it) and the level follows the finger's turn, with a tick at every
// 5% and a firmer one at each quarter; the arc glows brighter as it rises. Tap the middle to mute.
import { useEffect, useRef, useState } from 'preact/hooks';
import { glassClass } from './components';
import { haptic, useSpring } from './motion';

const START = 135, SWEEP = 270;
/** How far a finger turned between two angles (degrees), the short way round: -180..180. */
export function dialTurn(from: number, to: number) { let d = (to - from) % 360; if (d > 180) d -= 360; if (d <= -180) d += 360; return d; }
/** The detent a value sits in: 5% steps, 0..20. */
export const detent = (v: number) => Math.max(0, Math.min(20, Math.floor(v * 20 + 0.5)));

export function VolumeDial({ value, muted, onChange, onDone, onMute, size = 168, description = 'Volume' }: {
  value: number; muted: boolean; onChange: (v: number) => void; onDone: (v: number) => void; onMute: () => void; size?: number; description?: string;
}) {
  const [turning, setTurning] = useState(false);
  const [local, setLocal] = useState(value);
  const g = useRef({ angle: 0, step: 0, id: -1, value });
  useEffect(() => { if (!turning) { setLocal(value); g.current.value = value; } }, [value, turning]);
  const shown = useSpring(local, turning ? 1 : 0.8, turning ? 3000 : 300);
  const lift = useSpring(turning ? 1 : 0, 0.6, 500);
  const ref = useRef<HTMLDivElement>(null);
  const angleAt = (e: PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI; };

  const stroke = 11; const c = size / 2; const r = size / 2 - stroke * 1.6; const level = muted ? 0 : Math.max(0, Math.min(1, shown));
  const pt = (deg: number, rr: number) => [c + rr * Math.cos((deg * Math.PI) / 180), c + rr * Math.sin((deg * Math.PI) / 180)];
  const arc = (from: number, sweep: number) => {
    if (sweep <= 0.01) return '';
    const [x1, y1] = pt(from, r); const [x2, y2] = pt(from + sweep, r);
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };
  const [kx, ky] = pt(START + SWEEP * level, r);
  return (
    <div ref={ref} class="dial" role="slider" tabIndex={0} aria-label={description} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(local * 100)}
      style={{ width: size, height: size, position: 'relative', flex: 'none', touchAction: 'none' }}
      onKeyDown={(e) => { const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 0.05 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -0.05 : 0; if (d) { e.preventDefault(); const v = Math.max(0, Math.min(1, local + d)); setLocal(v); onDone(v); } }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('.dial-mute')) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        g.current = { angle: angleAt(e), step: detent(local), id: e.pointerId, value: local }; setTurning(true);
      }}
      onPointerMove={(e) => {
        const s = g.current; if (s.id !== e.pointerId) return;
        const a = angleAt(e); const v = Math.max(0, Math.min(1, s.value + dialTurn(s.angle, a) / SWEEP)); s.angle = a; s.value = v;
        setLocal(v); onChange(v);
        const now = detent(v); if (now !== s.step) { s.step = now; haptic(now % 5 === 0 ? 'click' : 'tick'); }
      }}
      onPointerUp={(e) => { const s = g.current; if (s.id !== e.pointerId) return; s.id = -1; setTurning(false); onDone(s.value); }}
      onPointerCancel={() => { const s = g.current; if (s.id < 0) return; s.id = -1; setTurning(false); onDone(s.value); }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: 'absolute', inset: 0, overflow: 'visible' }} aria-hidden="true">
        <defs>
          <radialGradient id="dialglow"><stop offset="55%" stop-color="var(--accent)" stop-opacity="0" /><stop offset="78%" stop-color="var(--accent)" stop-opacity={0.1 + 0.32 * level + 0.15 * lift} /><stop offset="100%" stop-color="var(--accent)" stop-opacity="0" /></radialGradient>
          <radialGradient id="knobglow"><stop offset="0%" stop-color="var(--accent)" stop-opacity="0.7" /><stop offset="100%" stop-color="var(--accent)" stop-opacity="0" /></radialGradient>
        </defs>
        <circle cx={c} cy={c} r={r + stroke * 2.4} fill="url(#dialglow)" />
        <path d={arc(START, SWEEP)} fill="none" stroke="var(--track)" stroke-width={stroke} stroke-linecap="round" />
        {level > 0 && <path d={arc(START, SWEEP * level)} fill="none" stroke="var(--accent)" stroke-width={stroke} stroke-linecap="round" />}
        {Array.from({ length: 11 }, (_, k) => { const [x, y] = pt(START + (SWEEP * k) / 10, r + stroke * 1.25); return <circle key={k} cx={x} cy={y} r={k % 5 === 0 ? 2.2 : 1.5} fill={k / 10 <= level + 0.001 ? 'var(--accent)' : 'color-mix(in srgb, var(--faint) 50%, transparent)'} />; })}
        <circle cx={kx} cy={ky} r={stroke * (1.8 + lift)} fill="url(#knobglow)" />
        <circle cx={kx} cy={ky + 1} r={stroke * (0.62 + 0.12 * lift) + 1} fill="rgba(0,0,0,.3)" />
        <circle cx={kx} cy={ky} r={stroke * (0.62 + 0.12 * lift)} fill="#fff" />
      </svg>
      <button type="button" class={`dial-mute press ${glassClass('control', 'circle')}`} aria-label={muted ? 'Sound on' : 'Mute'}
        style={{ position: 'absolute', left: '50%', top: '50%', width: size * 0.52, height: size * 0.52, marginLeft: -size * 0.26, marginTop: -size * 0.26, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
        onClick={() => { haptic('click'); onMute(); }}>
        <span class="t-digits" style={{ fontSize: 30, lineHeight: '34px' }}>{muted ? '–' : Math.floor(local * 100 + 0.5)}</span>
        <span class="t-micro muted">{muted ? 'Muted' : 'Volume'}</span>
      </button>
    </div>
  );
}
