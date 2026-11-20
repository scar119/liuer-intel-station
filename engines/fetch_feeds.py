#!/usr/bin/env python3
"""Fetch RSS/Atom feeds listed in feeds.json and store entries in SQLite.

Usage:
    python fetch_feeds.py <data_dir> <db_path>

Args:
    data_dir  Directory containing feeds.json
    db_path   Path to the SQLite database file

Only stdlib dependencies. Never crashes on a single bad feed.
"""

import sys
import os
import json
import time
import hashlib
import re
import html as html_mod
import sqlite3
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_TAG_RE = re.compile(r"<[^>]+>")


def strip_html(text: str) -> str:
    """Remove HTML tags and decode entities."""
    if not text:
        return ""
    text = _TAG_RE.sub("", text)
    text = html_mod.unescape(text)
    return " ".join(text.split())


def entry_id(link: str) -> str:
    """Deterministic 16-char hex id from link."""
    return hashlib.sha1(link.encode("utf-8", errors="replace")).hexdigest()[:16]


def parse_date(raw: str | None) -> str | None:
    """Best-effort date parsing → ISO string or None."""
    if not raw:
        return None
    raw = raw.strip()
    # Try RFC 2822 first (RSS pubDate)
    try:
        dt = parsedate_to_datetime(raw)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        pass
    # Try common ISO formats
    for fmt in (
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ):
        try:
            dt = datetime.strptime(raw, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).isoformat()
        except ValueError:
            continue
    return None


def get_text(elem, *tags):
    """Return first non-empty text among child tag names."""
    if elem is None:
        return None
    for tag in tags:
        child = elem.find(tag)
        if child is not None and child.text and child.text.strip():
            return child.text.strip()
    return None


def get_content_encoded(item):
    """Extract content:encoded (namespace-aware) or fall back to description."""
    # Atom <content>
    content = item.find("content")
    if content is not None:
        if content.text and content.text.strip():
            return content.text.strip()
    # RSS content:encoded — namespace varies
    for ns in (
        "http://purl.org/rss/1.0/modules/content/",
        "http://webns.net/mvcb/",
    ):
        ce = item.find(f"{{{ns}}}encoded")
        if ce is not None and ce.text and ce.text.strip():
            return ce.text.strip()
    return None


# ---------------------------------------------------------------------------
# Feed fetching & parsing
# ---------------------------------------------------------------------------

ATOM_NS = "http://www.w3.org/2005/Atom"


def fetch_feed(url: str, timeout: int = 20) -> bytes:
    """Download feed XML with a User-Agent header."""
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "liuer-intel-station/1.0 (+https://github.com)",
            "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read()
    # Handle encoding declaration
    return data


def parse_items(xml_bytes: bytes):
    """Yield dicts {title, link, published, summary, body} from RSS or Atom XML."""
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return

    # Detect Atom vs RSS
    tag = root.tag
    is_atom = tag == f"{{{ATOM_NS}}}feed" or tag == "feed"

    if is_atom:
        items = root.findall(f"{{{ATOM_NS}}}entry") or root.findall("entry")
    else:
        # RSS: items live under <channel>
        channel = root.find("channel")
        items = channel.findall("item") if channel is not None else root.findall(".//item")

    for item in items:
        try:
            if is_atom:
                title = get_text(item, f"{{{ATOM_NS}}}title", "title")
                link_el = item.find(f"{{{ATOM_NS}}}link")
                if link_el is None:
                    link_el = item.find("link")
                link = link_el.get("href", "") if link_el is not None else ""
                updated = get_text(item, f"{{{ATOM_NS}}}updated", "published", "updated")
                summary = get_text(item, f"{{{ATOM_NS}}}summary", "summary")
                body = get_content_encoded(item) or summary or ""
            else:
                title = get_text(item, "title")
                link = get_text(item, "link") or ""
                pub = get_text(item, "pubDate", "dc:date")
                updated = pub
                summary = get_text(item, "description", "summary")
                body = get_content_encoded(item) or summary or ""

            if not link:
                continue

            yield {
                "title": title or "",
                "link": link.strip(),
                "published": parse_date(updated),
                "summary": summary or "",
                "body": body or "",
            }
        except Exception:
            # Skip malformed individual items
            continue


def process_feed(feed_info: dict) -> dict:
    """Fetch one feed, parse items, return result dict."""
    url = feed_info.get("xmlUrl") or feed_info.get("url", "")
    feed_id = feed_info.get("id", url)
    result = {"feed_id": feed_id, "url": url, "items": [], "error": None}
    try:
        xml_bytes = fetch_feed(url)
        items = list(parse_items(xml_bytes))
        result["items"] = items
    except Exception as exc:
        result["error"] = str(exc)[:500]
    return result


# ---------------------------------------------------------------------------
# Database operations
# ---------------------------------------------------------------------------

def ensure_tables(conn: sqlite3.Connection):
    """建表 —— 复用 schema.py 的单一事实源，避免两处 schema 漂移。"""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import schema
    schema.ensure(conn)


def upsert_feed(conn: sqlite3.Connection, feed_info: dict):
    """Ensure feed row exists."""
    fid = feed_info.get("id") or feed_info.get("xmlUrl") or feed_info.get("url", "")
    ftitle = feed_info.get("title") or feed_info.get("name", "")
    furl = feed_info.get("xmlUrl") or feed_info.get("url", "")
    fhtml = feed_info.get("htmlUrl", "")
    conn.execute(
        """INSERT INTO feeds (id, title, xmlUrl, htmlUrl, addedAt, status)
           VALUES (?, ?, ?, ?, ?, 'ok')
           ON CONFLICT(id) DO UPDATE SET
             title=COALESCE(excluded.title, feeds.title),
             xmlUrl=excluded.xmlUrl,
             htmlUrl=COALESCE(excluded.htmlUrl, feeds.htmlUrl)""",
        (fid, ftitle, furl, fhtml, feed_info.get("addedAt", "")),
    )


def insert_entries(conn: sqlite3.Connection, feed_id: str, feed_title: str, items: list[dict]) -> int:
    """Insert entries, skip duplicates by id. Return count of new rows."""
    new_count = 0
    now_ts = int(time.time())
    for item in items:
        eid = entry_id(item["link"])
        # Convert published string → ts + iso
        pub_raw = item.get("published") or item.get("published_at") or ""
        pub_ts = 0
        pub_at = ""
        if pub_raw:
            try:
                from email.utils import parsedate_to_datetime
                dt = parsedate_to_datetime(pub_raw)
                if dt.tzinfo is None:
                    from datetime import timezone as _tz
                    dt = dt.replace(tzinfo=_tz.utc)
                pub_ts = int(dt.timestamp())
                pub_at = dt.isoformat()
            except Exception:
                # Try ISO format
                try:
                    from datetime import datetime as _dt, timezone as _tz
                    dt = _dt.fromisoformat(pub_raw.replace("Z", "+00:00"))
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=_tz.utc)
                    pub_ts = int(dt.timestamp())
                    pub_at = dt.isoformat()
                except Exception:
                    pub_at = pub_raw
        try:
            cur = conn.execute(
                """INSERT OR IGNORE INTO entries
                   (id, feed_id, title, link, source, published_ts, published_at, summary, body, indexed_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    eid, feed_id, item["title"], item["link"], feed_title,
                    pub_ts, pub_at, item["summary"], item["body"], now_ts,
                ),
            )
            if cur.rowcount > 0:
                new_count += 1
                # FTS5 contentless insert
                body_clean = strip_html(item.get("body", ""))[:600]
                try:
                    conn.execute(
                        "INSERT INTO entry_fts(rowid, title, summary, body, source) VALUES (?,?,?,?,?)",
                        (cur.lastrowid, item["title"] or "", item["summary"] or "", body_clean, feed_title),
                    )
                except Exception:
                    pass
        except sqlite3.IntegrityError:
            continue
    return new_count


def update_feed_status(conn: sqlite3.Connection, feed_id: str, status: str):
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "UPDATE feeds SET status=?, lastFetched=? WHERE id=?",
        (status, now, feed_id),
    )


def update_meta(conn: sqlite3.Connection):
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO meta (k, v) VALUES ('last_fetch', ?)
           ON CONFLICT(k) DO UPDATE SET v=excluded.v""",
        (now,),
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(data_dir: str, db_path: str):
    t0 = time.monotonic()

    # 1. Read feeds.json
    feeds_file = os.path.join(data_dir, "feeds.json")
    with open(feeds_file, "r", encoding="utf-8") as f:
        feeds_data = json.load(f)

    # Normalize: accept both list and {"feeds": [...]} shapes
    if isinstance(feeds_data, list):
        feed_list = feeds_data
    elif isinstance(feeds_data, dict):
        feed_list = feeds_data.get("feeds", feeds_data.get("sources", []))
    else:
        feed_list = []

    if not feed_list:
        stats = {"fetched": 0, "new_entries": 0, "errors": 0, "seconds": round(time.monotonic() - t0, 2)}
        print(json.dumps(stats))
        return

    # Ensure every feed has an id
    for fi in feed_list:
        if "id" not in fi:
            fi["id"] = fi.get("xmlUrl") or fi.get("url") or fi.get("title", "")

    # 2. Open DB & ensure schema
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    ensure_tables(conn)

    # Upsert feed metadata
    for fi in feed_list:
        upsert_feed(conn, fi)
    conn.commit()

    # 3. Fetch all feeds concurrently
    fetched = 0
    new_entries = 0
    errors = 0

    with ThreadPoolExecutor(max_workers=8) as pool:
        future_map = {pool.submit(process_feed, fi): fi for fi in feed_list}
        for future in as_completed(future_map):
            fi = future_map[future]
            try:
                result = future.result(timeout=30)
            except Exception as exc:
                result = {"feed_id": fi.get("id", fi.get("xmlUrl", "")), "items": [], "error": str(exc)[:500]}

            feed_id = result["feed_id"]

            if result["error"]:
                errors += 1
                update_feed_status(conn, feed_id, "error")
            else:
                fetched += 1
                n = insert_entries(conn, feed_id, fi.get("title", ""), result["items"])
                new_entries += n
                update_feed_status(conn, feed_id, "ok")

            conn.commit()

    # 9. Update meta
    update_meta(conn)
    conn.commit()
    conn.close()

    elapsed = round(time.monotonic() - t0, 2)
    stats = {"fetched": fetched, "new_entries": new_entries, "errors": errors, "seconds": elapsed}
    print(json.dumps(stats))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <data_dir> <db_path>", file=sys.stderr)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
