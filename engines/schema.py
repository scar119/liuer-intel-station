#!/usr/bin/env python3
"""Create or update the SQLite schema with all necessary tables and indexes."""
import sqlite3
import sys

SCHEMA = """
-- Feeds table: store RSS feed metadata
CREATE TABLE IF NOT EXISTS feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  xmlUrl TEXT UNIQUE NOT NULL,
  htmlUrl TEXT,
  category TEXT,
  added_at TEXT DEFAULT CURRENT_TIMESTAMP,
  weight INTEGER DEFAULT 5,
  enabled INTEGER DEFAULT 1
);

-- Entries table: store individual articles
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  link TEXT,
  source TEXT,
  published_ts INTEGER,
  published_at TEXT,
  summary TEXT,
  body TEXT,
  raw_category TEXT,
  read INTEGER DEFAULT 0,
  starred INTEGER DEFAULT 0,
  indexed_at TEXT DEFAULT CURRENT_TIMESTAMP,
  ai_summary TEXT,
  ai_score INTEGER
);

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS entry_fts USING fts5(
  title, source, summary, body_prefix,
  content='entries',
  contentless_delete=1,
  tokenize='trigram'
);

-- Metadata table: store key-value config
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_entries_source ON entries(source);
CREATE INDEX IF NOT EXISTS idx_entries_published ON entries(published_ts DESC);
CREATE INDEX IF NOT EXISTS idx_entries_read ON entries(read);
CREATE INDEX IF NOT EXISTS idx_entries_starred ON entries(starred);
CREATE INDEX IF NOT EXISTS idx_entries_score ON entries(ai_score DESC);
"""


def main():
    if len(sys.argv) < 2:
        print("Usage: schema.py <db_path>", file=sys.stderr)
        sys.exit(1)

    db_path = sys.argv[1]
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()
    print(f"Schema initialized: {db_path}")


if __name__ == "__main__":
    main()
