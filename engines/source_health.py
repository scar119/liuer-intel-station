#!/usr/bin/env python3
"""Analyse per-source health metrics from the RSS reader database.

Usage: source_health.py <db_path>

Outputs JSON to stdout:
  {
    "sources": [ {source, total, unread, last_ts, n30, signal, status}, ... ],
    "summary": {"ok": N, "quiet": N, "stale": N, "spam": N},
    "total_sources": N
  }

Classification rules (evaluated in order):
  spam  – n30 >= 15 AND signal / total < 0.05
  stale – last published > 30 days ago
  quiet – last published > 7 days ago
  ok    – everything else

Sorting: spam → stale → quiet → ok; within each group by total DESC.
"""

import json
import sqlite3
import sys
import time


def main() -> None:
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <db_path>", file=sys.stderr)
        sys.exit(1)

    db_path = sys.argv[1]
    now = int(time.time())
    thirty_days = 30 * 86400
    seven_days = 7 * 86400
    cutoff_30d = now - thirty_days

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute("""
            SELECT
                source,
                COUNT(*)                                    AS total,
                SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) AS unread,
                MAX(published_ts)                           AS last_ts,
                SUM(CASE WHEN published_ts >= ? THEN 1 ELSE 0 END) AS n30
            FROM entries
            WHERE source IS NOT NULL AND source != ''
            GROUP BY source
        """, (cutoff_30d,)).fetchall()
    finally:
        conn.close()

    sources = []
    summary = {"ok": 0, "quiet": 0, "stale": 0, "spam": 0}

    for r in rows:
        total = r["total"]
        n30 = r["n30"]
        last_ts = r["last_ts"] or 0

        # In standalone mode (no tier/score column), use n30 as signal proxy
        signal = n30

        # Classify
        if n30 >= 15 and total > 0 and (signal / total) < 0.05:
            status = "spam"
        elif last_ts < cutoff_30d:
            status = "stale"
        elif last_ts < (now - seven_days):
            status = "quiet"
        else:
            status = "ok"

        summary[status] += 1
        sources.append({
            "source": r["source"],
            "total": total,
            "unread": r["unread"],
            "last_ts": last_ts,
            "n30": n30,
            "signal": signal,
            "status": status,
        })

    # Sort: spam first, then stale, quiet, ok; within same status by total desc
    status_order = {"spam": 0, "stale": 1, "quiet": 2, "ok": 3}
    sources.sort(key=lambda s: (status_order.get(s["status"], 99), -s["total"]))

    result = {
        "sources": sources,
        "summary": summary,
        "total_sources": len(sources),
    }

    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    print()  # trailing newline


if __name__ == "__main__":
    main()
