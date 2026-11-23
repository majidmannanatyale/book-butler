"""Where to listen to or read a book — free options first.

Free and real (open, keyless APIs, checked live and cached for 30 days):
  * LibriVox: public-domain audiobooks read by volunteers.
  * Open Library / Internet Archive: read free (public domain) or borrow free.
Then search links (no API exists for these without partner keys): Spotify
audiobooks, Audible, Kindle, Google Play Books, Apple Books. No AI, $0.
"""

from __future__ import annotations

import re
from urllib.parse import quote, quote_plus

import httpx

import library

UA = {"User-Agent": "BookButler/1.0 (student project; open data)"}


def _librivox(title: str, author: str) -> dict | None:
    t = re.sub(r"[^\w\s']", " ", title.split(":")[0]).strip()
    try:
        r = httpx.get("https://librivox.org/api/feed/audiobooks/",
                      params={"title": f"^{t}", "format": "json", "extended": 1, "limit": 5},
                      headers=UA, timeout=12)
        books = r.json().get("books") or [] if r.status_code == 200 else []
    except Exception:  # noqa: BLE001
        return None
    surname = (author or "").split()[-1].lower() if author else ""
    for b in books:
        names = " ".join(f"{a.get('first_name', '')} {a.get('last_name', '')}" for a in b.get("authors") or []).lower()
        if surname and surname not in names:
            continue
        if library.title_similarity(title, b.get("title") or "") < 0.75:
            continue
        hours = (b.get("totaltime") or "").split(":")[0].lstrip("0") or "<1"
        return {"name": "LibriVox", "kind": "audiobook", "free": True, "url": b.get("url_librivox"),
                "detail": f"Free audiobook · {hours} h · public domain, read by volunteers"}
    return None


def _openlibrary(title: str, author: str) -> dict | None:
    try:
        r = httpx.get("https://openlibrary.org/search.json",
                      params={"title": title, "author": author, "fields": "key,title,author_name,ebook_access,ia",
                              "limit": 5},
                      headers=UA, timeout=15)
        docs = r.json().get("docs") or [] if r.status_code == 200 else []
    except Exception:  # noqa: BLE001
        return None
    for d in docs:
        if library.similarity(title, author, d.get("title") or "", ", ".join(d.get("author_name") or [])) < 0.75:
            continue
        access = d.get("ebook_access")
        if access == "public":
            return {"name": "Open Library", "kind": "ebook", "free": True, "url": f"https://openlibrary.org{d['key']}",
                    "detail": "Read free online · public domain"}
        if access == "borrowable":
            return {"name": "Open Library", "kind": "ebook", "free": True, "url": f"https://openlibrary.org{d['key']}",
                    "detail": "Borrow free for 14 days with a library account"}
    return None


def listen_and_read(title: str, author: str = "") -> dict:
    key = f"listen2|{title.lower()}|{author.lower()}"
    hit = library._cache_get(key)
    if hit is not None:
        return hit
    free = [x for x in (_librivox(title, author), _openlibrary(title, author)) if x]
    q = quote_plus(f"{title} {author}".strip())
    links = [
        {"name": "Spotify", "kind": "audiobook", "url": f"https://open.spotify.com/search/{quote(f'{title} {author}'.strip())}/audiobooks",
         "detail": "Audiobooks (Premium includes 15 h a month)"},
        {"name": "Audible", "kind": "audiobook", "url": f"https://www.audible.com/search?keywords={q}", "detail": "Audiobook"},
        {"name": "Kindle", "kind": "ebook", "url": f"https://www.amazon.com/s?k={q}&i=digital-text", "detail": "Ebook"},
        {"name": "Google Play Books", "kind": "ebook", "url": f"https://play.google.com/store/search?q={q}&c=books",
         "detail": "Ebook & audiobook"},
        {"name": "Libby", "kind": "borrow", "url": f"https://libbyapp.com/search/{quote_plus(title)}",
         "detail": "Borrow ebook/audiobook free from your library"},
    ]
    out = {"free": free, "links": links}
    library._cache_put(key, out)
    return out
