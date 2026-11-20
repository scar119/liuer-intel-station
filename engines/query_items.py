#!/usr/bin/env python3
"""Query entries from the RSS reader SQLite database.

Usage:
    python query_items.py <db_path> [--view VIEW] [--limit N] [--offset N] \
                          [--channel CH] [--feed FEED] [--q QUERY]

Outputs JSON to stdout:
    {"items": [...], "has_more": bool, "offset": int, "mode": "fts"|"like"|"time"}
"""

import argparse
import json
import sqlite3
import sys
import time


def clamp(value: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, value))


def build_query(view: str, feed: str, q: str, limit: int, offset: int):
    """Return (sql, params, mode) for the requested query."""
    conditions = []
    params = []
    mode = "time"
    use_fts = False

    # View filter
    if view == "unread":
        conditions.append("e.read = 0")
    elif view == "starred":
        conditions.append("e.starred = 1")
    elif view == "hot":
        cutoff = int(time.time()) - 7 * 86400
        conditions.append("e.published_ts >= ?")
        params.append(cutoff)
    # "all" → no extra condition (1=1 implicit)

    # Feed filter
    if feed:
        conditions.append("e.source = ?")
        params.append(feed)

    # Search filter
    if q and len(q) >= 3:
        use_fts = True
        mode = "fts"
    elif q:
        mode = "like"
        like_pattern = f"%{q}%"
        conditions.append("(e.title LIKE ? OR e.summary LIKE ? OR e.source LIKE ?)")
        params.extend([like_pattern, like_pattern, like_pattern])

    where_clause = ""
    if conditions:
        where_clause = "WHERE " + " AND ".join(conditions)

    if use_fts:
        # FTS5 query: join entry_fts with entries, order by bm25
        sql = (
            "SELECT e.id, e.title, e.source, e.published_ts, e.published_at, "
            "e.summary, e.read, e.starred, e.link "
            "FROM entries e "
            "JOIN entry_fts f ON e.rowid = f.rowid "
            f"{where_clause} AND f.entry_fts MATCH ? "
            if conditions
            else "SELECT e.id, e.title, e.source, e.published_ts, e.published_at, "
            "e.summary, e.read, e.starred, e.link "
            "FROM entries e "
            "JOIN entry_fts f ON e.rowid = f.rowid "
            "WHERE f.entry_fts MATCH ? "
        )
        # If there were existing conditions, we appended with AND; fix the WHERE
        if conditions:
            # Rebuild: the last condition was added above with AND prefix
            # but we need to restructure. Let's rebuild cleanly.
            pass

        # Clean rebuild for FTS path
        fts_conditions = []
        fts_params = []

        if view == "unread":
            fts_conditions.append("e.read = 0")
        elif view == "starred":
            fts_conditions.append("e.starred = 1")
        elif view == "hot":
            cutoff = int(time.time()) - 7 * 86400
            fts_conditions.append("e.published_ts >= ?")
            fts_params.append(cutoff)

        if feed:
            fts_conditions.append("e.source = ?")
            fts_params.append(feed)

        fts_where = ""
        if fts_conditions:
            fts_where = "WHERE " + " AND ".join(fts_conditions) + " AND "
        else:
            fts_where = "WHERE "

        sql = (
            "SELECT e.id, e.title, e.source, e.published_ts, e.published_at, "
            "e.summary, e.read, e.starred, e.link "
            "FROM entries e "
            "JOIN entry_fts f ON e.rowid = f.rowid "
            f"{fts_where}f.entry_fts MATCH ? "
            "ORDER BY bm25(entry_fts) "
            "LIMIT ? OFFSET ?"
        )
        fts_params.append(q)
        fts_params.append(limit + 1)  # fetch one extra for has_more
        fts_params.append(offset)
        return sql, fts_params, mode

    # Non-FTS path
    order = "ORDER BY e.published_ts DESC"
    sql = (
        "SELECT e.id, e.title, e.source, e.published_ts, e.published_at, "
        "e.summary, e.read, e.starred, e.link "
        f"FROM entries e {where_clause} "
        f"{order} LIMIT ? OFFSET ?"
    )
    params.append(limit + 1)
    params.append(offset)
    return sql, params, mode


def truncate(text: str | None, max_len: int = 220) -> str:
    if not text:
        return ""
    if len(text) <= max_len:
        return text
    return text[:max_len]


def main():
    parser = argparse.ArgumentParser(description="Query RSS entries from SQLite")
    parser.add_argument("db_path", help="Path to SQLite database")
    parser.add_argument("--view", default="all", choices=["unread", "all", "starred", "hot"])
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--channel", default="", help="Channel filter (reserved)")
    parser.add_argument("--feed", default="", help="Filter by source/feed name")
    parser.add_argument("--q", default="", help="Search query")
    args = parser.parse_args()

    limit = clamp(args.limit, 1, 200)
    offset = max(0, args.offset)

    conn = sqlite3.connect(args.db_path)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA busy_timeout=5000")

        sql, params, mode = build_query(args.view, args.feed, args.q, limit, offset)
        rows = conn.execute(sql, params).fetchall()

        has_more = len(rows) > limit
        if has_more:
            rows = rows[:limit]

        items = []
        for row in rows:
            summary_text = truncate(row["summary"], 220)
            items.append({
                "id": row["id"],
                "title": row["title"] or "",
                "source": row["source"] or "",
                "published_ts": row["published_ts"],
                "published_at": row["published_at"] or "",
                "summary": summary_text,
                "read": row["read"],
                "starred": row["starred"],
                "link": row["link"] or "",
                "preview": summary_text,
            })

        result = {
            "items": items,
            "has_more": has_more,
            "offset": offset,
            "mode": mode,
        }
        json.dump(result, sys.stdout, ensure_ascii=False)
        print()  # trailing newline
    finally:
        conn.close()


if __name__ == "__main__":
    main()
