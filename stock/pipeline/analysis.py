"""Screener (#1) and chip / 籌碼 signals (#3) computed from stored snapshots."""
from __future__ import annotations

from statistics import mean, pstdev

C, V, FI, IT, DL, MG = range(6)  # snapshot row layout


def _series(days: list[dict], code: str, col: int):
    return [(d["s"].get(code) or [None] * 6)[col] for d in days]


def screener(days: list[dict], revenue: dict[str, dict], names: dict, industry: dict, rev_months: int = 3):
    """revenue: {"YYYYMM": {code: {"yoy": .., "rev": ..}}} (any number of months).
    Returns rows for every stock with >= 1 month of revenue data, plus flags so the
    page can toggle each condition."""
    months = sorted(revenue)[-rev_months:]
    last = days[-1]
    out = []
    for code, row in last["s"].items():
        close = row[C]
        if close is None:
            continue
        yoys = [revenue[m].get(code, {}).get("yoy") for m in months]
        if all(y is None for y in yoys):
            continue
        closes = [c for c in _series(days[-60:], code, C) if c is not None]
        ma60 = mean(closes) if len(closes) >= 55 else None
        f5 = [x for x in _series(days[-5:], code, FI) if x is not None]
        t5 = [x for x in _series(days[-5:], code, IT) if x is not None]
        vol20 = [x for x in _series(days[-20:], code, V) if x is not None]
        out.append({
            "code": code, "name": names.get(code, ""), "ind": industry.get(code, ""),
            "close": close, "ma60": round(ma60, 2) if ma60 else None,
            "above_ma60": bool(ma60 and close > ma60),
            "pct_ma60": round((close / ma60 - 1) * 100, 2) if ma60 else None,
            "yoy": yoys,  # oldest → newest
            "rev_ok": len(months) >= rev_months and all(y is not None and y > 0 for y in yoys),
            "f5": sum(f5) if f5 else None, "t5": sum(t5) if t5 else None,
            "f5_buy": bool(f5) and sum(f5) > 0,
            "vol20": round(mean(vol20)) if vol20 else None,
        })
    out.sort(key=lambda r: (r["yoy"][-1] if r["yoy"][-1] is not None else -1e9), reverse=True)
    complete = len(months) >= rev_months and all(len(revenue[m]) >= 1000 for m in months)
    return {"months": months, "rows": out, "complete": complete,
            "coverage": {m: len(revenue[m]) for m in months}}


def chips(days: list[dict], code: str, names: dict, red_margin_pct: float = 20.0):
    """10-day 三大法人 + 融資 table, signals, and historical analogs for one stock."""
    dates = [d["date"] for d in days]
    close = _series(days, code, C)
    fi, it, dl, mg = (_series(days, code, k) for k in (FI, IT, DL, MG))
    n = len(days)
    mg_chg = [None] * n
    for i in range(1, n):
        if mg[i] is not None and mg[i - 1]:
            mg_chg[i] = round((mg[i] / mg[i - 1] - 1) * 100, 2)

    def abnormal_threshold(i):
        window = [x for x in mg_chg[max(1, i - 60):i] if x is not None]
        if len(window) < 15:
            return 5.0
        return max(5.0, mean(window) + 2 * pstdev(window))

    def streak(i):
        s = 0
        while i >= 0 and fi[i] is not None and fi[i] > 0:
            s += 1; i -= 1
        return s

    flags = []
    for i in range(n):
        f = []
        if mg_chg[i] is not None and mg_chg[i] > abnormal_threshold(i):
            f.append("margin_abn")
        if mg_chg[i] is not None and mg_chg[i] >= red_margin_pct and (fi[i] or 0) < 0:
            f.append("red")
        if "margin_abn" in f and (fi[i] or 0) < 0 and "red" not in f:
            f.append("warn")
        flags.append(f)

    def fwd(i, k=5):
        if i + k < n and close[i] and close[i + k]:
            return round((close[i + k] / close[i] - 1) * 100, 2)
        return None

    def analog(pred, label):
        hits = [i for i in range(n - 1) if pred(i)]
        rets = [(dates[i], fwd(i)) for i in hits]
        done = [r for _, r in rets if r is not None]
        return {"label": label, "count": len(done), "down": sum(1 for r in done if r < 0),
                "avg": round(mean(done), 2) if done else None,
                "cases": [{"date": dt, "ret5": r} for dt, r in rets[-6:]]}

    cur_streak = streak(n - 1)
    analogs = []
    if cur_streak >= 3:
        analogs.append(analog(lambda i: streak(i) == cur_streak, f"外資連買 {cur_streak} 天"))
    last_flags = set(flags[-1]) if flags else set()
    for key, label in (("red", f"融資單日增 ≥{red_margin_pct:g}% 且外資賣超"), ("warn", "融資異常增加 + 外資賣超"), ("margin_abn", "融資異常增加")):
        if key in last_flags or any(key in fl for fl in flags[-10:]):
            analogs.append(analog(lambda i, k=key: k in flags[i], label))

    table = [{"date": dates[i], "close": close[i], "fi": fi[i], "it": it[i], "dl": dl[i],
              "mg": mg[i], "mg_chg": mg_chg[i], "flags": flags[i]} for i in range(max(0, n - 10), n)]
    return {
        "code": code, "name": names.get(code, ""), "streak": cur_streak,
        "fi10": sum(x for x in fi[-10:] if x is not None),
        "mg10": (mg[-1] - mg[-11]) if n > 10 and mg[-1] is not None and mg[-11] is not None else None,
        "table": table, "analogs": analogs,
        "spark": [c for c in close[-60:]],
    }


def market(days: list[dict]):
    out = []
    for d in days[-60:]:
        rows = d["s"].values()
        out.append({"date": d["date"], "taiex": d.get("taiex"),
                    "fi": sum((r[FI] or 0) for r in rows), "mg": sum((r[MG] or 0) for r in rows)})
    return out
