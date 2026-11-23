"""Bulk import from Goodreads or Libib CSV exports.

Goodreads: My Books → Import and export → Export Library  (goodreads_library_export.csv)
Libib:     Settings → Export Library                      (library_*.csv)

Both are detected from their column headers. Books already on the shelf are
skipped (fuzzy title+author match), "to-read" becomes the wishlist, "currently
reading" is marked as reading, and covers come straight from the ISBN via the
Open Library covers service (no API call per book, so 1,000 books import in
seconds). No AI is used — this is plain parsing, $0.
"""

from __future__ import annotations

import csv
import io
import re

import audit
import library


def _clean_isbn(v: str | None) -> str:
    return re.sub(r"[^0-9Xx]", "", v or "")   # Goodreads wraps ISBNs as ="9780..."


def _int(v) -> int | None:
    try:
        return int(float(str(v).strip()))
    except (TypeError, ValueError):
        return None


def detect(headers: list[str]) -> str:
    h = {x.strip().lower() for x in headers}
    if {"title", "author", "exclusive shelf"} <= h or "my rating" in h:
        return "goodreads"
    if "creators" in h or "ean_isbn13" in h:
        return "libib"
    if "title" in h:
        return "generic"
    return "unknown"


def parse(text: str) -> tuple[str, list[dict]]:
    text = text.lstrip("﻿")
    reader = csv.DictReader(io.StringIO(text))
    source = detect(reader.fieldnames or [])
    rows: list[dict] = []
    for r in reader:
        g = {k.strip().lower(): (v or "").strip() for k, v in r.items() if k}
        if source == "goodreads":
            shelf = g.get("exclusive shelf", "read")
            isbn = _clean_isbn(g.get("isbn13")) or _clean_isbn(g.get("isbn"))
            rows.append({
                "title": re.sub(r"\s*\(.*?#\d+\)\s*$", "", g.get("title", "")),   # drop "(Series, #2)"
                "author": g.get("author", ""),
                "isbn": isbn or None,
                "year": _int(g.get("original publication year")) or _int(g.get("year published")),
                "publisher": g.get("publisher") or None,
                "pages": _int(g.get("number of pages")),
                "binding": (g.get("binding") or "").lower() or None,
                "status": "wishlist" if shelf == "to-read" else "owned",
                "reading": shelf == "currently-reading",
                "favourite": (_int(g.get("my rating")) or 0) >= 5,
                "notes": (g.get("my review") or "")[:300] or None,
            })
        elif source in ("libib", "generic"):
            isbn = _clean_isbn(g.get("ean_isbn13")) or _clean_isbn(g.get("upc_isbn10")) or _clean_isbn(g.get("isbn"))
            year = None
            m = re.search(r"(1[5-9]\d\d|20\d\d)", g.get("publish_date", "") or g.get("year", ""))
            if m:
                year = int(m.group(1))
            status_txt = (g.get("status") or "").lower()
            rows.append({
                "title": g.get("title", ""),
                "author": (g.get("creators") or g.get("author") or "").split(",")[0].strip(),
                "isbn": isbn or None,
                "year": year,
                "publisher": g.get("publisher") or None,
                "pages": _int(g.get("length")) or _int(g.get("pages")),
                "status": "wishlist" if "wish" in status_txt or "want" in status_txt else "owned",
                "reading": "in progress" in status_txt or "reading" in status_txt,
                "notes": (g.get("notes") or "")[:300] or None,
            })
    return source, [r for r in rows if r["title"]]


def import_csv(text: str) -> dict:
    source, rows = parse(text)
    if source == "unknown" or not rows:
        raise ValueError("That doesn't look like a Goodreads or Libib export (no Title column found).")
    existing = library.list_books(None)
    added = skipped = wish = 0
    sample: list[str] = []
    for r in rows[:5000]:
        dup = any(library.similarity(r["title"], r["author"], b["title"], b["author"]) >= library.OWNED_THRESHOLD for b in existing)
        if dup:
            skipped += 1
            continue
        if r.get("isbn"):
            r["cover_url"] = f"https://covers.openlibrary.org/b/isbn/{r['isbn']}-M.jpg?default=false"
        gap = library.gap_for(r["title"], r["author"])
        if gap:
            r["collection"], r["series_index"] = gap["collection"], gap["index"]
        b = library.add_book({k: v for k, v in r.items() if v is not None})
        existing.append(b)
        added += 1
        wish += r["status"] == "wishlist"
        if len(sample) < 6:
            sample.append(r["title"])
    audit.append({"kind": "import", "source": source, "rows": len(rows), "added": added, "skipped": skipped,
                  "user": library.uid()})
    return {"source": source, "rows": len(rows), "added": added, "skipped_duplicates": skipped,
            "wishlist": wish, "sample": sample}
