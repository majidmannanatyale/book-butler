"""The library MCP server.

Exposes the reader's library and Open Library lookups as MCP tools. The app's
agents connect to it in-process (fastmcp in-memory transport, no subprocess),
and it can also run standalone over stdio for any MCP client:

    python mcp_server/server.py

Safety: the only write tool is add_to_wishlist. Agents can never mark a book as
owned, edit or delete — those need a human tap in the app.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from fastmcp import FastMCP  # noqa: E402

import audit  # noqa: E402
import library  # noqa: E402

mcp = FastMCP("library", instructions="A reader's personal book collection plus Open Library lookups.")


def _brief(b: dict) -> dict:
    return {k: b.get(k) for k in ("id", "title", "author", "year", "binding", "edition", "collection",
                                  "series_index", "favourite", "reading", "status")}


@mcp.tool
def search_my_library(query: str, limit: int = 10) -> list[dict]:
    """Find books the reader owns or wants by title, author, subject or collection words."""
    q = library.norm(query)
    out = []
    for b in library.list_books(None):
        hay = " ".join([library.norm(b["title"]), library.norm(b["author"]), library.norm(b.get("collection")),
                        " ".join(library.norm(s) for s in b.get("subjects") or [])])
        if all(tok in hay for tok in q.split()):
            out.append(_brief(b))
    return out[: max(1, min(limit, 25))]


@mcp.tool
def check_owned(books: list[dict]) -> list[dict]:
    """For each {title, author}, say whether the reader already owns it (fuzzy match, score 0-1)."""
    owned = library.list_books("owned")
    res = []
    for item in books[:40]:
        hit, score = library.match_owned(item.get("title", ""), item.get("author"), owned)
        res.append({"title": item.get("title"), "owned": hit is not None, "score": round(score, 2),
                    "match": _brief(hit) if hit else None})
    return res


@mcp.tool
def collection_gaps() -> list[dict]:
    """Series and sets the reader has started but not finished, with the missing volumes."""
    return library.collection_gaps()


@mcp.tool
def fills_a_gap(title: str, author: str = "") -> dict | None:
    """Does this book complete part of one of the reader's collections? Returns the collection or null."""
    return library.gap_for(title, author)


@mcp.tool
def taste_profile() -> str:
    """Short summary of the reader's taste: top authors, subjects, favourites, formats."""
    return library.taste_profile()


@mcp.tool
async def open_library_search(title: str = "", author: str = "", query: str = "", limit: int = 3) -> list[dict]:
    """Look up real book metadata (year, subjects, cover, pages) on Open Library. Cached."""
    return await asyncio.to_thread(library.ol_search, title=title, author=author, q=query,
                                   limit=max(1, min(limit, 5)))


@mcp.tool
async def open_library_by_isbn(isbn: str) -> dict | None:
    """Look up one edition by ISBN-10 or ISBN-13 on Open Library."""
    return await asyncio.to_thread(library.ol_isbn, isbn)


@mcp.tool
def add_to_wishlist(title: str, author: str = "", reason: str = "") -> dict:
    """Save a book to the reader's wishlist (the only change an agent may make)."""
    hit, _ = library.match_owned(title, author)
    if hit:
        return {"saved": False, "why": "already owned", "match": _brief(hit)}
    for b in library.list_books("wishlist"):
        if library.similarity(title, author, b["title"], b["author"]) >= library.OWNED_THRESHOLD:
            return {"saved": False, "why": "already on wishlist", "match": _brief(b)}
    meta = (library.ol_search(title=title, author=author, limit=1) or [{}])[0]
    book = library.add_book({"title": title, "author": author or meta.get("author", ""), "status": "wishlist",
                             "year": meta.get("year"), "cover_url": meta.get("cover_url"),
                             "subjects": meta.get("subjects", []), "pages": meta.get("pages"),
                             "notes": reason[:200] or None})
    audit.append({"kind": "mcp_write", "tool": "add_to_wishlist", "book_id": book["id"], "title": title})
    return {"saved": True, "book": _brief(book)}


@mcp.resource("library://stats")
def stats_resource() -> dict:
    """Headline numbers for the reader's collection."""
    return library.stats()


library.init_db()

if __name__ == "__main__":
    mcp.run()
