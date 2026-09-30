// The app's pieces, as the Android app's Common.kt, Glass.kt and Motion.kt draw them.
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { PeerView } from '../link/island';
import { ICONS, type IconName } from './icons';
export type { IconName };
import { haptic, useSpring } from './motion';

export function Icon({ name, size = 24, class: cls = '', style }: { name: IconName; size?: number; class?: string; style?: JSX.CSSProperties }) {
  return <svg class={`icon ${cls}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={style} dangerouslySetInnerHTML={{ __html: ICONS[name] }} />;
}

type Level = 'card' | 'bar' | 'control' | 'sheet' | 'island';
type Shape = 'card' | 'tile' | 'inner' | 'sheet' | 'capsule' | 'circle';
export function glassClass(level: Level = 'card', shape: Shape = 'card', tinted = false, floating = false) {
  return `glass ${level === 'card' ? '' : level}${shape === 'card' ? '' : ' ' + shape}${tinted ? ' tinted' : ''}${floating ? ' floating' : ''}`;
}

export function GlassPanel({ level = 'card', shape = 'card', tint, class: cls = '', style, children, ...rest }: { level?: Level; shape?: Shape; tint?: string; class?: string; style?: JSX.CSSProperties; children?: ComponentChildren } & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'class' | 'style'>) {
  return <div class={`${glassClass(level, shape, !!tint)} ${cls}`} style={{ ...(tint ? { '--tint': tint } : {}), ...(style as object) }} {...rest}>{children}</div>;
}

/** A pressable glass capsule that springs down under the finger and glows in the accent when [prominent]. */
export function GlassButton({ onClick, prominent = false, enabled = true, shape = 'capsule', pad, description, class: cls = '', style, floating = false, children }: {
  onClick: (e: MouseEvent) => void; prominent?: boolean; enabled?: boolean; shape?: Shape; pad?: string; description?: string; class?: string; style?: JSX.CSSProperties; floating?: boolean; children?: ComponentChildren;
}) {
  return (
    <button type="button" class={`btn press ${glassClass('control', shape, prominent, floating)} ${prominent ? 'prominent' : ''} ${cls}`} disabled={!enabled} aria-label={description}
      style={{ ...(pad ? { padding: pad } : {}), ...(style as object) }} onClick={(e) => { haptic('click'); onClick(e); }}>{children}</button>
  );
}

export function GlassIconButton({ icon, description, onClick, size = 46, iconSize = 21, enabled = true, prominent = false, tint, class: cls = '', floating = false }: {
  icon: IconName; description: string; onClick: () => void; size?: number; iconSize?: number; enabled?: boolean; prominent?: boolean; tint?: string; class?: string; floating?: boolean;
}) {
  return (
    <button type="button" class={`iconbtn press ${glassClass('control', 'capsule', prominent, floating)} ${prominent ? 'prominent' : ''} ${cls}`} disabled={!enabled} aria-label={description} title={description}
      style={{ width: size, height: size, color: tint ?? (prominent ? 'var(--accent)' : 'var(--text)') }} onClick={() => { haptic('click'); onClick(); }}>
      <Icon name={icon} size={iconSize} />
    </button>
  );
}

/** A glass chip: a small fact (with its icon), or a choice when [onClick] is set. */
export function GlassChip({ label, icon, selected, iconTint, onClick, class: cls = '' }: { label: string; icon?: IconName; selected?: boolean; iconTint?: string; onClick?: () => void; class?: string }) {
  const inner = <>{icon && <Icon name={icon} size={15} style={{ color: iconTint ?? 'currentColor' }} />}<span class="t-caption" style={{ fontWeight: selected ? 600 : 500 }}>{label}</span></>;
  const c = `chip ${glassClass('control', 'capsule', selected)} ${selected ? 'on' : ''} ${cls}`;
  return onClick ? <button type="button" class={`${c} press`} role={selected === undefined ? undefined : 'radio'} aria-checked={selected === undefined ? undefined : selected} onClick={() => { haptic('tick'); onClick(); }}>{inner}</button> : <span class={c}>{inner}</span>;
}

/** A liquid switch: its knob is a drop that stretches under the finger, and the track fills with the accent. */
export function GlassSwitch({ checked, onChange, enabled = true, label }: { checked: boolean; onChange: (on: boolean) => void; enabled?: boolean; label?: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={!enabled} class={`switch ${checked ? 'on' : ''}`}
    onClick={(e) => { e.stopPropagation(); haptic('tick'); onChange(!checked); }}><i /></button>;
}

/**
 * A glass slider: a capsule track that thickens under the finger, filled in the accent with a soft glow at its edge. Ticks
 * mark each tenth, or each of [ticks] (a song's lyric lines). [onChange] follows the finger; [onDone] gets the final value.
 */
export function GlassSlider({ value, onChange, onDone, color, height = 8, description = '', ticks, class: cls = '' }: {
  value: number; onChange: (v: number) => void; onDone: (v: number) => void; color?: string; height?: number; description?: string; ticks?: number[] | null; class?: string;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const shown = Math.max(0, Math.min(1, drag ?? value));
  const last = useRef(0);
  const at = (x: number) => { const r = ref.current!.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / Math.max(1, r.width))); };
  const tick = (from: number, to: number) => {
    const lo = Math.min(from, to), hi = Math.max(from, to);
    if (ticks?.length) { if (hi > lo && ticks.some((t) => t > lo && t <= hi)) haptic('tick'); }
    else if (Math.floor(from * 10) !== Math.floor(to * 10)) haptic('tick');
  };
  return (
    <div ref={ref} class={`slider ${drag !== null ? 'drag' : ''} ${cls}`} role="slider" aria-label={description} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown * 100)} tabIndex={0}
      style={{ '--h': `${height}px`, ...(color ? { '--c': color } : {}) }}
      onKeyDown={(e) => { const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.05 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.05 : 0; if (d) { e.preventDefault(); const v = Math.max(0, Math.min(1, value + d)); onChange(v); onDone(v); } }}
      onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); const v = at(e.clientX); last.current = v; setDrag(v); onChange(v); haptic('tick'); }}
      onPointerMove={(e) => { if (drag === null) return; const v = at(e.clientX); tick(last.current, v); last.current = v; setDrag(v); onChange(v); }}
      onPointerUp={(e) => { if (drag === null) return; const v = at(e.clientX); setDrag(null); onDone(v); }}
      onPointerCancel={() => { if (drag === null) return; const v = drag; setDrag(null); onDone(v); }}>
      <div class="track">
        <div class="fill" style={{ width: `${shown * 100}%`, opacity: shown > 0 ? 1 : 0 }} />
        {shown > 0 && <div class="glow" style={{ left: `${shown * 100}%` }} />}
      </div>
    </div>
  );
}

/** A pressable glass tile: an icon in a lit well, a title and a line under it. */
export function GlassTile({ icon, title, detail, tint, enabled = true, onClick, class: cls = '' }: { icon: IconName; title: string; detail: string; tint?: string; enabled?: boolean; onClick: () => void; class?: string }) {
  return (
    <button type="button" class={`tile press tile-press ${glassClass('card', 'tile')} ${cls}`} disabled={!enabled} style={tint ? { '--tint': tint } : undefined} onClick={() => { haptic('click'); onClick(); }}>
      <span class="well"><Icon name={icon} size={22} /></span>
      <span class="t-strong ellipsis" style={{ marginTop: 14, width: '100%' }}>{title}</span>
      <span class="t-caption muted clamp2">{detail}</span>
    </button>
  );
}

/** How a paired device is reached, for its quality ring: the part of the ring lit, its kind (0 away, 1 weak, 2 relay, 3 direct) and a line saying so. */
export interface Quality { fraction: number; kind: number; text: string }
export function quality(p: PeerView): Quality {
  const ms = p.rtt > 0 ? `  ·  ${Math.round(p.rtt)} ms` : '';
  const relays = p.relays === 1 ? '1 free relay' : `${p.relays} free relays`;
  if (!p.online) return { fraction: 0, kind: 0, text: 'Away' };
  if (p.path === 2) return { fraction: 1, kind: 3, text: 'Direct' + ms };
  if (p.rtt >= 600 || p.relays <= 1) return { fraction: 0.3, kind: 1, text: `Weak  ·  through ${relays}${ms}` };
  return { fraction: 0.62, kind: 2, text: `Relay  ·  through ${relays}${ms}` };
}
export const qualityColor = (kind: number) => ['var(--faint)', 'var(--danger)', 'var(--warn)', 'var(--good)'][kind] ?? 'var(--faint)';
/** The ring itself: its arc sweeps (and changes colour) as the connection gets better or worse. */
export function QualityRing({ q, size = 36, stroke = 2 }: { q: Quality; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="color-mix(in srgb, var(--faint) 28%, transparent)" stroke-width={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={qualityColor(q.kind)} stroke-width={stroke} stroke-linecap={q.fraction >= 0.995 ? 'butt' : 'round'}
        stroke-dasharray={c} stroke-dashoffset={c * (1 - q.fraction)} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 900ms var(--sp-ring), stroke 600ms ease' }} />
    </svg>
  );
}

/** A settings-style row on glass: an icon, a title and a line under it, and whatever goes on the right. */
export function GlassRow({ icon, title, detail, tint, onClick, ring, trailing, class: cls = '' }: { icon: IconName; title: string; detail?: string | null; tint?: string; onClick?: () => void; ring?: Quality | null; trailing?: ComponentChildren; class?: string }) {
  const body = (
    <>
      {ring ? (
        <span style={{ position: 'relative', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <QualityRing q={ring} />
          <span class="rowicon" style={{ width: 28, height: 28, borderRadius: 14 }}><Icon name={icon} size={17} /></span>
        </span>
      ) : <span class="rowicon"><Icon name={icon} size={20} /></span>}
      <span class="col grow">
        <span class="t-strong ellipsis">{title}</span>
        {detail && <span class="t-caption muted clamp3" style={{ whiteSpace: 'pre-line' }}>{detail}</span>}
      </span>
      {trailing}
    </>
  );
  const style = tint ? { '--tint': tint } : undefined;
  return onClick ? <div role="button" tabIndex={0} class={`glassrow ${cls}`} style={{ ...style, cursor: 'pointer' }} onClick={() => { haptic('tick'); onClick(); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}>{body}</div>
    : <div class={`glassrow ${cls}`} style={style}>{body}</div>;
}
export const Hairline = () => <div class="hairline" />;
export const SectionLabel = ({ text, class: cls = '', style }: { text: string; class?: string; style?: JSX.CSSProperties }) => <h2 class={`section t-micro ${cls}`} style={{ margin: 0, ...(style as object) }}>{text}</h2>;
/** A screen's title, with an optional small line above it. */
export function ScreenTitle({ title, over, trailing }: { title: string; over?: string | null; trailing?: ComponentChildren }) {
  return (
    <div class="screen-title">
      <div class="col grow">
        {over && <span class="t-micro muted ellipsis">{over}</span>}
        <h1 class="t-hero ellipsis" style={{ margin: 0 }}>{title}</h1>
      </div>
      {trailing}
    </div>
  );
}

/** A small dot that glows and breathes while something is here. */
export function LiveDot({ on, size = 9 }: { on: boolean; size?: number }) {
  return <span class={`dot-live ${on ? 'on' : ''}`} style={{ width: size * 2.4, height: size * 2.4 }} aria-hidden="true">
    {on && <i class="pulse" style={{ width: size, height: size }} />}<i style={{ width: size, height: size }} />
  </span>;
}

/** A round glass button that steps once when tapped and keeps stepping while held (faster after a moment): volume. */
export function StepButton({ icon, description, onStep, size = 44, enabled = true }: { icon: IconName; description: string; onStep: () => void; size?: number; enabled?: boolean }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [down, setDown] = useState(false);
  const step = useRef(onStep); step.current = onStep;
  const stop = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; setDown(false); };
  useEffect(() => stop, []);
  return (
    <button type="button" aria-label={description} disabled={!enabled} class={`iconbtn press ${down ? 'down' : ''} ${glassClass('control', 'capsule')}`} style={{ width: size, height: size }}
      onPointerDown={(e) => {
        if (!enabled) return; e.preventDefault(); setDown(true); haptic('tick'); step.current();
        let gap = 140; const again = () => { haptic('tick'); step.current(); gap = Math.max(70, gap - 12); timer.current = setTimeout(again, gap); };
        timer.current = setTimeout(again, 420);
      }}
      onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStep(); } }}>
      <Icon name={icon} size={Math.round(size * 0.46)} />
    </button>
  );
}

/** A progress ring with a bright head, and a soft glow while it moves. */
export function ProgressRing({ fraction, color = 'var(--accent)', track = 'var(--track)', size = 42, stroke = 4, children }: { fraction: number; color?: string; track?: string; size?: number; stroke?: number; children?: ComponentChildren }) {
  const f = useSpring(Math.max(0, Math.min(1, fraction)), 0.9, 120);
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r; const a = (-90 + 360 * f) * (Math.PI / 180);
  const hx = size / 2 + r * Math.cos(a), hy = size / 2 + r * Math.sin(a);
  return (
    <span style={{ position: 'relative', width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: 'absolute', inset: 0, overflow: 'visible' }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} stroke-width={stroke} />
        {f > 0.001 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} stroke-width={stroke} stroke-linecap="round" stroke-dasharray={c} stroke-dashoffset={c * (1 - f)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
        {f > 0.001 && <circle cx={hx} cy={hy} r={stroke * 1.4} fill={color} opacity={0.35} />}
      </svg>
      {children}
    </span>
  );
}

/** Level bars that dance while music plays and settle when it stops. */
export function Equalizer({ playing, color = 'var(--accent)', width = 20, height = 14, bars = 4 }: { playing: boolean; color?: string; width?: number; height?: number; bars?: number }) {
  const gap = width / (bars * 2 - 1);
  return (
    <span class={`eq ${playing ? 'on' : ''}`} style={{ width, height, display: 'inline-flex', alignItems: 'center', gap, flex: 'none' }} aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => <i key={i} style={{ width: gap, background: color, animationDuration: `${520 + i * 170}ms` }} />)}
    </span>
  );
}

/** Rings spreading from the centre, as the app looks for your PCs. */
export function Radar({ color = 'var(--accent)', size = 40 }: { color?: string; size?: number }) {
  return (
    <span class="radar" style={{ width: size, height: size, '--c': color }} aria-hidden="true">
      <i /><i /><i /><b />
    </span>
  );
}

/** A tick that draws itself. */
export function DrawnCheck({ color = 'var(--good)', size = 24 }: { color?: string; size?: number }) {
  return <svg class="drawn-check" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d="M5.3 13 10.1 17.3 18.7 7.2" fill="none" stroke={color} stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>;
}

/** Play and pause, morphing: the two bars of pause flow into the triangle of play and back. */
export function PlayPause({ playing, color = 'currentColor', size = 22 }: { playing: boolean; color?: string; size?: number }) {
  const f = useSpring(playing ? 1 : 0, 0.72, 420);
  const mix = (a: number[], b: number[]) => a.map((v, i) => v + (b[i] - v) * f);
  const left = mix([0.24, 0.14, 0.52, 0.3, 0.52, 0.7, 0.24, 0.86], [0.22, 0.16, 0.42, 0.16, 0.42, 0.84, 0.22, 0.84]);
  const right = mix([0.52, 0.3, 0.84, 0.5, 0.84, 0.5, 0.52, 0.7], [0.58, 0.16, 0.78, 0.16, 0.78, 0.84, 0.58, 0.84]);
  const pts = (p: number[]) => [0, 2, 4, 6].map((i) => `${(p[i] * 24).toFixed(2)},${(p[i + 1] * 24).toFixed(2)}`).join(' ');
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
      <polygon points={pts(left)} fill={color} stroke={color} stroke-width="1.44" stroke-linejoin="round" />
      <polygon points={pts(right)} fill={color} stroke={color} stroke-width="1.44" stroke-linejoin="round" />
    </svg>
  );
}

/** A code whose digits roll into place one after another, like a departure board. */
export function RollingDigits({ text, class: cls = '', style }: { text: string; class?: string; style?: JSX.CSSProperties }) {
  return (
    <span class={`rolling ${cls}`} style={style} aria-label={text}>
      {Array.from(text).map((ch, i) => <Digit key={i} ch={ch} delay={i * 70} />)}
    </span>
  );
}
function Digit({ ch, delay }: { ch: string; delay: number }) {
  const [shown, setShown] = useState<{ now: string; was: string | null; n: number }>({ now: ch, was: null, n: 0 });
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) { first.current = false; return; }
    if (ch === shown.now) return;
    const t = setTimeout(() => setShown((s) => ({ now: ch, was: s.now, n: s.n + 1 })), delay);
    return () => clearTimeout(t);
  }, [ch]);
  return (
    <span class="digit" aria-hidden="true">
      <span class="sizer">{shown.now === ' ' ? ' ' : shown.now}</span>
      {shown.was !== null && <span key={`o${shown.n}`} class="out">{shown.was === ' ' ? ' ' : shown.was}</span>}
      <span key={`i${shown.n}`} class={shown.n > 0 ? 'in' : 'still'}>{shown.now === ' ' ? ' ' : shown.now}</span>
    </span>
  );
}

/** A card saying why something isn't here yet, with a way forward. */
export function Empty({ icon, title, detail, action }: { icon: IconName; title: string; detail?: string; action?: ComponentChildren }) {
  return (
    <GlassPanel class="col" style={{ alignItems: 'center', padding: 28, textAlign: 'center' }}>
      <span class="well" style={{ width: 64, height: 64 }}><Icon name={icon} size={30} /></span>
      <div class="t-headline" style={{ marginTop: 14 }}>{title}</div>
      {detail && <div class="t-caption muted" style={{ marginTop: 6 }}>{detail}</div>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </GlassPanel>
  );
}

// ---- words ----
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function ago(at: number, now = Date.now()): string {
  const m = Math.floor((now - at) / 60_000);
  if (m < 1) return 'Just now'; if (m < 60) return `${m} min ago`; if (m < 24 * 60) return `${Math.floor(m / 60)} h ago`; if (m < 48 * 60) return 'Yesterday';
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
export function rateText(b: number) { return b < 1024 ? `${Math.round(b)} B/s` : b < 1048576 ? `${Math.round(b / 1024)} KB/s` : `${(b / 1048576).toFixed(1)} MB/s`; }
export function leftText(s: number) {
  if (!Number.isFinite(s) || s < 0 || s > 360000) return '';
  if (s < 60) return `${Math.max(1, Math.floor(s))} s left`; if (s < 3600) return `${Math.floor(s / 60)} min left`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s / 60) % 60)} min left`;
}
export function span(seconds: number) { const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60); return d > 0 ? `${d} d ${h} h` : h > 0 ? `${h} h ${m} min` : `${m} min`; }
export function iconFor(name: string): IconName {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v'].includes(ext)) return 'movie';
  if (['mp3', 'flac', 'wav', 'm4a', 'ogg', 'aac'].includes(ext)) return 'musicNote';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'folderZip';
  return 'description';
}
