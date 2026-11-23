"""FastAPI backend for the book app.

Run from the backend folder:
    uvicorn main:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import base64
import binascii
import io
import json
import random
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

import agents
import live
import accounts
import extras
import importer
import shopping
import scouts
import spines
import textures
import listen
import characters
import bustmodel
import audit
import library
from config import APP_NAME, DAILY_BUDGET_USD, DATA_DIR, MODEL_NAME, ROOT, SCAN_MAX_BYTES, SCANS_PER_MINUTE
from llm import providers_available

library.init_db()
accounts.ensure_columns()
accounts.ensure_seed()
accounts.ensure_demo_verdicts()
characters.ensure_table()
QUOTES = json.loads((DATA_DIR / "quotes.json").read_text(encoding="utf-8"))

app = FastAPI(title=f"{APP_NAME} API")
app.add_middleware(GZipMiddleware, minimum_size=2048)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ------------------------------------------------------------------ who's asking

@app.middleware("http")
async def who(request: Request, call_next):
    """Bearer token -> the reader whose shelf this request works on (default: the demo reader)."""
    auth = request.headers.get("authorization", "")
    user = accounts.read_token(auth[7:] if auth.lower().startswith("bearer ") else None) or 1
    token = library.current_user.set(user)
    try:
        return await call_next(request)
    finally:
        library.current_user.reset(token)


# ------------------------------------------------------------- guard rails

_hits: dict[str, deque] = defaultdict(deque)


def _rate_limit(request: Request, per_minute: int = SCANS_PER_MINUTE) -> str:
    ip = request.client.host if request.client else "?"
    q, now = _hits[ip], time.time()
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= per_minute:
        audit.append({"kind": "blocked", "reason": "rate_limit", "client": ip})
        raise HTTPException(429, "Easy there — a few scans a minute is plenty. Try again shortly.")
    q.append(now)
    return ip


def _budget_ok() -> None:
    spent = library.spend_today()
    if spent >= DAILY_BUDGET_USD:
        audit.append({"kind": "blocked", "reason": "daily_budget", "spent_usd": round(spent, 4)})
        raise HTTPException(429, f"Today's AI budget (${DAILY_BUDGET_USD:.2f}) is used up. "
                                 "Cached shelves and your library still work.")


async def _read_upload(file: UploadFile) -> bytes:
    raw = await file.read(SCAN_MAX_BYTES + 1)
    if len(raw) > SCAN_MAX_BYTES:
        raise HTTPException(413, "That photo is too large (max 6 MB).")
    if not raw:
        raise HTTPException(400, "Empty upload.")
    return raw


def _friendly(exc: Exception) -> HTTPException:
    audit.append({"kind": "error", "error": type(exc).__name__})
    return HTTPException(502, "The reading room is quiet right now (AI service unavailable). Please try again.")


# ------------------------------------------------------------------ basics

@app.get("/api/health")
def health():
    return {"ok": True, "app": APP_NAME, "model": MODEL_NAME, "providers": providers_available(),
            "budget_usd": DAILY_BUDGET_USD, "spent_today_usd": round(library.spend_today(), 6)}


@app.get("/api/quote")
def quote(exclude: int | None = None):
    idx = random.choice([i for i in range(len(QUOTES)) if i != exclude] or [0])
    return {"index": idx, **QUOTES[idx]}


class QuoteSaveIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    author: str = Field(default="", max_length=120)
    to: str = Field(pattern="^(wishlist|tbr)$")


@app.post("/api/quote/save")
def save_quote_book(body: QuoteSaveIn):
    """From a quote on Home: put its book on the wishlist or the TBR pile."""
    owned = library.list_books(None)
    hit = next((b for b in owned if library.similarity(body.title, body.author, b["title"], b["author"]) >= library.OWNED_THRESHOLD), None)
    if hit:
        if body.to == "tbr":
            return {"book": library.update_book(hit["id"], {"tbr": True}), "already": hit["status"]}
        return {"book": hit, "already": hit["status"]}
    meta = (library.ol_search(title=body.title, author=body.author.replace("attributed to ", ""), limit=1) or [{}])[0]
    b = library.add_book({"title": body.title, "author": body.author.replace("attributed to ", ""), "status": "wishlist",
                          "tbr": body.to == "tbr", "cover_url": meta.get("cover_url"), "year": meta.get("year"),
                          "subjects": meta.get("subjects", []), "pages": meta.get("pages")})
    return {"book": b, "already": None}


@app.get("/api/stats")
def stats():
    return library.stats()


# ----------------------------------------------------------------- library

class BookIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    author: str = Field(default="", max_length=200)
    year: int | None = None
    publisher: str | None = None
    binding: str | None = None
    edition: str | None = None
    height_cm: float | None = None
    pages: int | None = None
    isbn: str | None = None
    cover_url: str | None = None
    subjects: list[str] | None = None
    collection: str | None = None
    series_index: int | None = None
    status: str = "owned"
    favourite: bool = False
    reading: bool = False
    tbr: bool = False
    rating: float | None = Field(default=None, ge=0, le=5)
    review: str | None = Field(default=None, max_length=4000)
    read_state: str = Field(default="", pattern="^(|read|dnf)$")
    finished_on: str | None = Field(default=None, max_length=10)
    progress: float = 0
    hours_read: float = 0
    notes: str | None = None


class BookPatch(BaseModel):
    title: str | None = None
    author: str | None = None
    year: int | None = None
    publisher: str | None = None
    binding: str | None = None
    edition: str | None = None
    height_cm: float | None = None
    pages: int | None = None
    isbn: str | None = None
    cover_url: str | None = None
    collection: str | None = None
    series_index: int | None = None
    status: str | None = None
    favourite: bool | None = None
    reading: bool | None = None
    tbr: bool | None = None
    rating: float | None = Field(default=None, ge=0, le=5)
    review: str | None = Field(default=None, max_length=4000)
    read_state: str | None = Field(default=None, pattern="^(|read|dnf)$")
    finished_on: str | None = Field(default=None, max_length=10)
    progress: float | None = None
    hours_read: float | None = None
    notes: str | None = None


@app.get("/api/books")
def books(status: str | None = "owned"):
    return library.list_books(None if status == "all" else status)


class VerdictsIn(BaseModel):
    items: list[dict] = Field(max_length=300)


@app.post("/api/friends/verdicts")
def friends_verdicts(body: VerdictsIn):
    """What your friends rated each of these books (yours, your wishlist, your 'to find' gaps)."""
    items = [{"title": str(i.get("title", ""))[:200], "author": str(i.get("author", ""))[:120]} for i in body.items]
    return {"verdicts": accounts.friend_verdicts(items, library.uid())}


@app.get("/api/books/check")
def check_duplicate(title: str, author: str = "", isbn: str = "", edition: str = "", binding: str = "",
                    publisher: str = "", year: int | None = None):
    """Before adding: do you already have this book, and is it the very same edition? (plain code, $0)"""
    import re as _re
    clean = lambda x: _re.sub(r"[^0-9x]", "", (x or "").lower())
    norm = lambda x: _re.sub(r"[^a-z0-9]", "", (x or "").lower())
    out = []
    for b in library.list_books(None):
        if library.similarity(title, author, b["title"], b["author"]) < library.OWNED_THRESHOLD:
            continue
        same_isbn = bool(clean(isbn) and clean(isbn) == clean(b.get("isbn")))
        same_print = (norm(edition) and norm(edition) == norm(b.get("edition"))) or \
                     (norm(publisher) and norm(publisher) == norm(b.get("publisher")) and year and year == b.get("year"))
        same_bind = not binding or not b.get("binding") or norm(binding) == norm(b.get("binding"))
        exact = same_isbn or bool(same_print and same_bind) or (not isbn and not edition and not publisher)
        out.append({"id": b["id"], "title": b["title"], "author": b["author"], "status": b["status"],
                    "edition": b.get("edition"), "binding": b.get("binding"), "year": b.get("year"),
                    "publisher": b.get("publisher"), "isbn": b.get("isbn"), "cover_url": b.get("cover_url"),
                    "exact": exact, "why": "same ISBN" if same_isbn else "same edition" if exact else "another edition"})
    out.sort(key=lambda x: (not x["exact"], x["status"] != "owned"))
    return {"copies": out, "exact": any(c["exact"] and c["status"] == "owned" for c in out),
            "owned": sum(1 for c in out if c["status"] == "owned")}


@app.get("/api/books/{book_id}")
def book(book_id: int):
    b = library.get_book(book_id)
    if not b:
        raise HTTPException(404, "No such book.")
    return b


@app.post("/api/books")
def create_book(body: BookIn):
    if body.status not in ("owned", "wishlist"):
        raise HTTPException(400, "status must be owned or wishlist")
    hit, _ = library.match_owned(body.title, body.author)
    b = library.add_book(body.model_dump())
    audit.append({"kind": "book_added", "id": b["id"], "title": b["title"], "status": b["status"],
                  "possible_duplicate_of": hit["id"] if hit else None})
    return {**b, "possible_duplicate_of": hit["id"] if hit else None}


@app.get("/api/books/{book_id}/spine.png")
def book_spine(book_id: int):
    """Spine artwork for the 3D bookshelf (cloth + gold-foil type), cached in memory."""
    b = library.get_book_any(book_id)
    if not b or (b.get("user_id") != library.uid() and not accounts.is_friend(library.uid(), b.get("user_id"))):
        raise HTTPException(404, "No such book.")
    png = spines.spine_png(b["title"], b.get("author") or "")
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/books/{book_id}/tex/{side}")
def book_texture(book_id: int, side: str):
    """One face of a 3D book, pre-sized and cached: the reader's photo, the real cover, or a printed one."""
    side = side.split(".")[0]
    if side not in ("front", "back", "spine", "pages"):
        raise HTTPException(404, "No such side.")
    b = library.get_book_any(book_id)
    if not b or (b.get("user_id") != library.uid() and not accounts.is_friend(library.uid(), b.get("user_id"))):
        raise HTTPException(404, "No such book.")
    data, mt = textures.texture(b, side)
    return Response(content=data, media_type=mt, headers={"Cache-Control": "public, max-age=3600"})


@app.get("/api/tex/pages.jpg")
def page_texture():
    return Response(content=textures.page_edges(), media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/tex/marble.jpg")
def marble_texture():
    return Response(content=textures.marble(), media_type="image/jpeg", headers={"Cache-Control": "public, max-age=604800"})


@app.on_event("startup")
def _prewarm_textures():
    """Fetch every cover in the background so the first showcase is already fast."""
    import threading

    def run():
        try:
            textures.marble()  # the busts' marble, rendered once
            with library.db() as con:
                rows = con.execute("SELECT cover_url FROM books WHERE cover_url IS NOT NULL").fetchall()
            textures.prewarm([{"cover_url": r[0]} for r in rows])
            textures.backfill_covers()
        except Exception:  # noqa: BLE001
            pass
    threading.Thread(target=run, daemon=True).start()


@app.patch("/api/books/{book_id}")
def patch_book(book_id: int, body: BookPatch):
    b = library.update_book(book_id, body.model_dump(exclude_unset=True))
    if not b:
        raise HTTPException(404, "No such book.")
    return b


@app.delete("/api/books/{book_id}")
def remove_book(book_id: int):
    if not library.delete_book(book_id):
        raise HTTPException(404, "No such book.")
    audit.append({"kind": "book_deleted", "id": book_id})
    return {"ok": True}


class Order(BaseModel):
    ids: list[int]


@app.post("/api/books/reorder")
def reorder(body: Order):
    library.reorder(body.ids)
    return {"ok": True}


@app.get("/api/collections")
def collections():
    return {"collections": library.collections(), "gaps": library.collection_gaps()}


@app.get("/api/search")
def search(q: str):
    if len(q.strip()) < 2:
        return {"results": []}
    owned = library.list_books("owned")
    results = []
    for r in library.ol_search(q=q, limit=8):
        hit, _ = library.match_owned(r["title"] or "", r["author"], owned)
        results.append({**r, "owned_id": hit["id"] if hit else None,
                        "gap": library.gap_for(r["title"] or "", r["author"])})
    return {"results": results}


@app.get("/api/isbn/{isbn}")
def isbn(isbn: str):
    meta = library.ol_isbn(isbn)
    if not meta:
        raise HTTPException(404, "No book found for that ISBN.")
    return meta


# ------------------------------------------------------------------ agents

@app.post("/api/finder/scan")
async def scan(request: Request, image: UploadFile = File(...)):
    ip = _rate_limit(request)
    raw = await _read_upload(image)
    _budget_ok()
    try:
        return await agents.scan_shelf(raw, client_tag=ip)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — never leak internals to the client
        raise _friendly(exc)


@app.post("/api/catalogue")
async def catalogue(request: Request, image: UploadFile = File(...)):
    _rate_limit(request)
    raw = await _read_upload(image)
    _budget_ok()
    try:
        return await agents.catalogue_photo(raw)
    except Exception as exc:  # noqa: BLE001
        raise _friendly(exc)


# The phone app sends base64 JSON (same code path on Android, iOS and web).
class ImageIn(BaseModel):
    image_b64: str = Field(min_length=100, max_length=SCAN_MAX_BYTES * 4 // 3 + 64)


def _decode(body: ImageIn) -> bytes:
    data = body.image_b64.split(",", 1)[1] if body.image_b64.startswith("data:") else body.image_b64
    try:
        raw = base64.b64decode(data, validate=False)
    except (binascii.Error, ValueError):
        raise HTTPException(400, "Could not read that image.")
    if len(raw) > SCAN_MAX_BYTES:
        raise HTTPException(413, "That photo is too large (max 6 MB).")
    return raw


@app.post("/api/finder/scan64")
async def scan64(request: Request, body: ImageIn):
    ip = _rate_limit(request)
    raw = _decode(body)
    _budget_ok()
    try:
        return await agents.scan_shelf(raw, client_tag=ip)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _friendly(exc)


@app.post("/api/catalogue64")
async def catalogue64(request: Request, body: ImageIn):
    _rate_limit(request)
    raw = _decode(body)
    _budget_ok()
    try:
        return await agents.catalogue_photo(raw)
    except Exception as exc:  # noqa: BLE001
        raise _friendly(exc)


# ---------------------------------------------------------- live AR (OCR text)

class OcrBlock(BaseModel):
    id: int
    text: str = Field(max_length=400)
    box: dict | None = None


class OcrIn(BaseModel):
    blocks: list[OcrBlock] = Field(max_length=80)


@app.post("/api/live/match")
def live_match(body: OcrIn):
    """Phase 1 — no AI: owned / completes-a-collection / flagged, in milliseconds."""
    t0 = time.perf_counter()
    res = live.match_blocks([b.model_dump() for b in body.blocks])
    return {"books": res, "ms": round((time.perf_counter() - t0) * 1000, 1)}


@app.post("/api/live/identify")
async def live_identify(request: Request, body: OcrIn):
    """Phase 2 — Open Library + Curator for the spines phase 1 didn't know."""
    ip = _rate_limit(request, per_minute=20)
    _budget_ok()
    try:
        return await live.identify([b.model_dump() for b in body.blocks], client_tag=ip)
    except Exception as exc:  # noqa: BLE001
        raise _friendly(exc)


@app.post("/api/session/scout")
async def session_scout(request: Request, body: OcrIn):
    """Recording session: fan unknown spines out to parallel Scout agents (≈ one LLM call of latency)."""
    ip = _rate_limit(request, per_minute=40)
    _budget_ok()
    try:
        return await scouts.scout_spines([b.model_dump() for b in body.blocks], client_tag=ip)
    except Exception as exc:  # noqa: BLE001
        raise _friendly(exc)


class FaceIn(BaseModel):
    image_b64: str = Field(min_length=100, max_length=SCAN_MAX_BYTES * 4 // 3 + 64)


@app.post("/api/books/{book_id}/faces/{side}")
async def upload_face(book_id: int, side: str, body: FaceIn):
    """The user's own photo of a book's front / back / spine — the 3D model wears it."""
    if not library.get_book(book_id):
        raise HTTPException(404, "No such book.")
    if side not in extras.SIDES:
        raise HTTPException(400, "side must be front, back or spine")
    return await extras.save_face(book_id, side, _decode(ImageIn(image_b64=body.image_b64)))


@app.post("/api/books/{book_id}/recrop")
async def recrop_faces(book_id: int):
    if not library.get_book(book_id):
        raise HTTPException(404, "No such book.")
    return {"sides": await extras.recrop(book_id), "book": library.get_book(book_id)}


@app.get("/api/books/{book_id}/face/{side}.jpg")
def get_face(book_id: int, side: str):
    p = extras.face_path(book_id, side)
    if not p:
        raise HTTPException(404, "No photo for that side.")
    return FileResponse(p, media_type="image/jpeg", headers={"Cache-Control": "no-cache"})


class MultiIn(BaseModel):
    front: str | None = None
    back: str | None = None
    spine: str | None = None
    page: str | None = None


@app.post("/api/catalogue/multi")
async def catalogue_multi(request: Request, body: MultiIn):
    """Front + back + spine (+ an inside page for old books) -> edition details in one vision call."""
    _rate_limit(request)
    _budget_ok()
    imgs = {k: _decode(ImageIn(image_b64=v)) for k, v in body.model_dump().items() if v}
    if not imgs:
        raise HTTPException(400, "Send at least one photo.")
    try:
        return await extras.catalogue_multi(imgs)
    except Exception as exc:  # noqa: BLE001
        raise _friendly(exc)


class ExplainIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    author: str = Field(default="", max_length=120)
    stars: int = 3
    reason: str = Field(default="", max_length=200)


@app.post("/api/explain")
async def explain(request: Request, body: ExplainIn):
    """Why was this book recommended to me?"""
    _rate_limit(request, per_minute=20)
    _budget_ok()
    try:
        return await extras.explain_pick(body.title, body.author, body.stars, body.reason)
    except Exception as exc:  # noqa: BLE001
        raise _friendly(exc)


@app.get("/api/books/{book_id}/sample")
async def book_sample(book_id: int):
    """Opening pages (public domain) or the description + preview link, for unread books."""
    b = library.get_book(book_id)
    if not b:
        raise HTTPException(404, "No such book.")
    import asyncio as _a
    return await _a.to_thread(extras.sample_for, b)


@app.get("/api/sample")
async def sample_by_title(title: str, author: str = ""):
    import asyncio as _a
    return await _a.to_thread(extras.sample_for, {"title": title, "author": author})


# ------------------------------------------------------------------ accounts

class RegisterIn(BaseModel):
    username: str = Field(min_length=3, max_length=24)
    password: str = Field(min_length=8, max_length=200)
    display_name: str = Field(default="", max_length=40)
    reader_type: str | None = None


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=24)
    password: str = Field(min_length=1, max_length=200)


@app.get("/api/reader-types")
def reader_types():
    return [{"key": k, "label": v[0], "blurb": v[1]} for k, v in accounts.READER_TYPES.items()]


@app.post("/api/auth/register")
def register(request: Request, body: RegisterIn):
    _rate_limit(request, per_minute=5)
    try:
        u = accounts.register(body.username, body.password, body.display_name, body.reader_type)
    except ValueError as e:
        raise HTTPException(400, str(e))
    audit.append({"kind": "register", "user": u["id"]})
    return {"token": accounts.make_token(u["id"]), "user": u}


@app.post("/api/auth/login")
def login(request: Request, body: LoginIn):
    _rate_limit(request, per_minute=10)
    u = accounts.login(body.username, body.password)
    if not u:
        audit.append({"kind": "blocked", "reason": "bad_login"})
        raise HTTPException(401, "That username and password don't match.")
    return {"token": accounts.make_token(u["id"]), "user": u}


@app.get("/api/me")
def me():
    u = accounts.get_user(library.uid())
    return {**(u or {}), "stats": library.stats(), "signed_in": library.uid() != 1}


class ProfileIn(BaseModel):
    display_name: str | None = Field(default=None, max_length=40)
    bio: str | None = Field(default=None, max_length=200)
    reader_type: str | None = None


@app.patch("/api/me")
def patch_me(body: ProfileIn):
    u = accounts.update_profile(library.uid(), body.display_name, body.bio)
    if body.reader_type:
        try:
            u = accounts.set_reader_type(library.uid(), body.reader_type)
        except ValueError as e:
            raise HTTPException(400, str(e))
    return u


class FriendIn(BaseModel):
    code: str = Field(min_length=4, max_length=12)


@app.get("/api/friends")
def friends():
    return accounts.friends(library.uid())


@app.post("/api/friends")
def add_friend(request: Request, body: FriendIn):
    _rate_limit(request, per_minute=10)
    try:
        return accounts.add_friend(library.uid(), body.code)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/friends/{friend_id}")
def friend_shelf(friend_id: int):
    """A friend's bookcase — read-only, and only for actual friends."""
    if not accounts.is_friend(library.uid(), friend_id):
        raise HTTPException(403, "You can only see the shelves of your friends.")
    return {"user": accounts.get_user(friend_id), "stats": library.stats(user_id=friend_id),
            "books": library.list_books("owned", user_id=friend_id)}


@app.get("/api/friends-own")
def friends_own(title: str, author: str = ""):
    return {"friends": accounts.friends_owning(title, author, library.uid())}


# ------------------------------------------------------------------ import

class ImportIn(BaseModel):
    csv: str = Field(min_length=10, max_length=8_000_000)


@app.post("/api/import")
def import_csv(request: Request, body: ImportIn):
    """Goodreads or Libib CSV export -> your library (no AI, $0)."""
    _rate_limit(request, per_minute=5)
    try:
        r = importer.import_csv(body.csv)
        textures.backfill_in_background()   # find covers for anything that came without one
        return r
    except ValueError as e:
        raise HTTPException(400, str(e))


# ------------------------------------------------------------------ finding books

@app.get("/api/where")
def where(title: str, author: str = "", isbn: str = ""):
    return {"links": shopping.where_to_buy(title, author, isbn),
            "friends": accounts.friends_owning(title, author, library.uid())}


@app.get("/api/listen")
async def listen_read(title: str, author: str = ""):
    """Free audiobooks/ebooks first (LibriVox, Open Library), then Spotify/Audible/Kindle/Play/Libby links."""
    import asyncio as _a
    return await _a.to_thread(listen.listen_and_read, title[:200], author[:120])


@app.get("/api/characters")
async def book_characters(request: Request, title: str, author: str = ""):
    """Up to four characters, described as a sculptor would carve them (one cached luna call)."""
    _rate_limit(request, per_minute=10)
    _budget_ok()
    try:
        return await characters.cast_for(title[:200], author[:120])
    except Exception as exc:  # noqa: BLE001
        raise _friendly(exc)


class DecorIn(BaseModel):
    book_id: int | None = None
    book_title: str = Field(default="", max_length=200)
    character: dict


@app.get("/api/models/bust.bin")
def bust_model():
    """Head-and-shoulders mesh for the marble busts (scan by Lee Perry-Smith, CC BY 3.0)."""
    return Response(content=bustmodel.bust_bin(), media_type="application/octet-stream",
                    headers={"Cache-Control": "public, max-age=604800"})


@app.get("/api/decor")
def decor_list():
    return characters.list_decor(library.uid())


@app.post("/api/decor")
def decor_add(body: DecorIn):
    try:
        return characters.add_decor(library.uid(), body.book_id, body.book_title, body.character)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/decor/{decor_id}")
def decor_remove(decor_id: int):
    return {"ok": characters.remove_decor(library.uid(), decor_id)}


@app.get("/api/nearby")
async def nearby(lat: float, lon: float):
    import asyncio as _a
    return {"shops": await _a.to_thread(shopping.nearby_bookshops, lat, lon)}


class DebugOcrIn(BaseModel):
    image_b64: str = Field(max_length=SCAN_MAX_BYTES * 4 // 3 + 64)
    blocks: list[dict] = Field(default_factory=list, max_length=120)
    raw: dict | None = None


@app.post("/api/debug/ocr")
def debug_ocr(body: DebugOcrIn):
    """Dev aid: draw the phone's OCR boxes on the exact frozen image (output/debug/ocr_latest.png)."""
    from PIL import Image as PILImage, ImageDraw

    img = PILImage.open(io.BytesIO(_decode(ImageIn(image_b64=body.image_b64)))).convert("RGB")
    d = ImageDraw.Draw(img)
    for b in body.blocks:
        x, y, w, h = (float(b.get(k, 0)) for k in ("x", "y", "w", "h"))
        d.rectangle([x * img.width, y * img.height, (x + w) * img.width, (y + h) * img.height], outline=(242, 181, 58), width=3)
        d.text((x * img.width + 3, y * img.height + 3), str(b.get("text", ""))[:24], fill=(255, 80, 80))
    out = ROOT / "output" / "debug"
    out.mkdir(parents=True, exist_ok=True)
    img.save(out / "ocr_latest.png")
    (out / "ocr_raw.json").write_text(json.dumps(body.raw or {}, indent=1), encoding="utf-8")
    return {"ok": True, "size": [img.width, img.height], "blocks": len(body.blocks)}


# Sample shelves: lets graders (or a laptop with no camera) try the Book Finder.
SAMPLES = {"bookshop": "shelf_bookshop.jpg", "injection": "shelf_injection.jpg"}


def _sample_path(name: str) -> Path:
    if name not in SAMPLES:
        raise HTTPException(404, "Unknown sample.")
    return ROOT / "test_data" / "shelves" / SAMPLES[name]


@app.get("/api/samples/{name}.jpg")
def sample_image(name: str):
    return FileResponse(_sample_path(name), media_type="image/jpeg")


@app.post("/api/finder/sample/{name}")
async def scan_sample(request: Request, name: str):
    ip = _rate_limit(request)
    raw = _sample_path(name).read_bytes()
    _budget_ok()
    try:
        return await agents.scan_shelf(raw, client_tag=f"{ip} sample:{name}")
    except Exception as exc:  # noqa: BLE001
        raise _friendly(exc)


class ChatIn(BaseModel):
    question: str = Field(min_length=1, max_length=600)
    history: list[dict] = Field(default_factory=list)


@app.post("/api/librarian")
async def librarian_chat(request: Request, body: ChatIn):
    _rate_limit(request, per_minute=10)
    _budget_ok()
    if agents.looks_like_injection(body.question):
        audit.append({"kind": "suspicious_chat", "question": body.question[:200]})
    try:
        r = await agents.ask_librarian(body.question, body.history)
    except Exception as exc:  # noqa: BLE001
        raise _friendly(exc)
    return {**r, "books": _books_mentioned(r.get("answer", ""))}


def _books_mentioned(answer: str, limit: int = 6) -> list[dict]:
    """Plain code, $0: which of the reader's books / collection gaps the answer names,
    in the order they appear, so the app can show them as tappable covers."""
    import re as _re
    text = answer.lower()
    found: list[tuple[int, dict]] = []
    seen: set[str] = set()

    def hit(title: str) -> int:
        main = title.split(":")[0].strip().lower()
        if len(main) < 4:
            return -1
        m = _re.search(r"(?<![a-z])" + _re.escape(main) + r"(?![a-z])", text)
        return m.start() if m else -1

    for b in library.list_books(None):
        pos = hit(b["title"])
        if pos >= 0 and b["title"].lower() not in seen:
            seen.add(b["title"].lower())
            found.append((pos, {"id": b["id"], "title": b["title"], "author": b["author"],
                                "cover_url": b.get("cover_url"), "status": b["status"]}))
    for g in library.collection_gaps():
        for m in g["missing"]:
            pos = hit(m["title"])
            if pos >= 0 and m["title"].lower() not in seen:
                seen.add(m["title"].lower())
                found.append((pos, {"id": None, "title": m["title"], "author": g["author"], "cover_url": None,
                                    "status": "to_find", "why": f"Vol. {m['index']} of {g['collection']}, a series you collect"}))
    return [b for _, b in sorted(found, key=lambda x: x[0])][:limit]


# ------------------------------------------------------------- tokenomics

@app.get("/api/usage")
def usage():
    return {**library.usage_summary(), "budget_usd": DAILY_BUDGET_USD, "model": MODEL_NAME}


@app.get("/api/audit")
def audit_tail(n: int = 30):
    return audit.tail(min(n, 200))
