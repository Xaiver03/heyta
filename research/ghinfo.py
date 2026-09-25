#!/usr/bin/env python3
"""Scrape GitHub repo facts without api.github.com.

Usage:  python3 ghinfo.py owner/repo [owner/repo ...]
Output: TSV, one row per repo (header included).

Facts pulled from public github.com HTML / atom feeds:
  stars, forks, license(spdx), archived, default branch, description, topics,
  last commit time (commits.atom feed <updated>), latest release,
  top language (shields.io, which mirrors linguist data).
"""
import re
import sys
import concurrent.futures
import urllib.request

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

FIELDS = ["repo", "stars", "forks", "license", "archived", "branch",
          "last_commit", "latest_release", "top_lang", "desc", "topics"]


def get(url, timeout=40):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def info(slug):
    out = {k: "" for k in FIELDS}
    out["repo"] = slug
    try:
        h = get("https://github.com/" + slug)
    except Exception as e:  # noqa: BLE001
        out["desc"] = "FETCH_ERROR:%s" % e
        return out
    m = re.search(r'"stargazerCount":(\d+)', h)
    out["stars"] = m.group(1) if m else "NA"
    m = re.search(r'"forksCount":(\d+)', h)
    out["forks"] = m.group(1) if m else "NA"
    m = re.search(r'"license":\{"spdxId":"([^"]*)","name":"([^"]*)"', h)
    if m:
        out["license"] = "%s (%s)" % (m.group(1), m.group(2))
    elif '"license":null' in h:
        out["license"] = "NONE-DECLARED"
    else:
        out["license"] = "NA"
    m = re.search(r'"isArchived":(true|false)', h)
    out["archived"] = m.group(1) if m else "NA"
    m = re.search(r'"defaultBranch":"([^"]*)"', h)
    out["branch"] = m.group(1) if m else "NA"
    m = re.search(r'"description":"(.*?)","formattedDescription"', h, re.S)
    if m:
        out["desc"] = m.group(1).replace("\\u003c", "<").replace("\\u003e", ">")[:220]
    m = re.search(r'"topics":\[(.*?)\]', h, re.S)
    if m:
        out["topics"] = ",".join(re.findall(r'"name":"([^"]+)"', m.group(1)))[:200]
    try:
        a = get("https://github.com/%s/commits.atom" % slug)
        m = re.search(r"<updated>([^<]+)</updated>", a)
        out["last_commit"] = m.group(1) if m else "NA"
    except Exception:  # noqa: BLE001
        out["last_commit"] = "ERR"
    try:
        r = get("https://github.com/%s/releases.atom" % slug)
        titles = re.findall(r"<title>([^<]*)</title>", r)
        ups = re.findall(r"<updated>([^<]+)</updated>", r)
        tag = titles[1] if len(titles) > 1 else "NO-RELEASES"
        out["latest_release"] = "%s @ %s" % (tag, ups[1] if len(ups) > 1 else "NA")
    except Exception:  # noqa: BLE001
        out["latest_release"] = "ERR"
    try:
        s = get("https://img.shields.io/github/languages/top/%s" % slug)
        m = re.search(r"<title>([^<]*)</title>", s)
        out["top_lang"] = m.group(1) if m else "NA"
    except Exception:  # noqa: BLE001
        out["top_lang"] = "NA"
    return out


def main():
    slugs = sys.argv[1:]
    rows = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        for r in ex.map(info, slugs):
            rows.append(r)
    print("\t".join(FIELDS))
    for r in rows:
        print("\t".join(str(r.get(k, "")).replace("\t", " ") for k in FIELDS))


if __name__ == "__main__":
    main()
