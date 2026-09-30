// The colours a cover lends the app: a vivid one (the accent), a second one, and a deep one for the background, weighed as
// the Android app's Art.colors weighs them (how vivid and how common each hue is).

export interface ArtColors { vivid: string; second: string; deep: string }
type RGB = [number, number, number];

function toHsv([r, g, b]: RGB): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255; const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d > 0) { if (max === R) h = ((G - B) / d) % 6; else if (max === G) h = (B - R) / d + 2; else h = (R - G) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, max === 0 ? 0 : d / max, max];
}
function fromHsv(h: number, s: number, v: number): RGB {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c; let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x]; else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
export const hexOf = ([r, g, b]: RGB) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
export function parseHex(h: string): RGB { const n = parseInt(h.replace('#', ''), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
export const lerpRgb = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t].map(Math.round) as RGB;

const vivid = (c: RGB) => { const [h, s, v] = toHsv(c); return fromHsv(h, Math.max(0.35, Math.min(0.85, s * 1.15)), Math.max(0.78, Math.min(0.98, v))); };
const deep = (c: RGB) => { const [h, s, v] = toHsv(c); return fromHsv(h, Math.min(0.7, s * 0.9), Math.max(0.08, Math.min(0.2, v))); };
const shift = (c: RGB, deg: number) => { const [h, s, v] = toHsv(c); return fromHsv((h + deg) % 360, s, v); };

/** A cover's colours (decoded from its JPEG), or null when it can't be read. */
export async function colorsOf(url: string): Promise<ArtColors | null> {
  try {
    const img = new Image(); img.decoding = 'async'; img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = 24; c.height = 24;
    const ctx = c.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(img, 0, 0, 24, 24);
    const px = ctx.getImageData(0, 0, 24, 24).data;
    const bins = Array.from({ length: 12 }, () => [0, 0, 0, 0]);
    let ar = 0, ag = 0, ab = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2]; ar += r; ag += g; ab += b;
      const [h, s, v] = toHsv([r, g, b]); const w = s * s * (1 - Math.abs(v - 0.62));
      if (v < 0.12 || w <= 0.01) continue;
      const bin = bins[Math.min(11, Math.max(0, Math.floor(h / 30)))]; bin[0] += w; bin[1] += r * w; bin[2] += g * w; bin[3] += b * w;
    }
    const n = 24 * 24; const average: RGB = [ar / n, ag / n, ab / n].map(Math.round) as RGB;
    const order = bins.map((_, i) => i).sort((a, b) => bins[b][0] - bins[a][0]);
    const colorOf = (i: number): RGB | null => { const b = bins[i]; return b[0] < 0.6 ? null : [b[1] / b[0], b[2] / b[0], b[3] / b[0]].map(Math.round) as RGB; };
    const first = colorOf(order[0]) ?? parseHex('#a5d8c5');
    // The second: the next strongest hue at least 60 degrees away, else the first turned a little.
    const far = order.slice(1).find((i) => { const d = Math.abs(i - order[0]); return Math.min(d, 12 - d) >= 2; });
    const second = (far !== undefined ? colorOf(far) : null) ?? shift(first, 40);
    return { vivid: hexOf(vivid(first)), second: hexOf(vivid(second)), deep: hexOf(deep(average)) };
  } catch { return null; }
}

/** The app's colours for a theme: in the light one the accents darken (to read on light glass) and the deep lightens. */
export function applyColors(colors: ArtColors | null, dark: boolean) {
  const a = parseHex(colors?.vivid ?? '#a5d8c5'), b = parseHex(colors?.second ?? '#8fa8ff'), d = parseHex(colors?.deep ?? '#0b1220');
  const s = document.documentElement.style;
  s.setProperty('--accent', hexOf(dark ? a : lerpRgb(a, [0, 0, 0], 0.38)));
  s.setProperty('--accent2', hexOf(dark ? b : lerpRgb(b, [0, 0, 0], 0.3)));
  s.setProperty('--deep', hexOf(dark ? d : lerpRgb(d, [255, 255, 255], 0.9)));
  // Safari tints its bars with the page's theme colour.
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', hexOf(dark ? lerpRgb(d, [0, 0, 0], 0.55) : lerpRgb(d, [255, 255, 255], 0.9)));
}
