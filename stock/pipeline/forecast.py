"""Three-aspect forecast (消息面 / 籌碼面 / 技術面) for the next 5 trading days, with win-rate checks.

Every score uses only data available on that day:
  - prices / institutional / margin up to that day's close
  - a month's revenue only from the 11th of the following month (MOPS deadline is the 10th)
Scores are in [-1, 1]. Weights and thresholds are fixed, not fitted to the backtest.
"""
from __future__ import annotations

from datetime import date
from statistics import mean

C, V, FI, IT, DL, MG = range(6)
W_INFO, W_CHIP, W_TECH = 0.25, 0.35, 0.40
CALL = 0.20          # |total| at or above this is a 看漲 / 看跌 call
ASPECT_CALL = 0.30   # same idea for a single aspect
HORIZON = 5          # trading days
MIN_VOL = 300        # 20-day average volume (張) for the universe
MIN_PRICE = 10


def clip(x, lo=-1.0, hi=1.0):
    return max(lo, min(hi, x))


def build_series(days: list[dict]):
    codes = set()
    for d in days:
        codes.update(d["s"])
    n = len(days)
    ser = {}
    for code in codes:
        cols = [[None] * n for _ in range(6)]
        for i, d in enumerate(days):
            row = d["s"].get(code)
            if row:
                for k in range(6):
                    cols[k][i] = row[k]
        ser[code] = cols
    return ser


def revenue_available(revenue: dict, day: date):
    """Months whose revenue was public on `day` (published by the 10th of the next month)."""
    out = []
    for ym in sorted(revenue):
        y, m = int(ym[:4]), int(ym[4:])
        y2, m2 = (y + 1, 1) if m == 12 else (y, m + 1)
        if day >= date(y2, m2, 11):
            out.append(ym)
    return out


def _streak(vals, i):
    """Consecutive days with the same sign of foreign net buy ending at i: +n buys, -n sells."""
    if vals[i] is None or vals[i] == 0:
        return 0
    sign = 1 if vals[i] > 0 else -1
    n = 0
    while i >= 0 and vals[i] is not None and vals[i] * sign > 0:
        n += 1
        i -= 1
    return n * sign


def _rsi(closes, period=14):
    gains = losses = 0.0
    for a, b in zip(closes[-period - 1:-1], closes[-period:]):
        d = b - a
        gains += max(d, 0)
        losses += max(-d, 0)
    if gains + losses == 0:
        return 50.0
    return 100 * gains / (gains + losses)


def score(cols, i, rev_months, revenue, code, ptt=None):
    """Returns the aspect scores, inputs and reasons for one stock on day i, or None."""
    close, vol, fi, it, _, mg = cols
    c = close[i]
    if c is None or i < 60:
        return None
    win60 = [x for x in close[i - 59:i + 1] if x is not None]
    if len(win60) < 55:
        return None
    vols = [x for x in vol[i - 19:i + 1] if x is not None]
    vol20 = mean(vols) if vols else 0
    if vol20 < MIN_VOL or c < MIN_PRICE:
        return None
    pos, neg = [], []

    def note(val, good, bad):
        if val >= 0.35:
            pos.append((val, good))
        elif val <= -0.35:
            neg.append((val, bad))

    # ---------------- 技術面
    ma60 = mean(win60)
    ma20 = mean([x for x in close[i - 19:i + 1] if x is not None])
    prev20 = [x for x in close[i - 24:i - 4] if x is not None]
    ma20_prev = mean(prev20) if prev20 else ma20
    c20 = close[i - 20] or c
    trend = clip((c / ma60 - 1) / 0.10)
    cross = 1.0 if ma20 > ma60 else -1.0
    mom = clip((c / c20 - 1) / 0.15)
    slope = clip((ma20 / ma20_prev - 1) / 0.03)
    tech = mean([trend, cross, mom, slope])
    pct60 = (c / ma60 - 1) * 100
    note(trend, f"站上季線 {pct60:+.1f}%", f"跌破季線 {pct60:+.1f}%")
    note(cross, "均線多頭排列", "均線空頭排列")
    note(mom, f"20 日漲 {(c / c20 - 1) * 100:.1f}%", f"20 日跌 {(c / c20 - 1) * 100:.1f}%")
    rsi = _rsi(win60)

    # ---------------- 籌碼面
    f5 = sum(x for x in fi[i - 4:i + 1] if x is not None)
    t5 = sum(x for x in it[i - 4:i + 1] if x is not None)
    base = max(vol20 * 5, 1)
    fr = clip(f5 / base / 0.20)
    tr = clip(t5 / base / 0.10)
    parts = [fr, tr]
    note(fr, f"外資 5 日買超 {f5:,.0f} 張", f"外資 5 日賣超 {-f5:,.0f} 張")
    note(tr, f"投信 5 日買超 {t5:,.0f} 張", f"投信 5 日賣超 {-t5:,.0f} 張")
    mg5 = None
    if mg[i] and mg[i - 5]:
        mg5 = mg[i] / mg[i - 5] - 1
        ms = clip(-mg5 / 0.10)  # retail margin piling in is bearish, unwinding is bullish
        parts.append(ms)
        note(ms, f"融資 5 日減 {-mg5 * 100:.1f}%", f"融資 5 日增 {mg5 * 100:.1f}%")
    st = _streak(fi, i)
    sts = clip(st / 5)
    parts.append(sts)
    if abs(st) >= 3:
        (pos if st > 0 else neg).append((sts, f"外資連{'買' if st > 0 else '賣'} {abs(st)} 天"))
    chips = mean(parts)

    # ---------------- 消息面
    info_parts = []
    yoys = [revenue[m].get(code, {}).get("yoy") for m in rev_months[-3:]]
    yoys = [y for y in yoys if y is not None]
    if yoys:
        y0 = yoys[-1]
        lvl = clip(y0 / 30)
        info_parts.append(lvl)
        note(lvl, f"營收年增 {y0:.0f}%", f"營收年減 {-y0:.0f}%")
        if len(yoys) == 3:
            acc = clip((y0 - mean(yoys[:2])) / 20)
            info_parts.append(acc)
            note(acc, "營收成長加速", "營收成長放緩")
            p3 = 1.0 if all(y > 0 for y in yoys) else -1.0 if all(y < 0 for y in yoys) else 0.0
            info_parts.append(p3)
            if p3 > 0:
                pos.append((0.5, "營收連 3 月正成長"))
            elif p3 < 0:
                neg.append((-0.5, "營收連 3 月衰退"))
    if ptt and ptt.get("idx") is not None:
        ps = clip((ptt["idx"] - 50) / 50) * min(1.0, ptt.get("n", 1) / 3)
        info_parts.append(ps)
        note(ps, f"PTT 討論偏多（{ptt.get('n', 0)} 篇）", f"PTT 討論偏空（{ptt.get('n', 0)} 篇）")
    info = mean(info_parts) if info_parts else 0.0

    total = W_INFO * info + W_CHIP * chips + W_TECH * tech
    call = 1 if total >= CALL else -1 if total <= -CALL else 0
    pos.sort(key=lambda x: -x[0])
    neg.sort(key=lambda x: x[0])
    return {"info": info, "chips": chips, "tech": tech, "total": total, "call": call,
            "close": c, "vol20": vol20, "rsi": rsi,
            "pos": [t for _, t in pos[:3]], "neg": [t for _, t in neg[:3]]}


def _rate(wins, n):
    return round(100 * wins / n, 1) if n else None


def backtest(days, ser, revenue):
    n = len(days)
    dates = [date.fromisoformat(d["date"]) for d in days]
    calls = {"bull": [0, 0, []], "bear": [0, 0, []]}
    aspect = {k: {"bull": [0, 0], "bear": [0, 0]} for k in ("info", "chips", "tech")}
    base_n = base_up = 0
    base_ret = []
    buckets = [[] for _ in range(5)]
    top10 = []
    first = last = None
    for i in range(60, n - HORIZON):
        rev = revenue_available(revenue, dates[i])
        day = []
        for code, cols in ser.items():
            s = score(cols, i, rev, revenue, code)
            if not s:
                continue
            c5 = cols[C][i + HORIZON]
            if not c5:
                continue
            r = c5 / s["close"] - 1
            day.append((s, r))
        if not day:
            continue
        first = first or days[i]["date"]
        last = days[i]["date"]
        for s, r in day:
            base_n += 1
            base_up += r > 0
            base_ret.append(r)
            if s["call"] == 1:
                calls["bull"][0] += 1; calls["bull"][1] += r > 0; calls["bull"][2].append(r)
            elif s["call"] == -1:
                calls["bear"][0] += 1; calls["bear"][1] += r < 0; calls["bear"][2].append(r)
            for k in aspect:
                if s[k] >= ASPECT_CALL:
                    aspect[k]["bull"][0] += 1; aspect[k]["bull"][1] += r > 0
                elif s[k] <= -ASPECT_CALL:
                    aspect[k]["bear"][0] += 1; aspect[k]["bear"][1] += r < 0
        day.sort(key=lambda x: x[0]["total"])
        for q in range(5):
            part = day[q * len(day) // 5:(q + 1) * len(day) // 5]
            buckets[q].extend(r for _, r in part)
        top = day[-10:]
        top10.append((mean(r for _, r in top), mean(r for _, r in day)))
    pct = lambda xs: round(mean(xs) * 100, 2) if xs else None  # noqa: E731
    return {
        "period": [first, last], "days": len(top10), "samples": base_n,
        "base_up": _rate(base_up, base_n), "base_avg": pct(base_ret),
        "bull": {"n": calls["bull"][0], "win": _rate(calls["bull"][1], calls["bull"][0]), "avg": pct(calls["bull"][2])},
        "bear": {"n": calls["bear"][0], "win": _rate(calls["bear"][1], calls["bear"][0]), "avg": pct(calls["bear"][2])},
        "aspects": {k: {"bull": {"n": v["bull"][0], "win": _rate(v["bull"][1], v["bull"][0])},
                        "bear": {"n": v["bear"][0], "win": _rate(v["bear"][1], v["bear"][0])}} for k, v in aspect.items()},
        "quintiles": [{"avg": pct(b), "up": _rate(sum(1 for r in b if r > 0), len(b))} for b in buckets],
        "top10": {"avg": pct([a for a, _ in top10]), "market": pct([b for _, b in top10]),
                  "beat": _rate(sum(1 for a, b in top10 if a > b), len(top10))},
    }


def today(days, ser, revenue, names, ptt_stocks):
    i = len(days) - 1
    rev = revenue_available(revenue, date.fromisoformat(days[i]["date"]))
    rows = []
    for code, cols in ser.items():
        s = score(cols, i, rev, revenue, code, (ptt_stocks or {}).get(code))
        if not s:
            continue
        rows.append({"code": code, "name": names.get(code, ""), "close": s["close"],
                     "info": round(s["info"] * 100), "chips": round(s["chips"] * 100), "tech": round(s["tech"] * 100),
                     "total": round(s["total"] * 100), "call": s["call"], "rsi": round(s["rsi"]),
                     "pos": s["pos"], "neg": s["neg"]})
    rows.sort(key=lambda r: -r["total"])
    return rows


def track(pred_dir, days, rows, save_json, load_json):
    """Save today's calls; check earlier calls whose 5 trading days have passed."""
    trade_date = days[-1]["date"]
    save_json(pred_dir / f"{trade_date.replace('-', '')}.json",
              {"date": trade_date, "calls": {r["code"]: [r["total"], r["call"], r["close"]] for r in rows if r["call"]},
               "top10": [r["code"] for r in rows[:10]]})
    idx = {d["date"]: i for i, d in enumerate(days)}
    stats = {"bull": [0, 0], "bear": [0, 0], "top10": [0, 0]}
    batches = []
    for p in sorted(pred_dir.glob("*.json")):
        rec = load_json(p)
        i = idx.get(rec["date"])
        if i is None or i + HORIZON >= len(days):
            continue
        later = days[i + HORIZON]["s"]
        b = {"date": rec["date"], "bull": [0, 0], "bear": [0, 0]}
        for code, (_, call, c0) in rec["calls"].items():
            c5 = (later.get(code) or [None])[0]
            if not c5 or not c0:
                continue
            k = "bull" if call == 1 else "bear"
            win = (c5 > c0) if call == 1 else (c5 < c0)
            stats[k][0] += 1; stats[k][1] += win
            b[k][0] += 1; b[k][1] += win
        for code in rec.get("top10", []):
            c0 = rec["calls"].get(code, [None, None, None])[2] or (days[i]["s"].get(code) or [None])[0]
            c5 = (later.get(code) or [None])[0]
            if c0 and c5:
                stats["top10"][0] += 1; stats["top10"][1] += c5 > c0
        batches.append({"date": b["date"], "bull": _rate(b["bull"][1], b["bull"][0]), "bear": _rate(b["bear"][1], b["bear"][0]),
                        "n": b["bull"][0] + b["bear"][0]})
    pending = sorted(p.stem for p in pred_dir.glob("*.json"))
    return {"bull": {"n": stats["bull"][0], "win": _rate(stats["bull"][1], stats["bull"][0])},
            "bear": {"n": stats["bear"][0], "win": _rate(stats["bear"][1], stats["bear"][0])},
            "top10": {"n": stats["top10"][0], "win": _rate(stats["top10"][1], stats["top10"][0])},
            "batches": batches[-20:], "first_pred": pending[0] if pending else None}
