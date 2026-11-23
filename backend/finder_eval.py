"""Book Finder regression check on a REAL phone OCR dump (test_data/ocr/pixel_shelf_17_books.json).

Re-creates what the phone sends (same block geometry + merging as mobile/src/ondevice.ts,
fast mode = upright + one turn), runs phase 1 (library match) and phase 2 (Scouts),
and scores the result against the books visible in that photo.

    python backend/finder_eval.py [--fresh]     (--fresh ignores the scout cache)
"""

from __future__ import annotations

import asyncio
import json
import math
import sys
import time

import library
import live
import scouts
from config import ROOT

TRUTH = [
    ("The Secret Keeper of Jaipur", "Alka Joshi"), ("The Housemaid", "Freida McFadden"),
    ("And the Mountains Echoed", "Khaled Hosseini"), ("Part of Your World", "Abby Jimenez"),
    ("The Stationery Shop", "Marjan Kamali"), ("Just for the Summer", "Abby Jimenez"),
    ("One Golden Summer", "Carley Fortune"), ("Every Summer After", "Carley Fortune"),
    ("Meet Me at the Lake", "Carley Fortune"), ("All My Rage", "Sabaa Tahir"),
    ("The Forty Rules of Love", "Elif Shafak"), ("The Nightingale", "Kristin Hannah"),
    ("In Five Years", "Rebecca Serle"), ("Yours Truly", "Abby Jimenez"),
    ("In the Time of Our History", "Susanne Pari"), ("The Alchemist", "Paulo Coelho"),
    ("The Secret History", "Donna Tartt"),
]


def letters(t: str) -> int:
    return sum(c.isalpha() for c in t)


def axis(pts):
    if not pts or len(pts) < 4:
        return None
    e1 = (pts[1]["x"] - pts[0]["x"], pts[1]["y"] - pts[0]["y"])
    e2 = (pts[2]["x"] - pts[1]["x"], pts[2]["y"] - pts[1]["y"])
    l1, l2 = math.hypot(*e1), math.hypot(*e2)
    v = e1 if l1 >= l2 else e2
    if v[1] < 0 or (v[1] == 0 and v[0] > 0):
        v = (-v[0], -v[1])
    return math.degrees(math.atan2(-v[0], v[1])), max(l1, l2)


def phone_blocks(raw: dict, fast: bool = True) -> list[dict]:
    W, H = raw["base"]["w"], raw["base"]["h"]
    out = []
    for b in raw["ccw"]["blocks"]:
        out.append({"text": b["text"], "x": W - (b["y"] + b["h"]), "y": b["x"], "w": b["h"], "h": b["w"],
                    "pts": [{"x": W - q["y"], "y": q["x"]} for q in b.get("pts") or []]})
    if not fast:
        for b in raw["cw"]["blocks"]:
            out.append({"text": b["text"], "x": b["y"], "y": H - (b["x"] + b["w"]), "w": b["h"], "h": b["w"],
                        "pts": [{"x": q["y"], "y": H - q["x"]} for q in b.get("pts") or []]})
    out += raw["flat"]["blocks"]
    norm = []
    for b in out:
        ax = axis(b.get("pts"))
        norm.append({"text": b["text"], "x": max(0, b["x"] / W), "y": max(0, b["y"] / H), "w": min(1, b["w"] / W),
                     "h": min(1, b["h"] / H), "angle": ax[0] if ax else (0 if b["h"] >= b["w"] else 90),
                     "len": (ax[1] if ax else max(b["h"], b["w"])) / H})
    allb = sorted([b for b in norm if letters(b["text"]) >= 3], key=lambda b: -letters(b["text"]))

    def iou(a, b):
        ix = max(0, min(a["x"] + a["w"], b["x"] + b["w"]) - max(a["x"], b["x"]))
        iy = max(0, min(a["y"] + a["h"], b["y"] + b["h"]) - max(a["y"], b["y"]))
        inter = ix * iy
        return inter / ((a["w"] * a["h"] + b["w"] * b["h"] - inter) or 1)

    kept = []
    for b in allb:
        if not any(iou(k, b) > 0.35 for k in kept):
            kept.append(b)
    # mergeSpines (same as the phone)
    merged = []
    for b in sorted(kept, key=lambda k: k["x"]):
        prev = merged[-1] if merged else None
        tall = lambda k: k["h"] > k["w"] * 1.3  # noqa: E731
        if prev and tall(prev) and tall(b):
            ov = min(prev["x"] + prev["w"], b["x"] + b["w"]) - max(prev["x"], b["x"])
            if ov > 0.5 * min(prev["w"], b["w"]):
                top = [prev, b] if prev["y"] <= b["y"] else [b, prev]
                x, y = min(prev["x"], b["x"]), min(prev["y"], b["y"])
                merged[-1] = {**prev, "text": f"{top[0]['text']} {top[1]['text']}", "x": x, "y": y,
                              "w": max(prev["x"] + prev["w"], b["x"] + b["w"]) - x,
                              "h": max(prev["y"] + prev["h"], b["y"] + b["h"]) - y}
                continue
        merged.append(dict(b))
    return [b for b in merged if letters(b["text"]) >= 4]


def score(found: list[tuple[str, str]]) -> tuple[int, list[str], list[str]]:
    hit, wrong = set(), []
    for t, a in found:
        m = next((i for i, (tt, aa) in enumerate(TRUTH) if library.similarity(t, a, tt, aa) >= 0.8), None)
        if m is None:
            wrong.append(f"{t} / {a}")
        else:
            hit.add(m)
    missed = [TRUTH[i][0] for i in range(len(TRUTH)) if i not in hit]
    return len(hit), missed, wrong


async def main(fresh: bool, fast: bool) -> None:
    library.current_user.set(1)
    raw = json.loads((ROOT / "test_data" / "ocr" / "pixel_shelf_17_books.json").read_text(encoding="utf-8"))
    blocks = phone_blocks(raw, fast=fast)
    texts = [b["text"].replace("\n", " ") for b in blocks]
    print(f"{len(texts)} spine texts from the phone ({'fast' if fast else 'full'} mode)")
    t0 = time.perf_counter()
    m = live.match_blocks([{"id": i, "text": t} for i, t in enumerate(texts)])
    t1 = time.perf_counter()
    found = [(r["title"], r.get("author") or "") for r in m if r["status"] in ("owned", "missing", "pick")]
    unknown = [{"id": r["id"], "text": r["text"]} for r in m if r["status"] == "unknown"]
    if fresh:
        scouts.CACHE_DAYS = 0
    r = await scouts.scout_spines(unknown)
    t2 = time.perf_counter()
    for x in r["results"]:
        for b in x.get("books") or ([x] if x.get("is_book") and x.get("title") else []):
            found.append((b["title"], b.get("author") or ""))
    # one entry per distinct book
    uniq = []
    for t, a in found:
        if not any(library.similarity(t, a, u, v) >= 0.85 for u, v in uniq):
            uniq.append((t, a))
    n, missed, wrong = score(uniq)
    print(f"match {1000 * (t1 - t0):.0f} ms · scouts {t2 - t1:.2f} s · {r['timings'].get('scouts')} scouts · ${r['usage']['cost_usd']:.5f}")
    print(f"FOUND {n}/{len(TRUTH)} correct · {len(wrong)} wrong · {len(uniq)} reported")
    print("  missed:", missed)
    print("  wrong :", wrong)
    if "-v" in sys.argv:
        for t in texts:
            print("   |", t)


if __name__ == "__main__":
    asyncio.run(main("--fresh" in sys.argv, "--full" not in sys.argv))
