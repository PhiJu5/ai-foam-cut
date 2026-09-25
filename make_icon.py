"""Erzeugt das Programm-Icon fuer AI Foam Cut (icon/icon.ico + PNG-Vorschau).

Motiv: ein Tragflaechenprofil (echtes NACA 2415, optisch verdickt) ueber dem
gluehenden Schneiddraht, der tangential darunter liegt - der Schnitt ist gerade
fertig. Farben aus der App (dunkler Grund, warmer Draht).

Die Datei wird von BEIDEN Varianten benutzt: electron-builder ueber
package.json ("win.icon") und PyInstaller ueber build_exe.py ("--icon").

Aufruf:  python make_icon.py
"""
import math
import os

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUTDIR = os.path.join(HERE, "icon")

BG_TOP = (32, 42, 56)          # Verlauf oben (leicht aufgehellt)
BG_BOT = (15, 18, 24)          # Verlauf unten  (--bg der App)
BLOCK = (231, 237, 244)        # Schaumblock, leicht kuehles Weiss
BLOCK_EDGE = (150, 166, 184)   # Kante des Blocks
WIRE_HOT = (255, 236, 170)     # Drahtkern
WIRE_MID = (255, 150, 40)      # Draht aussen
GLOW = (255, 120, 20)          # Schein um den Draht

SIZES = [256, 128, 64, 48, 32, 24, 16]
SS = 8                          # Supersampling-Faktor


def naca4(code="2412", n=120):
    """NACA-4-Profil als geschlossener Polygonzug, Sehne 0..1."""
    m = int(code[0]) / 100.0
    p = int(code[1]) / 10.0
    t = int(code[2:]) / 100.0
    up, lo = [], []
    for i in range(n + 1):
        beta = math.pi * i / n
        x = (1 - math.cos(beta)) / 2.0          # Kosinus-Verteilung: feine Nase
        yt = 5 * t * (0.2969 * math.sqrt(x) - 0.1260 * x - 0.3516 * x * x
                      + 0.2843 * x ** 3 - 0.1015 * x ** 4)
        if p > 0 and x < p:
            yc = m / (p * p) * (2 * p * x - x * x)
            dy = 2 * m / (p * p) * (p - x)
        elif p > 0:
            yc = m / ((1 - p) ** 2) * ((1 - 2 * p) + 2 * p * x - x * x)
            dy = 2 * m / ((1 - p) ** 2) * (p - x)
        else:
            yc, dy = 0.0, 0.0
        th = math.atan(dy)
        up.append((x - yt * math.sin(th), yc + yt * math.cos(th)))
        lo.append((x + yt * math.sin(th), yc - yt * math.cos(th)))
    return up + lo[::-1]


def place(pts, cx, cy, chord, ang_deg):
    """Profil skalieren, um die Sehnenmitte drehen und positionieren."""
    a = math.radians(ang_deg)
    ca, sa = math.cos(a), math.sin(a)
    out = []
    for x, y in pts:
        X = (x - 0.5) * chord
        Y = -y * chord                      # Bildkoordinaten: y nach unten
        out.append((cx + X * ca - Y * sa, cy + X * sa + Y * ca))
    return out


def vgrad(size, top, bot):
    """Senkrechter Farbverlauf."""
    img = Image.new("RGB", (1, size))
    for y in range(size):
        f = y / max(1, size - 1)
        img.putpixel((0, y), tuple(int(top[i] + (bot[i] - top[i]) * f) for i in range(3)))
    return img.resize((size, size), Image.BICUBIC)


def thicken(pts, f):
    """Profil dicker machen (nur optisch) - sonst ist es als Icon zu duenn."""
    return [(x, y * f) for x, y in pts]


def draw_icon(px, simple=False):
    """Zeichnet das Icon in der Kantenlaenge px (intern hochaufgeloest).

    Motiv: das Tragflaechenprofil ist der Held, der gluehende Draht schneidet
    waagerecht hindurch. Kein Schaumblock - der wurde bei 16 px zum weissen
    Kasten und hat das Profil erdrueckt.
    """
    S = px * SS
    r = S * 0.22                                    # Eckenradius

    base = vgrad(S, BG_TOP, BG_BOT).convert("RGBA")
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=255)
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    img.paste(base, (0, 0), mask)

    # ---- Tragflaechenprofil ------------------------------------------
    chord = S * (0.86 if simple else 0.78)
    cy = S * 0.46
    thick = 2.2 if simple else 1.75                  # klein = kraeftiger
    prof = place(thicken(naca4("2415", 200), thick), S * 0.50, cy, chord,
                 -10 if simple else -12)

    if not simple:                                   # weicher Schatten darunter
        sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(sh).polygon([(x, y + S * 0.035) for x, y in prof],
                                   fill=(0, 0, 0, 110))
        img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(S * 0.030)))

    pm = Image.new("L", (S, S), 0)
    ImageDraw.Draw(pm).polygon(prof, fill=255)
    body = vgrad(S, (250, 252, 255), (176, 206, 236)).convert("RGBA")
    img.paste(body, (0, 0), pm)

    # ---- gluehender Schneiddraht -------------------------------------
    # Der Draht liegt tangential UNTER dem Profil - so bleibt die ganze
    # Silhouette sichtbar und es sieht aus, als sei der Schnitt gerade fertig.
    wy = max(y for _, y in prof) + S * (0.045 if simple else 0.032)
    w = max(1, int(S * (0.065 if simple else 0.036)))

    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for k, a in ((4.0, 32), (2.3, 55)):
        gd.line([(0, wy), (S, wy)], fill=GLOW + (a,), width=int(w * k))
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.013))
    img.alpha_composite(Image.composite(glow, Image.new("RGBA", (S, S), (0, 0, 0, 0)), mask))

    wire = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    wd = ImageDraw.Draw(wire)
    # dunkler Saum: trennt den Draht optisch vom hellen Profil
    wd.line([(0, wy), (S, wy)], fill=(40, 24, 10, 170), width=int(w * 1.9))
    wd.line([(0, wy), (S, wy)], fill=WIRE_MID + (255,), width=w)
    wd.line([(0, wy), (S, wy)], fill=WIRE_HOT + (255,), width=max(1, int(w * 0.40)))
    wire = wire.filter(ImageFilter.GaussianBlur(S * 0.0016))
    img.alpha_composite(Image.composite(wire, Image.new("RGBA", (S, S), (0, 0, 0, 0)), mask))

    if not simple:                                   # feiner Lichtrand
        edge = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(edge).rounded_rectangle(
            [S * 0.012, S * 0.012, S - S * 0.012, S - S * 0.012],
            radius=r * 0.95, outline=(255, 255, 255, 30), width=max(1, int(S * 0.008)))
        img.alpha_composite(edge)

    return img.resize((px, px), Image.LANCZOS)


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    imgs = []
    for px in SIZES:
        im = draw_icon(px, simple=(px <= 32))
        imgs.append(im)
        im.save(os.path.join(OUTDIR, "icon-%d.png" % px))
    ico = os.path.join(OUTDIR, "icon.ico")
    imgs[0].save(ico, format="ICO", sizes=[(p, p) for p in SIZES])
    print("geschrieben:", ico)

    # Vorschaublatt auf neutralem Grau
    pad, gap = 24, 20
    W = pad * 2 + sum(i.width for i in imgs) + gap * (len(imgs) - 1)
    H = pad * 2 + SIZES[0]
    sheet = Image.new("RGB", (W, H), (124, 130, 138))
    x = pad
    for im in imgs:
        sheet.paste(im, (x, pad + (SIZES[0] - im.height) // 2), im)
        x += im.width + gap
    sheet.save(os.path.join(OUTDIR, "vorschau.png"))
    print("Vorschau:", os.path.join(OUTDIR, "vorschau.png"))


if __name__ == "__main__":
    main()
