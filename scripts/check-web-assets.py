#!/usr/bin/env python3
"""Check the actual served frontend, including the SVG volume overlay in Compose."""
import sys
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit
from urllib.request import urlopen


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.files = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and attrs.get("src"):
            self.files[attrs["src"]] = "javascript"
        if tag == "link" and attrs.get("rel") == "stylesheet" and attrs.get("href"):
            self.files[attrs["href"]] = "css"


def check(base):
    with urlopen(base, timeout=15) as response:
        if response.headers.get_content_type() != "text/html":
            raise ValueError("index response is not HTML")
        parser = Assets()
        parser.feed(response.read().decode("utf-8"))
    if set(parser.files.values()) != {"javascript", "css"}:
        raise ValueError("index must reference compiled JavaScript and CSS")
    for path, kind in parser.files.items():
        target = urljoin(base, path)
        if urlsplit(target).netloc != urlsplit(base).netloc:
            raise ValueError(f"unexpected external frontend asset: {target}")
        if not urlsplit(target).path.startswith("/static/"):
            raise ValueError(f"frontend bundle must be outside the SVG volume: {target}")
        with urlopen(target, timeout=15) as response:
            mime = response.headers.get_content_type()
            expected = {"text/css"} if kind == "css" else {"text/javascript", "application/javascript"}
            if response.status != 200 or mime not in expected:
                raise ValueError(f"invalid frontend response: {target}: {response.status} {mime}")
            body = response.read()
            if not body.strip() or body.lstrip().lower().startswith((b"<!doctype", b"<html")):
                raise ValueError(f"empty bundle or HTML fallback: {target}")
        print(f"OK {kind}: {target}")
    print("frontend JS/CSS HTTP smoke test: passed")


if __name__ == "__main__":
    check(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000")
