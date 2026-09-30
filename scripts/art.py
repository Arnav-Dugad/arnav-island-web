# The app's icons and launch screens, drawn as the Android app's adaptive icon is: night glass (deep blue-black with a mint
# glow rising from below) and the island, a glass capsule with a lit rim, a cover on its left and a level meter on its right.
import os
from PIL import Image, ImageDraw, ImageFilter

here = os.path.dirname(os.path.abspath(__file__))
pub = os.path.join(os.path.dirname(here), 'public')
os.makedirs(os.path.join(pub, 'icons'), exist_ok=True)
os.makedirs(os.path.join(pub, 'splash'), exist_ok=True)

def lerp(a, b, t): return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(len(a)))
def hexc(h, a=255): h = h.lstrip('#'); return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)

def background(w, h):
    img = Image.new('RGBA', (w, h))
    px = img.load()
    c0, c1, c2 = hexc('0B1426'), hexc('0A0F1C'), hexc('11302B')
    for y in range(h):
        for x in range(w):
            t = (x / max(1, w - 1) + y / max(1, h - 1)) / 2
            px[x, y] = lerp(c0, c1, t * 2) if t < .5 else lerp(c1, c2, (t - .5) * 2)
    # The mint glow rising from below.
    glow = Image.new('RGBA', (w, h), (0, 0, 0, 0)); g = ImageDraw.Draw(glow)
    tall = h > w * 1.2
    r = int(w * .95) if tall else int(max(w, h) * 70 / 108); cx, cy = w // 2, int(h * (1.02 if tall else 96 / 108))
    steps = 60
    for i in range(steps, 0, -1):
        rr = r * i / steps; a = int((0x48 if tall else 0x66) * (1 - i / steps) ** 1.2)
        g.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(0xA5, 0xD8, 0xC5, a))
    glow = glow.filter(ImageFilter.GaussianBlur(max(w, h) / 40))
    return Image.alpha_composite(img, glow)

def island(size, scale=1.0, cx=None, cy=None):
    """The capsule on a transparent layer, in a [size x size] square (108 units across), scaled about its centre."""
    s = size / 108 * scale
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ox = (cx if cx is not None else size / 2) - 54 * s; oy = (cy if cy is not None else size / 2) - 54 * s
    P = lambda x, y: (ox + x * s, oy + y * s)
    # Soft shadow under the capsule.
    sh = Image.new('RGBA', (size, size), (0, 0, 0, 0)); d = ImageDraw.Draw(sh)
    d.rounded_rectangle([*P(24, 60), *P(84, 80)], radius=10 * s, fill=(0, 0, 0, 0x55))
    layer = Image.alpha_composite(layer, sh.filter(ImageFilter.GaussianBlur(4 * s)))
    # The capsule's glass.
    cap = Image.new('RGBA', (size, size), (0, 0, 0, 0)); d = ImageDraw.Draw(cap)
    x0, y0 = P(21, 42); x1, y1 = P(87, 66)
    grad = Image.new('RGBA', (size, size)); gp = grad.load()
    a, b = hexc('1A2130', 0xF2), hexc('070A10', 0xF2)
    for y in range(int(y0), int(y1) + 1):
        for x in range(int(x0), int(x1) + 1):
            if 0 <= x < size and 0 <= y < size:
                t = min(1, max(0, ((x - x0) / max(1, x1 - x0) + (y - y0) / max(1, y1 - y0)) / 2)); gp[x, y] = lerp(a, b, t)
    mask = Image.new('L', (size, size), 0); ImageDraw.Draw(mask).rounded_rectangle([x0, y0, x1, y1], radius=12 * s, fill=255)
    cap.paste(grad, (0, 0), mask)
    # A soft sheen across its top.
    sheen = Image.new('RGBA', (size, size), (0, 0, 0, 0)); sd = ImageDraw.Draw(sheen)
    for i in range(int((y1 - y0) * .5)):
        sd.line([(x0, y0 + i), (x1, y0 + i)], fill=(255, 255, 255, int(28 * (1 - i / ((y1 - y0) * .5)))))
    cap = Image.alpha_composite(cap, Image.composite(sheen, Image.new('RGBA', (size, size), (0, 0, 0, 0)), mask))
    layer = Image.alpha_composite(layer, cap)
    # Its lit rim: bright at the upper left, fading, a mint return at the lower right.
    rim = Image.new('RGBA', (size, size), (0, 0, 0, 0)); rd = ImageDraw.Draw(rim)
    rd.rounded_rectangle([x0, y0, x1, y1], radius=12 * s, outline=(255, 255, 255, 255), width=max(1, int(round(1.4 * s))))
    rp = rim.load(); ra, rb, rc = (255, 255, 255, 0xE6), (255, 255, 255, 0x26), (0xA5, 0xD8, 0xC5, 0x80)
    for y in range(size):
        for x in range(size):
            if rp[x, y][3]:
                t = min(1, max(0, ((x - P(18, 0)[0]) / (70 * s) + (y - P(0, 40)[1]) / (28 * s)) / 2))
                c = lerp(ra, rb, t * 2) if t < .5 else lerp(rb, rc, (t - .5) * 2)
                rp[x, y] = (c[0], c[1], c[2], int(c[3] * rp[x, y][3] / 255))
    layer = Image.alpha_composite(layer, rim)
    # A cover.
    cov = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    cx0, cy0 = P(27, 47); cx1, cy1 = P(44, 61)
    cg = Image.new('RGBA', (size, size)); cgp = cg.load(); ca, cb = hexc('7FE3C8'), hexc('5B8DEF')
    for y in range(int(cy0), int(cy1) + 1):
        for x in range(int(cx0), int(cx1) + 1):
            if 0 <= x < size and 0 <= y < size:
                t = min(1, max(0, ((x - cx0) / max(1, cx1 - cx0) + (y - cy0) / max(1, cy1 - cy0)) / 2)); cgp[x, y] = lerp(ca, cb, t)
    cm = Image.new('L', (size, size), 0); ImageDraw.Draw(cm).rounded_rectangle([cx0, cy0, cx1, cy1], radius=3 * s, fill=255)
    cov.paste(cg, (0, 0), cm); layer = Image.alpha_composite(layer, cov)
    # The level meter.
    d = ImageDraw.Draw(layer)
    for bx, by, bh in [(52, 51.5, 5), (56.5, 48.5, 11), (61, 50.5, 7), (65.5, 52.5, 3), (70, 50, 8), (74.5, 52, 4)]:
        d.rounded_rectangle([*P(bx, by), *P(bx + 2.4, by + bh)], radius=1.2 * s, fill=hexc('A5D8C5'))
    return layer

def icon(size, pad_scale=1.3, rounded=False):
    img = background(size, size)
    img = Image.alpha_composite(img, island(size, pad_scale))
    if rounded:
        m = Image.new('L', (size, size), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * .225), fill=255)
        out = Image.new('RGBA', (size, size), (0, 0, 0, 0)); out.paste(img, (0, 0), m); return out
    return img

big = icon(1024, 1.34)
for n in [180, 192, 512]:
    im = big.resize((n, n), Image.LANCZOS)
    im.convert('RGB').save(os.path.join(pub, 'icons', 'apple-touch-icon.png' if n == 180 else f'icon-{n}.png'), optimize=True)
# Maskable (Android): the island well inside the safe zone.
icon(512, 1.02).convert('RGB').save(os.path.join(pub, 'icons', 'icon-maskable-512.png'), optimize=True)
icon(256, 1.34, rounded=True).save(os.path.join(pub, 'icons', 'icon-rounded-256.png'), optimize=True)

# Launch screens: night glass with the island in the middle.
for w, h in [(1320, 2868), (1290, 2796), (1206, 2622), (1179, 2556), (1284, 2778), (1170, 2532), (1125, 2436), (828, 1792), (750, 1334), (2048, 2732), (1668, 2388), (1640, 2360)]:
    small_w, small_h = w // 6, h // 6
    bg = background(small_w, small_h).resize((w, h), Image.BICUBIC)
    side = int(min(w, h) * .9)
    lay = island(side, 1.0)
    bg.alpha_composite(lay, ((w - side) // 2, (h - side) // 2 - int(h * .02)))
    bg.convert('RGB').save(os.path.join(pub, 'splash', f'splash-{w}x{h}.png'), optimize=True)
print('ok')
