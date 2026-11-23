"""Draw a book's spine as a PNG (cloth colour, gold-foil title and author).

Used as the texture on each 3D book in the app's bookshelf. Rendered once per
book and kept in memory; fonts are bundled (Cormorant Garamond, OFL).
"""

from __future__ import annotations

import hashlib
import io
from functools import lru_cache

from PIL import Image, ImageDraw, ImageFont

from config import DATA_DIR

FONT_TITLE = DATA_DIR / "fonts" / "CormorantGaramond_600SemiBold.ttf"
FONT_AUTHOR = DATA_DIR / "fonts" / "CormorantGaramond_500Medium_Italic.ttf"

# Night-library cloths that sit well with navy / sage / marigold
CLOTHS = [
    ((24, 44, 74), (242, 181, 58)),     # navy + marigold
    ((48, 78, 66), (242, 214, 150)),    # bottle green + pale gold
    ((112, 40, 44), (242, 196, 110)),   # oxblood + gold
    ((169, 205, 190), (18, 38, 58)),    # sage + navy ink
    ((233, 222, 199), (30, 44, 70)),    # cream + navy ink
    ((58, 44, 82), (230, 198, 120)),    # plum + gold
    ((30, 30, 34), (242, 181, 58)),     # black + marigold
    ((92, 70, 44), (240, 220, 170)),    # tan leather + cream
]


def cloth_for(title: str) -> tuple[tuple[int, int, int], tuple[int, int, int]]:
    h = int(hashlib.md5(title.encode("utf-8")).hexdigest(), 16)
    return CLOTHS[h % len(CLOTHS)]


def _fit(draw: ImageDraw.ImageDraw, text: str, path, max_len: int, start: int, minimum: int = 14):
    size = start
    while size > minimum:
        f = ImageFont.truetype(str(path), size)
        if draw.textlength(text, font=f) <= max_len:
            return f
        size -= 1
    return ImageFont.truetype(str(path), minimum)


@lru_cache(maxsize=512)
def spine_png(title: str, author: str, w: int = 112, h: int = 720) -> bytes:
    bg, ink = cloth_for(title)
    # draw horizontally (length = h), then rotate so text reads top-to-bottom like an English spine
    img = Image.new("RGB", (h, w), bg)
    d = ImageDraw.Draw(img)
    # subtle cloth weave
    for x in range(0, h, 3):
        d.line([(x, 0), (x, w)], fill=tuple(max(0, c - 6) for c in bg), width=1)
    # gilt bands near head and tail
    for x in (28, 36, h - 36, h - 28):
        d.line([(x, 8), (x, w - 8)], fill=ink, width=2)
    author_txt = (author or "").upper()
    fa = _fit(d, author_txt, FONT_AUTHOR, int(h * 0.28), int(w * 0.30)) if author_txt else None
    room = h - 120 - (int(d.textlength(author_txt, font=fa)) + 30 if fa else 0)
    ft = _fit(d, title, FONT_TITLE, room, int(w * 0.50))
    d.text((60, w // 2), title, font=ft, fill=ink, anchor="lm")
    if fa:
        d.text((h - 60, w // 2), author_txt, font=fa, fill=ink, anchor="rm")
    img = img.rotate(-90, expand=True)
    # soft shading at the edges so the spine looks rounded
    shade = Image.new("L", img.size, 0)
    sd = ImageDraw.Draw(shade)
    for i in range(10):
        a = int(70 * (1 - i / 10))
        sd.line([(i, 0), (i, img.height)], fill=a)
        sd.line([(img.width - 1 - i, 0), (img.width - 1 - i, img.height)], fill=a)
    img = Image.composite(Image.new("RGB", img.size, (0, 0, 0)), img, shade)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
