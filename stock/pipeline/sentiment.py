"""PTT Stock 板情緒 → 恐懼貪婪指數 (contrarian reading).

Each day's articles (title + body) and push comments are scored with a Taiwan
stock-market lexicon. Greed words (歐印, 睡飽數錢, 飛向宇宙 …) add to G, fear words
(畢業, 公園排隊, 塊陶 …) add to F. An article's own words are weighted by its
推噓比 (well-received posts count more, heavily booed posts count less).
Index = 100 * G / (G + F): 50 is neutral, high = euphoria (短線過熱), low = panic.
"""
from __future__ import annotations

import re
from collections import Counter
from datetime import date, datetime, timedelta

from . import sources as S

GREED = {
    "歐印": 3, "all in": 3, "梭哈": 3, "睡飽數錢": 3, "飛向宇宙": 3, "財富自由": 2.5, "賺爛": 2.5,
    "噴爛": 2.5, "少年股神": 2, "起飛": 2, "噴出": 2, "買爆": 2, "漲爆": 2, "繼續噴": 2, "月球": 2,
    "噴": 1.5, "漲停": 1.5, "上車": 1.5, "吃肉": 1.5, "發財": 1.5, "印鈔": 1.5, "噴發": 2,
    "加碼": 1, "新高": 1, "多軍": 1, "爽": 1, "會漲": 1, "大賺": 1.5, "賺翻": 2, "無腦多": 2,
    "股神": 1, "不賣": 1, "抱緊": 1, "要漲": 1, "噴起來": 2, "飆": 1.5, "漲翻": 2,
}
FEAR = {
    "畢業": 3, "公園排隊": 3, "塊陶": 3, "斷頭": 3, "崩盤": 3, "血流成河": 3, "哀鴻遍野": 3,
    "丸子": 2.5, "快逃": 2.5, "追繳": 2.5, "腰斬": 2.5, "逃命": 2.5, "歸零": 2.5,
    "完了": 2, "崩": 2, "跌停": 2, "套牢": 2, "住套房": 2, "認賠": 2, "繳學費": 2, "下市": 2,
    "認輸": 2, "投降": 2, "砍在阿呆谷": 2, "賠光": 2.5, "公園": 1.5, "停損": 1.5, "慘": 1.5,
    "綠油油": 1.5, "接刀": 1.5, "賣房": 1.5, "賠": 1, "韭菜": 1, "空軍": 1, "躺平": 1, "刀子": 1,
    "跌爛": 2, "崩跌": 2.5, "大跌": 1.5, "恐慌": 2, "割肉": 2, "被套": 1.5, "凹單": 1.5,
}
_G = sorted(GREED, key=len, reverse=True)
_F = sorted(FEAR, key=len, reverse=True)
CODE_IN_TITLE = re.compile(r"(?<!\d)([1-9]\d{3})(?!\d)")


def score(text: str):
    """Returns (greed, fear, Counter_of_greed_words, Counter_of_fear_words). Longer words win."""
    t = text.lower()
    g = f = 0.0
    cg, cf = Counter(), Counter()
    for words, table, cnt in ((_G, GREED, cg), (_F, FEAR, cf)):
        tmp = t
        for w in words:
            n = tmp.count(w)
            if n:
                cnt[w] += n
                tmp = tmp.replace(w, " ")
        if table is GREED:
            g = sum(GREED[w] * n for w, n in cnt.items())
        else:
            f = sum(FEAR[w] * n for w, n in cnt.items())
    return g, f, cg, cf


def _list_date(md: str, today: date) -> date | None:
    try:
        m, d = (int(x) for x in md.strip().split("/"))
    except ValueError:
        return None
    y = today.year if (m, d) <= (today.month, today.day) else today.year - 1
    try:
        return date(y, m, d)
    except ValueError:
        return None


def crawl(days: list[date], today: date, max_pages: int = 400):
    """Collect list entries for the given TW dates, newest page first."""
    want = set(days)
    earliest = min(days)
    entries = []
    url = S.PTT + "/bbs/Stock/index.html"
    for _ in range(max_pages):
        items, prev = S.ptt_index(url)
        dates = [_list_date(i["date"], today) for i in items]
        for it, d in zip(items, dates):
            if d in want and not it["title"].startswith("[公告]"):
                it["d"] = d
                entries.append(it)
        valid = [d for d in dates if d]
        if (valid and max(valid) < earliest) or not prev:
            break
        url = prev
    return entries


def summarize_day(d: date, entries: list[dict]):
    G = F = 0.0
    cg, cf = Counter(), Counter()
    stocks: dict[str, dict] = {}
    hot = []
    n_push = 0
    for e in entries:
        try:
            a = S.ptt_article(e["href"])
        except S.Blocked:
            continue
        push = sum(1 for t, _ in a["pushes"] if t == "推")
        boo = sum(1 for t, _ in a["pushes"] if t == "噓")
        n_push += len(a["pushes"])
        weight = 1 + (push - boo) / (push + boo + 1)  # 0..2, 推噓比 as credibility
        title = e["title"]
        g, f, g1, f1 = score(title + "\n" + a["body"])
        if title.startswith("[標的]"):
            if re.search(r"(?:^|\s)多\s*$", title) or title.rstrip().endswith("多"):
                g += 1; g1["標的:多"] += 1
            if title.rstrip().endswith("空"):
                f += 1; f1["標的:空"] += 1
        g, f = g * weight, f * weight
        pg = pf = 0.0
        for _, txt in a["pushes"]:
            x = score(txt)
            pg += x[0]; pf += x[1]; g1.update(x[2]); f1.update(x[3])
        G += g + pg; F += f + pf
        cg.update(g1); cf.update(f1)
        for code in set(CODE_IN_TITLE.findall(title)):
            st = stocks.setdefault(code, {"n": 0, "G": 0.0, "F": 0.0, "push": 0, "boo": 0, "titles": []})
            st["n"] += 1; st["G"] += g + pg; st["F"] += f + pf; st["push"] += push; st["boo"] += boo
            if len(st["titles"]) < 3:
                st["titles"].append({"t": title, "u": S.PTT + e["href"]})
        hot.append({"t": title, "u": S.PTT + e["href"], "push": push, "boo": boo})
    hot.sort(key=lambda h: h["push"] + h["boo"], reverse=True)
    idx = round(100 * G / (G + F), 1) if G + F > 0 else None
    for st in stocks.values():
        st["G"] = round(st["G"], 1); st["F"] = round(st["F"], 1)
        st["idx"] = round(100 * st["G"] / (st["G"] + st["F"]), 1) if st["G"] + st["F"] > 0 else None
    return {
        "date": d.isoformat(), "articles": len(entries), "pushes": n_push,
        "G": round(G, 1), "F": round(F, 1), "index": idx,
        "top_greed": cg.most_common(8), "top_fear": cf.most_common(8),
        "stocks": dict(sorted(stocks.items(), key=lambda kv: -kv[1]["n"])[:30]),
        "hot": hot[:8],
    }


def run(days_back: int = 1, today: date | None = None):
    """Crawl today + `days_back` previous days. Returns list of day summaries (oldest first)."""
    today = today or (datetime.utcnow() + timedelta(hours=8)).date()
    days = [today - timedelta(days=i) for i in range(days_back + 1)]
    entries = crawl(days, today)
    out = []
    for d in sorted(days):
        es = [e for e in entries if e["d"] == d]
        if es:
            print(f"PTT {d}: {len(es)} articles", flush=True)
            out.append(summarize_day(d, es))
    return out
