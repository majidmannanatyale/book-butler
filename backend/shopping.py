"""Where to find a book you don't own — honestly.

- Search links at reputable retailers + libraries (no prices are invented: live
  retailer prices need registered API keys, which this project doesn't use).
- Bookshops near you from OpenStreetMap (Overpass API, free, no key).
- "Possibly valuable" flags come from the scouts (see scouts.py) and link to
  AbeBooks' rare-book listings so the user can check real asking prices.
"""

from __future__ import annotations

import math
from urllib.parse import quote_plus

import httpx

import library

HEADERS = {"User-Agent": "BookFinderClassProject/0.1 (educational demo)"}


def where_to_buy(title: str, author: str = "", isbn: str = "") -> list[dict]:
    q = quote_plus(f"{title} {author}".strip())
    key = quote_plus(isbn) if isbn else q
    return [
        {"name": "Bookshop.org", "kind": "new · supports indie shops", "url": f"https://bookshop.org/search?keywords={key}"},
        {"name": "Barnes & Noble", "kind": "new", "url": f"https://www.barnesandnoble.com/s/{key}"},
        {"name": "Amazon", "kind": "new & used", "url": f"https://www.amazon.com/s?k={key}&i=stripbooks"},
        {"name": "AbeBooks", "kind": "used, rare & first editions",
         "url": f"https://www.abebooks.com/servlet/SearchResults?kn={q}&sortby=17"},
        {"name": "Libby / your library", "kind": "borrow free", "url": f"https://libbyapp.com/search/{quote_plus(title)}"},
        {"name": "WorldCat", "kind": "find it in a library near you", "url": f"https://search.worldcat.org/search?q={q}"},
    ]


def _km(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def nearby_bookshops(lat: float, lon: float, radius_deg: float = 0.06) -> list[dict]:
    """Bookshops + libraries near you from OpenStreetMap (Nominatim search; free, no key).

    Location is rounded to ~1 km before it is used or cached. Nominatim's fair-use
    policy is respected: a few queries, 1 s apart, and results cached per area for a week.
    """
    import time as _t
    lat_r, lon_r = round(lat, 2), round(lon, 2)
    key = f"shops2|{lat_r}|{lon_r}"
    cached = library._cache_get(key, max_age=7 * 86400)
    if cached is None:
        box = f"{lon_r - radius_deg},{lat_r + radius_deg},{lon_r + radius_deg},{lat_r - radius_deg}"
        found: dict[str, dict] = {}
        for i, q in enumerate(["[shop=books]", "bookstore", "books", "library"]):
            if i:
                _t.sleep(1.05)
            try:
                r = httpx.get("https://nominatim.openstreetmap.org/search", headers=HEADERS, timeout=12, params={
                    "q": q, "format": "jsonv2", "limit": 15, "bounded": 1, "viewbox": box, "addressdetails": 1})
                r.raise_for_status()
                rows = r.json()
            except httpx.HTTPError:
                continue
            for x in rows:
                cat, typ, name = x.get("category"), x.get("type"), x.get("name") or ""
                if not name or not ((cat == "shop" and typ == "books") or (cat == "amenity" and typ == "library")
                                    or "book" in name.lower()):
                    continue
                a = x.get("address") or {}
                addr = " ".join(v for v in (a.get("house_number"), a.get("road"), a.get("city") or a.get("town")) if v)
                found[name] = {"name": name, "kind": "library" if typ == "library" else "bookshop",
                               "lat": float(x["lat"]), "lon": float(x["lon"]), "address": addr}
        cached = list(found.values())
        library._cache_put(key, cached)
    out = []
    for s_ in cached:
        out.append({**s_, "km": round(_km(lat, lon, s_["lat"], s_["lon"]), 1),
                    "maps": f"https://www.google.com/maps/search/?api=1&query={s_['lat']},{s_['lon']}"})
    return sorted(out, key=lambda s_: (s_["kind"] != "bookshop", s_["km"]))[:12]
