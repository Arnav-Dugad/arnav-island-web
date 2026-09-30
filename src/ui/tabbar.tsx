// The floating tab bar: a glass capsule whose selection is a drop of glass. The drop follows the pages as they're swiped
// (so it glides continuously between tabs), stretches with its speed, swells under the finger and can be dragged across
// the tabs, as on iOS 26.
import { useEffect, useRef } from 'preact/hooks';
import { Icon, type IconName } from './components';
import { haptic } from './motion';

export interface TabItem { label: string; icon: IconName }

export function TabBar({ items, subscribe, selected, onSelect }: { items: TabItem[]; subscribe: (f: (position: number) => void) => () => void; selected: number; onSelect: (i: number) => void }) {
  const bar = useRef<HTMLDivElement>(null); const drop = useRef<HTMLDivElement>(null); const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const s = useRef({ position: selected, shown: selected, v: 0, raf: 0, dragging: false, touching: false, swell: 1, swellV: 0, last: 0, id: -1, startX: 0, startPos: 0, moved: false, tick: -1 });

  useEffect(() => {
    const st = s.current;
    const draw = () => {
      const b = bar.current, d = drop.current; if (!b || !d) return;
      const cell = (b.clientWidth - 12) / items.length;
      const stretch = Math.min(1.45, 1 + Math.abs(st.v) * 0.0016 * 60);
      d.style.width = `${cell}px`;
      d.style.transform = `translateX(${st.shown * cell}px) scale(${stretch * st.swell}, ${st.swell / Math.min(1.2, stretch)})`;
      tabs.current.forEach((t, i) => { if (t) t.style.setProperty('--near', String(Math.max(0, Math.min(1, 1 - Math.abs(st.shown - i))))); });
    };
    // The drop springs toward where the pages are (0.74 damping, stiffness 900, as the Android app's), and the swell toward the finger.
    const step = (now: number) => {
      const dt = Math.min(0.032, st.last ? (now - st.last) / 1000 : 1 / 60); st.last = now;
      if (!st.dragging) { const k = 900, c = 2 * 0.74 * Math.sqrt(k); const a = -k * (st.shown - st.position) - c * st.v; st.v += a * dt; st.shown += st.v * dt; }
      const ts = st.touching ? 1.16 : 1; { const k = 520, c = 2 * 0.5 * Math.sqrt(k); const a = -k * (st.swell - ts) - c * st.swellV; st.swellV += a * dt; st.swell += st.swellV * dt; }
      draw();
      const settled = Math.abs(st.shown - st.position) < 0.001 && Math.abs(st.v) < 0.001 && Math.abs(st.swell - ts) < 0.001 && Math.abs(st.swellV) < 0.001;
      if (settled && !st.dragging) { st.shown = st.position; st.v = 0; st.swell = ts; st.swellV = 0; st.raf = 0; st.last = 0; draw(); return; }
      st.raf = requestAnimationFrame(step);
    };
    const kick = () => { if (!st.raf) { st.last = 0; st.raf = requestAnimationFrame(step); } };
    (st as unknown as { kick: () => void }).kick = kick;
    const off = subscribe((p) => { st.position = p; kick(); });
    const ro = new ResizeObserver(() => draw()); if (bar.current) ro.observe(bar.current);
    draw();
    return () => { off(); ro.disconnect(); cancelAnimationFrame(st.raf); st.raf = 0; };
  }, [items.length]);

  const kick = () => (s.current as unknown as { kick?: () => void }).kick?.();
  const cellOf = () => (bar.current!.clientWidth - 12) / items.length;
  return (
    <nav ref={bar} class="tabbar glass bar capsule" aria-label="Tabs"
      onPointerDown={(e) => { const st = s.current; st.id = e.pointerId; st.touching = true; st.startX = e.clientX; st.startPos = st.shown; st.moved = false; st.tick = Math.round(st.shown); kick(); }}
      onPointerMove={(e) => {
        const st = s.current; if (st.id !== e.pointerId) return;
        const dx = e.clientX - st.startX;
        if (!st.dragging && Math.abs(dx) > 8) { st.dragging = true; st.moved = true; bar.current?.setPointerCapture(e.pointerId); }
        if (!st.dragging) return;
        const next = Math.max(-0.2, Math.min(items.length - 0.8, st.startPos + dx / cellOf())); st.v = (next - st.shown) * 60; st.shown = next; kick();
        const nearest = Math.max(0, Math.min(items.length - 1, Math.round(next))); if (nearest !== st.tick) { st.tick = nearest; haptic('tick'); }
      }}
      onPointerUp={(e) => { const st = s.current; if (st.id !== e.pointerId) return; st.id = -1; st.touching = false; if (st.dragging) { st.dragging = false; const target = Math.max(0, Math.min(items.length - 1, Math.round(st.shown))); st.position = target; onSelect(target); } kick(); }}
      onPointerCancel={() => { const st = s.current; st.id = -1; st.touching = false; st.dragging = false; kick(); }}>
      <div ref={drop} class="drop glass control tinted capsule" />
      <div class="tabs" role="tablist">
        {items.map((item, i) => (
          <button key={item.label} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" aria-selected={i === selected} aria-label={item.label} class="tab"
            onClick={() => { if (s.current.moved) return; haptic('tick'); s.current.position = i; kick(); onSelect(i); }}>
            <span class="tab-icon"><Icon name={item.icon} size={23} /></span>
            <span class="tab-label">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
