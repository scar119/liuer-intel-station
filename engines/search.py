#!/usr/bin/env python3
"""Full-text search over the liuer-intel-station SQLite database.

Usage:
    python search.py <db_path> <query> [limit] [offset]

Output:
    JSON object: {"items": [...], "has_more": bool, "offset": int, "mode": "fts"|"like"|"empty"}

    Each item has the same shape as the entries table plus a "body_hit" field:
      true if the query was NOT found in title+summary+source (meaning it matched in body).

Search strategy:
    - len(query) >= 3: FTS5 MATCH with trigram tokenizer, phrase search.
      Falls back to LIKE on OperationalError.
    - len(query) < 3:  LIKE on title/summary/source columns.
    - Empty query:     returns empty result set immediately.

Ordering:
    - FTS mode:  bm25(entry_fts) ascending (best match first).
    - LIKE mode: published_ts DESC (newest first).

Uses only Python stdlib.
"""

import json
import sqlite3
import sys


def _escape_fts_phrase(query: str) -> str:
    """Wrap query in double quotes for FTS5 phrase search, escaping internal quotes."""
    escaped = query.replace('"', '""')
    return f'"{escaped}"'


def _row_to_item(row: sqlite3.Row, query_lower: str, mode: str) -> dict:
    """Convert a database row to an item dict with body_hit field."""
    item = dict(row)

    # Determine body_hit: true if query not found in title+summary+source
    if mode == "empty":
        item["body_hit"] = False
    else:
        title = (item.get("title") or "").lower()
        summary = (item.get("summary") or "").lower()
        source = (item.get("source") or "").lower()
        combined = f"{title} {summary} {source}"
        item["body_hit"] = query_lower not in combined

    return item


def search_fts(conn: sqlite3.Connection, query: str, limit: int, offset: int) -> dict:
    """Perform FTS5 phrase search with trigram tokenizer."""
    phrase = _escape_fts_phrase(query)
    query_lower = query.lower()

    # Count total matches for has_more
    count_sql = """
        SELECT COUNT(*)
        FROM entry_fts
        WHERE entry_fts MATCH ?
    """
    try:
        total = conn.execute(count_sql, (phrase,)).fetchone()[0]
    except sqlite3.OperationalError:
        return None  # Signal fallback to LIKE

    has_more = (offset + limit) < total

    # Fetch page with bm25 ranking
    fetch_sql = """
        SELECT e.id, e.feed_id, e.title, e.link, e.source,
               e.published_ts, e.published_at, e.summary, e.body,
               e.read, e.starred, e.indexed_at
        FROM entry_fts f
        JOIN entries e ON e.rowid = f.rowid
        WHERE entry_fts MATCH ?
        ORDER BY bm25(entry_fts)
        LIMIT ? OFFSET ?
    """
    try:
        rows = conn.execute(fetch_sql, (phrase, limit, offset)).fetchall()
    except sqlite3.OperationalError:
        return None  # Signal fallback to LIKE

    items = [_row_to_item(r, query_lower, "fts") for r in rows]
    return {"items": items, "has_more": has_more, "offset": offset, "mode": "fts"}


def search_like(conn: sqlite3.Connection, query: str, limit: int, offset: int) -> dict:
    """Perform LIKE search on title/summary/source, ordered by published_ts DESC."""
    pattern = f"%{query}%"
    query_lower = query.lower()

    where = "(e.title LIKE ? OR e.summary LIKE ? OR e.source LIKE ?)"

    # Count total matches
    count_sql = f"SELECT COUNT(*) FROM entries e WHERE {where}"
    total = conn.execute(count_sql, (pattern, pattern, pattern)).fetchone()[0]
    has_more = (offset + limit) < total

    # Fetch page
    fetch_sql = f"""
        SELECT e.id, e.feed_id, e.title, e.link, e.source,
               e.published_ts, e.published_at, e.summary, e.body,
               e.read, e.starred, e.indexed_at
        FROM entries e
        WHERE {where}
        ORDER BY e.published_ts DESC
        LIMIT ? OFFSET ?
    """
    rows = conn.execute(fetch_sql, (pattern, pattern, pattern, limit, offset)).fetchall()

    items = [_row_to_item(r, query_lower, "like") for r in rows]
    return {"items": items, "has_more": has_more, "offset": offset, "mode": "like"}


def do_search(db_path: str, query: str, limit: int, offset: int) -> dict:
    """Main search dispatcher."""
    # Empty query → immediate empty result
    if not query or not query.strip():
        return {"items": [], "has_more": False, "offset": offset, "mode": "empty"}

    query = query.strip()

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA busy_timeout=5000")

        if len(query) >= 3:
            # Try FTS5 first
            result = search_fts(conn, query, limit, offset)
            if result is not None:
                return result
            # FTS failed → fall back to LIKE
            return search_like(conn, query, limit, offset)
        else:
            # Short query → LIKE only
            return search_like(conn, query, limit, offset)
    finally:
        conn.close()


def main() -> None:
    if len(sys.argv) < 3:
        print(
            f"Usage: {sys.argv[0]} <db_path> <query> [limit] [offset]",
            file=sys.stderr,
        )
        sys.exit(1)

    db_path = sys.argv[1]
    query = sys.argv[2]
    limit = int(sys.argv[3]) if len(sys.argv) > 3 else 40
    offset = int(sys.argv[4]) if len(sys.argv) > 4 else 0

    result = do_search(db_path, query, limit, offset)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
