"""Build data/seed_library.json — the small demo library graders start with.

The hand-written list below holds only what a collector would know off the
shelf (title, author, binding, edition, height). Real metadata (ISBN, cover,
subjects, pages) is filled in from Open Library, never invented.

    python backend/build_seed.py
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from config import SEED_PATH  # noqa: E402
import library  # noqa: E402

# title, author, binding, edition, height_cm, extras
SHELF = [
    ("Pride and Prejudice", "Jane Austen", "clothbound", "Penguin Clothbound Classics", 19.8, {"favourite": True, "hours_read": 11}),
    ("Emma", "Jane Austen", "clothbound", "Penguin Clothbound Classics", 19.8, {"hours_read": 13}),
    ("Persuasion", "Jane Austen", "clothbound", "Penguin Clothbound Classics", 19.8, {"hours_read": 8}),
    ("Sense and Sensibility", "Jane Austen", "clothbound", "Penguin Clothbound Classics", 19.8, {"hours_read": 10}),
    ("Jane Eyre", "Charlotte Brontë", "clothbound", "Penguin Clothbound Classics", 19.8, {"favourite": True, "hours_read": 14}),
    ("Wuthering Heights", "Emily Brontë", "clothbound", "Penguin Clothbound Classics", 19.8, {"hours_read": 10}),
    ("Middlemarch", "George Eliot", "clothbound", "Penguin Clothbound Classics", 19.8, {"reading": True, "progress": 0.42, "hours_read": 9}),
    ("The Picture of Dorian Gray", "Oscar Wilde", "clothbound", "Penguin Clothbound Classics", 19.8, {"hours_read": 6}),
    ("Frankenstein", "Mary Shelley", "clothbound", "Penguin Clothbound Classics", 19.8, {"hours_read": 6}),
    ("Crime and Punishment", "Fyodor Dostoevsky", "paperback", "Penguin Classics", 19.8, {"favourite": True, "hours_read": 20}),
    ("The Brothers Karamazov", "Fyodor Dostoevsky", "paperback", "Penguin Classics", 19.8, {"hours_read": 26}),
    ("Rebecca", "Daphne du Maurier", "paperback", "Virago Modern Classics", 19.8, {"hours_read": 10}),
    ("The Secret History", "Donna Tartt", "paperback", "Penguin", 19.8, {"favourite": True, "hours_read": 15}),
    ("Stoner", "John Williams", "paperback", "NYRB Classics", 20.3, {"hours_read": 8}),
    ("The Remains of the Day", "Kazuo Ishiguro", "paperback", "Faber & Faber", 19.8, {"hours_read": 7}),
    ("Never Let Me Go", "Kazuo Ishiguro", "paperback", "Faber & Faber", 19.8, {"hours_read": 8}),
    ("Norwegian Wood", "Haruki Murakami", "paperback", "Vintage", 19.8, {"hours_read": 9}),
    ("Kafka on the Shore", "Haruki Murakami", "paperback", "Vintage", 19.8, {"reading": True, "progress": 0.18, "hours_read": 3}),
    ("One Hundred Years of Solitude", "Gabriel García Márquez", "paperback", "Penguin Modern Classics", 19.8, {"hours_read": 14}),
    ("The Name of the Rose", "Umberto Eco", "paperback", "Vintage", 19.8, {"hours_read": 18}),
    ("Piranesi", "Susanna Clarke", "hardcover", "Bloomsbury first edition", 22.2, {"favourite": True, "hours_read": 7}),
    ("The Great Gatsby", "F. Scott Fitzgerald", "hardcover", "Folio Society", 22.5, {"hours_read": 4}),
    ("Harry Potter and the Philosopher's Stone", "J.K. Rowling", "hardcover", "Bloomsbury", 20.0, {"hours_read": 7}),
    ("Harry Potter and the Chamber of Secrets", "J.K. Rowling", "hardcover", "Bloomsbury", 20.0, {"hours_read": 8}),
    ("Harry Potter and the Prisoner of Azkaban", "J.K. Rowling", "hardcover", "Bloomsbury", 20.0, {"hours_read": 10}),
    ("Harry Potter and the Order of the Phoenix", "J.K. Rowling", "hardcover", "Bloomsbury", 20.0, {"hours_read": 19}),
    ("The Fellowship of the Ring", "J.R.R. Tolkien", "hardcover", "HarperCollins", 22.0, {"hours_read": 16}),
    ("The Two Towers", "J.R.R. Tolkien", "hardcover", "HarperCollins", 22.0, {"hours_read": 14}),
    ("Dune", "Frank Herbert", "paperback", "Hodder", 19.8, {"hours_read": 21}),
    ("My Brilliant Friend", "Elena Ferrante", "paperback", "Europa Editions", 21.0, {"hours_read": 12}),
    ("The Story of a New Name", "Elena Ferrante", "paperback", "Europa Editions", 21.0, {"hours_read": 14}),
]

COLLECTIONS = [
    {"name": "Harry Potter", "author": "J.K. Rowling", "members": [
        "Harry Potter and the Philosopher's Stone", "Harry Potter and the Chamber of Secrets",
        "Harry Potter and the Prisoner of Azkaban", "Harry Potter and the Goblet of Fire",
        "Harry Potter and the Order of the Phoenix", "Harry Potter and the Half-Blood Prince",
        "Harry Potter and the Deathly Hallows"]},
    {"name": "Jane Austen's six novels", "author": "Jane Austen", "members": [
        "Sense and Sensibility", "Pride and Prejudice", "Mansfield Park", "Emma",
        "Northanger Abbey", "Persuasion"]},
    {"name": "The Lord of the Rings", "author": "J.R.R. Tolkien", "members": [
        "The Fellowship of the Ring", "The Two Towers", "The Return of the King"]},
    {"name": "Dune Chronicles", "author": "Frank Herbert", "members": [
        "Dune", "Dune Messiah", "Children of Dune", "God Emperor of Dune"]},
    {"name": "Neapolitan Novels", "author": "Elena Ferrante", "members": [
        "My Brilliant Friend", "The Story of a New Name", "Those Who Leave and Those Who Stay",
        "The Story of the Lost Child"]},
    {"name": "Penguin Clothbound Classics (Brontës)", "author": "Anne Brontë", "members": [
        "Agnes Grey", "The Tenant of Wildfell Hall"]},
]


def series_of(title: str) -> tuple[str | None, int | None]:
    for c in COLLECTIONS:
        for i, m in enumerate(c["members"], 1):
            if library.norm(m) == library.norm(title):
                return c["name"], i
    return None, None


def main() -> None:
    library.init_db()   # creates tables + ol_cache for the lookups
    books = []
    for title, author, binding, edition, height, extra in SHELF:
        hits = library.ol_search(title=title, author=author.split()[-1], limit=3) \
            or library.ol_search(q=f"{title} {author}", limit=3)
        hit = next((h for h in hits if library.similarity(title, author, h["title"] or "", h["author"]) > 0.8),
                   hits[0] if hits else {})
        coll, idx = series_of(title)
        book = {
            "title": title, "author": author, "binding": binding, "edition": edition, "height_cm": height,
            # isbn left empty: your own edition gets scanned later (OL's first ISBN is a random edition)
            "year": hit.get("year"), "isbn": None, "pages": hit.get("pages"),
            "publisher": edition.split(" ")[0] if edition else hit.get("publisher"),
            "cover_url": hit.get("cover_url"), "subjects": hit.get("subjects", []),
            "collection": coll, "series_index": idx, "status": "owned", **extra,
        }
        books.append(book)
        print(f"{'ok ' if hit else 'MISS'} {title} -> cover={'y' if book['cover_url'] else 'n'} isbn={book['isbn']}")
        time.sleep(0.3)   # be polite to Open Library
    SEED_PATH.write_text(json.dumps({"books": books, "collections": COLLECTIONS}, indent=2, ensure_ascii=False),
                         encoding="utf-8")
    print(f"wrote {SEED_PATH} ({len(books)} books)")


if __name__ == "__main__":
    main()
