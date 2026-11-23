"""Render The Book Butler's "Spine of light" icon set (Pillow, supersampled).

    python mobile/scripts/make_icons.py

Writes mobile/assets: icon.png, android-icon-foreground.png (safe-zone fitted),
android-icon-background.png, android-icon-monochrome.png, splash-icon.png, favicon.png
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ASSETS = Path(__file__).resolve().parents[1] / "assets"
NAVY = (8, 19, 37, 255)
SPINE = (30, 52, 86, 255)
SHADOW = (22, 41, 74, 255)
GOLD = (242, 181, 58, 255)
GOLD_SOFT = (247, 200, 99, 255)
SAGE = (169, 205, 190, 255)


def art(size: int, mono: bool = False, bg: bool = True, scale: float = 1.0) -> Image.Image:
    """Draw the 140-unit concept at `size` px. `scale` shrinks the art toward the centre."""
    S = 4                                    # supersample for smooth edges
    W = size * S
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = W / 140 * scale                      # one concept unit in pixels
    off = (W - 140 * u) / 2

    def R(x0, y0, x1, y1, fill, r=0, outline=None, width=0):
        box = [off + x0 * u, off + y0 * u, off + x1 * u, off + y1 * u]
        d.rounded_rectangle(box, radius=r * u, fill=fill, outline=outline, width=int(width * u) if width else 0)

    def C(cx, cy, r, fill):
        d.ellipse([off + (cx - r) * u, off + (cy - r) * u, off + (cx + r) * u, off + (cy + r) * u], fill=fill)

    white = (255, 255, 255, 255)
    if bg and not mono:
        d.rounded_rectangle([0, 0, W, W], radius=0, fill=NAVY)   # launchers apply their own mask
    # neighbouring spines in shadow
    R(30, 38, 50, 116, white if mono else SHADOW, 2)
    R(90, 34, 112, 116, white if mono else SHADOW, 2)
    # the lit spine with gilt bands
    R(56, 26, 84, 116, white if mono else SPINE, 3, outline=None if mono else GOLD, width=1.2)
    if not mono:
        for y in (36, 40, 102, 106):
            R(60, y - 0.5, 80, y + 0.5, GOLD)
    # the sliver of light + dust motes
    R(68.5, 16, 71.5, 120, white if mono else GOLD, 1.5)
    for cx, cy, r in ((62, 22, 1.6), (79, 14, 1.3), (74, 28, 1.1), (64, 10, 1.0)):
        C(cx, cy, r, white if mono else GOLD_SOFT)
    # shelf edge
    R(24, 116, 116, 119, white if mono else SAGE, 1.5)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    ASSETS.mkdir(exist_ok=True)
    art(1024).save(ASSETS / "icon.png")
    # adaptive icon: art must sit inside the central ~66% safe zone of the 108dp canvas
    art(1024, bg=False, scale=0.8).save(ASSETS / "android-icon-foreground.png")
    Image.new("RGBA", (1024, 1024), NAVY).save(ASSETS / "android-icon-background.png")
    art(1024, mono=True, bg=False, scale=0.8).save(ASSETS / "android-icon-monochrome.png")
    art(1024, bg=False, scale=0.7).save(ASSETS / "splash-icon.png")
    art(196).save(ASSETS / "favicon.png")
    print("wrote", sorted(p.name for p in ASSETS.glob("*.png")))


if __name__ == "__main__":
    main()
