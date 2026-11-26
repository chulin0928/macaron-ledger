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

    # ---------------- 短線反轉 (5-day horizon: recent losers tend to bounce, recent winners to cool off)
    c5 = close[i - 5] or c
    r5 = clip(-(c / c5 - 1) / 0.08)
    r20 = clip(-(c / c20 - 1) / 0.15)
    rr = clip((50 - rsi) / 30)
    rev = mean([r5, r20, rr])
    rnotes = []
    if r5 >= 0.35:
        rnotes.append((r5, f"5 日跌 {(c / c5 - 1) * 100:.1f}%，短線超跌"))
    elif r5 <= -0.35:
        rnotes.append((r5, f"5 日漲 {(c / c5 - 1) * 100:.1f}%，短線過熱"))
    if rsi <= 30:
        rnotes.append((0.5, f"RSI {rsi:.0f} 超賣"))
    elif rsi >= 70:
        rnotes.append((-0.5, f"RSI {rsi:.0f} 超買"))

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

    return {"info": info, "chips": chips, "tech": tech, "rev": rev,
            "close": c, "vol20": vol20, "rsi": rsi,
            "notes": {"pos": pos, "neg": neg, "rev": rnotes}}


# Candidate models, written down before looking at the test half. Weights over the aspects.
MODELS = {
    "trend": ("原始（順勢）", {"info": W_INFO, "chips": W_CHIP, "tech": W_TECH}),
    "revert": ("籌碼＋消息＋短線反轉", {"info": 0.25, "chips": 0.35, "rev": 0.40}),
    "revert_info": ("消息＋短線反轉", {"info": 0.5, "rev": 0.5}),
    "pure_revert": ("純短線反轉", {"rev": 1.0}),
}


def total_of(s, model):
    return sum(w * s[k] for k, w in MODELS[model][1].items())


def reasons(s, model):
    """Up to 3 bullish and 3 bearish reasons, drawn from the aspects this model uses."""
    used = MODELS[model][1]
    pos = list(s["notes"]["pos"]) if any(k in used for k in ("info", "chips", "tech")) else []
    neg = list(s["notes"]["neg"]) if pos or any(k in used for k in ("info", "chips", "tech")) else []
    if "tech" not in used:  # trend phrases don't apply when the model reads price action as reversal
        drop = ("季線", "均線", "20 日")
        pos = [x for x in pos if not any(d in x[1] for d in drop)]
        neg = [x for x in neg if not any(d in x[1] for d in drop)]
    if "rev" in used:
        for v, t in s["notes"]["rev"]:
            (pos if v > 0 else neg).append((abs(v), t))
    pos.sort(key=lambda x: -abs(x[0]))
    neg.sort(key=lambda x: -abs(x[0]))
    return [t for _, t in pos[:3]], [t for _, t in neg[:3]]


def _rate(wins, n):
    return round(100 * wins / n, 1) if n else None


def _stats(entries, model):
    """entries: list of (day_index, aspects, ret). Win rates for one model."""
    n = up = 0
    rets = []
    bull = [0, 0, []]
    bear = [0, 0, []]
    by_day = {}
    for d, s, r in entries:
        t = total_of(s, model)
        n += 1; up += r > 0; rets.append(r)
        if t >= CALL:
            bull[0] += 1; bull[1] += r > 0; bull[2].append(r)
        elif t <= -CALL:
            bear[0] += 1; bear[1] += r < 0; bear[2].append(r)
        by_day.setdefault(d, []).append((t, r))
    buckets = [[] for _ in range(5)]
    top = []
    for rows in by_day.values():
        rows.sort(key=lambda x: x[0])
        for q in range(5):
            buckets[q].extend(r for _, r in rows[q * len(rows) // 5:(q + 1) * len(rows) // 5])
        t10 = rows[-10:]
        top.append((mean(r for _, r in t10), mean(r for _, r in rows)))
    pct = lambda xs: round(mean(xs) * 100, 2) if xs else None  # noqa: E731
    base_up = _rate(up, n)
    out = {
        "days": len(by_day), "samples": n, "base_up": base_up, "base_avg": pct(rets),
        "bull": {"n": bull[0], "win": _rate(bull[1], bull[0]), "avg": pct(bull[2])},
        "bear": {"n": bear[0], "win": _rate(bear[1], bear[0]), "avg": pct(bear[2])},
        "quintiles": [{"avg": pct(b), "up": _rate(sum(1 for r in b if r > 0), len(b))} for b in buckets],
        "top10": {"avg": pct([a for a, _ in top]), "market": pct([b for _, b in top]),
                  "beat": _rate(sum(1 for a, b in top if a > b), len(top))},
    }
    ok = bull[0] >= 200 and bear[0] >= 200 and base_up is not None
    out["edge"] = round((out["bull"]["win"] - base_up) + (out["bear"]["win"] - (100 - base_up)), 1) if ok else None
    return out


def backtest(days, ser, revenue):
    """Score every liquid stock on every past day that has 5 trading days after it.
    The older half picks the model; the newer half (never used for picking) reports its win rate."""
    n = len(days)
    dates = [date.fromisoformat(d["date"]) for d in days]
    entries = []
    for i in range(60, n - HORIZON):
        rev = revenue_available(revenue, dates[i])
        for code, cols in ser.items():
            s = score(cols, i, rev, revenue, code)
            if not s:
                continue
            c5 = cols[C][i + HORIZON]
            if c5:
                entries.append((i, s, c5 / s["close"] - 1))
    idx = sorted({d for d, _, _ in entries})
    if not idx:
        return None
    cut = idx[len(idx) // 2]
    train = [e for e in entries if e[0] < cut]
    test = [e for e in entries if e[0] >= cut]
    models = {}
    for key, (label, w) in MODELS.items():
        models[key] = {"label": label, "weights": w, "train": _stats(train, key), "test": _stats(test, key)}
    # Use a model only if it beat random in BOTH halves; otherwise keep the original and say no model is reliable.
    edge = lambda k, part: models[k][part]["edge"] if models[k][part]["edge"] is not None else -1e9  # noqa: E731
    passing = [k for k in models if edge(k, "train") > 0 and edge(k, "test") > 0]
    chosen = max(passing, key=lambda k: edge(k, "train")) if passing else "trend"
    reliable = chosen in passing and edge(chosen, "test") >= 3
    # single-aspect check on the test half
    aspects = {}
    tb = _stats(test, "trend")["base_up"]
    for k in ("info", "chips", "tech", "rev"):
        b = [0, 0]; s_ = [0, 0]
        for _, s, r in test:
            if s[k] >= ASPECT_CALL:
                b[0] += 1; b[1] += r > 0
            elif s[k] <= -ASPECT_CALL:
                s_[0] += 1; s_[1] += r < 0
        aspects[k] = {"bull": {"n": b[0], "win": _rate(b[1], b[0])}, "bear": {"n": s_[0], "win": _rate(s_[1], s_[0])}}
    return {
        "train_period": [days[idx[0]]["date"], days[cut - 1]["date"] if cut - 1 >= idx[0] else days[idx[0]]["date"]],
        "test_period": [days[cut]["date"], days[idx[-1]]["date"]],
        "models": models, "chosen": chosen, "reliable": reliable, "aspects": aspects, "test_base_up": tb,
    }


def today(days, ser, revenue, names, ptt_stocks, model, i=None):
    i = len(days) - 1 if i is None else i
    rev = revenue_available(revenue, date.fromisoformat(days[i]["date"]))
    rows = []
    for code, cols in ser.items():
        s = score(cols, i, rev, revenue, code, (ptt_stocks or {}).get(code))
        if not s:
            continue
        t = total_of(s, model)
        pos, neg = reasons(s, model)
        rows.append({"code": code, "name": names.get(code, ""), "close": s["close"],
                     "info": round(s["info"] * 100), "chips": round(s["chips"] * 100), "tech": round(s["tech"] * 100),
                     "rev": round(s["rev"] * 100), "total": round(t * 100),
                     "call": 1 if t >= CALL else -1 if t <= -CALL else 0, "rsi": round(s["rsi"]),
                     "pos": pos, "neg": neg})
    rows.sort(key=lambda r: -r["total"])
    return rows


def track(pred_dir, days, rows, save_json, load_json, model=None):
    """Save today's calls; check earlier calls whose 5 trading days have passed."""
    trade_date = days[-1]["date"]
    save_json(pred_dir / f"{trade_date.replace('-', '')}.json",
              {"date": trade_date, "model": model, "calls": {r["code"]: [r["total"], r["call"], r["close"]] for r in rows if r["call"]},
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


def fill_missing_predictions(pred_dir, days, ser, revenue, names, model, save_json):
    """Recreate prediction files for trading days after the first saved one that have none
    (e.g. a run that could not save). Uses only data up to each day, so nothing is looked ahead."""
    have = sorted(p.stem for p in pred_dir.glob("*.json"))
    if not have:
        return 0
    made = 0
    for i, d in enumerate(days[:-1]):
        key = d["date"].replace("-", "")
        if key <= have[0] or key in have:
            continue
        rows = today(days, ser, revenue, names, None, model, i)
        save_json(pred_dir / f"{key}.json",
                  {"date": d["date"], "model": model, "rebuilt": True,
                   "calls": {r["code"]: [r["total"], r["call"], r["close"]] for r in rows if r["call"]},
                   "top10": [r["code"] for r in rows[:10]]})
        made += 1
    return made
