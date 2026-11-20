#!/usr/bin/env python3
"""Fetch an RSS/Atom feed URL and return its title and item count as JSON."""

import json
import sys
import urllib.request
import xml.etree.ElementTree as ET


def probe_feed(url: str) -> dict:
    """Fetch and parse an RSS or Atom feed, returning title and item count."""
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "LiuerIntel/1.0"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()

        root = ET.fromstring(data)

        # Strip namespace for uniform handling of Atom feeds
        tag = root.tag
        ns = ""
        if tag.startswith("{"):
            ns = tag[: tag.index("}") + 1]

        # Try RSS 2.0: channel/title
        title_el = root.find(f"{ns}channel/{ns}title")
        if title_el is None:
            # Try Atom: feed/title
            title_el = root.find(f"{ns}title")
        title = title_el.text.strip() if title_el is not None and title_el.text else url

        # Count items: RSS uses <item>, Atom uses <entry>
        items = root.findall(f".//{ns}item")
        if not items:
            items = root.findall(f".//{ns}entry")

        return {"title": title, "items": len(items)}

    except Exception as exc:
        return {"title": url, "items": 0, "error": str(exc)}


def main():
    if len(sys.argv) != 2:
        print(json.dumps({"title": "", "items": 0, "error": "Usage: probe_feed.py <url>"}))
        sys.exit(1)

    result = probe_feed(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
