"""Live AR path: the phone reads spines on-device (ML Kit) and sends only text.

Phase 1  match_blocks()  — plain code, ~ms: owned / completes-a-collection / flagged.
Phase 2  identify()      — Open Library (parallel, cached) to put a real title on the
                           unknown spines, then the Curator ranks them (cached by
                           candidate set). Target: picks on screen in < 5 s.

No photo ever leaves the phone in this path, which is also better for privacy.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import time

import audit
import library
from agents import PROMPTS, looks_like_injection
from llm import build_model
from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIResponsesModelSettings
from config import MAX_PICKS
from llm import Meter
from pydantic_ai.usage import UsageLimits

_STOP = library._STOP | {"by", "with", "edition", "classics", "penguin", "vintage", "press", "books", "new"}


def _tokens(text: str) -> list[str]:
    return [t for t in library.norm(text).split() if t]


def _distinct(title: str) -> set[str]:
    return {t for t in _tokens(title) if t not in _STOP and len(t) > 1}


def _coverage(title: str, author: str | None, block_tokens: set[str], block_norm: str) -> float:
    """How well a known title explains an OCR block (0..1)."""
    words = _distinct(title)
    if not words:
        return 0.0
    hit = len(words & block_tokens) / len(words)
    surname = library._surname(author)
    has_author = bool(surname) and surname in block_tokens
    if len(words) == 1:
        # One-word titles ("Emma", "Dune") must be the ONLY title word on the spine:
        # "Dune Messiah" is not "Dune". Anything else on the spine must be the author.
        only = next(iter(words))
        author_toks = set(_tokens(author or ""))
        extra = {t for t in block_tokens if t not in _STOP and t != only and t not in author_toks and len(t) > 1}
        if only in block_tokens and not extra:
            return 1.0
        return 0.0
    return min(1.0, hit + (0.15 if has_author else 0.0))


def _ocr_support(title: str, author: str | None, raw: str) -> float:
    """How well camera text supports an AI-proposed title (0..1), tolerant of OCR slips.

    A title word counts if the spine shows it exactly, glued to a neighbour
    ("JIMENEZYOURS"), or misread by a letter or two ("ALCHEHI5T" ~ "alchemist").
    This is the guard against invented titles: the AI may fix spelling, never add words.
    """
    import difflib
    # common OCR confusions on spines: digits read for letters
    fix = str.maketrans({"5": "s", "0": "o", "1": "l", "8": "b", "4": "a", "3": "e", "6": "g", "7": "t"})
    toks = {t.translate(fix) for t in _tokens(raw)}
    squashed = library.norm(raw).replace(" ", "").translate(fix)
    words = _distinct(title)
    if not words or not (author or "").strip():
        return 0.0          # a real identification names its author
    surname0 = library._surname(author)
    if library.norm(title) in library.norm(author) or library.norm(title) == surname0:
        return 0.0          # an author's name is not a title ("Carley Fortune", "Fortune")

    def seen(w: str) -> bool:
        if w in toks:
            return True
        if len(w) >= 4 and (w in squashed or any(w in t for t in toks if len(t) > len(w))):
            return True
        if len(w) >= 4:
            return any(difflib.SequenceMatcher(None, w, t).ratio() >= 0.78 for t in toks if abs(len(t) - len(w)) <= 3)
        return False

    hit = sum(seen(w) for w in words) / len(words)
    surname = library._surname(author)
    author_seen = bool(surname) and len(surname) >= 3 and seen(surname)
    if len(words) < 3 and not author_seen:
        return 0.0          # short titles are too easy to "find": the author must be on the spine too
    if author_seen:
        hit += 0.15
    return min(1.0, hit)


def _known_titles() -> list[dict]:
    """Owned + wishlist books and the missing volumes of started collections."""
    out = [{"kind": "owned" if b["status"] == "owned" else "wishlist", "title": b["title"],
            "author": b["author"], "book": b} for b in library.list_books(None)]
    for g in library.collection_gaps():
        for m in g["missing"]:
            out.append({"kind": "missing", "title": m["title"], "author": g["author"], "gap": {
                "collection": g["collection"], "index": m["index"],
                "owned_count": len(g["have"]), "total": len(g["have"]) + len(g["missing"])}})
    return out


def match_blocks(blocks: list[dict]) -> list[dict]:
    known = _known_titles()
    results = []
    for blk in blocks[:60]:
        text = (blk.get("text") or "")[:300]
        bnorm = library.norm(text)
        btok = set(bnorm.split())
        item = {"id": blk.get("id"), "text": text, "box": blk.get("box"), "status": "unknown"}
        if looks_like_injection(text):
            item.update(status="flagged", note="Printed text looked like instructions to an AI — ignored.")
            results.append(item)
            continue
        best, best_s, best_len = None, 0.0, 0
        for k in known:
            sc = _coverage(k["title"], k["author"], btok, bnorm)
            ln = len(_distinct(k["title"]))
            if sc > best_s or (sc == best_s and sc > 0 and ln > best_len):   # prefer the more specific title
                best, best_s, best_len = k, sc, ln
        if best and best_s >= 0.75:
            # a block that runs across several spines: if much of its text isn't this book,
            # the phone should ALSO send it to the scouts so the neighbours aren't lost
            explained = _distinct(best["title"]) | set(_tokens(best.get("author") or ""))
            leftover = [t for t in btok if t not in explained and t not in _STOP and len(t) >= 4]
            if len(leftover) >= 3:
                item["more"] = True
            if best["kind"] == "owned":
                b = best["book"]
                item.update(status="owned", title=b["title"], author=b["author"], book_id=b["id"],
                            note=f"In your library · {b.get('binding') or ''}".strip(" ·"))
            elif best["kind"] == "wishlist":
                b = best["book"]
                item.update(status="pick", stars=5, title=b["title"], author=b["author"], book_id=b["id"],
                            note="On your wishlist — it's here!")
            else:
                g = best["gap"]
                item.update(status="missing", title=best["title"], author=best["author"], collection=g["collection"],
                            note=f"Completes {g['collection']} · vol. {g['index']} ({g['owned_count']}/{g['total']} owned)")
        results.append(item)
    return results


# ------------------------------------------------------------------ phase 2

def _plausible(text: str) -> bool:
    words = [w for w in _tokens(text) if len(w) >= 3 and w not in _STOP]
    return len(words) >= 2


class LivePick(BaseModel):
    id: int
    title: str = Field(max_length=200)
    author: str = Field(default="", max_length=120)
    stars: int = Field(ge=1, le=5)
    reason: str = Field(max_length=140)


class LivePicks(BaseModel):
    picks: list[LivePick] = Field(default_factory=list, max_length=MAX_PICKS)


_LIVE: Agent | None = None


def _live_curator() -> Agent:
    global _LIVE
    if _LIVE is None:
        _LIVE = Agent(build_model(), output_type=LivePicks,
                      instructions=(PROMPTS / "live_curator.md").read_text(encoding="utf-8"),
                      name="live_curator", retries=1,
                      model_settings=OpenAIResponsesModelSettings(openai_reasoning_effort="none"))
    return _LIVE


async def _enrich(text: str) -> dict | None:
    hits = await asyncio.to_thread(library.ol_search, q=text[:120], limit=1)
    return hits[0] if hits else None


def _cache_key(texts: list[str]) -> str:
    sig = json.dumps(sorted(library.norm(t) for t in texts)) + library.taste_profile()
    return "livecurator|" + hashlib.sha256(sig.encode()).hexdigest()[:24]


async def identify(blocks: list[dict], client_tag: str = "") -> dict:
    """Unknown OCR blocks -> the Curator reads the raw spine text and returns <=5 picks (one fast call).

    Every title it returns must be explained by the text the camera actually saw
    (anti-hallucination). Open Library only decorates picks with a cover/year, under
    a hard time cap, so it can never delay the answer much.
    """
    t0 = time.perf_counter()
    todo = [b for b in blocks if _plausible(b.get("text", "")) and not looks_like_injection(b.get("text", ""))][:12]
    meter = Meter()
    picks: list[dict] = []
    cached = False
    if todo:
        key = _cache_key([b["text"] for b in todo])
        prior = library._cache_get(key, max_age=7 * 86400)
        if prior is not None:
            picks, cached = prior, True
        else:
            brief = [{"id": b["id"], "spine_text": b["text"][:160]} for b in todo]
            prompt = (f"READER TASTE PROFILE\n{library.taste_profile()}\n\n"
                      f"SPINES SEEN ON THE SHELF (raw camera text, JSON)\n{json.dumps(brief, ensure_ascii=False)}")
            run = await _live_curator().run(prompt, usage_limits=UsageLimits(request_limit=2, output_tokens_limit=900))
            meter.add("live_curator", run.usage)
            texts = {b["id"]: b["text"] for b in todo}
            owned = library.list_books("owned")
            for pk in run.output.picks:
                raw = texts.get(pk.id)
                if raw is None or looks_like_injection(pk.reason):
                    continue
                if _ocr_support(pk.title, pk.author, raw) < 0.6:
                    continue          # title not supported by what the camera read -> drop it
                if library.match_owned(pk.title, pk.author, owned)[0]:
                    continue
                picks.append(pk.model_dump())
            library._cache_put(key, picks)
    t_llm = round(time.perf_counter() - t0, 2)
    try:
        metas = await asyncio.wait_for(
            asyncio.gather(*(_enrich(f"{pk['title']} {pk['author']}") for pk in picks)), timeout=0.7)
    except asyncio.TimeoutError:
        metas = [None] * len(picks)
    out = []
    for pk, m in zip(picks[:MAX_PICKS], metas):
        m = m or {}
        out.append({"id": pk["id"], "title": pk["title"], "author": pk["author"], "status": "pick",
                    "stars": pk["stars"], "note": pk["reason"], "cover_url": m.get("cover_url"),
                    "year": m.get("year"), "subjects": (m.get("subjects") or [])[:4]})
    usage = meter.as_dict()
    result = {"books": out, "usage": usage, "cached": cached,
              "timings": {"curator": t_llm, "total": round(time.perf_counter() - t0, 2)}}
    if usage["requests"]:
        library.log_usage("live", usage, f"{len(todo)} spines")
    audit.append({"kind": "live_identify", "client": client_tag, "blocks": len(blocks), "considered": len(todo),
                  "picks": len(out), "cached": cached, "usage": usage, "timings": result["timings"]})
    return result
