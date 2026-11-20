#!/usr/bin/env python3
"""Return dashboard stats from the liuer-intel-station SQLite database.

Usage:
    python bootstrap.py <db_path>

Outputs a single JSON object to stdout with dashboard statistics.
Uses only Python stdlib (sqlite3, json, sys, time).
"""

import json
import os
import sqlite3
import sys
import time


def load_min_score(db_path):
    """Load minScore from config.json."""
    try:
        data_dir = os.path.dirname(db_path)
        config_file = os.path.join(data_dir, "config.json")
        if os.path.exists(config_file):
            with open(config_file, "r", encoding="utf-8") as f:
                config = json.load(f)
                return config.get("minScore", 50)
    except:
        pass
    return 50


def get_stats(db_path: str) -> dict:
    """Query the SQLite database and return dashboard stats."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    now = int(time.time())
    last_24h_ts = now - 86400
    last_7d_ts = now - 7 * 86400

    # total
    cur.execute("SELECT COUNT(*) FROM entries")
    total = cur.fetchone()[0]

    # unread
    cur.execute("SELECT SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) FROM entries")
    unread = cur.fetchone()[0] or 0

    # starred
    cur.execute("SELECT SUM(CASE WHEN starred = 1 THEN 1 ELSE 0 END) FROM entries")
    starred = cur.fetchone()[0] or 0

    # last_24h
    cur.execute("SELECT COUNT(*) FROM entries WHERE published_ts >= ?", (last_24h_ts,))
    last_24h = cur.fetchone()[0]

    # hot_unread: recent unread as proxy (no score/tier in standalone version)
    cur.execute(
        "SELECT COUNT(*) FROM entries WHERE read = 0 AND published_ts >= ?",
        (last_7d_ts,),
    )
    hot_unread = cur.fetchone()[0]

    # feed_count
    cur.execute("SELECT COUNT(DISTINCT feed_id) FROM entries")
    feed_count = cur.fetchone()[0]

    # last_indexed from meta table
    last_indexed = None
    try:
        cur.execute("SELECT v FROM meta WHERE k = 'last_fetch'")
        row = cur.fetchone()
        if row:
            last_indexed = row[0]
    except sqlite3.OperationalError:
        # meta table may not exist
        pass

    # channels: empty array (no channel taxonomy in standalone version)
    channels = []

    # feeds: top 60 sources by count
    cur.execute(
        """
        SELECT source, COUNT(*) AS n, SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) AS u
        FROM entries
        WHERE source <> ''
        GROUP BY source
        ORDER BY n DESC
        LIMIT 60
        """
    )
    feeds = [{"source": row["source"], "count": row["n"], "unread": row["u"]} for row in cur.fetchall()]

    # filtered_count: entries with ai_score >= minScore
    min_score = load_min_score(db_path)
    filtered_count = 0
    try:
        cur.execute(
            "SELECT COUNT(*) FROM entries WHERE ai_score >= ? AND read = 0",
            (min_score,),
        )
        filtered_count = cur.fetchone()[0]
    except sqlite3.OperationalError:
        # ai_score column may not exist
        pass

    conn.close()

    return {
        "total": total,
        "unread": unread,
        "starred": starred,
        "last_24h": last_24h,
        "hot_unread": hot_unread,
        "feed_count": feed_count,
        "last_indexed": last_indexed,
        "channels": channels,
        "feeds": feeds,
        "practice_unread": 0,
        "cognition_unread": 0,
        "filtered_count": filtered_count,
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: python bootstrap.py <db_path>", file=sys.stderr)
        sys.exit(1)

    db_path = sys.argv[1]
    stats = get_stats(db_path)
    print(json.dumps(stats, ensure_ascii=False))


if __name__ == "__main__":
    main()
