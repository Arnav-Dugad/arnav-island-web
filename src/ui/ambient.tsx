// The light behind the glass, the weather on it, and files in flight.
import { useEffect, useRef } from 'preact/hooks';
import type { Transfer } from '../state/hub';

/**
 * The ambient light: a deep field lit by slow-drifting colour from what plays on your PC. It breathes gently while music
 * plays. The drift runs on the compositor (CSS), so it costs nothing on the main thread, and it stands still while a sheet
 * covers it or a finger is on the screen.
 */
export function Ambient({ playing }: { playing: boolean }) {
  return (
    <div class={`ambient ${playing ? 'playing' : ''}`} aria-hidden="true">
      <div class="blob b0"><i /></div><div class="blob b1"><i /></div><div class="blob b2"><i /></div><div class="blob b3"><i /></div>
      <div class="vignette" />
    </div>
  );
}

/** The sky where your PC is, as its island names it ("14° Rain", "9° Thunderstorm"...). */
export type Sky = 'none' | 'drizzle' | 'rain' | 'storm' | 'snow' | 'fog';
export function skyOf(weather: string): Sky {
  const w = weather.toLowerCase();
  if (w.includes('thunder') || w.includes('storm')) return 'storm';
  if (w.includes('drizzle')) return 'drizzle';
  if (w.includes('rain') || w.includes('shower')) return 'rain';
  if (w.includes('snow') || w.includes('sleet')) return 'snow';
  if (w.includes('fog') || w.includes('mist') || w.includes('haze')) return 'fog';
  return 'none';
}

interface Drop { x: number; y: number; r: number; v: number; sliding: boolean; age: number; wobble: number }
interface Flake { x: number; y: number; r: number; speed: number; sway: number; phase: number }

/**
 * The weather where your PC is, on the app's glass: drops that bead on it and now and then run down (rain, drizzle), a
 * storm's double flash, snow drifting past, or fog. It takes no touches, is still with reduced motion, and stops while the
 * app is hidden.
 */
export function WeatherGlass({ sky, active }: { sky: Sky; active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas || sky === 'none') return;
    const ctx = canvas.getContext('2d')!; const dpr = Math.min(2, devicePixelRatio || 1);
    const rnd = Math.random; const size = () => (sky === 'drizzle' ? 1.8 + rnd() * 2 : 2.4 + rnd() * 3.8);
    const drops: Drop[] = []; const trail: Drop[] = []; const flakes: Flake[] = [];
    const n = sky === 'drizzle' ? 16 : sky === 'rain' ? 28 : sky === 'storm' ? 34 : 0;
    for (let i = 0; i < n; i++) drops.push({ x: rnd(), y: rnd(), r: size(), v: 0, sliding: false, age: 1, wobble: rnd() * 6 });
    if (sky === 'snow') for (let i = 0; i < 46; i++) flakes.push({ x: rnd(), y: rnd(), r: 1.2 + rnd() * 2.4, speed: 0.02 + rnd() * 0.035, sway: 0.01 + rnd() * 0.02, phase: rnd() * 6.28 });
    let time = 0, nextSlide = 1.2, nextFlash = 3 + rnd() * 5, flash = 100, raf = 0, last = 0, lastDraw = 0;
    const resize = () => { canvas.width = Math.round(canvas.clientWidth * dpr); canvas.height = Math.round(canvas.clientHeight * dpr); };
    resize(); const ro = new ResizeObserver(resize); ro.observe(canvas);
    const pulse = (x: number) => (x < 0 ? 0 : Math.exp(-x * 14) * (1 - Math.exp(-x * 90)));
    const bead = (cx: number, cy: number, r: number, alpha: number, stretch: number) => {
      if (alpha <= 0 || r <= 0.3) return;
      const h = r * stretch; const top = cy + r - 2 * h;
      ctx.fillStyle = `rgba(0,0,0,${0.1 * alpha})`; ctx.beginPath(); ctx.ellipse(cx - r * 0.05 + 0, top + r * 0.22 + h * 1.05, r * 1.1, h * 1.05, 0, 0, Math.PI * 2); ctx.fill();
      const g = ctx.createLinearGradient(0, top, 0, top + 2 * h);
      g.addColorStop(0, `rgba(0,0,0,${0.12 * alpha})`); g.addColorStop(0.55, `rgba(255,255,255,${0.05 * alpha})`); g.addColorStop(1, `rgba(255,255,255,${0.46 * alpha})`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx, top + h, r, h, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${0.24 * alpha})`; ctx.lineWidth = Math.max(0.8, r * 0.12); ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${0.92 * alpha})`; ctx.beginPath(); ctx.arc(cx - r * 0.36, top + h * 0.5, r * 0.24, 0, Math.PI * 2); ctx.fill();
    };
    const step = (dt: number) => {
      time += dt;
      if (drops.length) {
        nextSlide -= dt;
        if (nextSlide <= 0) { const heavy = drops.filter((d) => !d.sliding && d.r > 3); if (heavy.length) heavy[Math.floor(rnd() * heavy.length)].sliding = true; nextSlide = (sky === 'drizzle' ? 2.4 : 1.1) * (0.6 + rnd()); }
        for (const d of drops) {
          d.age = Math.min(1, d.age + dt * 1.6);
          if (d.sliding) {
            d.v = Math.min(0.42, d.v + dt * 0.35); const before = d.y; d.y += d.v * dt; d.x += Math.sin(time * 3 + d.wobble) * 0.0009;
            if (Math.floor(d.y * 90) !== Math.floor(before * 90) && rnd() < 0.5) trail.push({ x: d.x, y: before, r: d.r * 0.38, v: 0, sliding: false, age: 1, wobble: 0 });
            if (d.y > 1.08) { d.x = rnd(); d.y = rnd() * 0.9; d.v = 0; d.sliding = false; d.age = 0; d.r = size(); }
          } else d.r = Math.min(6.8, d.r + dt * 0.06);
        }
        for (const t of trail) t.age -= dt * 0.35;
        for (let i = trail.length - 1; i >= 0; i--) if (trail[i].age <= 0) trail.splice(i, 1);
        if (trail.length > 120) trail.splice(0, trail.length - 120);
      }
      if (sky === 'storm') { nextFlash -= dt; if (nextFlash <= 0) { flash = 0; nextFlash = 6 + rnd() * 6; } flash += dt; }
      for (const f of flakes) { f.y += f.speed * dt; if (f.y > 1.05) { f.y = -0.05; f.x = rnd(); } }
    };
    const draw = () => {
      const w = canvas.width, h = canvas.height; ctx.clearRect(0, 0, w, h);
      if (sky === 'fog') for (let k = 0; k < 3; k++) {
        const y = h * (0.2 + 0.3 * k) + Math.sin(time * 0.1 + k * 2) * h * 0.03; const x = w * (Math.sin(time * 0.05 + k) * 0.2);
        const g = ctx.createLinearGradient(0, y - h * 0.12, 0, y + h * 0.12); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.085)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(x - w * 0.2, y - h * 0.12, w * 1.4, h * 0.24);
      }
      for (const d of trail) bead(d.x * w, d.y * h, d.r * dpr, d.age * 0.8, 1);
      for (const d of drops) bead(d.x * w, d.y * h, d.r * dpr, d.age, d.sliding ? 1 + Math.min(1.1, d.v * 5) : 1);
      for (const f of flakes) {
        const px = (f.x + Math.sin(time * 1.3 + f.phase) * f.sway) * w, py = f.y * h, r = f.r * dpr * 2.2;
        const g = ctx.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, 'rgba(255,255,255,.85)'); g.addColorStop(0.5, 'rgba(255,255,255,.2)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      }
      if (sky === 'storm') { const a = pulse(flash) + 0.7 * pulse(flash - 0.26); if (a > 0.01) { ctx.fillStyle = `rgba(255,255,255,${Math.min(0.2, a * 0.16)})`; ctx.fillRect(0, 0, w, h); } }
    };
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - lastDraw < 32) return; // about 30 steps a second: plenty for water on glass
      const dt = Math.min(0.1, last ? (now - last) / 1000 : 0.033); last = now; lastDraw = now;
      step(dt); draw();
    };
    if (active && !reduced) raf = requestAnimationFrame(loop); else draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [sky, active]);
  if (sky === 'none') return null;
  return <canvas ref={ref} class="overlay-canvas" aria-hidden="true" />;
}

interface Mote { born: number; life: number; fx: number; fy: number; bx: number; by: number; tx: number; ty: number; size: number; second: boolean }
/**
 * Files in flight, seen: while something goes to your PC, motes of light stream up into the app's island; while something
 * comes from it, they pour out of it. More of them the faster it goes; a finished send bursts from the island.
 */
export function HandoffParticles({ transfers }: { transfers: Map<number, Transfer> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useRef({ motes: [] as Mote[], seen: new Map<number, Transfer>(), raf: 0, carry: 0, last: 0, transfers });
  state.current.transfers = transfers;
  useEffect(() => {
    const st = state.current; const canvas = ref.current; if (!canvas) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // A send that finished (it was nearly all there when it left the list) bursts from the island.
    let burst = false;
    for (const [id, last] of st.seen) if (!transfers.has(id) && last.outgoing && last.total > 0 && last.done >= last.total * 0.97) burst = true;
    st.seen = new Map(transfers);
    const place = () => {
      const h = canvas.clientHeight || 1;
      const i = document.querySelector('.mini-island')?.getBoundingClientRect(); const t = document.querySelector('.tabbar')?.getBoundingClientRect();
      return { island: { x: 0.5, y: i ? (i.top + 19) / h : 0.06 }, dock: { x: 0.5, y: t ? (t.top - 40) / h : 0.82 } };
    };
    const { island } = place();
    if (burst) {
      const now = performance.now();
      for (let k = 0; k < 22; k++) { const a = (2 * Math.PI * k) / 22 + Math.random() * 0.2, d = 0.1 + Math.random() * 0.08; st.motes.push({ born: now, life: 0.7 + Math.random() * 0.3, fx: island.x, fy: island.y, bx: island.x, by: island.y, tx: island.x + Math.cos(a) * d, ty: island.y + Math.sin(a) * d * 0.55, size: 2.2 + Math.random() * 2, second: k % 2 === 0 }); }
    }
    if (st.raf) return;
    const ctx = canvas.getContext('2d')!; const dpr = Math.min(2, devicePixelRatio || 1);
    const accent = () => rgbOf(getComputedStyle(document.documentElement).getPropertyValue('--accent'), '165,216,197');
    const accent2 = () => rgbOf(getComputedStyle(document.documentElement).getPropertyValue('--accent2'), '143,168,255');
    let c1 = accent(), c2 = accent2(), colorsAt = 0;
    const loop = (now: number) => {
      const list = [...st.transfers.values()]; const sending = list.some((t) => t.outgoing), receiving = list.some((t) => !t.outgoing);
      if (!list.length && !st.motes.length) { st.raf = 0; st.last = 0; ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
      st.raf = requestAnimationFrame(loop);
      if (now - colorsAt > 1000) { c1 = accent(); c2 = accent2(); colorsAt = now; }
      const w = (canvas.width = Math.round(canvas.clientWidth * dpr)), h = (canvas.height = Math.round(canvas.clientHeight * dpr));
      const dt = Math.min(0.05, st.last ? (now - st.last) / 1000 : 0.016); st.last = now;
      const { island: is, dock } = place();
      if (sending || receiving) {
        const rate = list.reduce((a, t) => a + t.rate, 0);
        st.carry += dt * (14 + 26 * Math.max(0, Math.min(1, rate / (1 << 20))));
        while (st.carry >= 1) {
          st.carry -= 1;
          const up = sending && (!receiving || Math.random() < 0.5); const side = (Math.random() - 0.5) * 0.5;
          const s = up ? { x: dock.x + side * 0.5, y: dock.y + Math.random() * 0.03 } : is; const e = up ? { x: is.x, y: is.y - 0.03 } : { x: dock.x + side, y: dock.y + Math.random() * 0.05 };
          st.motes.push({ born: now, life: 0.9 + Math.random() * 0.5, fx: s.x, fy: s.y, bx: (s.x + e.x) / 2 + side * 0.6, by: (s.y + e.y) / 2, tx: e.x, ty: e.y, size: 1.6 + Math.random() * 2.4, second: Math.random() < 0.5 });
        }
      }
      st.motes = st.motes.filter((m) => (now - m.born) / 1000 <= m.life);
      for (const m of st.motes) {
        const f = Math.max(0, Math.min(1, (now - m.born) / 1000 / m.life));
        const e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2; const u = 1 - e;
        const x = (u * u * m.fx + 2 * u * e * m.bx + e * e * m.tx) * w, y = (u * u * m.fy + 2 * u * e * m.by + e * e * m.ty) * h;
        const alpha = Math.sin(Math.PI * f); const r = m.size * dpr * (1 - 0.45 * f);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2); const col = m.second ? c2 : c1;
        g.addColorStop(0, `rgba(${col},${(0.45 * alpha).toFixed(3)})`); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(255,255,255,${0.9 * alpha})`; ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, Math.PI * 2); ctx.fill();
      }
    };
    st.raf = requestAnimationFrame(loop);
  }, [transfers]);
  useEffect(() => () => { cancelAnimationFrame(state.current.raf); state.current.raf = 0; }, []);
  return <canvas ref={ref} class="overlay-canvas" aria-hidden="true" />;
}

/** A CSS colour ("#a5d8c5" or "rgb(...)") as "r,g,b" for a canvas. */
export function rgbOf(css: string, fallback = '165,216,197'): string {
  const c = css.trim();
  const h = c.match(/^#([0-9a-f]{6})$/i); if (h) { const n = parseInt(h[1], 16); return `${n >> 16},${(n >> 8) & 255},${n & 255}`; }
  const r = c.match(/rgba?\(([^)]+)\)/); if (r) return r[1].split(/[ ,/]+/).slice(0, 3).join(',');
  return fallback;
}
