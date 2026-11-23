"""Append-only audit trail (output/audit_trail.json).

Lesson from hw5: never rewrite the file from a failed read, and write atomically
under a lock so concurrent requests can't wipe history.
"""

from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime, timezone

from config import AUDIT_PATH

_LOCK = threading.Lock()


def append(entry: dict) -> None:
    entry = {"timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"), **entry}
    with _LOCK:
        AUDIT_PATH.parent.mkdir(parents=True, exist_ok=True)
        if AUDIT_PATH.exists():
            try:
                data = json.loads(AUDIT_PATH.read_text(encoding="utf-8") or "[]")
            except json.JSONDecodeError:
                # Don't destroy history: park the unreadable file and start a new one.
                AUDIT_PATH.rename(AUDIT_PATH.with_suffix(f".corrupt-{int(time.time())}.json"))
                data = []
        else:
            data = []
        data.append(entry)
        tmp = AUDIT_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, AUDIT_PATH)


def tail(n: int = 50) -> list[dict]:
    if not AUDIT_PATH.exists():
        return []
    try:
        return json.loads(AUDIT_PATH.read_text(encoding="utf-8"))[-n:]
    except json.JSONDecodeError:
        return []
