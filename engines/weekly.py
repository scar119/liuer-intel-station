#!/usr/bin/env python3
"""Compute weekly digest statistics from the RSS reader database.

Usage: weekly.py <db_path>

Compares the current week (last 7 days) against the previous week.
Outputs JSON to stdout with range, totals, deltas, daily breakdown,
top entries, busiest sources, new sources, and channel distribution.
"""

import json
import sqlite3
import sys
import time
from datetime import datetime, timezone, timedelta


def _day_key(ts: int, tz_offset: timedelta) -> str:
    """Return YYYY-MM-DD for a unix timestamp in the given offset."""
    dt = datetime.fromtimestamp(ts, tz=timezone(tz_offset))
    return dt.strftime("%Y-%m-%d")


def main() -> None:
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <db_path>", file=sys.stderr)
        sys.exit(1)

    db_path = sys.argv[1]

    # Use local timezone offset derived from system time
    local_now = datetime.now()
    utc_now = datetime.now(timezone.utc)
    tz_offset = local_now.replace(tzinfo=None) - utc_now.replace(tzinfo=None)

    now = int(time.time())
    seven_days = 7 * 86400

    cur_to = now
    cur_from = now - seven_days
    prev_to = cur_from
    prev_from = prev_to - seven_days

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        # --- Current week aggregates ---
        cur_row = conn.execute("""
            SELECT COUNT(*) AS total, COUNT(DISTINCT source) AS sources
            FROM entries WHERE published_ts >= ? AND published_ts < ?
        """, (cur_from, cur_to)).fetchone()
        cur_total = cur_row["total"]
        cur_sources = cur_row["sources"]

        # --- Previous week aggregates ---
        prev_row = conn.execute("""
            SELECT COUNT(*) AS total, COUNT(DISTINCT source) AS sources
            FROM entries WHERE published_ts >= ? AND published_ts < ?
        """, (prev_from, prev_to)).fetchone()
        prev_total = prev_row["total"]
        prev_sources = prev_row["sources"]

        # --- Delta & pct ---
        delta = cur_total - prev_total
        pct = round((delta / prev_total * 100), 1) if prev_total > 0 else (
            100.0 if cur_total > 0 else 0.0
        )

        # --- Daily breakdown (current week) ---
        daily_rows = conn.execute("""
            SELECT published_ts FROM entries
            WHERE published_ts >= ? AND published_ts < ?
            ORDER BY published_ts
        """, (cur_from, cur_to)).fetchall()

        daily_map: dict[str, int] = {}
        for r in daily_rows:
            day = _day_key(r["published_ts"], tz_offset)
            daily_map[day] = daily_map.get(day, 0) + 1

        # Fill all 7 days so gaps show as 0
        daily_list = []
        for i in range(7):
            day_dt = datetime.fromtimestamp(cur_from + i * 86400, tz=timezone(tz_offset))
            day_str = day_dt.strftime("%Y-%m-%d")
            daily_list.append({"day": day_str, "n": daily_map.get(day_str, 0)})

        # --- Channels (distinct sources this week) ---
        channel_rows = conn.execute("""
            SELECT DISTINCT source FROM entries
            WHERE published_ts >= ? AND published_ts < ?
              AND source IS NOT NULL AND source != ''
            ORDER BY source
        """, (cur_from, cur_to)).fetchall()
        channels = [r["source"] for r in channel_rows]

        # --- Top 12 latest entries this week ---
        top_rows = conn.execute("""
            SELECT id, title, link, source, published_ts
            FROM entries
            WHERE published_ts >= ? AND published_ts < ?
            ORDER BY published_ts DESC
            LIMIT 12
        """, (cur_from, cur_to)).fetchall()
        top = [
            {
                "id": r["id"],
                "title": r["title"],
                "link": r["link"],
                "source": r["source"],
                "published_ts": r["published_ts"],
            }
            for r in top_rows
        ]

        # --- New sources (appeared this week but not before) ---
        new_source_rows = conn.execute("""
            SELECT DISTINCT source FROM entries
            WHERE published_ts >= ? AND published_ts < ?
              AND source IS NOT NULL AND source != ''
              AND source NOT IN (
                  SELECT DISTINCT source FROM entries
                  WHERE published_ts < ?
                    AND source IS NOT NULL AND source != ''
              )
        """, (cur_from, cur_to, cur_from)).fetchall()
        new_sources = [r["source"] for r in new_source_rows]

        # --- Busiest 8 sources this week ---
        busiest_rows = conn.execute("""
            SELECT source, COUNT(*) AS n FROM entries
            WHERE published_ts >= ? AND published_ts < ?
              AND source IS NOT NULL AND source != ''
            GROUP BY source
            ORDER BY n DESC
            LIMIT 8
        """, (cur_from, cur_to)).fetchall()
        busiest = [{"name": r["source"], "n": r["n"]} for r in busiest_rows]

    finally:
        conn.close()

    result = {
        "range": {"from": cur_from, "to": cur_to},
        "cur": {"total": cur_total, "sources": cur_sources},
        "prev": {"total": prev_total, "sources": prev_sources},
        "delta": delta,
        "pct": pct,
        "daily": daily_list,
        "channels": channels,
        "top": top,
        "new_sources": new_sources,
        "busiest": busiest,
    }

    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    print()  # trailing newline


if __name__ == "__main__":
    main()
