"""Smoke test: hit every read endpoint (and a few safe writes) on a running backend.

    python backend/smoke_test.py [http://localhost:8020]

Prints one line per call with status and time; exits 1 if anything failed.
Writes are cleaned up (test book and decor are removed afterwards).
"""

from __future__ import annotations

import sys
import time

import httpx

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8020").rstrip("/")
c = httpx.Client(base_url=BASE, timeout=60)
fails = 0


def call(method: str, path: str, ok=(200,), **kw):
    global fails
    t = time.perf_counter()
    try:
        r = c.request(method, path, **kw)
        good = r.status_code in ok
    except Exception as e:  # noqa: BLE001
        r, good = None, False
        print(f"FAIL {method:6} {path}  {e}")
    dt = (time.perf_counter() - t) * 1000
    if r is not None:
        print(f"{'ok  ' if good else 'FAIL'} {method:6} {path:58} {r.status_code}  {dt:6.0f} ms")
    if not good:
        fails += 1
    return r


call("GET", "/api/health")
call("GET", "/api/quote")
call("GET", "/api/stats")
books = call("GET", "/api/books?status=all").json()
bid = books[0]["id"]
call("GET", f"/api/books/{bid}")
call("GET", f"/api/books/{bid}/spine.png")
for side in ("front.jpg", "back.jpg", "spine.png"):
    call("GET", f"/api/books/{bid}/tex/{side}")
call("GET", "/api/tex/pages.jpg")
call("GET", "/api/models/bust.bin")
call("GET", "/api/collections")
call("GET", "/api/books/check?title=Middlemarch&author=George%20Eliot")
call("POST", "/api/friends/verdicts", json={"items": [{"title": "Middlemarch", "author": "George Eliot"}]})
call("GET", "/api/listen?title=Middlemarch&author=George%20Eliot")
call("GET", "/api/where?title=Piranesi&author=Susanna%20Clarke")
call("GET", "/api/characters?title=Middlemarch&author=George%20Eliot")
call("GET", "/api/decor")
call("GET", "/api/me")
call("GET", "/api/friends")
call("GET", "/api/reader-types")
call("GET", "/api/usage")
call("GET", "/api/audit?n=5")
call("POST", "/api/live/match", json={"blocks": [{"id": 0, "text": "DONNA TARTT THE SECRET HISTORY"}]})
call("POST", "/api/session/scout", json={"blocks": [{"id": 0, "text": "KAZUO ISHIGURO KLARA AND THE SUN"}]})
call("GET", f"/api/books/{bid}/sample")
# safe writes, cleaned up
nb = call("POST", "/api/books", json={"title": "Smoke Test Volume", "author": "Nobody", "status": "wishlist"}).json()
call("PATCH", f"/api/books/{nb['id']}", json={"rating": 3.75, "review": "fine", "read_state": "dnf"})
call("DELETE", f"/api/books/{nb['id']}")
d = call("POST", "/api/decor", json={"book_id": None, "book_title": "Test", "character": {"name": "Tester", "epithet": "x", "line": "y", "look": {}}}).json()
call("DELETE", f"/api/decor/{d['id']}")
# guards
call("GET", "/api/books/999999", ok=(404,))
call("POST", "/api/books", ok=(400, 422), json={"title": "", "status": "nope"})
print("\nALL GOOD" if not fails else f"\n{fails} FAILED")
sys.exit(1 if fails else 0)
