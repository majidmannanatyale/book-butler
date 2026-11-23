"""Library data layer: SQLite, fuzzy title matching, collection gaps, Open Library.

Everything here is plain code (no LLM) — the cheapest possible path. The MCP
server and the FastAPI routes both call into this module.
"""

from __future__ import annotations

import json
import re
import sqlite3
import time
import unicodedata
from contextlib import contextmanager
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable

import httpx

from config import DB_PATH, SEED_PATH

OL_BASE = "https://openlibrary.org"
OL_HEADERS = {"User-Agent": "BookFinderClassProject/0.1 (educational demo)"}
OL_FIELDS = ("key,title,author_name,first_publish_year,isbn,cover_i,subject,"
             "number_of_pages_median,publisher,edition_count")

SCHEMA = """
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  year INTEGER,
  publisher TEXT,
  binding TEXT,              -- hardcover / paperback / clothbound / leather ...
  edition TEXT,              -- e.g. "Penguin Clothbound Classics", "First UK edition"
  height_cm REAL,
  pages INTEGER,
  isbn TEXT,
  cover_url TEXT,
  subjects TEXT,             -- JSON list
  collection TEXT,           -- series / set this belongs to
  series_index INTEGER,
  status TEXT NOT NULL DEFAULT 'owned',   -- owned | wishlist
  favourite INTEGER NOT NULL DEFAULT 0,
  reading INTEGER NOT NULL DEFAULT 0,
  progress REAL NOT NULL DEFAULT 0,       -- 0..1
  hours_read REAL NOT NULL DEFAULT 0,
  notes TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS collections (
  name TEXT PRIMARY KEY,
  author TEXT,
  members TEXT NOT NULL      -- JSON list of titles, in reading order
);
CREATE TABLE IF NOT EXISTS ol_cache (
  key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  fetched_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS scan_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dhash TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts REAL NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  input_tokens INTEGER, cached_tokens INTEGER, output_tokens INTEGER,
  cost_usd REAL NOT NULL,
  detail TEXT
);
"""

BOOK_FIELDS = ("title", "author", "year", "publisher", "binding", "edition", "height_cm", "pages",
               "isbn", "cover_url", "subjects", "collection", "series_index", "status", "favourite",
               "reading", "progress", "hours_read", "notes", "position", "faces")


# ----------------------------------------------------------------- database

def connect(path: Path = DB_PATH) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    return con


@contextmanager
def db():
    con = connect()
    try:
        yield con
        con.commit()
    finally:
        con.close()


def init_db(reset: bool = False) -> None:
    """Create tables; seed from data/seed_library.json when empty (or on reset)."""
    with db() as con:
        con.executescript(SCHEMA)
        cols = {r[1] for r in con.execute("PRAGMA table_info(books)")}
        if "faces" not in cols:   # added later: which sides of the book the user photographed
            con.execute("ALTER TABLE books ADD COLUMN faces TEXT")
        if reset:
            con.execute("DELETE FROM books")
            con.execute("DELETE FROM collections")
        empty = con.execute("SELECT COUNT(*) FROM books").fetchone()[0] == 0
        if empty and SEED_PATH.exists():
            seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
            for i, b in enumerate(seed.get("books", [])):
                b = {**b, "position": i}
                _insert_book(con, b)
            for c in seed.get("collections", []):
                con.execute("INSERT OR REPLACE INTO collections(name, author, members) VALUES (?,?,?)",
                            (c["name"], c.get("author", ""), json.dumps(c["members"])))


def _insert_book(con: sqlite3.Connection, b: dict) -> int:
    row = {k: b.get(k) for k in BOOK_FIELDS if b.get(k) is not None}
    if isinstance(row.get("subjects"), list):
        row["subjects"] = json.dumps(row["subjects"][:8])
    if isinstance(row.get("faces"), list):
        row["faces"] = json.dumps(row["faces"])
    for k in ("favourite", "reading"):
        if k in row:
            row[k] = int(bool(row[k]))
    cols = ",".join(row)
    cur = con.execute(f"INSERT INTO books({cols}) VALUES ({','.join('?' * len(row))})", tuple(row.values()))
    return int(cur.lastrowid)


def book_to_dict(r: sqlite3.Row) -> dict:
    d = dict(r)
    try:
        d["subjects"] = json.loads(d.get("subjects") or "[]")
    except json.JSONDecodeError:
        d["subjects"] = []
    d["favourite"] = bool(d.get("favourite"))
    d["reading"] = bool(d.get("reading"))
    try:
        d["faces"] = json.loads(d.get("faces") or "[]")
    except json.JSONDecodeError:
        d["faces"] = []
    return d


def list_books(status: str | None = "owned") -> list[dict]:
    with db() as con:
        if status:
            rows = con.execute("SELECT * FROM books WHERE status=? ORDER BY position, id", (status,))
        else:
            rows = con.execute("SELECT * FROM books ORDER BY position, id")
        return [book_to_dict(r) for r in rows]


def get_book(book_id: int) -> dict | None:
    with db() as con:
        r = con.execute("SELECT * FROM books WHERE id=?", (book_id,)).fetchone()
        return book_to_dict(r) if r else None


def add_book(data: dict) -> dict:
    with db() as con:
        if "position" not in data:
            data["position"] = (con.execute("SELECT COALESCE(MAX(position),0)+1 FROM books").fetchone()[0])
        new_id = _insert_book(con, data)
    return get_book(new_id)  # type: ignore[return-value]


def update_book(book_id: int, changes: dict) -> dict | None:
    row = {k: v for k, v in changes.items() if k in BOOK_FIELDS}
    if not row:
        return get_book(book_id)
    if isinstance(row.get("subjects"), list):
        row["subjects"] = json.dumps(row["subjects"][:8])
    if isinstance(row.get("faces"), list):
        row["faces"] = json.dumps(row["faces"])
    for k in ("favourite", "reading"):
        if k in row:
            row[k] = int(bool(row[k]))
    sets = ",".join(f"{k}=?" for k in row)
    with db() as con:
        con.execute(f"UPDATE books SET {sets} WHERE id=?", (*row.values(), book_id))
    return get_book(book_id)


def delete_book(book_id: int) -> bool:
    with db() as con:
        return con.execute("DELETE FROM books WHERE id=?", (book_id,)).rowcount > 0


def reorder(ids: list[int]) -> None:
    with db() as con:
        for pos, bid in enumerate(ids):
            con.execute("UPDATE books SET position=? WHERE id=?", (pos, bid))


def stats() -> dict:
    with db() as con:
        owned = con.execute("SELECT COUNT(*), COALESCE(SUM(hours_read),0), COALESCE(SUM(pages),0) "
                            "FROM books WHERE status='owned'").fetchone()
        authors = con.execute("SELECT COUNT(DISTINCT author) FROM books WHERE status='owned'").fetchone()[0]
        reading = con.execute("SELECT COUNT(*) FROM books WHERE reading=1").fetchone()[0]
        wish = con.execute("SELECT COUNT(*) FROM books WHERE status='wishlist'").fetchone()[0]
        favs = con.execute("SELECT COUNT(*) FROM books WHERE favourite=1").fetchone()[0]
    gaps = collection_gaps()
    return {
        "books": owned[0], "hours_read": round(owned[1], 1), "pages": owned[2], "authors": authors,
        "reading_now": reading, "wishlist": wish, "favourites": favs,
        "missing_from_collections": sum(len(g["missing"]) for g in gaps),
    }


# ----------------------------------------------------------- fuzzy matching

_ARTICLES = re.compile(r"^(the|a|an|le|la|les|el|il)\s+")


def norm(text: str | None) -> str:
    if not text:
        return ""
    t = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    t = t.split(":")[0]                       # drop subtitles
    t = re.sub(r"\(.*?\)", " ", t)            # drop "(Penguin Classics)" etc.
    t = re.sub(r"[^a-z0-9 ]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return _ARTICLES.sub("", t)


def _surname(author: str | None) -> str:
    parts = norm(author).split()
    return parts[-1] if parts else ""


_STOP = {"and", "the", "of", "a", "an", "in", "to", "on", "for", "or", "de", "la", "le", "book", "novel", "vol", "volume"}


def title_similarity(title_a: str, title_b: str) -> float:
    """Blend of character similarity and distinctive-word overlap.

    Words matter more than characters so series titles that share a long prefix
    ("Harry Potter and the ...") don't look alike, while a spine that shows only
    "Goblet of Fire" still matches the full title.
    """
    ta, tb = norm(title_a), norm(title_b)
    if not ta or not tb:
        return 0.0
    if ta == tb:
        return 1.0
    seq = SequenceMatcher(None, ta, tb).ratio()
    A = {w for w in ta.split() if w not in _STOP}
    B = {w for w in tb.split() if w not in _STOP}
    if not A or not B:
        return seq
    inter = len(A & B)
    f1 = 2 * inter / (len(A) + len(B))
    score = 0.5 * seq + 0.5 * f1
    if inter == min(len(A), len(B)) and min(len(A), len(B)) >= 2:
        score = max(score, 0.9)          # every distinctive word of the shorter title is present
    return score


def similarity(title_a: str, author_a: str | None, title_b: str, author_b: str | None) -> float:
    t = title_similarity(title_a, title_b)
    sa, sb = _surname(author_a), _surname(author_b)
    if sa and sb:
        a = 1.0 if sa == sb else SequenceMatcher(None, sa, sb).ratio()
        return 0.75 * t + 0.25 * a
    return t


OWNED_THRESHOLD = 0.84


def match_owned(title: str, author: str | None, books: Iterable[dict] | None = None) -> tuple[dict | None, float]:
    best, best_s = None, 0.0
    for b in books if books is not None else list_books("owned"):
        s = similarity(title, author, b["title"], b.get("author"))
        if s > best_s:
            best, best_s = b, s
    return (best, best_s) if best_s >= OWNED_THRESHOLD else (None, best_s)


# --------------------------------------------------------- collection gaps

def collections() -> list[dict]:
    with db() as con:
        return [{"name": r["name"], "author": r["author"], "members": json.loads(r["members"])}
                for r in con.execute("SELECT * FROM collections")]


def collection_gaps() -> list[dict]:
    owned = list_books("owned")
    out = []
    for c in collections():
        have, missing = [], []
        for idx, title in enumerate(c["members"], 1):
            hit, _ = match_owned(title, c["author"], owned)
            (have if hit else missing).append({"title": title, "index": idx})
        if have and missing:   # only a "gap" if you've started the set
            out.append({"collection": c["name"], "author": c["author"], "have": have, "missing": missing})
    return out


def gap_for(title: str, author: str | None) -> dict | None:
    """If this title fills a hole in one of your collections, say which."""
    for g in collection_gaps():
        for m in g["missing"]:
            if similarity(title, author, m["title"], g["author"]) >= OWNED_THRESHOLD:
                return {"collection": g["collection"], "index": m["index"],
                        "owned_count": len(g["have"]), "total": len(g["have"]) + len(g["missing"])}
    return None


# ----------------------------------------------------------- taste profile

def taste_profile(max_items: int = 12) -> str:
    """A compact, stable text summary of the reader (cache-friendly prompt prefix)."""
    books = list_books("owned")
    from collections import Counter
    authors = Counter(b["author"] for b in books if b.get("author"))
    generic = {"fiction", "literature", "novel", "general", "classics", "english fiction", "fiction in english"}
    subjects = Counter(
        part.strip().lower()
        for b in books for s in (b.get("subjects") or [])[:5] for part in s.split(",")
        if ":" not in part and part.strip().lower() not in generic and len(part.strip()) > 2)
    favs = [f'{b["title"]} ({b["author"]})' for b in books if b.get("favourite")]
    reading = [b["title"] for b in books if b.get("reading")]
    bindings = Counter(b.get("binding") or "unknown" for b in books)
    return (
        f"Owns {len(books)} books.\n"
        f"Top authors: {', '.join(a for a, _ in authors.most_common(max_items))}.\n"
        f"Top subjects: {', '.join(s for s, _ in subjects.most_common(max_items))}.\n"
        f"Favourites: {'; '.join(favs[:max_items]) or 'none marked'}.\n"
        f"Reading now: {', '.join(reading) or 'nothing'}.\n"
        f"Formats collected: {', '.join(f'{k} x{v}' for k, v in bindings.most_common())}."
    )


# ------------------------------------------------------------ Open Library

def _cache_get(key: str, max_age: float = 30 * 86400) -> Any | None:
    with db() as con:
        r = con.execute("SELECT payload, fetched_at FROM ol_cache WHERE key=?", (key,)).fetchone()
    if r and time.time() - r["fetched_at"] < max_age:
        return json.loads(r["payload"])
    return None


def _cache_put(key: str, payload: Any) -> None:
    with db() as con:
        con.execute("INSERT OR REPLACE INTO ol_cache(key, payload, fetched_at) VALUES (?,?,?)",
                    (key, json.dumps(payload), time.time()))


def _shape(doc: dict) -> dict:
    cover = doc.get("cover_i")
    isbns = doc.get("isbn") or []
    isbn13 = next((i for i in isbns if len(i) == 13), isbns[0] if isbns else None)
    return {
        "title": doc.get("title"),
        "author": ", ".join((doc.get("author_name") or [])[:2]),
        "year": doc.get("first_publish_year"),
        "isbn": isbn13,
        "pages": doc.get("number_of_pages_median"),
        "publisher": (doc.get("publisher") or [None])[0],
        "subjects": [s for s in (doc.get("subject") or []) if len(s) < 40][:6],
        "cover_url": f"https://covers.openlibrary.org/b/id/{cover}-M.jpg" if cover else None,
        "ol_key": doc.get("key"),
        "edition_count": doc.get("edition_count"),
    }


def ol_search(title: str = "", author: str = "", q: str = "", limit: int = 5) -> list[dict]:
    key = f"search|{norm(title)}|{norm(author)}|{norm(q)}|{limit}"
    cached = _cache_get(key)
    if cached is not None:
        return cached
    fields = OL_FIELDS if q.startswith("isbn:") else OL_FIELDS.replace("isbn,", "")   # isbn lists are huge
    params: dict[str, Any] = {"fields": fields, "limit": limit}
    if q:
        params["q"] = q
    if title:
        params["title"] = title
    if author:
        params["author"] = author
    docs = None
    for attempt in range(2):
        try:
            r = httpx.get(f"{OL_BASE}/search.json", params=params, headers=OL_HEADERS, timeout=25)
            r.raise_for_status()
            docs = [_shape(d) for d in r.json().get("docs", [])]
            break
        except httpx.HTTPError:
            time.sleep(1.0)
    if docs is None:
        return []      # network trouble: degrade quietly, never invent data
    _cache_put(key, docs)
    return docs


def ol_isbn(isbn: str) -> dict | None:
    isbn = re.sub(r"[^0-9Xx]", "", isbn)
    if len(isbn) not in (10, 13):
        return None
    hits = ol_search(q=f"isbn:{isbn}", limit=1)
    if hits:
        hits[0]["isbn"] = isbn
        return hits[0]
    return None


# --------------------------------------------------------------- usage log

def log_usage(kind: str, meter_dict: dict, detail: str = "") -> None:
    with db() as con:
        con.execute("INSERT INTO usage_log(ts, day, kind, input_tokens, cached_tokens, output_tokens, cost_usd, detail)"
                    " VALUES (?,?,?,?,?,?,?,?)",
                    (time.time(), time.strftime("%Y-%m-%d"), kind, meter_dict.get("input_tokens", 0),
                     meter_dict.get("cached_tokens", 0), meter_dict.get("output_tokens", 0),
                     meter_dict.get("cost_usd", 0.0), detail[:300]))


def spend_today() -> float:
    with db() as con:
        return float(con.execute("SELECT COALESCE(SUM(cost_usd),0) FROM usage_log WHERE day=?",
                                 (time.strftime("%Y-%m-%d"),)).fetchone()[0])


def usage_summary() -> dict:
    with db() as con:
        rows = con.execute("SELECT kind, COUNT(*) n, SUM(input_tokens) i, SUM(cached_tokens) c, "
                           "SUM(output_tokens) o, SUM(cost_usd) usd FROM usage_log GROUP BY kind").fetchall()
        recent = con.execute("SELECT * FROM usage_log ORDER BY id DESC LIMIT 20").fetchall()
    return {"by_kind": [dict(r) for r in rows], "recent": [dict(r) for r in recent],
            "spend_today_usd": round(spend_today(), 6)}
