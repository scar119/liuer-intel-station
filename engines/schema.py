#!/usr/bin/env python3
"""Create the SQLite schema for the RSS reader database."""

import os
import sqlite3
import sys


def init_db(db_path: str) -> None:
    """Initialize the database with all required tables and indexes."""
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)

    conn = sqlite3.connect(db_path)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")

        conn.executescript("""
            CREATE TABLE IF NOT EXISTS feeds (
                id          TEXT PRIMARY KEY,
                title       TEXT,
                xmlUrl      TEXT UNIQUE,
                htmlUrl     TEXT,
                addedAt     TEXT,
                lastFetched INTEGER,
                status      TEXT DEFAULT 'ok'
            );

            CREATE TABLE IF NOT EXISTS entries (
                id           TEXT PRIMARY KEY,
                feed_id      TEXT,
                title        TEXT,
                link         TEXT,
                source       TEXT,
                published_ts INTEGER,
                published_at TEXT,
                summary      TEXT,
                body         TEXT,
                read         INTEGER DEFAULT 0,
                starred      INTEGER DEFAULT 0,
                indexed_at   INTEGER
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

            CREATE TABLE IF NOT EXISTS meta (
                k TEXT PRIMARY KEY,
                v TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_entries_pub  ON entries(published_ts DESC);
            CREATE INDEX IF NOT EXISTS idx_entries_feed ON entries(feed_id);
            CREATE INDEX IF NOT EXISTS idx_entries_read ON entries(read);
        """)

        conn.commit()
    finally:
        conn.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <db_path>", file=sys.stderr)
        sys.exit(1)

    init_db(sys.argv[1])
    print("ok")
