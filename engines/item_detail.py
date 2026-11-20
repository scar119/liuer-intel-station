#!/usr/bin/env python3
"""Return a single entry's full detail as JSON.

Usage:
    python item_detail.py <db_path> <entry_id>

Output:
    JSON object with all fields from the entries table, including the full body.
    If the entry is not found, outputs {"error": "not found"}.
"""

import json
import sqlite3
import sys


def get_entry_detail(db_path: str, entry_id: str) -> dict:
    """Query a single entry by id and return its full detail as a dict."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            "SELECT * FROM entries WHERE id=?", (entry_id,)
        ).fetchone()
        if row is None:
            return {"error": "not found"}
        return dict(row)
    finally:
        conn.close()


def main() -> None:
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <db_path> <entry_id>", file=sys.stderr)
        sys.exit(1)

    db_path = sys.argv[1]
    entry_id = sys.argv[2]

    result = get_entry_detail(db_path, entry_id)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
