// This device as the island shows it in its own view: only what any web page may know (the kind of device, its system,
// its screen, the room this app has, the network's kind where the browser says it). Nothing that identifies you.

const started = Date.now();

export function platform(): { kind: 'iPhone' | 'iPad' | 'Mac' | 'Android' | 'Device'; os: string } {
  const ua = navigator.userAgent;
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const v = ua.match(/OS (\d+)[_.](\d+)(?:[_.](\d+))? like Mac OS X/) ?? ua.match(/Version\/(\d+)\.(\d+)(?:\.(\d+))?/);
  const version = v ? [v[1], v[2], v[3]].filter(Boolean).join('.') : '';
  if (/iPhone|iPod/.test(ua)) return { kind: 'iPhone', os: `iOS ${version}`.trim() };
  if (ipad) return { kind: 'iPad', os: `iPadOS ${version}`.trim() };
  if (/Android/.test(ua)) return { kind: 'Android', os: `Android ${ua.match(/Android ([\d.]+)/)?.[1] ?? ''}`.trim() };
  if (/Macintosh/.test(ua)) return { kind: 'Mac', os: 'macOS' };
  return { kind: 'Device', os: navigator.platform || 'A browser' };
}
export const isIos = () => { const k = platform().kind; return k === 'iPhone' || k === 'iPad'; };
export const standalone = () => (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;

/** A name for this device on your PCs' islands ("iPhone", "iPad"). */
export function deviceName(): string { const k = platform().kind; return k === 'Device' ? 'Web browser' : k; }

function gb(bytes: number) { return bytes >= 10 * 2 ** 30 ? `${Math.round(bytes / 2 ** 30)} GB` : `${(bytes / 2 ** 30).toFixed(1)} GB`; }
function span(ms: number) { const m = Math.floor(ms / 60_000); return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} days`; }

export async function deviceDetails(): Promise<[string, string][]> {
  const out: [string, string][] = [];
  const p = platform();
  out.push(['Model', p.kind]);
  out.push([p.kind === 'iPhone' ? 'iOS' : p.kind === 'iPad' ? 'iPadOS' : 'System', p.os.replace(/^(iOS|iPadOS) /, '')]);
  out.push(['Screen', `${screen.width} × ${screen.height} pt  ·  ${devicePixelRatio}×`]);
  try { const e = await navigator.storage?.estimate?.(); if (e?.quota) out.push(['Room for Arnav Island', `${gb(Math.max(0, e.quota - (e.usage ?? 0)))} free`]); } catch { /* unknown */ }
  const c = (navigator as Navigator & { connection?: { effectiveType?: string; type?: string } }).connection;
  out.push(['Network', !navigator.onLine ? 'Offline' : c?.type === 'wifi' ? 'Wi-Fi' : c?.type === 'cellular' ? 'Mobile data' : 'Online']);
  out.push(['Appearance', matchMedia('(prefers-color-scheme: dark)').matches ? 'Dark' : 'Light']);
  out.push(['Open for', span(Date.now() - started)]);
  out.push(['App', 'Arnav Island for iPhone (web)']);
  return out;
}
