"""The agent team.

    Shelf Reader  (LLM, vision)   photo  -> spines with boxes
    Librarian     (code + MCP)    spines -> owned / fills-a-gap / candidate, enriched via Open Library
    Curator       (LLM, text)     taste profile + candidates -> up to 5 picks with 1-5 stars
    Cataloguer    (LLM, vision)   cover / copyright-page photo -> edition details
    Librarian chat(LLM + MCP)     free questions about the collection

Token discipline: plain code orchestrates (no LLM "boss"), the Curator only
runs when there is something to rank, Open Library answers are cached, and
identical shelves are served from the scan cache for $0.
"""

from __future__ import annotations

import asyncio
import io
import json
import re
import time
from pathlib import Path

from fastmcp import Client
from PIL import Image, ImageOps
from pydantic import BaseModel, Field
from pydantic_ai import Agent, BinaryContent
from pydantic_ai.mcp import MCPToolset
from pydantic_ai.models.openai import OpenAIResponsesModelSettings
from pydantic_ai.usage import UsageLimits

import audit
import library
from config import MAX_CANDIDATES_FOR_CURATOR, MAX_PICKS, SCAN_CACHE_HAMMING, SCAN_IMAGE_MAX_PX
from llm import Meter, build_model

PROMPTS = Path(__file__).resolve().parent / "prompts"


def _prompt(name: str) -> str:
    return (PROMPTS / f"{name}.md").read_text(encoding="utf-8")


# ------------------------------------------------------------------ schemas

class Spine(BaseModel):
    title: str
    author: str = ""
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(ge=0, le=1)
    h: float = Field(ge=0, le=1)
    confidence: float = Field(ge=0, le=1)
    instruction_like_text: bool = False


class ShelfReading(BaseModel):
    spines: list[Spine] = Field(default_factory=list, max_length=40)
    notes: str = ""


class Pick(BaseModel):
    id: int
    stars: int = Field(ge=1, le=5)
    reason: str = Field(max_length=140)


class Picks(BaseModel):
    picks: list[Pick] = Field(default_factory=list, max_length=MAX_PICKS)


class BookDraft(BaseModel):
    title: str = ""
    author: str = ""
    publisher: str = ""
    year: int | None = None
    isbn: str = ""
    edition: str = ""
    binding: str = "unknown"
    printing_line: str = ""
    confidence: float = Field(default=0, ge=0, le=1)


# ------------------------------------------------------------------- agents

_agents: dict[str, Agent] = {}


# Reasoning tokens are billed as output and were ~55% of the first scan's output.
# Reading spines is perception, not reasoning, so it gets none; ranking gets a little.
EFFORT = {"shelf_reader": "none", "cataloguer": "none", "curator": "low", "librarian": "low"}


def _settings(name: str) -> OpenAIResponsesModelSettings:
    return OpenAIResponsesModelSettings(openai_reasoning_effort=EFFORT.get(name, "low"))


def _agent(name: str, output_type, **kw) -> Agent:
    if name not in _agents:
        _agents[name] = Agent(build_model(), output_type=output_type, instructions=_prompt(name),
                              name=name, retries=1, model_settings=_settings(name), **kw)
    return _agents[name]


# ------------------------------------------------------------ image helpers

def prepare_image(raw: bytes) -> tuple[bytes, Image.Image]:
    """Fix rotation, shrink to SCAN_IMAGE_MAX_PX, re-encode as JPEG (fewer tokens, no EXIF/GPS)."""
    img = Image.open(io.BytesIO(raw))
    img = ImageOps.exif_transpose(img).convert("RGB")
    img.thumbnail((SCAN_IMAGE_MAX_PX, SCAN_IMAGE_MAX_PX))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=82, optimize=True)   # re-encoding strips EXIF (location) too
    return buf.getvalue(), img


def dhash(img: Image.Image, size: int = 8) -> str:
    g = img.convert("L").resize((size + 1, size), Image.Resampling.LANCZOS)
    px = list(g.getdata())
    bits = 0
    for row in range(size):
        for col in range(size):
            left, right = px[row * (size + 1) + col], px[row * (size + 1) + col + 1]
            bits = (bits << 1) | (1 if left > right else 0)
    return f"{bits:016x}"


def _hamming(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def cached_scan(h: str, max_age_s: float = 6 * 3600) -> dict | None:
    with library.db() as con:
        rows = con.execute("SELECT dhash, result, created_at FROM scan_cache ORDER BY id DESC LIMIT 200").fetchall()
    for r in rows:
        if time.time() - r["created_at"] < max_age_s and _hamming(h, r["dhash"]) <= SCAN_CACHE_HAMMING:
            return json.loads(r["result"])
    return None


def store_scan(h: str, result: dict) -> None:
    with library.db() as con:
        con.execute("INSERT INTO scan_cache(dhash, result, created_at) VALUES (?,?,?)",
                    (h, json.dumps(result), time.time()))


# --------------------------------------------------------- injection guard

_SUSPICIOUS = re.compile(
    r"(ignore (all|your|previous)|disregard|system prompt|instruction|you are now|as an ai|assistant|"
    r"override|jailbreak|recommend this|five stars|5 stars|call |fetch|http|www\.|\.com|api key|password)",
    re.I)


def looks_like_injection(text: str) -> bool:
    return bool(_SUSPICIOUS.search(text or ""))


# ---------------------------------------------------------------- Librarian

def _mcp_data(res):
    data = getattr(res, "data", None)
    if data is None and getattr(res, "structured_content", None):
        data = res.structured_content.get("result", res.structured_content)
    return data


async def librarian(spines: list[Spine], mcp_server) -> list[dict]:
    """Code agent: classify every spine using only the library MCP server's tools."""
    books: list[dict] = []
    async with Client(mcp_server) as mcp:
        checks = _mcp_data(await mcp.call_tool(
            "check_owned", {"books": [{"title": s.title, "author": s.author} for s in spines]})) or []
        for i, (s, chk) in enumerate(zip(spines, checks)):
            item = {
                "id": i, "title": s.title, "author": s.author,
                "box": {"x": round(s.x, 4), "y": round(s.y, 4), "w": round(s.w, 4), "h": round(s.h, 4)},
                "confidence": round(s.confidence, 2), "status": "unknown",
            }
            if s.instruction_like_text or looks_like_injection(f"{s.title} {s.author}"):
                item.update(status="flagged", note="Printed text looked like instructions to an AI — ignored.")
            elif s.confidence < 0.45:
                item.update(status="unreadable")
            elif chk.get("owned"):
                m = chk["match"]
                item.update(status="owned", book_id=m["id"], note=f"In your library · {m.get('binding') or ''}".strip(" ·"))
            else:
                gap = _mcp_data(await mcp.call_tool("fills_a_gap", {"title": s.title, "author": s.author}))
                if gap:
                    item.update(status="missing", collection=gap["collection"],
                                note=f"Completes {gap['collection']} · vol. {gap['index']} "
                                     f"({gap['owned_count']}/{gap['total']} owned)")
                else:
                    item["status"] = "candidate"
            books.append(item)

        # Enrich missing + candidates with real metadata (cached; capped).
        to_enrich = [b for b in books if b["status"] in ("missing", "candidate")][:MAX_CANDIDATES_FOR_CURATOR]

        async def enrich(b: dict) -> None:
            hits = _mcp_data(await mcp.call_tool(
                "open_library_search", {"title": b["title"], "author": b["author"], "limit": 1})) or []
            if hits:
                h = hits[0]
                if library.similarity(b["title"], b["author"], h.get("title") or "", h.get("author")) >= 0.7:
                    b.update(year=h.get("year"), subjects=(h.get("subjects") or [])[:4],
                             cover_url=h.get("cover_url"), ol_author=h.get("author"))

        await asyncio.gather(*(enrich(b) for b in to_enrich))
    return books


# ------------------------------------------------------------ scan pipeline

async def scan_shelf(raw: bytes, client_tag: str = "") -> dict:
    t0 = time.perf_counter()
    jpeg, img = prepare_image(raw)
    h = dhash(img)
    hit = cached_scan(h)
    if hit:
        hit = {**hit, "cached": True, "usage": {**hit["usage"], "cost_usd": 0.0, "saved_usd": hit["usage"]["cost_usd"]},
               "seconds": round(time.perf_counter() - t0, 2)}
        audit.append({"kind": "scan", "cached": True, "dhash": h, "client": client_tag})
        return hit

    meter = Meter()
    limits = UsageLimits(request_limit=2, output_tokens_limit=4000)

    # 1) Shelf Reader (vision)
    reading = await _agent("shelf_reader", ShelfReading).run(
        ["Read this shelf.", BinaryContent(data=jpeg, media_type="image/jpeg")], usage_limits=limits)
    meter.add("shelf_reader", reading.usage)
    spines = reading.output.spines
    timings = {"read": round(time.perf_counter() - t0, 2)}

    # 2) Librarian (code + MCP)
    from mcp_bridge import MCP_SERVER   # local import avoids a cycle
    t1 = time.perf_counter()
    books = await librarian(spines, MCP_SERVER)
    timings["librarian"] = round(time.perf_counter() - t1, 2)

    # 3) Curator (only if there is something to rank)
    candidates = [b for b in books if b["status"] == "candidate"][:MAX_CANDIDATES_FOR_CURATOR]
    picks: list[dict] = []
    t2 = time.perf_counter()
    if candidates:
        brief = [{"id": b["id"], "title": b["title"], "author": b.get("ol_author") or b["author"],
                  "year": b.get("year"), "subjects": b.get("subjects", [])} for b in candidates]
        prompt = (f"READER TASTE PROFILE\n{library.taste_profile()}\n\n"
                  f"CANDIDATES ON THE SHELF (JSON)\n{json.dumps(brief, ensure_ascii=False)}")
        cur = await _agent("curator", Picks).run(prompt, usage_limits=UsageLimits(request_limit=2,
                                                                                   output_tokens_limit=1200))
        meter.add("curator", cur.usage)
        valid = {b["id"] for b in candidates}
        for p in cur.output.picks:
            if p.id in valid and not looks_like_injection(p.reason):     # never trust ids/text blindly
                picks.append(p.model_dump())
        by_id = {b["id"]: b for b in books}
        for p in picks[:MAX_PICKS]:
            by_id[p["id"]].update(status="pick", stars=p["stars"], note=p["reason"])

    timings["curator"] = round(time.perf_counter() - t2, 2)
    counts = {k: sum(1 for b in books if b["status"] == k)
              for k in ("owned", "missing", "pick", "candidate", "flagged", "unreadable")}
    result = {
        "books": books, "counts": counts, "notes": reading.output.notes,
        "image": {"w": img.width, "h": img.height, "dhash": h},
        "usage": meter.as_dict(), "cached": False, "seconds": round(time.perf_counter() - t0, 2),
        "timings": timings,
    }
    store_scan(h, result)
    library.log_usage("scan", result["usage"], f"{len(books)} spines")
    audit.append({"kind": "scan", "cached": False, "dhash": h, "client": client_tag, "counts": counts,
                  "flagged": [b["title"] for b in books if b["status"] == "flagged"],
                  "usage": result["usage"], "seconds": result["seconds"]})
    return result


# ---------------------------------------------------------------- catalogue

async def catalogue_photo(raw: bytes) -> dict:
    jpeg, _ = prepare_image(raw)
    meter = Meter()
    run = await _agent("cataloguer", BookDraft).run(
        ["Catalogue this book.", BinaryContent(data=jpeg, media_type="image/jpeg")],
        usage_limits=UsageLimits(request_limit=2, output_tokens_limit=800))
    meter.add("cataloguer", run.usage)
    draft = run.output.model_dump()
    # Verify against Open Library (ISBN first, then title/author). Never trust the photo alone.
    meta = library.ol_isbn(draft["isbn"]) if draft["isbn"] else None
    if not meta and draft["title"]:
        meta = (library.ol_search(title=draft["title"], author=draft["author"], limit=1) or [None])[0]
    verified = bool(meta and library.similarity(draft["title"], draft["author"],
                                                 meta.get("title") or "", meta.get("author")) >= 0.75)
    if verified:
        draft.update(cover_url=meta.get("cover_url"), subjects=meta.get("subjects", []),
                     pages=draft.get("pages") or meta.get("pages"),
                     original_year=meta.get("year"))
    usage = meter.as_dict()
    library.log_usage("catalogue", usage, draft.get("title", ""))
    audit.append({"kind": "catalogue", "title": draft.get("title"), "verified": verified, "usage": usage})
    return {"draft": draft, "verified": verified, "usage": usage}


# -------------------------------------------------------------- chat agent

async def ask_librarian(question: str, history: list[dict] | None = None) -> dict:
    from mcp_bridge import MCP_SERVER
    meter = Meter()
    toolset = MCPToolset(Client(MCP_SERVER))
    agent = Agent(build_model(), instructions=_prompt("librarian"), toolsets=[toolset],
                  name="librarian_chat", retries=1, model_settings=_settings("librarian"))
    convo = "\n".join(f"{m['role']}: {m['text'][:400]}" for m in (history or [])[-6:])
    prompt = (f"Earlier in this chat:\n{convo}\n\n" if convo else "") + f"Reader: {question[:600]}"
    tools_used: list[str] = []
    async with agent:
        run = await agent.run(prompt, usage_limits=UsageLimits(request_limit=6, tool_calls_limit=8,
                                                               output_tokens_limit=1500))
    for msg in run.all_messages():
        for part in getattr(msg, "parts", []):
            if getattr(part, "part_kind", "") == "tool-call":
                tools_used.append(part.tool_name)
    meter.add("librarian_chat", run.usage)
    usage = meter.as_dict()
    library.log_usage("chat", usage, question[:120])
    audit.append({"kind": "chat", "question": question[:200], "tools": tools_used, "usage": usage})
    return {"answer": run.output, "tools": tools_used, "usage": usage}
