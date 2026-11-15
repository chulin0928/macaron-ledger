"""Fetchers for Taiwan market data (TWSE 上市 + TPEx 上櫃) and PTT.

Every fetcher returns plain dicts keyed by 4-digit stock code. Network calls go
through `get()`, which spaces requests out and backs off when the exchanges'
anti-scraping page ("FOR SECURITY REASONS") appears.
"""
from __future__ import annotations

import re
import time
from datetime import date

import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9"})

STOCK_CODE = re.compile(r"^[1-9]\d{3}$")  # common shares only; ETFs start with 0
_last_call: dict[str, float] = {}
MIN_GAP = {"www.twse.com.tw": 3.5, "www.tpex.org.tw": 2.0, "mopsov.twse.com.tw": 6.0, "www.ptt.cc": 0.4}


class Blocked(Exception):
    pass


def get(url: str, *, params=None, cookies=None, tries: int = 4, as_json: bool = True):
    host = url.split("/")[2]
    for attempt in range(tries):
        gap = MIN_GAP.get(host, 1.0)
        wait = _last_call.get(host, 0) + gap - time.time()
        if wait > 0:
            time.sleep(wait)
        _last_call[host] = time.time()
        try:
            r = SESSION.get(url, params=params, cookies=cookies, timeout=40, allow_redirects=False)
        except requests.RequestException:
            time.sleep(10 * (attempt + 1))
            continue
        blocked = r.status_code in (302, 307, 403, 429) or b"FOR SECURITY REASONS" in r.content[:2000]
        if blocked:
            time.sleep(30 * (attempt + 1))
            continue
        if r.status_code != 200:
            time.sleep(5)
            continue
        if not as_json:
            return r
        try:
            return r.json()
        except ValueError:
            time.sleep(10)
    raise Blocked(url)


def num(s) -> float | None:
    if s is None:
        return None
    s = re.sub(r"<[^>]+>", "", str(s)).replace(",", "").strip()
    if s in ("", "--", "---", "-", "X", "除權息", "除息", "除權"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def roc(d: date) -> str:
    return f"{d.year - 1911}/{d.month:02d}/{d.day:02d}"


# ---------------------------------------------------------------- prices
def twse_prices(d: date):
    """Returns (rows, taiex) or (None, None) on a non-trading day."""
    j = get("https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX",
            params={"response": "json", "date": d.strftime("%Y%m%d"), "type": "ALLBUT0999"})
    if j.get("stat") not in (None, "OK") or not j.get("tables"):
        return None, None
    rows, taiex, names = {}, None, {}
    for t in j["tables"]:
        f = t.get("fields") or []
        if f and f[0] == "指數":
            for r in t.get("data", []):
                if r[0].startswith("發行量加權股價指數"):
                    taiex = num(r[1])
        if "證券代號" in f and "收盤價" in f:
            ic, iv = f.index("收盤價"), f.index("成交股數")
            for r in t["data"]:
                code = r[0].strip()
                if STOCK_CODE.match(code):
                    rows[code] = (num(r[ic]), (num(r[iv]) or 0) / 1000)
                    names[code] = r[1].strip()
    if not rows:
        return None, None
    return {"rows": rows, "names": names}, taiex


def tpex_prices(d: date):
    j = get("https://www.tpex.org.tw/www/zh-tw/afterTrading/otc",
            params={"date": d.strftime("%Y/%m/%d"), "type": "EW", "response": "json"})
    tables = j.get("tables") or []
    if not tables or not tables[0].get("data"):
        return None
    t = tables[0]
    rows, names = {}, {}
    for r in t["data"]:
        code = r[0].strip()
        if STOCK_CODE.match(code):
            rows[code] = (num(r[2]), (num(r[7]) or 0) / 1000)
            names[code] = r[1].strip()
    return {"rows": rows, "names": names} if rows else None


# ---------------------------------------------------------------- institutional (三大法人, 單位: 張)
def twse_inst(d: date):
    j = get("https://www.twse.com.tw/rwd/zh/fund/T86",
            params={"response": "json", "date": d.strftime("%Y%m%d"), "selectType": "ALLBUT0999"})
    if j.get("stat") != "OK":
        return None
    out = {}
    for r in j["data"]:
        code = r[0].strip()
        if STOCK_CODE.match(code):
            foreign = (num(r[4]) or 0) + (num(r[7]) or 0)
            out[code] = (round(foreign / 1000), round((num(r[10]) or 0) / 1000), round((num(r[11]) or 0) / 1000))
    return out or None


def tpex_inst(d: date):
    j = get("https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade",
            params={"type": "Daily", "sect": "EW", "date": d.strftime("%Y/%m/%d"), "response": "json"})
    tables = j.get("tables") or []
    if not tables or not tables[0].get("data"):
        return None
    out = {}
    for r in tables[0]["data"]:
        code = r[0].strip()
        if STOCK_CODE.match(code):
            out[code] = (round((num(r[10]) or 0) / 1000), round((num(r[13]) or 0) / 1000), round((num(r[22]) or 0) / 1000))
    return out or None


# ---------------------------------------------------------------- margin (融資餘額, 張)
def twse_margin(d: date):
    j = get("https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN",
            params={"response": "json", "date": d.strftime("%Y%m%d"), "selectType": "ALL"})
    if j.get("stat") != "OK":
        return None
    out = {}
    for t in j.get("tables", []):
        f = t.get("fields") or []
        if f[:1] == ["代號"]:
            for r in t["data"]:
                code = r[0].strip()
                if STOCK_CODE.match(code):
                    out[code] = num(r[6])
    return out or None


def tpex_margin(d: date):
    j = get("https://www.tpex.org.tw/www/zh-tw/margin/balance",
            params={"date": d.strftime("%Y/%m/%d"), "response": "json"})
    tables = j.get("tables") or []
    if not tables or not tables[0].get("data"):
        return None
    out = {}
    for r in tables[0]["data"]:
        code = r[0].strip()
        if STOCK_CODE.match(code):
            out[code] = num(r[6])
    return out or None


# ---------------------------------------------------------------- monthly revenue
def revenue_latest():
    """Latest published month for 上市 + 上櫃 from the open-data APIs.
    Returns {"YYYYMM": {code: {"yoy": float, "rev": float, "name": str, "industry": str}}}."""
    out: dict[str, dict] = {}
    for url in ("https://openapi.twse.com.tw/v1/opendata/t187ap05_L",
                "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O"):
        try:
            rows = get(url)
        except Blocked:
            continue
        for r in rows:
            code = str(r.get("公司代號", "")).strip()
            ym = str(r.get("資料年月", "")).strip()
            if not STOCK_CODE.match(code) or len(ym) < 4:
                continue
            key = f"{int(ym[:-2]) + 1911}{ym[-2:]}"
            out.setdefault(key, {})[code] = {
                "yoy": num(r.get("營業收入-去年同月增減(%)")),
                "rev": num(r.get("營業收入-當月營收")),
                "name": str(r.get("公司名稱", "")).strip(),
                "industry": str(r.get("產業別", "")).strip(),
            }
    return out


def revenue_month_mops(year: int, month: int):
    """Historical month from MOPS static pages (上市 sii + 上櫃 otc). {code: {"yoy","rev"}}"""
    from lxml import html as lh

    out = {}
    for market in ("sii", "otc"):
        url = f"https://mopsov.twse.com.tw/nas/t21/{market}/t21sc03_{year - 1911}_{month}_0.html"
        r = get(url, as_json=False, tries=3)
        doc = lh.fromstring(r.content.decode("big5", errors="ignore"))
        for tr in doc.xpath("//tr"):
            tds = [td.text_content().strip() for td in tr.xpath("./td")]
            if len(tds) >= 7 and STOCK_CODE.match(tds[0]):
                out[tds[0]] = {"yoy": num(tds[6]), "rev": num(tds[2])}
    return out


# ---------------------------------------------------------------- PTT
PTT = "https://www.ptt.cc"


def ptt_index(page_url: str):
    from lxml import html as lh

    r = get(page_url, cookies={"over18": "1"}, as_json=False)
    doc = lh.fromstring(r.text)
    prev = doc.xpath('//a[contains(@class,"btn wide") and contains(text(),"上頁")]/@href')
    items = []
    for ent in doc.xpath('//div[contains(@class,"r-list-sep")]/preceding-sibling::div[contains(@class,"r-ent")]') or doc.xpath('//div[contains(@class,"r-ent")]'):
        a = ent.xpath('.//div[@class="title"]/a')
        if not a:
            continue
        items.append({"href": a[0].get("href"), "title": a[0].text_content().strip(),
                      "nrec": "".join(ent.xpath('.//div[@class="nrec"]//text()')).strip(),
                      "date": "".join(ent.xpath('.//div[@class="date"]//text()')).strip()})
    return items, (PTT + prev[0]) if prev else None


def ptt_article(href: str):
    from lxml import html as lh

    r = get(PTT + href, cookies={"over18": "1"}, as_json=False)
    doc = lh.fromstring(r.text)
    meta = {m.xpath('string(./span[1])'): m.xpath('string(./span[2])') for m in doc.xpath('//div[@class="article-metaline"]')}
    pushes = []
    for p in doc.xpath('//div[@class="push"]'):
        pushes.append((p.xpath('string(./span[1])').strip(), p.xpath('string(./span[3])').lstrip(": ").strip()))
    main = doc.xpath('//div[@id="main-content"]')
    body = ""
    if main:
        m = main[0]
        for el in m.xpath('./div[contains(@class,"article-metaline")] | ./div[@class="push"] | ./span[@class="f2"]'):
            el.getparent().remove(el)
        body = m.text_content().split("\n--\n")[0]
    return {"time": meta.get("時間", ""), "title": meta.get("標題", ""), "body": body[:4000], "pushes": pushes}


# ---------------------------------------------------------------- FinMind (fallback for revenue history)
def finmind_revenue(code: str, start: str, token: str | None):
    """{"YYYYMM": {"yoy": float, "rev": float}} computed from FinMind monthly revenue."""
    params = {"dataset": "TaiwanStockMonthRevenue", "data_id": code, "start_date": start}
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    r = SESSION.get("https://api.finmindtrade.com/api/v4/data", params=params, headers=headers, timeout=30)
    j = r.json()
    if j.get("status") != 200:
        raise Blocked(j.get("msg", "finmind"))
    by = {(d["revenue_year"], d["revenue_month"]): d["revenue"] for d in j["data"]}
    out = {}
    for (y, m), rev in by.items():
        prev = by.get((y - 1, m))
        out[f"{y}{m:02d}"] = {"rev": rev / 1000, "yoy": round((rev / prev - 1) * 100, 2) if prev else None}
    return out
