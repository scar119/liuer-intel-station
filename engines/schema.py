#!/usr/bin/env python3
"""建库 / 升级数据库结构。

用法：
    python3 schema.py <db_path>

设计要点：
- 这是**唯一的建表事实源**，其它脚本必须复用 `ensure(conn)`，不要各写一份
  （之前踩过：三处 schema 不一致，导致全新安装后抓取和查询全部报错）
- FTS5 用 content='' 的 contentless 表 + trigram 分词：
  ① contentless 才能配 contentless_delete=1（配 content='entries' 会直接报错）
  ② trigram 才能中文子串搜
- 结构化字段用 ALTER 增量补，老库升级不丢数据
"""

import sqlite3
import sys

# 基础表：全新库必须一次建到位
BASE_SCHEMA = """
CREATE TABLE IF NOT EXISTS feeds (
    id          TEXT PRIMARY KEY,
    title       TEXT,
    xmlUrl      TEXT UNIQUE,
    htmlUrl     TEXT,
    addedAt     TEXT,
    lastFetched INTEGER,
    status      TEXT DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS entries (
    id           TEXT PRIMARY KEY,
    feed_id      TEXT,
    title        TEXT,
    link         TEXT UNIQUE,
    source       TEXT,
    published_ts INTEGER,
    published_at TEXT,
    summary      TEXT,
    body         TEXT,
    read         INTEGER DEFAULT 0,
    starred      INTEGER DEFAULT 0,
    indexed_at   INTEGER
);

CREATE TABLE IF NOT EXISTS meta (
    k TEXT PRIMARY KEY,
    v TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS entry_fts USING fts5(
    title,
    summary,
    body,
    source,
    content='',
    contentless_delete=1,
    tokenize='trigram'
);

CREATE INDEX IF NOT EXISTS idx_entries_source      ON entries(source);
CREATE INDEX IF NOT EXISTS idx_entries_published   ON entries(published_ts DESC);
CREATE INDEX IF NOT EXISTS idx_entries_read        ON entries(read);
CREATE INDEX IF NOT EXISTS idx_entries_starred     ON entries(starred);
"""

# 后加的列：老库靠这个补齐
EXTRA_COLUMNS = [
    ("entries", "ai_score",   "INTEGER"),
    ("entries", "llm_score",  "INTEGER"),
    ("entries", "ai_summary", "TEXT"),
    ("entries", "ai_tier",    "TEXT"),
    ("entries", "ai_channel", "TEXT"),
]

EXTRA_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_entries_llm_score ON entries(llm_score DESC);
CREATE INDEX IF NOT EXISTS idx_entries_tier      ON entries(ai_tier);
CREATE INDEX IF NOT EXISTS idx_entries_channel   ON entries(ai_channel);
"""


def ensure(conn: sqlite3.Connection) -> None:
    """幂等地建表 + 补列 + 补索引。其它脚本都应该调这个。"""
    conn.executescript(BASE_SCHEMA)

    for table, column, ctype in EXTRA_COLUMNS:
        existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        if column not in existing:
            try:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ctype}")
            except sqlite3.OperationalError:
                pass  # 并发下可能已被别的进程加过

    conn.executescript(EXTRA_INDEXES)
    conn.commit()


def main() -> None:
    if len(sys.argv) < 2:
        print("用法: python3 schema.py <db_path>", file=sys.stderr)
        sys.exit(1)

    db_path = sys.argv[1]
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        ensure(conn)
        n = conn.execute("SELECT COUNT(*) FROM entries").fetchone()[0]
        print(f"✓ 数据库已就绪: {db_path}（现有 {n} 条记录）")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
