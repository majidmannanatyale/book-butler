"""Scout team — parallel agents for the recording-session Book Finder.

The phone streams the spine text it reads. Plain code (the "boss") splits the new,
unknown spines into small batches and sends each batch to its own Scout agent AT
THE SAME TIME (asyncio.gather). Every scout identifies its spines and scores them
for this reader. Wall-clock ≈ one LLM call however many spines there are.

Token discipline: per-spine results are cached by normalised spine text, so a
spine seen in many frames is only ever paid for once; scouts run with reasoning
off and tiny outputs; batches are capped.
"""

from __future__ import annotations

import asyncio
import json
import re
import time

from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIResponsesModelSettings
from pydantic_ai.usage import UsageLimits

import audit
import library
from agents import PROMPTS, looks_like_injection
from live import _ocr_support, _plausible, _tokens
from llm import Meter, build_model

_PRICE = re.compile(r"[$£€]\s?\d{1,4}(?:[.,]\d{2})?")

BATCH = 2            # spines per scout (small = fast answers)
MAX_SCOUTS = 12      # parallel agents per request
CACHE_DAYS = 14


class ScoutBook(BaseModel):
    title: str = Field(max_length=200)
    author: str = Field(default="", max_length=120)
    stars: int = Field(default=1, ge=1, le=5)
    reason: str = Field(default="", max_length=120)
    collectible: bool = False
    collectible_why: str = Field(default="", max_length=90)


class ScoutItem(BaseModel):
    id: int
    # one camera text can run across several neighbouring spines: list every book it shows
    books: list[ScoutBook] = Field(default_factory=list, max_length=5)


class ScoutReport(BaseModel):
    items: list[ScoutItem] = Field(default_factory=list, max_length=BATCH + 2)


_SCOUT: Agent | None = None


def _scout() -> Agent:
    global _SCOUT
    if _SCOUT is None:
        _SCOUT = Agent(build_model(), output_type=ScoutReport,
                       instructions=(PROMPTS / "scout.md").read_text(encoding="utf-8"),
                       name="scout", retries=1,
                       model_settings=OpenAIResponsesModelSettings(openai_reasoning_effort="none"))
    return _SCOUT


def _key(text: str) -> str:
    return f"scout2|u{library.uid()}|" + " ".join(sorted(set(_tokens(text))))[:200]   # stars are per reader


async def _run_scout(batch: list[dict], profile: str, meter: Meter, n: int) -> list[dict]:
    brief = [{"id": b["id"], "spine_text": b["text"][:160]} for b in batch]
    prompt = f"READER TASTE PROFILE\n{profile}\n\nSPINES (JSON)\n{json.dumps(brief, ensure_ascii=False)}"
    run = await _scout().run(prompt, usage_limits=UsageLimits(request_limit=2, output_tokens_limit=700))
    meter.add(f"scout_{n}", run.usage)
    texts = {b["id"]: b["text"] for b in batch}
    out = []
    for it in run.output.items:
        raw = texts.get(it.id)
        if raw is None:
            continue
        books = []
        for bk in it.books:
            # the spine must actually show this title (OCR slips allowed, invented words not)
            if not bk.title or looks_like_injection(bk.reason + " " + bk.title):
                continue
            if _ocr_support(bk.title, bk.author, raw) < 0.6:
                continue
            if any(library.similarity(bk.title, bk.author, b["title"], b["author"]) >= 0.85 for b in books):
                continue
            books.append({"title": bk.title, "author": bk.author, "stars": bk.stars, "reason": bk.reason,
                          "collectible": bk.collectible, "collectible_why": bk.collectible_why if bk.collectible else ""})
        first = books[0] if books else {}
        out.append({"id": it.id, "is_book": bool(books), "books": books,
                    "title": first.get("title", ""), "author": first.get("author", ""), "stars": first.get("stars", 0),
                    "reason": first.get("reason", ""), "collectible": bool(first.get("collectible")),
                    "collectible_why": first.get("collectible_why", "")})
    return out


async def scout_spines(blocks: list[dict], client_tag: str = "") -> dict:
    """blocks: [{id, text}] of spines the library match didn't recognise."""
    t0 = time.perf_counter()
    meter = Meter()
    results: dict[int, dict] = {}
    todo: list[dict] = []
    for b in blocks[: BATCH * MAX_SCOUTS]:
        text = b.get("text", "")
        if looks_like_injection(text):
            results[b["id"]] = {"id": b["id"], "is_book": False, "flagged": True}
            continue
        if not _plausible(text):
            results[b["id"]] = {"id": b["id"], "is_book": False}
            continue
        hit = library._cache_get(_key(text), max_age=CACHE_DAYS * 86400)
        if hit is not None:
            results[b["id"]] = {**hit, "id": b["id"], "cached": True}
        else:
            todo.append(b)

    batches = [todo[i:i + BATCH] for i in range(0, len(todo), BATCH)]
    profile = library.taste_profile()
    if batches:
        reports = await asyncio.gather(*(_run_scout(bt, profile, meter, n) for n, bt in enumerate(batches)),
                                       return_exceptions=True)
        by_id = {b["id"]: b for b in todo}
        for rep in reports:
            if isinstance(rep, Exception):
                continue
            for r in rep:
                results[r["id"]] = r
                library._cache_put(_key(by_id[r["id"]]["text"]), {k: v for k, v in r.items() if k != "id"})

    owned = library.list_books("owned")
    import accounts   # friends who own it ("Sam owns this — borrow it?")
    out = []
    for b in blocks:
        r = results.get(b["id"])
        if not r:
            continue
        price = _PRICE.search(b.get("text", ""))
        if price:
            r = {**r, "price_seen": price.group(0).replace(" ", "")}   # a price sticker the camera read
        legacy = [{k: r.get(k) for k in ("title", "author", "stars", "reason", "collectible", "collectible_why")}] \
            if r.get("is_book") and r.get("title") else []
        books = []
        for bk in (r.get("books") or legacy):
            bk = dict(bk)
            fr = accounts.friends_owning(bk["title"], bk.get("author"), library.uid())
            if fr:
                bk["friends_own"] = fr
            hit, _ = library.match_owned(bk["title"], bk.get("author"), owned)
            if hit:
                bk["owned_id"] = hit["id"]
            gap = library.gap_for(bk["title"], bk.get("author"))
            if gap:
                bk["gap"] = gap
            books.append(bk)
        if books:
            # top-level fields mirror the first book (older app builds read only these)
            r = {**r, **books[0], "books": books}
        out.append(r)

    usage = meter.as_dict()
    timings = {"total": round(time.perf_counter() - t0, 2), "scouts": len(batches)}
    if usage["requests"]:
        library.log_usage("session", usage, f"{len(todo)} spines, {len(batches)} scouts")
    audit.append({"kind": "scout_team", "client": client_tag, "spines": len(blocks), "new": len(todo),
                  "scouts": len(batches), "usage": usage, "timings": timings})
    return {"results": out, "usage": usage, "timings": timings}
