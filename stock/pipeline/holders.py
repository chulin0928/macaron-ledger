"""Shareholding structure per stock: 外資持股比例 (daily) and 大戶 / 散戶 持股比例 (weekly, TDCC 集保).

TDCC 持股分級 levels (shares): 1: <1,000 · 2: 1-5 張 · 3: 5-10 · 4: 10-15 · 5: 15-20 · 6: 20-30
· 7: 30-40 · 8: 40-50 · 9: 50-100 · 10: 100-200 · 11: 200-400 · 12: 400-600 · 13: 600-800
· 14: 800-1,000 · 15: >1,000 張.
  散戶 = levels 1-8 (50 張以下) · 大戶 = levels 12-15 (400 張以上) · 千張大戶 = level 15
Stored per stock as {YYYYMMDD: [retail_pct, big_pct, k1000_pct, holders]}.
"""
from __future__ import annotations

import csv
import io
import os
import re

from . import sources as S

TDCC_QUERY = "https://www.tdcc.com.tw/portal/zh/smWeb/qryStock"
TDCC_OPEN = "https://opendata.tdcc.com.tw/getOD.ashx?id=1-5"
S.MIN_GAP.setdefault("www.tdcc.com.tw", 1.2)
S.MIN_GAP.setdefault("opendata.tdcc.com.tw", 1.0)


def _summarize(levels: dict[int, tuple[float, float]]):
    """levels: {level: (holders, pct)} → [retail_pct, big_pct, k1000_pct, holders]"""
    pct = lambda ls: round(sum(levels.get(k, (0, 0))[1] for k in ls), 2)  # noqa: E731
    holders = int(sum(levels.get(k, (0, 0))[0] for k in range(1, 16)))
    return [pct(range(1, 9)), pct(range(12, 16)), pct([15]), holders]


def tdcc_latest():
    """All stocks for the most recent week. Returns (YYYYMMDD, {code: summary})."""
    r = S.get(TDCC_OPEN, as_json=False)
    text = r.content.decode("utf-8-sig", errors="ignore")
    per: dict[str, dict[int, tuple[float, float]]] = {}
    day = None
    for row in csv.reader(io.StringIO(text)):
        if len(row) < 6 or not row[0].strip().isdigit():
            continue
        day = row[0].strip()
        code = row[1].strip()
        if not S.STOCK_CODE.match(code):
            continue
        lvl = int(row[2])
        if 1 <= lvl <= 15:
            per.setdefault(code, {})[lvl] = (float(row[3] or 0), float(row[5] or 0))
    return day, {c: _summarize(v) for c, v in per.items()}


_token = None


def _tdcc_form():
    global _token
    if _token is None:
        h = S.get(TDCC_QUERY, as_json=False).text
        tok = re.search(r'name="SYNCHRONIZER_TOKEN"[^>]*value="([^"]+)"', h)
        dates = re.findall(r'<option[^>]*value="(20\d{6})"', h)
        _token = (tok.group(1) if tok else "", dates)
    return _token


def tdcc_dates():
    return _tdcc_form()[1]


def tdcc_week(code: str, day: str):
    """One stock, one week; retries once with a fresh form if the reply has no table."""
    global _token
    for _ in range(2):
        v = _tdcc_week(code, day)
        if v:
            return v
        _token = None
    return None


def _tdcc_week(code: str, day: str):
    """One stock, one week (YYYYMMDD) from the TDCC query page."""
    from lxml import html

    tok, dates = _tdcc_form()
    form = {"SYNCHRONIZER_TOKEN": tok, "SYNCHRONIZER_URI": "/portal/zh/smWeb/qryStock", "method": "submit",
            "firDate": dates[0] if dates else day, "scaDate": day, "sqlMethod": "StockNo", "stockNo": code, "stockName": ""}
    host = "www.tdcc.com.tw"
    import time
    wait = S._last_call.get(host, 0) + S.MIN_GAP[host] - time.time()
    if wait > 0:
        time.sleep(wait)
    S._last_call[host] = time.time()
    r = S.SESSION.post(TDCC_QUERY, data=form, timeout=40)
    global _token
    nxt = re.search(r'name="SYNCHRONIZER_TOKEN"[^>]*value="([^"]+)"', r.text)
    _token = (nxt.group(1), dates) if nxt else None  # the token is single-use; the reply carries the next one
    doc = html.fromstring(r.text)
    levels = {}
    for tr in doc.xpath("//table//tr"):
        tds = [td.text_content().strip() for td in tr.xpath("./td")]
        if len(tds) >= 5 and tds[0].isdigit() and 1 <= int(tds[0]) <= 15:
            levels[int(tds[0])] = (S.num(tds[2]) or 0, S.num(tds[4]) or 0)
    return _summarize(levels) if levels else None


def finmind_foreign(code: str, start: str):
    """{YYYY-MM-DD: 外資持股比例 %} from FinMind TaiwanStockShareholding."""
    token = os.environ.get("FINMIND_TOKEN")
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    r = S.SESSION.get("https://api.finmindtrade.com/api/v4/data",
                      params={"dataset": "TaiwanStockShareholding", "data_id": code, "start_date": start},
                      headers=headers, timeout=30)
    j = r.json()
    if j.get("status") != 200:
        raise S.Blocked(j.get("msg", "finmind"))
    return {d["date"]: d["ForeignInvestmentSharesRatio"] for d in j["data"]}


def update(data_dir, codes, load_json, save_json, log, weeks_back=26, foreign_days=200):
    """Refresh the weekly all-stock snapshot, backfill TDCC weeks and foreign % for `codes`."""
    from datetime import date, timedelta

    hdir = data_dir / "holders"
    # 1) newest week for every stock (one download)
    try:
        day, allrows = tdcc_latest()
        if day and allrows:
            save_json(hdir / "weeks" / f"{day}.json", allrows)
    except Exception as e:  # noqa: BLE001
        log.append(f"集保週資料下載失敗: {e}")
    weekly = {p.stem: load_json(p, {}) for p in sorted((hdir / "weeks").glob("*.json"))}

    # 2) per-stock history for the stocks shown in 籌碼
    try:
        dates = tdcc_dates()[:weeks_back]
    except Exception as e:  # noqa: BLE001
        dates = []
        log.append(f"集保歷史查詢失敗: {e}")
    start = (date.today() - timedelta(days=foreign_days)).isoformat()
    out = {}
    fm_ok = True
    for code in codes:
        p = hdir / "stocks" / f"{code}.json"
        rec = load_json(p, {"tdcc": {}, "foreign": {}})
        for day, rows in weekly.items():
            if code in rows:
                rec["tdcc"][day] = rows[code]
        for day in dates:
            if day in rec["tdcc"]:
                continue
            try:
                v = tdcc_week(code, day)
            except Exception:  # noqa: BLE001
                v = None
            if v:
                rec["tdcc"][day] = v
        if fm_ok:
            have = sorted(rec["foreign"])
            since = have[-1] if have else start
            try:
                rec["foreign"].update(finmind_foreign(code, since))
            except Exception as e:  # noqa: BLE001
                fm_ok = False
                log.append(f"外資持股比例在 {code} 停止更新（{e}），下次再補。")
        rec["tdcc"] = dict(sorted(rec["tdcc"].items())[-60:])
        rec["foreign"] = dict(sorted(rec["foreign"].items())[-260:])
        save_json(p, rec)
        out[code] = summary(rec)
    return out


def summary(rec):
    t = sorted(rec["tdcc"].items())
    f = sorted(rec["foreign"].items())

    def chg(series, k):
        return round(series[-1] - series[-1 - k], 2) if len(series) > k else None

    weeks = [d for d, _ in t]
    retail = [v[0] for _, v in t]
    big = [v[1] for _, v in t]
    k1000 = [v[2] for _, v in t]
    holders = [v[3] for _, v in t]
    fpct = [v for _, v in f]
    read = []
    if len(big) > 4:
        db, dr = chg(big, 4), chg(retail, 4)
        if db is not None and dr is not None:
            if db > 0.3 and dr < 0:
                read.append("近 4 週大戶加碼、散戶減少：籌碼往大戶集中（偏多）")
            elif db < -0.3 and dr > 0:
                read.append("近 4 週大戶減碼、散戶增加：籌碼分散到散戶手上（偏空）")
    if len(fpct) > 20:
        df = chg(fpct, 20)
        if df is not None and abs(df) >= 0.5:
            read.append(f"外資持股比例近 20 個交易日{'增加' if df > 0 else '減少'} {abs(df):.2f} 個百分點")
    return {
        "weeks": weeks, "retail": retail, "big": big, "k1000": k1000, "holders": holders,
        "fdates": [d for d, _ in f][-120:], "foreign": fpct[-120:],
        "chg": {"big4": chg(big, 4), "big12": chg(big, 12), "retail4": chg(retail, 4), "retail12": chg(retail, 12),
                "k1000_4": chg(k1000, 4), "holders4": chg(holders, 4),
                "f20": chg(fpct, 20), "f60": chg(fpct, 60)},
        "read": read,
    }
