"""A ready-made tester account: 150 books with covers, series (some with gaps), favourites,
books in progress, a to-be-read pile, a wishlist, ratings and reviews, friends, and marble busts.

    python seed_tester.py            # (re)build the account; safe to run again
    python seed_tester.py --no-busts # skip the busts (they are the only part that calls the AI)

Login:  booktester / butler-test-2026

Everything except the busts is plain code and free: covers, years and page counts come from
Open Library. The busts go through the app's own /api/characters endpoint (one cached luna call
per book), so they are metered and logged in the audit trail like any other request.
"""
from __future__ import annotations

import json
import sys
from datetime import date, timedelta

import accounts
import library
import textures

USERNAME, PASSWORD, NAME = "booktester", "butler-test-2026", "Book Tester"
API = "http://127.0.0.1:8020"

# (title, author, extras). Extras: fav, reading (progress), tbr, rating, review, dnf, note,
# hours, edition, binding, height
SERIES = {
    "Red Rising Saga": ("Pierce Brown", ["Red Rising", "Golden Son", "Morning Star", "Iron Gold", "Dark Age", "Light Bringer"]),
    "Dungeon Crawler Carl": ("Matt Dinniman", ["Dungeon Crawler Carl", "Carl's Doomsday Scenario", "The Dungeon Anarchist's Cookbook",
                                               "The Gate of the Feral Gods", "The Butcher's Masquerade", "The Eye of the Bedlam Bride",
                                               "This Inevitable Ruin"]),
    "The Hunger Games": ("Suzanne Collins", ["The Hunger Games", "Catching Fire", "Mockingjay"]),
    "Mistborn": ("Brandon Sanderson", ["The Final Empire", "The Well of Ascension", "The Hero of Ages"]),
    "The Stormlight Archive": ("Brandon Sanderson", ["The Way of Kings", "Words of Radiance", "Oathbringer", "Rhythm of War", "Wind and Truth"]),
    "The Kingkiller Chronicle": ("Patrick Rothfuss", ["The Name of the Wind", "The Wise Man's Fear"]),
    "Remembrance of Earth's Past": ("Cixin Liu", ["The Three-Body Problem", "The Dark Forest", "Death's End"]),
    "The Murderbot Diaries": ("Martha Wells", ["All Systems Red", "Artificial Condition", "Rogue Protocol", "Exit Strategy"]),
}
# not on the shelf: gaps the app should spot ("To find")
SKIP = {"Light Bringer", "This Inevitable Ruin", "Wind and Truth", "Rogue Protocol", "Exit Strategy", "God Emperor of Dune"}
EXISTING_SERIES = {   # collections the app already knows
    "Harry Potter": "J.K. Rowling", "The Lord of the Rings": "J.R.R. Tolkien",
    "Dune Chronicles": "Frank Herbert", "Jane Austen's six novels": "Jane Austen",
}

X = {
    # --- Red Rising
    "Red Rising": dict(fav=1, rating=5, review="Break the chains. Darrow's first carve still gives me chills.", hours=11),
    "Golden Son": dict(fav=1, rating=5, review="The best middle book I have read. That ending!", hours=13),
    "Morning Star": dict(fav=1, rating=4.75, review="Howlers forever.", hours=14),
    "Iron Gold": dict(rating=4, review="Slower start, four narrators, worth it.", hours=15),
    "Dark Age": dict(reading=0.42),
    # --- Dungeon Crawler Carl
    "Dungeon Crawler Carl": dict(fav=1, rating=4.75, review="Princess Donut is the best character in fiction. Fight me.", hours=12),
    "Carl's Doomsday Scenario": dict(rating=4.5, hours=11),
    "The Dungeon Anarchist's Cookbook": dict(rating=4.5, review="Mordecai deserves better.", hours=13),
    "The Gate of the Feral Gods": dict(rating=4.25, hours=13),
    "The Butcher's Masquerade": dict(rating=5, review="Funniest and saddest of the lot.", hours=16),
    "The Eye of the Bedlam Bride": dict(reading=0.63),
    # --- Harry Potter (the whole set, in Bloomsbury hardback)
    "Harry Potter and the Philosopher's Stone": dict(rating=4.5, hours=8, edition="Bloomsbury first edition (reprint)", binding="hardcover"),
    "Harry Potter and the Chamber of Secrets": dict(rating=4, hours=8, binding="hardcover"),
    "Harry Potter and the Prisoner of Azkaban": dict(fav=1, rating=5, review="Time-turners, Lupin, Buckbeak. Peak Hogwarts.", hours=10, binding="hardcover"),
    "Harry Potter and the Goblet of Fire": dict(rating=4.5, hours=14, binding="hardcover"),
    "Harry Potter and the Order of the Phoenix": dict(rating=4, review="Umbridge is the real villain.", hours=19, binding="hardcover"),
    "Harry Potter and the Half-Blood Prince": dict(rating=4.5, hours=14, binding="hardcover"),
    "Harry Potter and the Deathly Hallows": dict(rating=4.75, hours=16, binding="hardcover"),
    # --- Tolkien (Folio Society leather)
    "The Hobbit": dict(rating=4.75, hours=9, edition="Folio Society", binding="leather"),
    "The Fellowship of the Ring": dict(fav=1, rating=5, review="Not all those who wander are lost.", hours=17, edition="Folio Society", binding="leather"),
    "The Two Towers": dict(rating=4.5, hours=15, edition="Folio Society", binding="leather"),
    "The Return of the King": dict(rating=5, hours=16, edition="Folio Society", binding="leather"),
    "The Silmarillion": dict(tbr=1, edition="Folio Society", binding="leather"),
    # --- Dune
    "Dune": dict(rating=4.75, review="The spice must flow.", hours=20),
    "Dune Messiah": dict(rating=3.75, hours=8),
    "Children of Dune": dict(tbr=1),
    # --- Austen in Penguin clothbound
    **{t: dict(edition="Penguin Clothbound Classics", binding="clothbound", height=19.8) for t in
       ["Sense and Sensibility", "Pride and Prejudice", "Mansfield Park", "Emma", "Northanger Abbey", "Persuasion"]},
    # --- others in series
    "The Way of Kings": dict(rating=4.75, hours=40), "Words of Radiance": dict(rating=5, review="Bridge Four!", hours=42),
    "Oathbringer": dict(rating=4.25, hours=45), "Rhythm of War": dict(reading=0.35),
    "The Name of the Wind": dict(fav=1, rating=4.75, review="Gorgeous prose. Still waiting for book three.", hours=24),
    "The Wise Man's Fear": dict(rating=4, hours=30),
    "The Three-Body Problem": dict(rating=4.25, hours=12), "The Dark Forest": dict(rating=5, review="The best idea in sci-fi this century.", hours=17),
    "Death's End": dict(tbr=1),
    "All Systems Red": dict(rating=4.5, review="Murderbot just wants to watch its shows. Relatable.", hours=3),
    "Artificial Condition": dict(rating=4.25, hours=3),
    "The Hunger Games": dict(rating=4.25, hours=7), "Catching Fire": dict(rating=4.5, hours=8), "Mockingjay": dict(rating=3.5, hours=8),
    "The Final Empire": dict(rating=4.5, hours=18), "The Well of Ascension": dict(rating=4, hours=20), "The Hero of Ages": dict(rating=4.75, hours=20),
}

AI_BOOKS = [
    ("Artificial Intelligence: A Modern Approach", "Stuart Russell", dict(reading=0.18, height=26, binding="hardcover", note="The course textbook. Chapter 2 on agents is the whole app in miniature.")),
    ("Co-Intelligence", "Ethan Mollick", dict(fav=1, rating=4.5, review="The friendliest way into working with AI.", hours=5)),
    ("Life 3.0", "Max Tegmark", dict(rating=4, hours=9)),
    ("Superintelligence", "Nick Bostrom", dict(rating=3.75, review="Dense but important.", hours=12)),
    ("Human Compatible", "Stuart Russell", dict(rating=4.25, hours=8)),
    ("The Alignment Problem", "Brian Christian", dict(rating=4.5, hours=11)),
    ("Prediction Machines", "Ajay Agrawal", dict(rating=4.25, review="AI makes prediction cheap. Everything follows from that.", hours=6)),
    ("Power and Prediction", "Ajay Agrawal", dict(rating=4, hours=6)),
    ("Deep Learning", "Ian Goodfellow", dict(height=23.5, binding="hardcover")),
    ("The Master Algorithm", "Pedro Domingos", dict(rating=3.5, hours=9)),
    ("AI Superpowers", "Kai-Fu Lee", dict(rating=4, hours=7)),
    ("Atlas of AI", "Kate Crawford", dict(tbr=1)),
    ("Weapons of Math Destruction", "Cathy O'Neil", dict(rating=4.25, hours=6)),
    ("Competing in the Age of AI", "Marco Iansiti", dict(rating=4, hours=7)),
    ("The Coming Wave", "Mustafa Suleyman", dict(tbr=1)),
    ("Genius Makers", "Cade Metz", dict(rating=4.25, hours=10)),
    ("Thinking, Fast and Slow", "Daniel Kahneman", dict(rating=4.5, hours=14)),
    ("The Innovator's Dilemma", "Clayton M. Christensen", dict(rating=4.25, hours=8)),
    ("Zero to One", "Peter Thiel", dict(rating=3.5, hours=4)),
    ("Good Strategy Bad Strategy", "Richard Rumelt", dict(rating=4.5, review="Strategy is a diagnosis, a guiding policy and coherent action.", hours=8)),
    ("The Lean Startup", "Eric Ries", dict(rating=3.75, hours=6)),
    ("Gödel, Escher, Bach", "Douglas R. Hofstadter", dict(rating=4.5, hours=40, note="This note is about itself.")),
]

# Easter eggs: look in the notes, the hours read, and ask the Librarian about them.
EGGS = [
    ("The Hitchhiker's Guide to the Galaxy", "Douglas Adams", dict(fav=1, rating=5, hours=42, review="Don't panic.", note="The answer is 42. Ask the Librarian what the question was.")),
    ("The Remains of the Day", "Kazuo Ishiguro", dict(fav=1, rating=5, hours=7, note="Required reading for any butler. Signed, Alfred.")),
    ("Right Ho, Jeeves", "P.G. Wodehouse", dict(rating=4.5, hours=5, note="Jeeves would approve of the Book Butler.")),
    ("Batman: Year One", "Frank Miller", dict(rating=4, hours=1, note="Every good butler is called Alfred.")),
    ("Ready Player One", "Ernest Cline", dict(rating=3.75, hours=10, note="You found an egg! Now point the AR Finder at this one.")),
    ("Do Androids Dream of Electric Sheep?", "Philip K. Dick", dict(rating=4.25, hours=5)),
    ("I, Robot", "Isaac Asimov", dict(rating=4, hours=6, note="A robot may not injure a human being or, through inaction, allow a human being to come to harm.")),
    ("Frankenstein", "Mary Shelley", dict(rating=4.25, hours=7, note="The first story about making something smarter than you. It did not go well.")),
    ("Klara and the Sun", "Kazuo Ishiguro", dict(rating=4, hours=8)),
    ("The Name of the Rose", "Umberto Eco", dict(rating=4.5, hours=18, note="A murder mystery inside a library. Stay out of the Finis Africae.")),
    ("The Shadow of the Wind", "Carlos Ruiz Zafón", dict(fav=1, rating=4.75, hours=14, note="From the Cemetery of Forgotten Books: adopt one book and keep it alive.")),
    ("Fahrenheit 451", "Ray Bradbury", dict(rating=4.25, hours=4.51, note="The temperature at which book paper catches fire. Not on this shelf.")),
    ("Ulysses", "James Joyce", dict(dnf=1, review="Did not finish. Stopped somewhere in Bloomsday.")),
]

CLASSICS = [
    ("Nineteen Eighty-Four", "George Orwell"), ("Animal Farm", "George Orwell"), ("Brave New World", "Aldous Huxley"),
    ("To Kill a Mockingbird", "Harper Lee"), ("The Great Gatsby", "F. Scott Fitzgerald"), ("Moby-Dick", "Herman Melville"),
    ("Jane Eyre", "Charlotte Brontë"), ("Wuthering Heights", "Emily Brontë"), ("Great Expectations", "Charles Dickens"),
    ("A Tale of Two Cities", "Charles Dickens"), ("Crime and Punishment", "Fyodor Dostoevsky"),
    ("The Brothers Karamazov", "Fyodor Dostoevsky"), ("Anna Karenina", "Leo Tolstoy"), ("War and Peace", "Leo Tolstoy"),
    ("Middlemarch", "George Eliot"), ("One Hundred Years of Solitude", "Gabriel García Márquez"),
    ("The Count of Monte Cristo", "Alexandre Dumas"), ("Les Misérables", "Victor Hugo"), ("Don Quixote", "Miguel de Cervantes"),
    ("The Odyssey", "Homer"), ("Beloved", "Toni Morrison"), ("The Catcher in the Rye", "J.D. Salinger"),
    ("Lord of the Flies", "William Golding"), ("Of Mice and Men", "John Steinbeck"), ("The Grapes of Wrath", "John Steinbeck"),
    ("Slaughterhouse-Five", "Kurt Vonnegut"), ("Catch-22", "Joseph Heller"), ("The Handmaid's Tale", "Margaret Atwood"),
    ("Never Let Me Go", "Kazuo Ishiguro"), ("The Road", "Cormac McCarthy"), ("Life of Pi", "Yann Martel"),
    ("The Kite Runner", "Khaled Hosseini"), ("The Book Thief", "Markus Zusak"), ("The Night Circus", "Erin Morgenstern"),
    ("Circe", "Madeline Miller"), ("The Song of Achilles", "Madeline Miller"), ("Piranesi", "Susanna Clarke"),
    ("Jonathan Strange & Mr Norrell", "Susanna Clarke"), ("The Goldfinch", "Donna Tartt"), ("The Secret History", "Donna Tartt"),
    ("Normal People", "Sally Rooney"), ("Pachinko", "Min Jin Lee"), ("Educated", "Tara Westover"),
    ("Sapiens", "Yuval Noah Harari"), ("Atomic Habits", "James Clear"), ("The Midnight Library", "Matt Haig"),
    ("Tomorrow, and Tomorrow, and Tomorrow", "Gabrielle Zevin"), ("Station Eleven", "Emily St. John Mandel"),
    ("Neuromancer", "William Gibson"), ("Foundation", "Isaac Asimov"), ("Ender's Game", "Orson Scott Card"),
    ("The Left Hand of Darkness", "Ursula K. Le Guin"), ("A Wizard of Earthsea", "Ursula K. Le Guin"),
    ("American Gods", "Neil Gaiman"), ("Good Omens", "Terry Pratchett"), ("The Princess Bride", "William Goldman"),
    ("Project Hail Mary", "Andy Weir"), ("The Martian", "Andy Weir"), ("Rebecca", "Daphne du Maurier"), ("Dracula", "Bram Stoker"),
    ("Watership Down", "Richard Adams"), ("Coraline", "Neil Gaiman"), ("The Little Prince", "Antoine de Saint-Exupéry"),
    ("Kafka on the Shore", "Haruki Murakami"), ("Cloud Atlas", "David Mitchell"), ("Snow Crash", "Neal Stephenson"),
]
CLASSIC_X = {
    "Project Hail Mary": dict(fav=1, rating=5, review="Rocky! Amaze amaze amaze.", hours=11),
    "Piranesi": dict(fav=1, rating=4.75, review="The beauty of the House is immeasurable.", hours=5),
    "Moby-Dick": dict(tbr=1), "The Brothers Karamazov": dict(tbr=1), "War and Peace": dict(tbr=1), "Les Misérables": dict(tbr=1),
    "Nineteen Eighty-Four": dict(rating=4.5, hours=9), "The Great Gatsby": dict(rating=4, hours=4),
    "Circe": dict(rating=4.5, hours=10), "The Song of Achilles": dict(rating=4.25, hours=9),
    "The Secret History": dict(rating=4.5, hours=15), "Never Let Me Go": dict(rating=4.25, hours=8),
    "The Martian": dict(rating=4.5, hours=9), "Foundation": dict(rating=3.75, hours=7), "Neuromancer": dict(rating=3.5, hours=8),
    "Educated": dict(rating=4.5, hours=10), "Station Eleven": dict(rating=4.25, hours=8),
}

WISHLIST = [("Wind and Truth", "Brandon Sanderson"), ("The Doors of Stone", "Patrick Rothfuss"),
            ("Children of Time", "Adrian Tchaikovsky"), ("Nexus", "Yuval Noah Harari"),
            ("Empire of AI", "Karen Hao"), ("The Winds of Winter", "George R.R. Martin")]
WISH_NOTES = {"The Doors of Stone": "Any day now.", "The Winds of Winter": "Also any day now."}

BUSTS = [("Red Rising", "Pierce Brown"), ("Harry Potter and the Prisoner of Azkaban", "J.K. Rowling"),
         ("The Fellowship of the Ring", "J.R.R. Tolkien"), ("Dungeon Crawler Carl", "Matt Dinniman"),
         ("Dune", "Frank Herbert"), ("The Remains of the Day", "Kazuo Ishiguro")]


def owned_list() -> list[tuple[str, str, dict]]:
    out: list[tuple[str, str, dict]] = []
    for name, (author, titles) in SERIES.items():
        for i, t in enumerate(titles, 1):
            if t not in SKIP:
                out.append((t, author, {**X.get(t, {}), "collection": name, "series_index": i}))
    with library.db() as con:
        for name, author in EXISTING_SERIES.items():
            members = json.loads(con.execute("SELECT members FROM collections WHERE name=?", (name,)).fetchone()[0])
            extra = ["The Hobbit", "The Silmarillion"] if name == "The Lord of the Rings" else []
            for i, t in enumerate(members, 1):
                if t not in SKIP:
                    out.append((t, author, {**X.get(t, {}), "collection": name, "series_index": i}))
            out += [(t, author, X.get(t, {})) for t in extra]
    out += AI_BOOKS + EGGS + [(t, a, CLASSIC_X.get(t, {})) for t, a in CLASSICS]
    return out


def meta_for(title: str, author: str) -> dict:
    """Best Open Library match (cover, year, pages, subjects); {} if nothing close."""
    hits = library.ol_search(title=title, author=author.split()[-1], limit=5) or []
    best = max(hits, key=lambda h: (library.similarity(title, author, h.get("title") or "", h.get("author")),
                                    bool(h.get("cover_url"))), default=None)
    if not best or library.similarity(title, author, best.get("title") or "", best.get("author")) < 0.6:
        return {}
    return best


def build(busts: bool = True) -> None:
    books = owned_list()
    assert len(books) == 150, f"{len(books)} owned books, expected 150"
    print(f"looking up {len(books) + len(WISHLIST)} books on Open Library…", flush=True)
    metas = {t: meta_for(t, a) for t, a, _ in books + [(t, a, {}) for t, a in WISHLIST]}

    with library.db() as con:
        row = con.execute("SELECT id FROM users WHERE username=?", (USERNAME,)).fetchone()
    uid = row[0] if row else accounts.register(USERNAME, PASSWORD, NAME, "collector")["id"]
    with library.db() as con:
        for tbl in ("books", "decor"):
            con.execute(f"DELETE FROM {tbl} WHERE user_id=?", (uid,))
        con.execute("DELETE FROM friendships WHERE user_id=? OR friend_id=?", (uid, uid))
        con.execute("UPDATE users SET pw_hash=?, display_name=?, bio=?, reader_type='collector' WHERE id=?",
                    (accounts.hash_password(PASSWORD), NAME, "A sample library for testers: series, favourites, busts and a few easter eggs.", uid))
        for name, (author, titles) in SERIES.items():
            con.execute("INSERT OR REPLACE INTO collections(name, author, members) VALUES (?,?,?)", (name, author, json.dumps(titles)))
        today = date(2026, 11, 20)
        for pos, (title, author, x) in enumerate(books):
            m = metas.get(title) or {}
            read = x.get("rating") is not None or x.get("dnf")
            library._insert_book(con, {
                "user_id": uid, "title": title, "author": author, "status": "owned", "position": pos,
                "cover_url": m.get("cover_url"), "year": m.get("year"), "pages": m.get("pages"), "subjects": m.get("subjects") or [],
                "publisher": m.get("publisher"), "edition": x.get("edition"), "binding": x.get("binding") or "paperback",
                "height_cm": x.get("height"), "collection": x.get("collection"), "series_index": x.get("series_index"),
                "favourite": x.get("fav", 0), "reading": 1 if "reading" in x else 0, "progress": x.get("reading", 1.0 if read else 0),
                "tbr": x.get("tbr", 0), "hours_read": x.get("hours", 0), "notes": x.get("note"),
                "rating": x.get("rating"), "review": x.get("review"),
                "read_state": "dnf" if x.get("dnf") else ("read" if read else None),
                "finished_on": (today - timedelta(days=7 * pos % 700)).isoformat() if read and not x.get("dnf") else None,
            })
        for pos, (title, author) in enumerate(WISHLIST):
            m = metas.get(title) or {}
            library._insert_book(con, {"user_id": uid, "title": title, "author": author, "status": "wishlist", "position": pos,
                                       "cover_url": m.get("cover_url"), "year": m.get("year"), "pages": m.get("pages"),
                                       "notes": WISH_NOTES.get(title)})
        for friend in ("reader", "sam", "ada"):
            f = con.execute("SELECT id FROM users WHERE username=?", (friend,)).fetchone()
            if f:
                con.execute("INSERT OR IGNORE INTO friendships(user_id, friend_id) VALUES (?,?)", (uid, f[0]))
                con.execute("INSERT OR IGNORE INTO friendships(user_id, friend_id) VALUES (?,?)", (f[0], uid))

    covered = sum(1 for t, _, _ in books if (metas.get(t) or {}).get("cover_url"))
    print(f"user {uid}: 150 owned + {len(WISHLIST)} wishlist; {covered}/150 have an Open Library cover (the rest get a printed one)")
    with library.db() as con:
        rows = [dict(r) for r in con.execute("SELECT * FROM books WHERE user_id=?", (uid,))]
    print("covers cached on the server:", textures.prewarm(rows))
    if busts:
        add_busts(uid)


def add_busts(uid: int) -> None:
    """Through the running server, like the app does: metered, budget-capped and audited."""
    import httpx
    h = {"Authorization": f"Bearer {accounts.make_token(uid)}"}
    with library.db() as con:
        ids = {r[0]: r[1] for r in con.execute("SELECT title, id FROM books WHERE user_id=?", (uid,))}
    for title, author in BUSTS:
        r = httpx.get(f"{API}/api/characters", params={"title": title, "author": author}, headers=h, timeout=120)
        r.raise_for_status()
        cast = r.json().get("characters") or []
        if not cast:
            print("no characters for", title)
            continue
        d = httpx.post(f"{API}/api/decor", json={"book_id": ids.get(title), "book_title": title, "character": cast[0]}, headers=h, timeout=30)
        print("bust:", cast[0].get("name"), "from", title, d.status_code)


if __name__ == "__main__":
    build(busts="--no-busts" not in sys.argv)
