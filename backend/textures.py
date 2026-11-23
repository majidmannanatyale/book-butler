"""Textures for the 3D books, served fast from our own server.

Open Library covers can take seconds to arrive and come at odd sizes, so the
server fetches each one once, sizes it for a phone GPU (power-of-two-ish,
~512 px), and keeps it on disk. When a book has no cover anywhere, we print
one: cloth, gilt rules and gold-foil type, matching its spine. Every face of
every book therefore has an image, and a 3D book never shows a bare colour.
"""

from __future__ import annotations

import hashlib
import io
import threading
from functools import lru_cache

import httpx
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

import spines
from config import DATA_DIR

TEX_DIR = DATA_DIR / "tex"
FACES_DIR = DATA_DIR / "faces"
COVER_W, COVER_H = 400, 600
_lock = threading.Lock()


def _jpeg(img: Image.Image, q: int = 84) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=q, optimize=True, progressive=False)
    return buf.getvalue()


def _fit_cover(img: Image.Image) -> Image.Image:
    img = ImageOps.exif_transpose(img).convert("RGB")
    return ImageOps.fit(img, (COVER_W, COVER_H), Image.LANCZOS, centering=(0.5, 0.5))


# ------------------------------------------------------------ printed covers

def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(DATA_DIR / "fonts" / name), size)


def _wrap(d: ImageDraw.ImageDraw, text: str, font, width: int) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = f"{cur} {w}".strip()
        if d.textlength(t, font=font) <= width or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines[:5]


@lru_cache(maxsize=512)
def printed_cover(title: str, author: str) -> bytes:
    """A cloth-bound cover with gilt frame and gold-foil title, matching the spine."""
    bg, ink = spines.cloth_for(title)
    W, H = COVER_W, COVER_H
    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)
    for y in range(0, H, 3):                                  # cloth weave
        d.line([(0, y), (W, y)], fill=tuple(max(0, c - 7) for c in bg))
    for x in range(0, W, 4):
        d.line([(x, 0), (x, H)], fill=tuple(min(255, c + 4) for c in bg))
    d.rectangle([22, 22, W - 22, H - 22], outline=ink, width=2)   # gilt frame
    d.rectangle([30, 30, W - 30, H - 30], outline=ink, width=1)
    for cx, cy in ((30, 30), (W - 30, 30), (30, H - 30), (W - 30, H - 30)):
        d.ellipse([cx - 5, cy - 5, cx + 5, cy + 5], fill=ink)
    size = 52 if len(title) < 18 else 44 if len(title) < 32 else 36
    ft = _font("CormorantGaramond_600SemiBold.ttf", size)
    lines = _wrap(d, title, ft, W - 90)
    lh = int(size * 1.08)
    y = int(H * 0.36) - (len(lines) * lh) // 2
    for ln in lines:
        d.text((W // 2, y), ln, font=ft, fill=ink, anchor="mm")
        y += lh
    d.line([(W // 2 - 30, y + 6), (W // 2 + 30, y + 6)], fill=ink, width=1)
    d.ellipse([W // 2 - 3, y + 3, W // 2 + 3, y + 9], fill=ink)
    if author:
        fa = _font("CormorantGaramond_500Medium_Italic.ttf", 28)
        d.text((W // 2, int(H * 0.80)), author, font=fa, fill=ink, anchor="mm")
    # a little wear and light falloff so it reads as an object, not a graphic
    vign = Image.new("L", (W, H), 0)
    ImageDraw.Draw(vign).rectangle([0, 0, W, H], outline=90, width=26)
    vign = vign.filter(ImageFilter.GaussianBlur(22))
    img = Image.composite(Image.new("RGB", (W, H), (0, 0, 0)), img, vign)
    return _jpeg(img, 86)


@lru_cache(maxsize=512)
def printed_back(title: str, author: str) -> bytes:
    bg, ink = spines.cloth_for(title)
    W, H = COVER_W, COVER_H
    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)
    for y in range(0, H, 3):
        d.line([(0, y), (W, y)], fill=tuple(max(0, c - 7) for c in bg))
    d.rectangle([22, 22, W - 22, H - 22], outline=ink, width=1)
    # a small blind-stamped device in the middle, publisher-style
    d.ellipse([W // 2 - 26, H // 2 - 26, W // 2 + 26, H // 2 + 26], outline=ink, width=2)
    fa = _font("CormorantGaramond_600SemiBold.ttf", 30)
    d.text((W // 2, H // 2), (title[:1] or "B").upper(), font=fa, fill=ink, anchor="mm")
    vign = Image.new("L", (W, H), 0)
    ImageDraw.Draw(vign).rectangle([0, 0, W, H], outline=90, width=26)
    img = Image.composite(Image.new("RGB", (W, H), (0, 0, 0)), img, vign.filter(ImageFilter.GaussianBlur(22)))
    return _jpeg(img, 84)


@lru_cache(maxsize=1)
def page_edges() -> bytes:
    """Fine paper lines for the fore-edge, top and bottom of every book."""
    W, H = 64, 512
    img = Image.new("RGB", (W, H), (236, 226, 204))
    d = ImageDraw.Draw(img)
    import random
    rnd = random.Random(7)
    for x in range(0, W, 2):
        c = 214 + rnd.randint(-10, 8)
        d.line([(x, 0), (x, H)], fill=(c, c - 9, c - 26))
    return _jpeg(img, 80)


# ------------------------------------------------------------ fetched covers

def _cache_path(url: str):
    return TEX_DIR / f"cover_{hashlib.sha1(url.encode()).hexdigest()[:16]}.jpg"


def fetch_cover(url: str, timeout: float = 12.0) -> bytes | None:
    """Download once, size for the GPU, keep on disk. None if it isn't a real image."""
    p = _cache_path(url)
    if p.exists():
        return p.read_bytes() or None          # an empty file marks "tried, no cover"
    try:
        r = httpx.get(url, timeout=timeout, follow_redirects=True)
        if r.status_code != 200 or len(r.content) < 1500:
            raise ValueError("no cover")
        img = Image.open(io.BytesIO(r.content))
        if img.width < 40:                     # Open Library's 1x1 "no cover" pixel
            raise ValueError("blank")
        data = _jpeg(_fit_cover(img))
    except Exception:  # noqa: BLE001
        TEX_DIR.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"")
        return None
    TEX_DIR.mkdir(parents=True, exist_ok=True)
    with _lock:
        p.write_bytes(data)
    return data


def _face(book: dict, side: str) -> bytes | None:
    if side in (book.get("faces") or []):
        p = FACES_DIR / f"{book['id']}_{side}.jpg"
        if p.exists():
            return p.read_bytes()
    return None


def texture(book: dict, side: str) -> tuple[bytes, str]:
    """(bytes, media type) for one face of a book: the reader's photo, the real cover, or a printed one."""
    own = _face(book, side)
    if own:
        return own, "image/jpeg"
    title, author = book.get("title") or "Untitled", book.get("author") or ""
    if side == "front":
        if book.get("cover_url"):
            got = fetch_cover(book["cover_url"])
            if got:
                return got, "image/jpeg"
        return printed_cover(title, author), "image/jpeg"
    if side == "back":
        return printed_back(title, author), "image/jpeg"
    if side == "spine":
        return spines.spine_png(title, author), "image/png"
    return page_edges(), "image/jpeg"


def prewarm(books: list[dict]) -> int:
    """Fetch every cover in the background so the first look is already fast."""
    n = 0
    for b in books:
        url = b.get("cover_url")
        if url and not _cache_path(url).exists():
            if fetch_cover(url):
                n += 1
    return n
