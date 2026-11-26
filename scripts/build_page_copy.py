#!/usr/bin/env python3
"""Put the lessons from words/data/ into the word-card page as its saved copy.

  python scripts/build_page_copy.py PAGE.html

Replaces the contents of <script type="application/json" id="seed">...</script> in PAGE.html with
{"savedAt": <ms>, "lessons": {"lesson_<driveFileId>": lesson, ...}}, the shape the page reads.
Run scripts/sync_drive.py first. Exits with code 3 (and leaves the page alone) when nothing changed.
"""
import json, os, re, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "words", "data")

def main(page):
    state = json.load(open(os.path.join(DATA, "sync_state.json"), encoding="utf-8"))
    lessons = {}
    for fid, info in state["files"].items():
        les = json.load(open(os.path.join(DATA, "lessons", info["lesson"] + ".json"), encoding="utf-8"))
        name = "lesson_" + re.sub(r"[^A-Za-z0-9_-]", "_", fid)
        les.update({"id": name, "driveId": fid})
        les.pop("notes", None)
        for a in les["articles"]:
            for v in a["vocab"]:
                v.pop("num", None)
        lessons[name] = les
    seed = json.dumps({"savedAt": int(time.time() * 1000), "lessons": lessons}, ensure_ascii=False, separators=(",", ":"))
    seed = seed.replace("<", "\\u003c")
    html = open(page, encoding="utf-8").read()
    rx = re.compile(r'(<script type="application/json" id="seed">)(.*?)(</script>)', re.S)
    m = rx.search(html)
    if not m:
        sys.exit("seed block not found in page")
    try:
        old = json.loads(m.group(2)).get("lessons", {})
    except ValueError:
        old = {}
    if old == json.loads(json.dumps(lessons)):
        print("NO CHANGE: the page already has these lessons")
        sys.exit(3)
    html = rx.sub(lambda m: m.group(1) + seed + m.group(3), html, count=1)
    open(page, "w", encoding="utf-8").write(html)
    print(f"saved {len(lessons)} lessons into {page} ({len(html) // 1024} KB)")

if __name__ == "__main__":
    main(sys.argv[1])
