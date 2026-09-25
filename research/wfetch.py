#!/usr/bin/env python3
"""Fetch a URL through the system proxy and print readable text."""
import sys, re, html, urllib.request
PROXY = "http://127.0.0.1:7890"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

def get(url):
    op = urllib.request.build_opener(urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}))
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    return op.open(req, timeout=45).read().decode("utf-8", "replace")

def text(h):
    h = re.sub(r"(?is)<(script|style|svg|nav|footer|head)[^>]*>.*?</\1>", " ", h)
    h = re.sub(r"(?i)<br\s*/?>", "\n", h)
    h = re.sub(r"(?i)</(p|div|li|tr|h[1-6]|section)>", "\n", h)
    h = re.sub(r"<[^>]+>", " ", h)
    h = html.unescape(h)
    lines = [re.sub(r"[ \t\xa0]+", " ", l).strip() for l in h.split("\n")]
    return "\n".join(l for l in lines if l)

if __name__ == "__main__":
    url = sys.argv[1]
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 120
    try:
        t = text(get(url))
        print("\n".join(t.split("\n")[:limit]))
    except Exception as e:
        print("FETCH_ERROR:", e)
