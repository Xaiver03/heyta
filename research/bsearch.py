#!/usr/bin/env python3
"""Bing HTML search via proxy -> text results (title / url / snippet)."""
import sys, re, html, urllib.parse, urllib.request

PROXY = "http://127.0.0.1:7890"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

def fetch(url):
    op = urllib.request.build_opener(urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}))
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    return op.open(req, timeout=40).read().decode("utf-8", "replace")

def strip(s):
    s = re.sub(r"<[^>]+>", "", s)
    return html.unescape(s).strip()

def search(q, n=8):
    u = "https://www.bing.com/search?q=" + urllib.parse.quote(q) + "&count=20&setlang=en"
    h = fetch(u)
    out = []
    for m in re.finditer(r'<li class="b_algo".*?</li>', h, re.S):
        blk = m.group(0)
        t = re.search(r"<h2[^>]*>(.*?)</h2>", blk, re.S)
        a = re.search(r'<h2[^>]*>\s*<a[^>]+href="([^"]+)"', blk, re.S)
        p = re.search(r'<p[^>]*>(.*?)</p>', blk, re.S)
        if t:
            out.append((strip(t.group(1)), a.group(1) if a else "", strip(p.group(1))[:300] if p else ""))
        if len(out) >= n:
            break
    return out

if __name__ == "__main__":
    for q in sys.argv[1:]:
        print("=" * 100)
        print("QUERY:", q)
        try:
            for i, (t, u, s) in enumerate(search(q), 1):
                print(f"\n[{i}] {t}\n    {u}\n    {s}")
        except Exception as e:
            print("ERROR:", e)
