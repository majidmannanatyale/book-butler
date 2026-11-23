"""App-wide settings.

.env lookup follows the course rule: this repo folder first, then the folder
above it (where the teaching staff keep their .env). Nearest file wins.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")

ROOT = Path(__file__).resolve().parents[1]          # book_app/
for folder in (ROOT, ROOT.parent):
    if (folder / ".env").exists():
        load_dotenv(folder / ".env", override=False)

# The one place the product name lives (still a placeholder).
APP_NAME = os.getenv("APP_NAME", "Working Title")

MODEL_NAME = os.getenv("OPENAI_MODEL", "gpt-6-luna")
PORTKEY_BASE_URL = os.getenv("PORTKEY_BASE_URL", "https://api.portkey.ai/v1").rstrip("/")

DATA_DIR = ROOT / "data"
DB_PATH = Path(os.getenv("LIBRARY_DB", DATA_DIR / "library.db"))
SEED_PATH = DATA_DIR / "seed_library.json"
OUTPUT_DIR = ROOT / "output"
AUDIT_PATH = OUTPUT_DIR / "audit_trail.json"

# USD per 1M tokens (Lecture 11, "Cached Token Cost" slide).
PRICES = {
    "gpt-6-luna": {"input": 0.10, "cached": 0.01, "cache_write": 0.125, "output": 0.50},
}

# Guard rails (token responsibility).
DAILY_BUDGET_USD = float(os.getenv("DAILY_BUDGET_USD", "0.50"))
SCAN_IMAGE_MAX_PX = 1280          # longest side sent to the vision model
SCAN_MAX_BYTES = 6_000_000        # refuse bigger uploads
MAX_CANDIDATES_FOR_CURATOR = 12
MAX_PICKS = 5
SCAN_CACHE_HAMMING = 6            # dHash distance that counts as "same shelf"
SCANS_PER_MINUTE = 6              # per client IP


def price_of(model: str) -> dict[str, float]:
    return PRICES.get(model, PRICES["gpt-6-luna"])
