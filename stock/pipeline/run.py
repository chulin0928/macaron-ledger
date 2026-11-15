"""Daily job: update snapshots, revenue, PTT sentiment, then write the page's JSON + CSV exports.

    python -m stock.pipeline.run            # normal daily run
    python -m stock.pipeline.run --ptt-days 14 --backfill 130   # first-time setup
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
from datetime import datetime, timedelta

from . import analysis, sentiment, sources as S, store
from .store import DATA, load_json, save_json

CONFIG = store.ROOT / "config.json"
MIN_ARTICLES = 20
EXPORT = DATA / "exports"


def tw_now():
    return datetime.utcnow() + timedelta(hours=8)


def update_revenue(log):
    rev_dir = DATA / "revenue"
    industry = load_json(DATA / "industry.json", {})
    names = load_json(DATA / "names.json", {})
    try:
        latest = S.revenue_latest()
    except Exception as e:  # noqa: BLE001
        latest = {}
        log.append(f"營收 API 失敗: {e}")
    for ym, rows in latest.items():
        p = rev_dir / f"{ym}.json"
        old = load_json(p, {})
        for code, r in rows.items():
            old[code] = {"yoy": r["yoy"], "rev": r["rev"]}
            if r["industry"]:
                industry[code] = r["industry"]
            names.setdefault(code, r["name"])
        save_json(p, old)
    save_json(DATA / "industry.json", industry)
    save_json(DATA / "names.json", names)
    # make sure the two months before the newest one exist (MOPS history pages)
    have = sorted(p.stem for p in rev_dir.glob("*.json"))
    if have:
        y, m = int(have[-1][:4]), int(have[-1][4:])
        for _ in range(2):
            m -= 1
            if m == 0:
                y, m = y - 1, 12
            key = f"{y}{m:02d}"
            p = rev_dir / f"{key}.json"
            if p.exists() and len(load_json(p, {})) > 1000:
                continue
            try:
                rows = S.revenue_month_mops(y, m)
                if len(rows) > 1000:
                    save_json(p, rows)
                    log.append(f"補齊 {key} 營收 {len(rows)} 家")
            except Exception as e:  # noqa: BLE001
                log.append(f"{key} 營收歷史抓取失敗（下次再試）: {e}")
    revenue = {p.stem: load_json(p, {}) for p in sorted(rev_dir.glob("*.json"))[-12:]}
    return revenue, industry


def fill_revenue_finmind(revenue, scr, months_needed, log):
    """When MOPS history pages are unavailable, fill missing months from FinMind for the
    stocks that already pass the other conditions (latest YoY > 0 and above 季線)."""
    newest = max(revenue)
    y, m = int(newest[:4]), int(newest[4:])
    want = []
    for _ in range(months_needed):
        want.append(f"{y}{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    missing = [k for k in want if k not in revenue or len(revenue[k]) < 1000]
    if not missing:
        return revenue
    cands = [r["code"] for r in scr["rows"] if r["above_ma60"] and (r["yoy"][-1] or 0) > 0]
    token = os.environ.get("FINMIND_TOKEN") or None
    cache = load_json(DATA / "revenue_finmind.json", {})
    start = f"{int(want[-1][:4]) - 1}-{want[-1][4:]}-01"
    got = 0
    for code in cands:
        if all(k in cache.get(code, {}) for k in missing):
            continue
        try:
            cache[code] = S.finmind_revenue(code, start, token)
            got += 1
        except Exception as e:  # noqa: BLE001
            log.append(f"FinMind 營收補抓在 {got} 檔後停止（{e}），下次更新會繼續。")
            break
    save_json(DATA / "revenue_finmind.json", cache)
    for k in missing:
        revenue.setdefault(k, {})
        for code, months in cache.items():
            if k in months and code not in revenue[k]:
                revenue[k][code] = months[k]
    return dict(sorted(revenue.items()))


def update_sentiment(days_back, log):
    pdir = DATA / "ptt"
    try:
        for summ in sentiment.run(days_back=days_back, names=load_json(DATA / "names.json", {})):
            save_json(pdir / f"{summ['date'].replace('-', '')}.json", summ)
    except Exception as e:  # noqa: BLE001
        log.append(f"PTT 抓取失敗: {e}")
    files = sorted(pdir.glob("*.json"))
    for p in files[:-400]:
        p.unlink()
    series = [load_json(p) for p in sorted(pdir.glob("*.json"))]
    for s in series:  # too few posts (e.g. just after midnight) gives a meaningless reading
        if (s.get("articles") or 0) < MIN_ARTICLES:
            s["index"] = None
    vals = [s["index"] for s in series if s.get("index") is not None]
    for s in series:
        x = s.get("index")
        if x is None:
            s["pct"] = None
            continue
        hist = [v for v in vals]
        s["pct"] = round(100 * sum(1 for v in hist if v <= x) / len(hist), 1) if len(hist) >= 20 else None
    return series


def zone(s, cfg):
    x, pct = s.get("index"), s.get("pct")
    hi, lo = cfg.get("sentiment_high", 70), cfg.get("sentiment_low", 30)
    if pct is not None:
        if pct >= 90 or (x is not None and x >= hi + 10):
            return "extreme_greed"
        if pct <= 10 or (x is not None and x <= lo - 10):
            return "extreme_fear"
    if x is None:
        return "unknown"
    if x >= hi:
        return "greed"
    if x <= lo:
        return "fear"
    return "neutral"


def write_csv(path, header, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows(rows)
    path.write_text("﻿" + buf.getvalue(), "utf-8")  # BOM so Excel opens 中文 correctly


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backfill", type=int, default=0, help="trading days of history to ensure")
    ap.add_argument("--ptt-days", type=int, default=1, help="previous days of PTT to (re)crawl")
    ap.add_argument("--skip-market", action="store_true")
    ap.add_argument("--skip-ptt", action="store_true")
    args = ap.parse_args()

    cfg = load_json(CONFIG, {})
    log: list[str] = []
    if not args.skip_market:
        store.update_recent(lookback_calendar_days=10, target_trading_days=args.backfill or None)
    days = store.load_days(130)
    names = load_json(DATA / "names.json", {})
    revenue, industry = update_revenue(log)
    series = (load_json(DATA / "sentiment.json", {}) or {}).get("series", [])
    if not args.skip_ptt:
        series = update_sentiment(args.ptt_days, log)
    usable = [s for s in series if s.get("index") is not None]
    latest_sent = usable[-1] if usable else (series[-1] if series else None)

    scr = analysis.screener(days, revenue, names, industry, cfg.get("revenue_months", 3))
    if not scr["complete"]:
        revenue = fill_revenue_finmind(revenue, scr, cfg.get("revenue_months", 3), log)
        scr = analysis.screener(days, revenue, names, industry, cfg.get("revenue_months", 3))

    # watchlist for 籌碼: config + top screener picks + most-discussed on PTT
    watch = list(dict.fromkeys(cfg.get("watchlist", [])))
    picks = [r["code"] for r in scr["rows"] if r["rev_ok"] and r["above_ma60"] and r["f5_buy"]]
    picks.sort(key=lambda c: -(next(r for r in scr["rows"] if r["code"] == c)["f5"] or 0))
    watch += [c for c in picks[: cfg.get("auto_from_screener", 10)] if c not in watch]
    if latest_sent:
        hot = [c for c in latest_sent.get("stocks", {}) if c in days[-1]["s"]]
        watch += [c for c in hot[: cfg.get("auto_from_ptt", 5)] if c not in watch]
    chip = {c: analysis.chips(days, c, names, cfg.get("red_margin_pct", 20)) for c in watch if c in days[-1]["s"]}
    sources_tag = {c: ("自選" if c in cfg.get("watchlist", []) else "選股" if c in picks else "PTT熱門") for c in chip}
    for c in chip:
        chip[c]["src"] = sources_tag[c]

    for s in series:
        s["zone"] = zone(s, cfg)

    partial = days[-1].get("partial", [])
    out = {
        "updated": tw_now().strftime("%Y-%m-%d %H:%M"),
        "trade_date": days[-1]["date"],
        "partial": partial,
        "log": log,
        "config": {k: cfg.get(k) for k in ("revenue_months", "red_margin_pct", "sentiment_high", "sentiment_low")},
        "screener": scr,
        "sentiment": {"latest": latest_sent,
                      "series": [{k: s.get(k) for k in ("date", "index", "pct", "zone", "articles", "pushes", "G", "F")} for s in series[-180:]]},
        "chips": chip,
        "market": analysis.market(days),
    }
    save_json(DATA / "latest.json", out)
    save_json(DATA / "sentiment.json", {"series": series[-400:]})

    # ---- CSV exports (also what the Google Drive sync copies)
    ym = scr["months"]
    write_csv(EXPORT / "screener.csv",
              ["代號", "名稱", "產業", "收盤", "季線MA60", "距季線%"] + [f"{m}營收YoY%" for m in ym] +
              ["營收連續正成長", "站上季線", "外資近5日(張)", "投信近5日(張)", "外資近5日買超", "20日均量(張)"],
              [[r["code"], r["name"], r["ind"], r["close"], r["ma60"], r["pct_ma60"], *r["yoy"],
                "Y" if r["rev_ok"] else "", "Y" if r["above_ma60"] else "", r["f5"], r["t5"],
                "Y" if r["f5_buy"] else "", r["vol20"]]
               for r in scr["rows"] if r["rev_ok"] and r["above_ma60"]])
    write_csv(EXPORT / "chips.csv", ["代號", "名稱", "日期", "收盤", "外資", "投信", "自營商", "融資餘額", "融資增減%", "訊號"],
              [[c["code"], c["name"], t["date"], t["close"], t["fi"], t["it"], t["dl"], t["mg"], t["mg_chg"], " ".join(t["flags"])]
               for c in chip.values() for t in c["table"]])
    write_csv(EXPORT / "sentiment.csv", ["日期", "恐懼貪婪指數", "歷史百分位", "區間", "文章數", "推文數", "貪婪分", "恐懼分"],
              [[s["date"], s.get("index"), s.get("pct"), s.get("zone"), s.get("articles"), s.get("pushes"), s.get("G"), s.get("F")] for s in series])
    print("done:", out["updated"], "trade_date", out["trade_date"], "screener rows", len(scr["rows"]), "chips", len(chip), "log", log)


if __name__ == "__main__":
    main()
