// A glass sheet rising from the bottom over a dimmed screen. It follows the finger down and closes past a point, or with
// Escape, or a tap outside it.
import type { ComponentChildren, JSX } from 'preact';
import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';

/** How many sheets are open: while one is, the light behind stands still. */
export const sheetsOpen = signal(0);

export function GlassSheet({ visible, onDismiss, dismissible = true, class: cls = '', style, label, children }: {
  visible: boolean; onDismiss: () => void; dismissible?: boolean; class?: string; style?: JSX.CSSProperties; label?: string; children?: ComponentChildren;
}) {
  const [mounted, setMounted] = useState(visible);
  const [phase, setPhase] = useState<'' | 'in' | 'out'>('');
  const [drag, setDrag] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const kept = useRef<ComponentChildren>(null);
  const g = useRef({ id: -1, y: 0, x: 0, dragging: false, scroller: null as HTMLElement | null, last: 0, lastAt: 0, speed: 0 });
  if (visible) kept.current = children;

  useEffect(() => {
    if (visible) {
      setMounted(true); setDrag(0); sheetsOpen.value++;
      let raf2 = 0; const raf = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setPhase('in')); });
      const prev = document.activeElement as HTMLElement | null;
      setTimeout(() => { if (ref.current && !ref.current.contains(document.activeElement)) ref.current.focus({ preventScroll: true }); }, 60);
      return () => { cancelAnimationFrame(raf); cancelAnimationFrame(raf2); sheetsOpen.value--; prev?.focus?.({ preventScroll: true }); };
    }
    if (!mounted) return;
    setPhase('out');
    const t = setTimeout(() => { setMounted(false); setPhase(''); kept.current = null; }, 280);
    return () => clearTimeout(t);
  }, [visible]);

  useEffect(() => {
    if (!visible || !dismissible) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onDismiss(); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [visible, dismissible, onDismiss]);

  if (!mounted) return null;
  const onDown = (e: PointerEvent) => {
    if (!dismissible || phase !== 'in') return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, .slider, .no-drag, [role="slider"]')) return;
    g.current = { id: e.pointerId, y: e.clientY, x: e.clientX, dragging: false, scroller: t.closest('.sheet-scroll') as HTMLElement | null, last: e.clientY, lastAt: performance.now(), speed: 0 };
  };
  const onMove = (e: PointerEvent) => {
    const s = g.current; if (s.id !== e.pointerId) return;
    const dy = e.clientY - s.y, dx = e.clientX - s.x;
    if (!s.dragging) {
      if (dy > 8 && Math.abs(dy) > Math.abs(dx) * 1.2 && (!s.scroller || s.scroller.scrollTop <= 0)) { s.dragging = true; ref.current?.setPointerCapture(e.pointerId); }
      else if (Math.abs(dx) > 10 || dy < -8) { s.id = -1; return; }
      else return;
    }
    const now = performance.now(); s.speed = (e.clientY - s.last) / Math.max(1, now - s.lastAt); s.last = e.clientY; s.lastAt = now;
    setDrag(Math.max(0, dy)); e.preventDefault();
  };
  const onUp = (e: PointerEvent) => {
    const s = g.current; if (s.id !== e.pointerId) return; s.id = -1;
    if (!s.dragging) return;
    if (drag > 120 || s.speed > 0.8) onDismiss(); else setDrag(0);
  };
  return (
    <div class="layer" style={{ position: 'absolute', inset: 0, zIndex: 20 }}>
      <div class={`scrim ${phase === 'in' ? 'in' : ''}`} onClick={() => dismissible && onDismiss()} />
      <div class="sheet-wrap">
        <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label}
          class={`sheet glass sheet ${phase === 'in' ? 'in' : ''} ${phase === 'out' ? 'out' : ''} ${drag > 0 ? 'dragging' : ''} ${cls}`}
          style={{ ...(drag > 0 ? { transform: `translateY(${drag}px)` } : {}), ...(style as object) }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div class="grabber" />
          <div class="sheet-body">{visible ? children : kept.current}</div>
        </div>
      </div>
    </div>
  );
}
