#!/usr/bin/env python3
"""Apply filter rules to entries and calculate relevance scores.

Usage:
    python apply_filters.py <data_dir> <db_path>

Reads config.json for filter rules, scores each entry, and updates ai_score column.
"""
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone


def load_config(data_dir):
    """Load config.json, return filter rules."""
    config_file = os.path.join(data_dir, "config.json")
    if not os.path.exists(config_file):
        return {"include": [], "exclude": [], "minScore": 50}

    with open(config_file, "r", encoding="utf-8") as f:
        config = json.load(f)

    return {
        "include": config.get("include", []),
        "exclude": config.get("exclude", []),
        "minScore": config.get("minScore", 50),
    }


def score_entry(title, summary, body, source, rules):
    """Calculate relevance score (0-100) based on filter rules.

    Field-weighted scoring — a title hit is far more meaningful than a body hit:
    - Include keyword in title:   +40
    - Include keyword in summary: +20
    - Include keyword in body:    +10
    - Exclude keyword anywhere:  -100 (strong rejection)
    """
    if not rules["include"] and not rules["exclude"]:
        return 0  # No rules, no score

    title_l = (title or "").lower()
    summary_l = (summary or "").lower()
    body_l = (body or "").lower()

    score = 0

    for kw in rules["include"]:
        k = kw.lower()
        if k in title_l:
            score += 40
        elif k in summary_l:
            score += 20
        elif k in body_l:
            score += 10

    # Exclude keywords (strong penalty)
    for kw in rules["exclude"]:
        if kw.lower() in title_l or kw.lower() in summary_l or kw.lower() in body_l:
            score -= 100

    # Cap score
    score = max(0, min(100, score))

    return score


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "用法: apply_filters.py <data_dir> <db_path>"}))
        sys.exit(1)

    data_dir = sys.argv[1]
    db_path = sys.argv[2]

    # Load rules
    rules = load_config(data_dir)

    if not rules["include"] and not rules["exclude"]:
        print(json.dumps({"ok": True, "message": "未配置过滤规则，跳过"}))
        return

    # Connect to DB
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    # Ensure ai_score column exists
    try:
        conn.execute("ALTER TABLE entries ADD COLUMN ai_score INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass  # Column already exists

    # Score all entries without score
    cur = conn.cursor()
    cur.execute(
        "SELECT id, title, summary, body, source FROM entries WHERE ai_score IS NULL OR ai_score = 0"
    )
    rows = cur.fetchall()

    scored = 0
    for row in rows:
        score = score_entry(
            row["title"] or "",
            row["summary"] or "",
            (row["body"] or "")[:500],  # Only first 500 chars for speed
            row["source"] or "",
            rules,
        )
        conn.execute("UPDATE entries SET ai_score = ? WHERE id = ?", (score, row["id"]))
        scored += 1

    conn.commit()
    conn.close()

    print(json.dumps({
        "ok": True,
        "scored": scored,
        "rules": rules,
    }))


if __name__ == "__main__":
    main()