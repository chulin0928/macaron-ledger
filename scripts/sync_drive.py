#!/usr/bin/env python3
"""
Sync the TOEIC study files from a shared Google Drive folder into JSON data
for the word-card site in /words.

  python scripts/sync_drive.py                    # read the Drive folder (link-shared)
  python scripts/sync_drive.py --local some/dir   # read .docx files from a local folder

Output (all under words/data/):
  index.json          lesson list + headlines
  lessons/<id>.json   one lesson: articles (body, summary, vocab) and grammar notes
  vocab.json          every word across all lessons, de-duplicated
  grammar.json        every grammar note across all lessons
  sync_state.json     which Drive file produced which lesson (to skip unchanged files)

The Drive folder must be shared as "Anyone with the link". Listing uses Drive's
public embedded folder view, so no API key is needed. If the GOOGLE_API_KEY
environment variable is set, the Drive API is used for listing instead.
"""
import argparse
import datetime as dt
import html
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from xml.etree import ElementTree as ET

PARSER_VERSION = 7
DEFAULT_FOLDER = "1AnZyk1rU7nAVAYhyqD-tm7ckiOsMWWwz"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "words", "data")
UA = "Mozilla/5.0 (X11; Linux x86_64) word-cards-sync"

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
GDOC_MIME = "application/vnd.google-apps.document"
FOLDER_MIME = "application/vnd.google-apps.folder"


# --------------------------------------------------------------------------- HTTP

def http_get(url, tries=4):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 ** i)
    raise RuntimeError(f"GET failed: {url}: {last}")


# --------------------------------------------------------------------------- Drive listing

def list_folder_embedded(folder_id, depth=0):
    page = http_get(f"https://drive.google.com/embeddedfolderview?id={folder_id}").decode("utf-8", "replace")
    files = []
    for chunk in page.split('class="flip-entry"')[1:]:
        m_id = re.search(r'id="entry-([A-Za-z0-9_-]+)"', chunk)
        m_title = re.search(r'class="flip-entry-title">(.*?)</div>', chunk, re.S)
        if not m_id or not m_title:
            continue
        fid = m_id.group(1)
        name = html.unescape(m_title.group(1)).strip()
        href = re.search(r'href="([^"]+)"', chunk)
        href = html.unescape(href.group(1)) if href else ""
        m_mod = re.search(r'class="flip-entry-last-modified"><div>(.*?)</div>', chunk, re.S)
        modified = html.unescape(m_mod.group(1)).strip() if m_mod else ""
        m_type = re.search(r'/type/([^"?]+)', chunk)
        mime = urllib.parse.unquote(m_type.group(1)) if m_type else ""
        if "/folders/" in href or mime == FOLDER_MIME:
            if depth < 4:
                files += list_folder_embedded(fid, depth + 1)
            continue
        if "/document/d/" in href:
            mime = GDOC_MIME
        files.append({"id": fid, "name": name, "modified": modified, "mime": mime})
    return files


def list_folder_api(folder_id, key, depth=0):
    files, token = [], None
    while True:
        q = urllib.parse.urlencode({
            "q": f"'{folder_id}' in parents and trashed = false",
            "fields": "nextPageToken, files(id,name,mimeType,modifiedTime)",
            "pageSize": "1000", "key": key, **({"pageToken": token} if token else {}),
        })
        data = json.loads(http_get(f"https://www.googleapis.com/drive/v3/files?{q}"))
        for f in data.get("files", []):
            if f["mimeType"] == FOLDER_MIME:
                if depth < 4:
                    files += list_folder_api(f["id"], key, depth + 1)
                continue
            files.append({"id": f["id"], "name": f["name"], "modified": f["modifiedTime"], "mime": f["mimeType"]})
        token = data.get("nextPageToken")
        if not token:
            return files


def is_supported(f):
    return f["name"].lower().endswith(".docx") or f["mime"] in (DOCX_MIME, GDOC_MIME)


def download(f):
    if f["mime"] == GDOC_MIME:
        urls = [f"https://docs.google.com/document/d/{f['id']}/export?format=docx"]
    else:
        urls = [
            f"https://drive.usercontent.google.com/download?id={f['id']}&export=download&confirm=t",
            f"https://drive.google.com/uc?export=download&id={f['id']}",
        ]
    for u in urls:
        try:
            data = http_get(u)
        except RuntimeError as e:
            print("  ", e)
            continue
        if data[:2] == b"PK":
            return data
        print(f"   not a docx from {u} ({len(data)} bytes)")
    raise RuntimeError(f"could not download {f['name']}")


# --------------------------------------------------------------------------- docx -> blocks

def docx_blocks(data):
    """Return the document body as a flat list of paragraphs and tables, in order."""
    z = zipfile.ZipFile(io.BytesIO(data))
    doc = ET.fromstring(z.read("word/document.xml"))
    rels = {}
    if "word/_rels/document.xml.rels" in z.namelist():
        for rel in ET.fromstring(z.read("word/_rels/document.xml.rels")):
            rels[rel.get("Id")] = rel.get("Target")
    styles = {}
    if "word/styles.xml" in z.namelist():
        for s in ET.fromstring(z.read("word/styles.xml")).iter(W + "style"):
            name = s.find(W + "name")
            styles[s.get(W + "styleId")] = (name.get(W + "val") if name is not None else "") or ""

    def para_text(p):
        out = []
        for el in p.iter():
            if el.tag == W + "t":
                out.append(el.text or "")
            elif el.tag in (W + "br", W + "cr"):
                out.append("\n")
            elif el.tag == W + "tab":
                out.append(" ")
        return "".join(out)

    def para(p):
        style = ""
        level = 0
        ppr = p.find(W + "pPr")
        if ppr is not None:
            ps = ppr.find(W + "pStyle")
            if ps is not None:
                style = styles.get(ps.get(W + "val"), ps.get(W + "val") or "")
            ol = ppr.find(W + "outlineLvl")
            if ol is not None and ol.get(W + "val", "").isdigit():
                level = int(ol.get(W + "val")) + 1
        m = re.match(r"(?i)heading\s*(\d)", style)
        if m:
            level = int(m.group(1))
        elif style.lower() == "title":
            level = 0
        links = [rels.get(h.get(R + "id"), "") for h in p.iter(W + "hyperlink") if h.get(R + "id")]
        return {"type": "p", "text": para_text(p).strip(), "level": level, "style": style,
                "links": [x for x in links if x]}

    def table(t):
        rows = []
        for tr in t.findall(W + "tr"):
            cells = []
            for tc in tr.findall(W + "tc"):
                cells.append("\n".join(para_text(p).strip() for p in tc.findall(W + "p")).strip())
            rows.append(cells)
        return {"type": "table", "rows": rows}

    body = doc.find(W + "body")
    blocks = []
    for el in body:
        if el.tag == W + "p":
            blocks.append(para(el))
        elif el.tag == W + "tbl":
            blocks.append(table(el))
        elif el.tag == W + "sdt":  # content controls: look inside
            for inner in el.iter():
                if inner.tag == W + "p":
                    blocks.append(para(inner))
    return blocks


# --------------------------------------------------------------------------- blocks -> lesson

RE_ARTICLE = re.compile(r"^(?:article|passage|reading)\s*(\d+)\s*(?:[|·:\-–—．.]\s*(.*))?$", re.I)
RE_GRAMMAR = re.compile(r"grammar|文法|語法|句型", re.I)
RE_REVIEW = re.compile(r"today.?s\s*\d+\s*words|quick review|總複習|^review\b|^複習", re.I)
RE_VOCAB_HEAD = re.compile(r"vocabulary|字彙|單字", re.I)
RE_SUMMARY = re.compile(r"^中文摘要|^summary\b|^摘要", re.I)
RE_WORDCOUNT = re.compile(r"^\(?\s*\d+\s*words?\s*\)?$", re.I)
RE_POS = re.compile(
    r"\s+((?:(?:n|v|adj|adv|prep|conj|pron|phr|det|int|aux)\.\s*(?:\((?:pl|sing)\.?\)\s*)?(?:/\s*)?)+)$",
    re.I)
RE_URL = re.compile(r"https?://[^\s<>）)]+")


def clean(s):
    return re.sub(r"[ \t ]+", " ", (s or "").replace("\\", "")).strip()


def word_key(w):
    w = re.sub(r"\(.*?\)", "", w.lower())
    return re.sub(r"\s+", " ", w).strip(" .")


def split_word_cell(cell, has_pos, has_ipa):
    text = clean(cell.replace("\n", " "))
    star = "★" in text
    text = clean(re.sub(r"^\d+\s*[.)、]\s*", "", text.replace("★", " ")))
    ipa = pos = ""
    if has_ipa:
        m = re.match(r"^(.*?)\s*(/[^/\s](?:[^/]*[^/\s])?/)\s*(.*)$", text)
        if m:
            text, ipa = clean(m.group(1) + " " + m.group(3)), m.group(2)
    if has_pos:
        m = RE_POS.search(" " + text)
        if m:
            pos = clean(m.group(1))
            text = clean((" " + text)[: m.start()])
    return text, star, ipa, pos


def parse_vocab_table(rows):
    if len(rows) < 2:
        return None
    head = [clean(h).lower() for h in rows[0]]
    if not any("example" in h or "例句" in h for h in head):
        return None
    col = {}
    for i, h in enumerate(head):
        if h in ("#", "no", "no.", "編號"):
            col.setdefault("num", i)
        elif "word" in h or "單字" in h or h == "詞彙":
            col.setdefault("word", i)
            if "ipa" in h or "音標" in h:
                col["word_ipa"] = True
            if "詞性" in h or "pos" in h:
                col["word_pos"] = True
        elif "ipa" in h or "音標" in h or "pronunciation" in h:
            col.setdefault("ipa", i)
        elif h in ("pos", "詞性", "part of speech") or "詞性" in h:
            col.setdefault("pos", i)
        elif "colloc" in h or "搭配" in h:
            col.setdefault("colloc", i)
        elif "example" in h or "例句" in h:
            col.setdefault("example", i)
        elif "中文" in h or "meaning" in h or "意思" in h or "chinese" in h:
            col.setdefault("zh", i)
    if "word" not in col:
        return None
    out = []

    def get(r, k):
        i = col.get(k)
        return clean(r[i]) if i is not None and i < len(r) else ""

    for r in rows[1:]:
        raw = r[col["word"]] if col["word"] < len(r) else ""
        if not clean(raw):
            continue
        word, star, ipa, pos = split_word_cell(raw, col.get("word_pos") or "pos" not in col,
                                               col.get("word_ipa") or "ipa" not in col)
        if get(r, "ipa"):
            ipa = get(r, "ipa")
        if get(r, "pos"):
            pos = get(r, "pos")
        if "★" in (get(r, "pos") + get(r, "zh")):
            star = True
        out.append({
            "word": word, "key": word_key(word), "star": star, "ipa": ipa, "pos": pos.replace("★", "").strip(),
            "zh": get(r, "zh").replace("★", "").strip(), "colloc": get(r, "colloc"),
            "example": get(r, "example"),
        })
    return out


def parse_lesson(blocks, name, fallback_date):
    m = re.search(r"(\d{4})[-_.](\d{1,2})[-_.](\d{1,2})", name)
    date = f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else ""
    lesson = {"title": "", "subtitle": "", "date": date, "articles": [], "grammar": [], "notes": []}
    art = None          # current article
    mode = "intro"      # intro | title | body | summary | vocab | grammar | review
    gram = None         # current grammar section
    gram_level = 0

    def new_grammar(title, level):
        nonlocal gram
        gram = {"title": title, "body": [], "article": art["n"] if art else None}
        lesson["grammar"].append(gram)
        return gram

    for b in blocks:
        if b["type"] == "table":
            rows = [[clean(c) for c in r] for r in b["rows"] if any(clean(c) for c in r)]
            if not rows:
                continue
            flat = "\n".join(" ".join(r) for r in rows).strip()
            vocab = parse_vocab_table(rows)
            if vocab is not None:
                if art is not None and mode != "review":
                    art["vocab"] += vocab
                elif mode != "review":
                    lesson.setdefault("extra_vocab", []).extend(vocab)
                continue
            if len(rows) == 1 and len(rows[0]) == 1 and RE_SUMMARY.match(flat):
                if art is not None:
                    art["summary"] = clean(RE_SUMMARY.sub("", flat, count=1)).lstrip("：: \n")
                continue
            if mode == "grammar" and gram is not None:
                gram["body"].append({"table": rows})
            continue

        text = b["text"]
        if not text:
            continue
        level = b["level"]
        one_line = clean(text.replace("\n", " "))

        if not lesson["title"]:
            lesson["title"] = one_line
            continue

        am = RE_ARTICLE.match(one_line)
        if am and (level or len(one_line) < 80):
            same = [a for a in lesson["articles"] if a["n"] == int(am.group(1))]
            if same:  # e.g. "ARTICLE 1 · WORLD AFFAIRS · VOCABULARY": more of the same article
                art, gram = same[-1], None
                mode = "vocab" if RE_VOCAB_HEAD.search(one_line) else "body"
                continue
            art = {"n": int(am.group(1)), "category": clean(am.group(2) or ""), "title": "",
                   "source": "", "url": "", "body": [], "summary": "", "vocab": []}
            lesson["articles"].append(art)
            mode, gram = "title", None
            continue

        if level and RE_REVIEW.search(one_line):
            mode, art, gram = "review", None, None
            continue

        if level and RE_GRAMMAR.search(one_line) and not RE_VOCAB_HEAD.search(one_line):
            mode, gram_level = "grammar", level
            if level <= 1:
                art = None          # a top-level grammar section belongs to the whole lesson
            new_grammar(one_line, level)
            continue

        if mode == "grammar":
            if level and level <= gram_level:
                mode, gram = ("body" if art else "intro"), None
            elif level:
                # a sub-heading inside a grammar section = one grammar point
                if gram is not None and not gram["body"]:
                    gram["title"] = one_line   # section heading had no text of its own
                else:
                    new_grammar(one_line, level)
                continue
            else:
                gram["body"].append({"p": text})
                continue

        if level and RE_SUMMARY.match(one_line):
            mode = "summary"
            continue
        if level and RE_VOCAB_HEAD.search(one_line):
            mode = "vocab"
            continue

        if art is None:
            if mode == "intro" and not lesson["subtitle"] and len(one_line) < 60:
                lesson["subtitle"] = one_line
            elif not date:
                dm = re.search(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", one_line)
                if dm:
                    date = lesson["date"] = f"{dm.group(1)}-{int(dm.group(2)):02d}-{int(dm.group(3)):02d}"
            continue

        if one_line.lower().startswith("source"):
            url = (b["links"] or RE_URL.findall(one_line) or [""])[0]
            src = re.sub(r"^source\s*[:：]\s*", "", one_line, flags=re.I)
            src = RE_URL.sub("", src).replace("<>", "").strip(" <>")
            art["source"], art["url"] = src, url
            if mode == "title":
                mode = "body"
            continue

        if mode == "title":
            art["title"] = one_line
            mode = "body"
            continue
        if RE_WORDCOUNT.match(one_line):
            continue
        if mode == "summary":
            art["summary"] = (art["summary"] + "\n" + one_line).strip()
            continue
        if mode == "body":
            if level:
                continue
            art["body"].append(one_line)

    if not lesson["date"]:
        lesson["date"] = fallback_date
    # drop articles that ended up empty (e.g. a headline list that looked like "Article 1 ...")
    lesson["articles"] = [a for a in lesson["articles"] if a["body"] or a["vocab"]]
    for g in lesson["grammar"]:
        g["body"] = [x for x in g["body"] if x.get("p") or x.get("table")]
    lesson["grammar"] = [g for g in lesson["grammar"] if g["body"]]
    return lesson


# --------------------------------------------------------------------------- build output

def slug(s):
    return re.sub(r"[^A-Za-z0-9_-]+", "-", s).strip("-")[:80] or "lesson"


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    os.replace(tmp, path)


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def build(files, fetch, folder_url):
    state_path = os.path.join(DATA, "sync_state.json")
    state = load_json(state_path, {})
    if state.get("parser") != PARSER_VERSION:
        state = {"parser": PARSER_VERSION, "files": {}}
    known = state["files"]
    lessons_dir = os.path.join(DATA, "lessons")
    today = dt.date.today().isoformat()
    changed = False
    seen = set()

    for f in sorted(files, key=lambda x: x["name"]):
        if not is_supported(f):
            print(f"skip (not .docx / Google Doc): {f['name']}")
            continue
        seen.add(f["id"])
        prev = known.get(f["id"])
        if prev and prev.get("modified") == f["modified"] and prev.get("name") == f["name"] \
                and os.path.exists(os.path.join(lessons_dir, prev["lesson"] + ".json")):
            continue
        print(f"parse: {f['name']}")
        try:
            blocks = docx_blocks(fetch(f))
        except Exception as e:  # noqa: BLE001
            print(f"   ERROR {e}")
            continue
        lesson = parse_lesson(blocks, f["name"], today)
        lid = slug(lesson["date"] + "_" + os.path.splitext(f["name"])[0]) if lesson["date"] not in f["name"] \
            else slug(os.path.splitext(f["name"])[0])
        lesson.update({"id": lid, "file": f["name"], "driveId": f["id"], "modified": f["modified"]})
        nv = sum(len(a["vocab"]) for a in lesson["articles"])
        print(f"   -> {lid}: {len(lesson['articles'])} articles, {nv} words, {len(lesson['grammar'])} grammar")
        if prev and prev.get("lesson") != lid:
            try:
                os.remove(os.path.join(lessons_dir, prev["lesson"] + ".json"))
            except OSError:
                pass
        write_json(os.path.join(lessons_dir, lid + ".json"), lesson)
        known[f["id"]] = {"name": f["name"], "modified": f["modified"], "lesson": lid}
        changed = True

    # files removed from Drive -> remove their lessons
    for fid in list(known):
        if fid not in seen:
            print(f"removed from Drive: {known[fid]['name']}")
            try:
                os.remove(os.path.join(lessons_dir, known[fid]["lesson"] + ".json"))
            except OSError:
                pass
            del known[fid]
            changed = True

    lessons = [load_json(os.path.join(lessons_dir, v["lesson"] + ".json"), None) for v in known.values()]
    lessons = sorted([x for x in lessons if x], key=lambda x: (x["date"], x["id"]), reverse=True)

    vocab, grammar = {}, []
    for les in sorted(lessons, key=lambda x: x["date"]):
        for a in les["articles"]:
            for v in a["vocab"]:
                e = vocab.setdefault(v["key"], {"key": v["key"], "word": v["word"], "star": False, "ipa": "",
                                                "pos": "", "zh": "", "uses": []})
                for k in ("ipa", "pos", "zh", "word"):
                    if v[k] and not e[k]:
                        e[k] = v[k]
                e["star"] = e["star"] or v["star"]
                e["uses"].append({"lesson": les["id"], "date": les["date"], "article": a["n"],
                                  "category": a["category"], "zh": v["zh"], "colloc": v["colloc"],
                                  "example": v["example"]})
        for i, g in enumerate(les["grammar"]):
            grammar.append({"id": f"{les['id']}#{i}", "lesson": les["id"], "date": les["date"], **g})
    for e in vocab.values():
        e["first"] = e["uses"][0]["date"]
    vocab_list = sorted(vocab.values(), key=lambda e: (e["first"], e["key"]), reverse=True)

    index = {
        "updated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "folder": folder_url,
        "lessons": [{
            "id": x["id"], "date": x["date"], "title": x["title"], "subtitle": x.get("subtitle", ""),
            "file": x["file"],
            "articles": [{"n": a["n"], "category": a["category"], "title": a["title"], "words": len(a["vocab"])}
                         for a in x["articles"]],
            "grammar": len(x["grammar"]),
        } for x in lessons],
        "counts": {"lessons": len(lessons), "words": len(vocab_list), "grammar": len(grammar),
                   "articles": sum(len(x["articles"]) for x in lessons)},
    }
    old_index = load_json(os.path.join(DATA, "index.json"), {})
    old_index.pop("updated", None)
    cmp_index = dict(index)
    cmp_index.pop("updated")
    if changed or old_index != cmp_index or not os.path.exists(os.path.join(DATA, "vocab.json")):
        write_json(os.path.join(DATA, "index.json"), index)
        write_json(os.path.join(DATA, "vocab.json"), vocab_list)
        write_json(os.path.join(DATA, "grammar.json"), grammar)
        write_json(state_path, state)
        print(f"wrote data: {index['counts']}")
    else:
        print("no changes")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--folder", default=os.environ.get("DRIVE_FOLDER_ID") or DEFAULT_FOLDER)
    ap.add_argument("--local", help="read .docx files from this local directory instead of Drive")
    args = ap.parse_args()

    if args.local:
        files = []
        for n in os.listdir(args.local):
            p = os.path.join(args.local, n)
            if os.path.isfile(p) and n.lower().endswith(".docx"):
                files.append({"id": "local:" + n, "name": n, "modified": str(int(os.path.getmtime(p))),
                              "mime": DOCX_MIME, "path": p})
        fetch = lambda f: open(f["path"], "rb").read()  # noqa: E731
        build(files, fetch, "")
        return

    key = os.environ.get("GOOGLE_API_KEY")
    files = list_folder_api(args.folder, key) if key else list_folder_embedded(args.folder)
    print(f"Drive folder lists {len(files)} file(s)")
    if not files:
        # An empty listing is almost always a sharing / network problem; never wipe the site for it.
        print("ERROR: no files listed. Is the folder shared as 'Anyone with the link'?")
        sys.exit(1)
    build(files, download, f"https://drive.google.com/drive/folders/{args.folder}")


if __name__ == "__main__":
    main()
