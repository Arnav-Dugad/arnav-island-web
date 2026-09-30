// Motion as the Android app has it: real springs (damping ratio and stiffness, as Compose's spring()), haptic ticks, and the
// light that follows the phone's tilt. CSS transitions get the springs as linear() curves, so they run on the compositor.
import { useEffect, useRef, useState } from 'preact/hooks';

/** A spring from 0 to 1, sampled: its CSS linear() curve and how long it takes to settle. */
export function springCurve(damping: number, stiffness: number): { css: string; ms: number } {
  const c = 2 * damping * Math.sqrt(stiffness); const dt = 1 / 240; const samples: number[] = [];
  let x = 0, v = 0, t = 0;
  while (t < 3) {
    const a = -stiffness * (x - 1) - c * v; v += a * dt; x += v * dt; t += dt; samples.push(x);
    if (t > 0.05 && Math.abs(x - 1) < 0.0015 && Math.abs(v) < 0.02) break;
  }
  const n = Math.min(64, samples.length); const pts: string[] = ['0'];
  for (let i = 1; i < n; i++) pts.push(samples[Math.round((i / (n - 1)) * (samples.length - 1))].toFixed(4));
  pts[pts.length - 1] = '1';
  return { css: `linear(${pts.join(', ')})`, ms: Math.round(t * 1000) };
}

/** The springs the app's CSS uses, as the Android app's specs. */
export function installSprings() {
  const root = document.documentElement.style;
  if (!CSS.supports('transition-timing-function', 'linear(0, 1)')) return;
  const specs: Record<string, [number, number]> = {
    press: [0.5, 650], soft: [0.8, 300], flip: [0.76, 160], bouncy: [0.6, 600], sheet: [0.8, 340], tab: [0.74, 900], island: [0.68, 330], switch: [0.62, 520], ring: [0.9, 120], pop: [0.5, 260],
  };
  for (const [name, [d, k]] of Object.entries(specs)) { const s = springCurve(d, k); root.setProperty(`--sp-${name}`, s.css); root.setProperty(`--sp-${name}-ms`, `${s.ms}ms`); }
}

/** A value that springs to its target (for what CSS can't transition: canvas drawings, numbers), redrawn each frame. */
export function useSpring(target: number, damping = 0.72, stiffness = 380, reduced = false): number {
  const [value, setValue] = useState(target);
  const s = useRef({ x: target, v: 0, raf: 0, last: 0 });
  useEffect(() => {
    const st = s.current;
    if (reduced) { st.x = target; st.v = 0; setValue(target); return; }
    const c = 2 * damping * Math.sqrt(stiffness);
    const step = (now: number) => {
      const dt = Math.min(0.032, st.last ? (now - st.last) / 1000 : 1 / 60); st.last = now;
      for (let i = 0; i < 4; i++) { const a = -stiffness * (st.x - target) - c * st.v; st.v += (a * dt) / 4; st.x += (st.v * dt) / 4; }
      if (Math.abs(st.x - target) < 0.0005 && Math.abs(st.v) < 0.005) { st.x = target; st.v = 0; st.raf = 0; st.last = 0; setValue(target); return; }
      setValue(st.x); st.raf = requestAnimationFrame(step);
    };
    cancelAnimationFrame(st.raf); st.last = 0; st.raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(st.raf); st.raf = 0; };
  }, [target, damping, stiffness, reduced]);
  return value;
}

/** The time, ticking every [ms] while [on]. */
export function useNow(ms: number, on = true): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!on) return; setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms, on]);
  return now;
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- haptics ----
let hapticsOn = true;
let switchLabel: HTMLLabelElement | null = null;
export function setHaptics(on: boolean) { hapticsOn = on; }
/**
 * A haptic tick. Safari has no vibration API, but toggling a native switch control (iOS 18) gives the system's own tick; a
 * hidden one is kept for it. Elsewhere, navigator.vibrate.
 */
export function haptic(kind: 'tick' | 'click' | 'confirm' | 'reject' | 'long' = 'tick') {
  if (!hapticsOn) return;
  try {
    if (typeof navigator.vibrate === 'function' && !/iPhone|iPad|Macintosh/.test(navigator.userAgent)) { navigator.vibrate(kind === 'long' ? 18 : kind === 'confirm' ? [8, 40, 12] : kind === 'reject' ? [14, 50, 14] : 6); return; }
    if (!switchLabel) {
      switchLabel = document.createElement('label'); switchLabel.className = 'sr'; switchLabel.setAttribute('aria-hidden', 'true');
      const input = document.createElement('input'); input.type = 'checkbox'; input.setAttribute('switch', ''); input.tabIndex = -1;
      switchLabel.appendChild(input); document.body.appendChild(switchLabel);
    }
    switchLabel.click();
    if (kind === 'confirm' || kind === 'reject') setTimeout(() => switchLabel?.click(), 90);
  } catch { /* no haptics */ }
}

// ---- tilt ----
/** The light on the glass follows the phone's tilt (-1..1 each way), smoothed, while the app is on screen. */
let tiltOn = false; let tx = 0, ty = 0, shownX = 0, shownY = 0;
function onOrientation(e: DeviceOrientationEvent) {
  if (e.beta == null || e.gamma == null) return;
  const portrait = !screen.orientation || screen.orientation.type.startsWith('portrait');
  const gx = portrait ? e.gamma : e.beta; const gy = portrait ? e.beta : -e.gamma;
  const targetX = Math.max(-1, Math.min(1, gx / 32)); const targetY = Math.max(-1, Math.min(1, (gy - 42) / 27));
  tx += (targetX - tx) * 0.12; ty += (targetY - ty) * 0.12;
  // Moves smaller than about half a degree of the light aren't drawn.
  if (Math.abs(shownX - tx) > 0.009 || Math.abs(shownY - ty) > 0.009) {
    shownX = tx; shownY = ty;
    const s = document.documentElement.style; s.setProperty('--tx', tx.toFixed(3)); s.setProperty('--ty', ty.toFixed(3));
  }
}
export let tiltHeard = false;
/** Listens for the tilt (it arrives only once iOS has allowed it for this site). */
export function listenTilt() { if (tiltOn) return; window.addEventListener('deviceorientation', onOrientation); window.addEventListener('deviceorientation', () => { tiltHeard = true; }, { once: true }); tiltOn = true; }
export function stopTilt() { if (tiltOn) window.removeEventListener('deviceorientation', onOrientation); tiltOn = false; const s = document.documentElement.style; s.setProperty('--tx', '0'); s.setProperty('--ty', '0'); }
/** Asks iOS for the tilt (from a tap: iOS asks only then); true when it's allowed. */
export async function askTilt(): Promise<boolean> {
  const D = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
  if (!D) return false;
  if (typeof D.requestPermission === 'function') { try { if ((await D.requestPermission()) !== 'granted') return false; } catch { return false; } }
  listenTilt(); return true;
}
export const tilt = () => ({ x: shownX, y: shownY });
