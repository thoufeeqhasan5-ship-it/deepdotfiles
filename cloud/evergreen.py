#!/usr/bin/env python3
"""Pick a few unused timeless topics for this run's area and fetch their facts from Wikipedia.
usage: evergreen.py <list.txt> <history.json> <out.json>     (env FOCUS = the run's area)"""
import json, os, random, sys, urllib.parse, urllib.request

lst, hist_file, out = sys.argv[1:4]
focus = os.environ.get("FOCUS", "").lower()
areas = [a for a in ("space", "ocean", "nature", "technology") if a[:4] in focus] or ["space", "ocean", "nature", "technology"]

def key(s):
    return urllib.parse.unquote(str(s)).rstrip("/").split("/")[-1].replace(" ", "_").lower()

try:
    used = {key(h.get("source", "")) for h in json.load(open(hist_file))}
except Exception:
    used = set()

pool = []
for line in open(lst, encoding="utf-8"):
    if "|" in line and not line.startswith("#"):
        area, title = (x.strip() for x in line.split("|", 1))
        if area in areas and key(title) not in used:
            pool.append((area, title))
random.shuffle(pool)

found = []
for area, title in pool[:16]:
    if len(found) >= 8:
        break
    url = "https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(title, safe="")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "DeepDotFilesBot/1.0 (GitHub Actions; educational shorts)"})
        d = json.load(urllib.request.urlopen(req, timeout=15))
        extract = " ".join(str(d.get("extract", "")).split())
        if d.get("type") == "standard" and len(extract) > 200:
            found.append({"area": area, "title": d.get("title", title), "extract": extract[:900],
                          "url": d.get("content_urls", {}).get("desktop", {}).get("page", "https://en.wikipedia.org/wiki/" + title)})
    except Exception as e:
        print(f"skip {title}: {e}", file=sys.stderr)

json.dump(found, open(out, "w"), ensure_ascii=True)
print(f"Timeless topics offered: {', '.join(f['title'] for f in found) or 'none'}")
