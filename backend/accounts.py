"""Accounts, profiles and friends (lightweight, but done properly).

- Passwords: PBKDF2-SHA256, 600k iterations, per-user salt; stored as
  pbkdf2_sha256$<iters>$<salt>$<digest>. Never logged, never returned.
- Tokens: HMAC-SHA256 signed "<user_id>.<expiry>.<sig>", 7 days. Secret from
  APP_SECRET, else a random one kept in data/.app_secret (git-ignored).
- Friends: add by a 6-character friend code; friendship is mutual; a friend's
  bookcase is read-only.
- The demo reader is user 1 (everything works without signing in), with two
  demo friends so the social features can be tried straight away.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
import time

import library
from config import DATA_DIR

ITERATIONS = 600_000
TOKEN_DAYS = 7
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # no 0/O/1/I confusion


def _secret() -> bytes:
    env = os.getenv("APP_SECRET", "").strip()
    if env:
        return env.encode()
    f = DATA_DIR / ".app_secret"
    if not f.exists():
        f.write_text(secrets.token_hex(32), encoding="utf-8")
    return f.read_text(encoding="utf-8").strip().encode()


# ---------------------------------------------------------------- passwords

def hash_password(pw: str) -> str:
    salt = secrets.token_hex(16)
    dig = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), ITERATIONS).hex()
    return f"pbkdf2_sha256${ITERATIONS}${salt}${dig}"


def check_password(pw: str, stored: str) -> bool:
    try:
        _, iters, salt, dig = stored.split("$")
        got = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), int(iters)).hex()
        return hmac.compare_digest(got, dig)
    except ValueError:
        return False


# ------------------------------------------------------------------- tokens

def make_token(user_id: int) -> str:
    exp = int(time.time()) + TOKEN_DAYS * 86400
    body = f"{user_id}.{exp}"
    sig = base64.urlsafe_b64encode(hmac.new(_secret(), body.encode(), hashlib.sha256).digest()).decode().rstrip("=")
    return f"{body}.{sig}"


def read_token(token: str | None) -> int | None:
    if not token:
        return None
    try:
        uid_s, exp_s, sig = token.split(".")
        body = f"{uid_s}.{exp_s}"
        want = base64.urlsafe_b64encode(hmac.new(_secret(), body.encode(), hashlib.sha256).digest()).decode().rstrip("=")
        if not hmac.compare_digest(want, sig) or int(exp_s) < time.time():
            return None
        return int(uid_s)
    except ValueError:
        return None


# -------------------------------------------------------------------- users

def _code() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(6))


def public(u) -> dict:
    keys = u.keys() if hasattr(u, "keys") else []
    rt = u["reader_type"] if "reader_type" in keys else None
    return {"id": u["id"], "username": u["username"], "display_name": u["display_name"],
            "friend_code": u["friend_code"], "bio": u["bio"] or "", "reader_type": rt,
            "reader_type_label": READER_TYPES[rt][0] if rt in READER_TYPES else None}


def get_user(user_id: int) -> dict | None:
    with library.db() as con:
        r = con.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    return public(r) if r else None


def register(username: str, password: str, display_name: str, reader_type: str | None = None) -> dict:
    username = username.strip().lower()
    if not re.fullmatch(r"[a-z0-9_.]{3,24}", username):
        raise ValueError("Usernames are 3–24 letters, numbers, dots or underscores.")
    if len(password) < 8:
        raise ValueError("Passwords need at least 8 characters.")
    with library.db() as con:
        if con.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
            raise ValueError("That username is taken.")
        cur = con.execute("INSERT INTO users(username, display_name, pw_hash, friend_code) VALUES (?,?,?,?)",
                          (username, display_name.strip()[:40] or username, hash_password(password), _code()))
        new_id = int(cur.lastrowid)
        if reader_type in READER_TYPES:
            con.execute("UPDATE users SET reader_type=? WHERE id=?", (reader_type, new_id))
    return get_user(new_id)  # type: ignore[return-value]


def login(username: str, password: str) -> dict | None:
    with library.db() as con:
        r = con.execute("SELECT * FROM users WHERE username=?", (username.strip().lower(),)).fetchone()
    if not r or not check_password(password, r["pw_hash"]):
        return None
    return public(r)


def update_profile(user_id: int, display_name: str | None, bio: str | None) -> dict:
    with library.db() as con:
        if display_name is not None:
            con.execute("UPDATE users SET display_name=? WHERE id=?", (display_name.strip()[:40], user_id))
        if bio is not None:
            con.execute("UPDATE users SET bio=? WHERE id=?", (bio.strip()[:200], user_id))
    return get_user(user_id)  # type: ignore[return-value]


# ------------------------------------------------------------------ friends

def add_friend(user_id: int, code: str) -> dict:
    with library.db() as con:
        r = con.execute("SELECT * FROM users WHERE friend_code=?", (code.strip().upper(),)).fetchone()
        if not r:
            raise ValueError("No reader has that friend code.")
        if r["id"] == user_id:
            raise ValueError("That's your own code.")
        con.execute("INSERT OR IGNORE INTO friendships(user_id, friend_id) VALUES (?,?)", (user_id, r["id"]))
        con.execute("INSERT OR IGNORE INTO friendships(user_id, friend_id) VALUES (?,?)", (r["id"], user_id))
    return public(r)


def friend_ids(user_id: int) -> list[int]:
    with library.db() as con:
        return [r[0] for r in con.execute("SELECT friend_id FROM friendships WHERE user_id=?", (user_id,))]


def is_friend(user_id: int, other: int) -> bool:
    return other in friend_ids(user_id)


def friends(user_id: int) -> list[dict]:
    out = []
    for fid in friend_ids(user_id):
        u = get_user(fid)
        if u:
            st = library.stats(user_id=fid)
            out.append({**u, "books": st["books"], "reading_now": st["reading_now"]})
    return out


def friends_owning(title: str, author: str | None, user_id: int) -> list[str]:
    """Display names of friends who own this book (for 'Sam owns this — borrow it?')."""
    names = []
    for fid in friend_ids(user_id):
        hit, _ = library.match_owned(title, author, library.list_books("owned", user_id=fid))
        if hit:
            u = get_user(fid)
            if u:
                names.append(u["display_name"])
    return names


# ------------------------------------------------------------- reader types

READER_TYPES = {
    "collector": ("The Collector", "Editions, complete sets and the thrill of the hunt."),
    "devourer": ("The Devourer", "Reads fast and wide; the next book is always waiting."),
    "romantic": ("The Romantic", "Swoony love stories and big feelings."),
    "scholar": ("The Scholar", "Classics, ideas and footnotes welcome."),
    "wanderer": ("The Wanderer", "Hops genres and countries for the joy of it."),
    "comfort": ("The Comfort Re-reader", "Old favourites, worn spines, familiar voices."),
}


def ensure_columns() -> None:
    with library.db() as con:
        cols = {r[1] for r in con.execute("PRAGMA table_info(users)")}
        if "reader_type" not in cols:
            con.execute("ALTER TABLE users ADD COLUMN reader_type TEXT")


def set_reader_type(user_id: int, kind: str) -> dict:
    if kind not in READER_TYPES:
        raise ValueError("Unknown reader type.")
    with library.db() as con:
        con.execute("UPDATE users SET reader_type=? WHERE id=?", (kind, user_id))
    return get_user(user_id)  # type: ignore[return-value]


def reader_type_line(user_id: int) -> str:
    u = get_user(user_id)
    t = READER_TYPES.get((u or {}).get("reader_type") or "")
    return f"Reader type: {t[0]} — {t[1]}" if t else ""


# --------------------------------------------------------------------- seed

DEMO_FRIENDS = {
    "sam": ("Sam", "Mostly fantasy and anything with a map in the front.", [
        ("The Name of the Wind", "Patrick Rothfuss"), ("Mistborn", "Brandon Sanderson"),
        ("The Hobbit", "J.R.R. Tolkien"), ("Klara and the Sun", "Kazuo Ishiguro"),
        ("Jonathan Strange & Mr Norrell", "Susanna Clarke"), ("Harry Potter and the Goblet of Fire", "J.K. Rowling"),
        ("The Return of the King", "J.R.R. Tolkien"), ("A Wizard of Earthsea", "Ursula K. Le Guin"),
    ]),
    "ada": ("Ada", "Russian novels, Victorian heroines, too many tote bags.", [
        ("Anna Karenina", "Leo Tolstoy"), ("Villette", "Charlotte Brontë"), ("The Idiot", "Fyodor Dostoevsky"),
        ("North and South", "Elizabeth Gaskell"), ("Mansfield Park", "Jane Austen"), ("The Goldfinch", "Donna Tartt"),
        ("Brideshead Revisited", "Evelyn Waugh"), ("War and Peace", "Leo Tolstoy"), ("Middlemarch", "George Eliot"),
    ]),
}


def ensure_seed() -> None:
    """Demo reader (id 1, owns the seed library) + two demo friends with small shelves."""
    with library.db() as con:
        if con.execute("SELECT COUNT(*) FROM users").fetchone()[0]:
            return
    # look up covers BEFORE opening the write transaction (the cover cache writes to the same DB)
    metas = {}
    if os.getenv("SEED_COVERS", "1") == "1":
        for _, (_, _, books) in DEMO_FRIENDS.items():
            for title, author in books:
                metas[title] = (library.ol_search(title=title, author=author.split()[-1], limit=1) or [{}])[0]
    with library.db() as con:
        con.execute("INSERT INTO users(id, username, display_name, pw_hash, friend_code, bio, reader_type) VALUES (1,?,?,?,?,?,?)",
                    ("reader", "The Reader", hash_password("reader-demo"), "READER", "The demo collection.", "collector"))
        for i, (username, (name, bio, books)) in enumerate(DEMO_FRIENDS.items()):
            cur = con.execute("INSERT INTO users(username, display_name, pw_hash, friend_code, bio, reader_type) VALUES (?,?,?,?,?,?)",
                              (username, name, hash_password(secrets.token_hex(12)), username.upper().ljust(6, "X")[:6], bio,
                               "wanderer" if username == "sam" else "scholar"))
            fid = int(cur.lastrowid)
            for pos, (title, author) in enumerate(books):
                meta = metas.get(title, {})
                library._insert_book(con, {"title": title, "author": author, "status": "owned", "position": pos,
                                           "user_id": fid, "cover_url": meta.get("cover_url"), "year": meta.get("year"),
                                           "pages": meta.get("pages"), "subjects": meta.get("subjects", []),
                                           "hours_read": 6 + (pos * 3) % 11})
            con.execute("INSERT OR IGNORE INTO friendships(user_id, friend_id) VALUES (1, ?)", (fid,))
            con.execute("INSERT OR IGNORE INTO friendships(user_id, friend_id) VALUES (?, 1)", (fid,))


# Demo friends' verdicts, so "what your friends thought" has something to show.
DEMO_VERDICTS = {
    "sam": {
        "The Name of the Wind": (4.75, "The best magic-school book that isn't the one you're thinking of."),
        "Mistborn": (4.25, "Heist crew, but the vault is a god."),
        "The Hobbit": (5, ""),
        "Klara and the Sun": (3.5, "Quiet and sad in the Ishiguro way. Slow middle."),
        "Jonathan Strange & Mr Norrell": (4.5, "Footnotes worth reading. If you liked Piranesi, yes."),
        "Harry Potter and the Goblet of Fire": (4.75, "Where the series grows up."),
        "The Return of the King": (4.5, ""),
        "A Wizard of Earthsea": (4, "Short, strange, perfect."),
        "Children of Dune": (3.25, "For completists. Leto II gets weird."),
    },
    "ada": {
        "Anna Karenina": (5, "The train, the haymaking, Levin. All of it."),
        "Villette": (4.25, "Darker and better than Jane Eyre, fight me."),
        "The Idiot": (3.75, ""),
        "North and South": (4.5, "Mr Thornton > Mr Darcy."),
        "Mansfield Park": (3.5, "Fanny is better than her reputation."),
        "The Goldfinch": (3.25, "Loved Boris, the last 100 pages lost me. Did not finish? Almost."),
        "Brideshead Revisited": (4.5, ""),
        "War and Peace": (0, "DNF at page 400. Will return. Probably."),
        "Middlemarch": (4.75, "Dorothea's last chapter made me cry on a train."),
        "Northanger Abbey": (4.5, "Austen laughing at gothic novels — the funniest one."),
    },
}


def ensure_demo_verdicts() -> None:
    """Give the demo friends ratings/reviews once (and Ada a copy of Northanger Abbey)."""
    with library.db() as con:
        for username, verdicts in DEMO_VERDICTS.items():
            u = con.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
            if not u:
                continue
            fid = u[0]
            if con.execute("SELECT COUNT(*) FROM books WHERE user_id=? AND rating IS NOT NULL", (fid,)).fetchone()[0]:
                continue
            have = {r[0] for r in con.execute("SELECT title FROM books WHERE user_id=?", (fid,))}
            for title, (rating, review) in verdicts.items():
                if title not in have:
                    author = {"Northanger Abbey": "Jane Austen", "Children of Dune": "Frank Herbert"}.get(title)
                    if not author:
                        continue
                    library._insert_book(con, {"title": title, "author": author, "status": "owned", "user_id": fid,
                                               "cover_url": None, "position": 99})
                con.execute("UPDATE books SET rating=?, review=?, read_state=? WHERE user_id=? AND title=?",
                            (rating or None, review or None, "dnf" if rating == 0 else "read", fid, title))


def friend_verdicts(items: list[dict], user_id: int) -> list[list[dict]]:
    """For each {title, author}, what your friends rated it (plain code, $0)."""
    ids = [f["id"] for f in friends(user_id)]
    if not ids:
        return [[] for _ in items]
    with library.db() as con:
        rows = con.execute(
            f"SELECT b.title, b.author, b.rating, b.review, b.read_state, u.display_name, u.id FROM books b "
            f"JOIN users u ON u.id=b.user_id WHERE b.user_id IN ({','.join('?' * len(ids))}) "
            f"AND (b.rating IS NOT NULL OR b.read_state='dnf' OR (b.review IS NOT NULL AND b.review!=''))", ids).fetchall()
    out = []
    for it in items:
        hits = []
        for t, a, rating, review, state, name, fid in rows:
            if library.similarity(it.get("title", ""), it.get("author", ""), t, a) >= library.OWNED_THRESHOLD:
                hits.append({"friend": name, "friend_id": fid, "rating": rating, "review": review, "dnf": state == "dnf"})
        out.append(hits)
    return out
