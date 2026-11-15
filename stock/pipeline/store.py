"""Daily market snapshots kept in stock/data/hist/YYYYMMDD.json.

One file per trading day:
  {"date": "2026-11-13", "taiex": 23456.7, "partial": [],
   "s": {"2330": [close, volume_lots, foreign, trust, dealer, margin_balance], ...}}
Institutional numbers are net buy (+) / sell (-) in 張; margin balance in 張.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from pathlib import Path

from . import sources as S

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
HIST = DATA / "hist"
KEEP_DAYS = 260


def hist_path(d: date) -> Path:
    return HIST / f"{d:%Y%m%d}.json"


def load_json(p: Path, default=None):
    try:
        return json.loads(p.read_text("utf-8"))
    except (FileNotFoundError, ValueError):
        return default


def save_json(p: Path, obj, pretty=False):
    p.parent.mkdir(parents=True, exist_ok=True)
    txt = json.dumps(obj, ensure_ascii=False, indent=1 if pretty else None, separators=None if pretty else (",", ":"))
    p.write_text(txt, "utf-8")


def _safe(fn, d):
    try:
        return fn(d)
    except S.Blocked as e:
        print("  blocked:", e)
        return None


def fetch_day(d: date, names: dict) -> str:
    """Fetch (or complete) one day's snapshot. Returns 'ok' | 'partial' | 'closed' | 'error'."""
    p = hist_path(d)
    snap = load_json(p)
    if snap and not snap.get("partial"):
        return "ok"
    if snap is None:
        try:
            tw, taiex = S.twse_prices(d)
        except S.Blocked:
            return "error"
        if tw is None:
            return "closed"
        otc = _safe(S.tpex_prices, d) or {"rows": {}, "names": {}}
        names.update(tw["names"]); names.update(otc["names"])
        s = {}
        for code, (c, v) in {**tw["rows"], **otc["rows"]}.items():
            s[code] = [c, round(v), None, None, None, None]
        snap = {"date": d.isoformat(), "taiex": taiex, "s": s, "partial": ["inst_tw", "inst_otc", "mg_tw", "mg_otc"]}
        if not otc["rows"]:
            snap["partial"].append("px_otc")
    s = snap["s"]
    todo = list(snap["partial"])
    for part in todo:
        if part == "px_otc":
            otc = _safe(S.tpex_prices, d)
            if otc:
                names.update(otc["names"])
                for code, (c, v) in otc["rows"].items():
                    s.setdefault(code, [None] * 6)[:2] = [c, round(v)]
                snap["partial"].remove(part)
            continue
        fn = {"inst_tw": S.twse_inst, "inst_otc": S.tpex_inst, "mg_tw": S.twse_margin, "mg_otc": S.tpex_margin}[part]
        res = _safe(fn, d)
        if not res:
            continue
        for code, val in res.items():
            row = s.get(code)
            if row is None:
                continue
            if part.startswith("inst"):
                row[2:5] = list(val)
            else:
                row[5] = val
        snap["partial"].remove(part)
    save_json(p, snap)
    return "partial" if snap["partial"] else "ok"


def trading_days(n: int | None = None) -> list[date]:
    days = sorted(datetime.strptime(p.stem, "%Y%m%d").date() for p in HIST.glob("*.json"))
    return days[-n:] if n else days


def load_days(n: int) -> list[dict]:
    return [load_json(hist_path(d)) for d in trading_days(n)]


def prune():
    days = trading_days()
    for d in days[:-KEEP_DAYS]:
        hist_path(d).unlink()


def update_recent(lookback_calendar_days: int = 10, target_trading_days: int | None = None, today: date | None = None):
    """Fill in any missing / partial days. With target_trading_days, walk back until that many exist."""
    names = load_json(DATA / "names.json", {})
    today = today or (datetime.utcnow() + timedelta(hours=8)).date()
    d = today
    stop = today - timedelta(days=lookback_calendar_days)
    have = 0
    errors = 0
    while True:
        if target_trading_days is None and d < stop:
            break
        if target_trading_days is not None and (have >= target_trading_days or (today - d).days > target_trading_days * 2 + 30):
            break
        if d.weekday() < 5:
            st = fetch_day(d, names)
            print(d, st, flush=True)
            if st in ("ok", "partial"):
                have += 1
            elif st == "error":
                errors += 1
                if errors >= 3:
                    print("too many errors, stopping early")
                    break
        d -= timedelta(days=1)
    save_json(DATA / "names.json", names)
    prune()
