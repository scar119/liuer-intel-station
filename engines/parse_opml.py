#!/usr/bin/env python3
"""Parse OPML XML and extract feed outlines as JSON.

Usage:
    python parse_opml.py '<opml_xml_string>'
    echo '<opml_xml_string>' | python parse_opml.py

Outputs a JSON array of objects with title, xmlUrl, and htmlUrl fields
for every <outline> element that carries an xmlUrl attribute.
"""

import json
import sys
import xml.etree.ElementTree as ET


def parse_opml(opml_string: str) -> list[dict[str, str]]:
    """Return feeds found in the given OPML XML string.

    Each feed is represented as {"title": ..., "xmlUrl": ..., "htmlUrl": ...}.
    Outlines without an xmlUrl attribute are skipped.
    Encoding errors in the input are replaced so parsing never raises on
    malformed bytes embedded in otherwise-valid XML.
    """
    # Normalise to str; callers may pass bytes from stdin in binary mode.
    if isinstance(opml_string, (bytes, bytearray)):
        opml_string = opml_string.decode("utf-8", errors="replace")

    try:
        root = ET.fromstring(opml_string)
    except ET.ParseError:
        return []

    feeds: list[dict[str, str]] = []
    for outline in root.iter("outline"):
        xml_url = outline.get("xmlUrl")
        if not xml_url:
            continue
        feeds.append(
            {
                "title": outline.get("title", ""),
                "xmlUrl": xml_url,
                "htmlUrl": outline.get("htmlUrl", ""),
            }
        )
    return feeds


def main() -> None:
    if len(sys.argv) > 1:
        opml_input = sys.argv[1]
    else:
        opml_input = sys.stdin.read()

    result = parse_opml(opml_input)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
