/* 台股盤後雷達 — renders data/latest.json; the transcript tool runs fully client-side. */

/* Login gate. Only a SHA-256 of "username:password" is kept (username lower-cased): the default
   below, or the one saved with 修改密碼 — in the artifact's database (settings/login, works on every
   device) or, if that is unreachable, in this browser. Keeps casual visitors out; not strong security. */
(() => {
  const DEFAULT_HASH = '3e05ac42a24563324d28e58f2329a39cc71bb9242050f3b41b51823ae1bbd384'; // admin:0000
  const KEY = 'radar:auth', LOCAL = 'radar:login-hash';
  const $ = (id) => document.getElementById(id);
  const sha = async (t) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))), (b) => b.toString(16).padStart(2, '0')).join('');
  const cred = (u, p) => sha(u.trim().toLowerCase() + ':' + p);
  // logins saved by the first version kept the username's exact capitals: accept those too
  const matches = async (u, p) => { const a = await cred(u, p); return a === current || (await sha(u.trim() + ':' + p)) === current ? a : null; };
  const ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } } };
  const ss = { get(k) { try { return sessionStorage.getItem(k); } catch { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* blocked */ } }, del(k) { try { sessionStorage.removeItem(k); } catch { /* blocked */ } } };
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error('timeout')), ms))]);

  const getDb = async () => {
    try { return window.claude?.use ? await withTimeout(window.claude.use('db'), 10000) : null; } catch { return null; }
  };
  let current = DEFAULT_HASH;
  const hashReady = (async () => {
    const db = await getDb();
    if (db) {
      try {
        const snap = await withTimeout(db.doc('settings/login').get(), 10000);
        if (snap.exists && snap.data().hash) return (current = snap.data().hash);
      } catch { /* fall through */ }
    }
    return (current = ls.get(LOCAL) || DEFAULT_HASH);
  })();

  const unlock = () => document.documentElement.classList.add('unlocked');
  hashReady.then((h) => { if (ss.get(KEY) === h) unlock(); });

  $('gate-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await hashReady;
    const hex = await matches($('gate-user').value, $('gate-pass').value);
    if (hex) { ss.set(KEY, current); $('gate-err').hidden = true; unlock(); }
    else { $('gate-err').hidden = false; $('gate-pass').value = ''; }
  });

  $('logout').addEventListener('click', () => {
    ss.del(KEY);
    document.documentElement.classList.remove('unlocked');
    $('gate-pass').value = '';
  });

  const modal = $('pw-modal'), msg = $('pw-msg');
  const say = (t, ok) => { msg.textContent = t; msg.className = ok ? 'gate-ok' : 'gate-err'; msg.hidden = false; };
  $('pw-open').addEventListener('click', () => { $('pw-form').reset(); msg.hidden = true; modal.hidden = false; $('pw-curuser').focus(); });
  $('pw-cancel').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.hidden = true; });
  $('pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = $('pw-user').value.trim(), pw = $('pw-new').value;
    if (!user || user.includes(':')) return say('新帳號不能空白，也不能包含「:」。');
    if (!pw) return say('新密碼不能空白。');
    if (pw !== $('pw-new2').value) return say('兩次輸入的新密碼不一樣。');
    await hashReady;
    if (!(await matches($('pw-curuser').value, $('pw-cur').value))) return say('目前的帳號或密碼不正確。');
    const save = $('pw-save'); save.disabled = true; say('儲存中…', true);
    const next = await cred(user, pw);
    let where = null, why = '';
    const db = await getDb();
    if (db) {
      try { await withTimeout(db.doc('settings/login').set({ hash: next, updated: new Date().toISOString() }), 15000); where = 'cloud'; }
      catch (err) { why = err?.code || err?.message || String(err); }
    } else { why = 'no-db'; }
    if (!where && ls.set(LOCAL, next)) where = 'device';
    save.disabled = false;
    if (!where) return say('儲存失敗（' + why + '）。請截圖給 Claude。');
    current = next; ss.set(KEY, next);
    say(where === 'cloud' ? '已更新！所有裝置都要用新的帳號密碼登入。' : '已更新，但只存在這台裝置（' + why + '）。其他裝置仍用舊密碼。', true);
    setTimeout(() => { modal.hidden = true; }, where === 'cloud' ? 1500 : 4000);
  });
})();

(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, d = 0) => (v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const signed = (v, d = 0) => (v == null ? '—' : (v > 0 ? '+' : '') + fmt(v, d));
  const cls = (v) => (v == null ? 'mut' : v > 0 ? 'up' : v < 0 ? 'down' : 'mut');
  const store = {
    get(k, d) { try { const v = localStorage.getItem('radar:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('radar:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  let DATA = null;

  /* ---------------- tabs */
  const TABS = ['screener', 'forecast', 'sentiment', 'chips', 'transcript'];
  function showTab() {
    const name = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'screener';
    TABS.forEach((t) => {
      $('#tab-' + t).hidden = t !== name;
      $(`.tabs a[data-tab="${t}"]`).setAttribute('aria-selected', String(t === name));
    });
  }
  addEventListener('hashchange', showTab);
  showTab();

  /* ---------------- load */
  fetch('data/latest.json?t=' + Date.now(), { cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((d) => { DATA = d; renderAll(); })
    .catch((e) => {
      $('#meta-line').textContent = '資料尚未產生';
      const n = $('#notice'); n.hidden = false;
      n.textContent = '讀不到 data/latest.json（' + e.message + '）。第一次自動更新完成後就會出現資料。';
    });

  function renderAll() {
    const d = DATA;
    $('#meta-line').textContent = `資料日 ${d.trade_date} · 更新 ${d.updated}`;
    const notes = [];
    if (d.partial?.length) notes.push('今日部分資料（三大法人或融資）尚未公布，晚上會再更新一次。');
    if (!d.screener.complete) {
      const cov = Object.entries(d.screener.coverage || {}).map(([m, n]) => `${m.slice(0, 4)}/${m.slice(4)} ${n} 家`).join('、');
      notes.push(`月營收歷史資料還沒補齊（${cov}），缺資料的個股暫時不會出現在「營收連續成長」名單，下次更新會繼續補。`);
    }
    (d.log || []).forEach((l) => notes.push(l));
    if (notes.length) { const n = $('#notice'); n.hidden = false; n.innerHTML = notes.map(esc).join('<br>'); }
    renderScreener();
    renderForecast();
    renderSentiment();
    renderChips();
  }

  /* ================================================================ 預測 */
  const FC = { call: 'all' };
  const pctTxt = (v) => (v == null ? '—' : fmt(v, 1) + '%');
  function bar(v) {
    const w = Math.min(50, Math.abs(v) / 2);
    const side = v >= 0 ? `left:50%;width:${w}%;background:var(--up)` : `right:50%;width:${w}%;background:var(--down)`;
    return `<span class="bar"><i><s style="${side}"></s></i><span class="${cls(v)}">${signed(v)}</span></span>`;
  }
  function renderForecast() {
    const F = DATA.forecast;
    if (!F || !F.backtest) { $('#fc-verify').innerHTML = '<p class="empty">尚無預測資料</p>'; return; }
    const B = F.backtest, L = F.live, M = B.models, key = B.chosen, T = M[key].test;
    const base = T.base_up, baseDown = base == null ? null : Math.round((100 - base) * 10) / 10;
    const verdict = B.reliable
      ? ['good', `採用「${esc(M[key].label)}」：前後兩段資料都贏過隨機挑股。`]
      : ['bad', '目前沒有可靠的預測模型：四種模型都沒有在前後兩段資料同時贏過隨機挑股。下面的看漲／看跌只能當參考，不要直接照著買賣。'];
    const edgeCell = (e) => (e == null ? '<td class="r mut">—</td>' : `<td class="r ${e > 0 ? 'up' : 'down'}">${signed(e, 1)}</td>`);
    const models = Object.entries(M).map(([k, m]) => `<tr${k === key ? ' style="font-weight:700"' : ''}><td>${esc(m.label)}${k === key ? ' <span class="tag src">使用中</span>' : ''}</td>
      ${edgeCell(m.train.edge)}<td class="r">${pctTxt(m.test.bull.win)}</td><td class="r">${pctTxt(m.test.bear.win)}</td>${edgeCell(m.test.edge)}</tr>`).join('');
    const asp = { info: '消息面', chips: '籌碼面', tech: '技術面', rev: '短線反轉' };
    const q = T.quintiles.map((x, i) => `<tr><td>${['最低 20%', '第 2 組', '第 3 組', '第 4 組', '最高 20%'][i]}</td><td class="r ${cls(x.avg)}">${signed(x.avg, 2)}%</td><td class="r">${pctTxt(x.up)}</td></tr>`).join('');
    const liveN = L.bull.n + L.bear.n;
    const liveTxt = liveN
      ? `看漲勝率 <b>${pctTxt(L.bull.win)}</b>（${fmt(L.bull.n)} 筆）、看跌勝率 <b>${pctTxt(L.bear.win)}</b>（${fmt(L.bear.n)} 筆）、每日前 10 名上漲比例 <b>${pctTxt(L.top10.win)}</b>。`
      : `從 ${esc((L.first_pred || F.date).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'))} 開始每天記錄預測，5 個交易日後自動對答案。`;
    $('#fc-verify').innerHTML = `
      <div class="verdict ${verdict[0]}"><b class="big">${verdict[1]}</b>
        <p>設計期 ${esc(B.train_period[0])} 到 ${esc(B.train_period[1])}（大盤偏多），驗證期 ${esc(B.test_period[0])} 到 ${esc(B.test_period[1])}（大盤偏空）。驗證期隨機挑一檔，5 天後上漲的機率是 ${pctTxt(base)}。</p></div>
      <div class="wr-grid">
        <div class="wr"><span class="lbl">看漲勝率（驗證期）</span><span class="val ${T.bull.win >= base ? 'up' : 'down'}">${pctTxt(T.bull.win)}</span><span class="cmp">隨機 ${pctTxt(base)} · ${fmt(T.bull.n)} 筆</span></div>
        <div class="wr"><span class="lbl">看跌勝率（驗證期）</span><span class="val ${T.bear.win >= baseDown ? 'up' : 'down'}">${pctTxt(T.bear.win)}</span><span class="cmp">隨機 ${pctTxt(baseDown)} · ${fmt(T.bear.n)} 筆</span></div>
        <div class="wr"><span class="lbl">每日前 10 名 比大盤多賺</span><span class="val ${cls(T.top10.avg - T.top10.market)}">${signed(T.top10.avg - T.top10.market, 2)}%</span><span class="cmp">前 10 名 ${signed(T.top10.avg, 2)}% · 全市場 ${signed(T.top10.market, 2)}%</span></div>
        <div class="wr"><span class="lbl">實際追蹤（上線後）</span><span class="val">${liveN ? pctTxt(L.bull.win) : '—'}</span><span class="cmp">${liveN ? '看漲勝率' : '等待第一批結果'}</span></div>
      </div>
      <div class="table-box"><table class="grid"><thead><tr><th>模型</th><th class="r">設計期 贏隨機</th><th class="r">驗證期 看漲勝率</th><th class="r">驗證期 看跌勝率</th><th class="r">驗證期 贏隨機</th></tr></thead><tbody>${models}</tbody></table></div>
      <div class="wr-cols">
        <div class="table-box"><table class="grid"><thead><tr><th>單一面向（驗證期）</th><th class="r">看漲勝率</th><th class="r">看跌勝率</th></tr></thead><tbody>
          ${Object.entries(B.aspects).map(([k, v]) => `<tr><td>${asp[k]}</td><td class="r ${v.bull.win >= base ? 'up' : 'down'}">${pctTxt(v.bull.win)}</td><td class="r ${v.bear.win >= baseDown ? 'up' : 'down'}">${pctTxt(v.bear.win)}</td></tr>`).join('')}
          <tr><td class="mut">隨機挑股</td><td class="r mut">${pctTxt(base)}</td><td class="r mut">${pctTxt(baseDown)}</td></tr></tbody></table></div>
        <div class="table-box"><table class="grid"><thead><tr><th>依綜合分數分 5 組（驗證期）</th><th class="r">5 日平均報酬</th><th class="r">上漲比例</th></tr></thead><tbody>${q}</tbody></table></div>
      </div>
      <p class="foot-note">「贏隨機」= 看漲勝率比隨機多幾個百分點 ＋ 看跌勝率比隨機多幾個百分點，正數代表比亂猜好。實際追蹤：${liveTxt}</p>`;
    document.querySelectorAll('.seg-b').forEach((b) => b.addEventListener('click', () => {
      FC.call = b.dataset.call;
      document.querySelectorAll('.seg-b').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      drawForecast();
    }));
    $('#fc-q').addEventListener('input', drawForecast);
    drawForecast();
  }
  function drawForecast() {
    const F = DATA.forecast, q = $('#fc-q').value.trim();
    let rows = F.rows.filter((r) => (FC.call === 'all' || String(r.call) === FC.call) && (!q || (r.code + r.name).includes(q)));
    if (FC.call === '-1') rows = rows.slice().reverse();
    const lab = { 1: '看漲', '-1': '看跌', 0: '中性' };
    $('#fc-table tbody').innerHTML = rows.length ? rows.slice(0, 300).map((r) => `<tr>
      <td><a class="code" href="https://tw.stock.yahoo.com/quote/${r.code}" target="_blank" rel="noopener">${r.code}</a></td>
      <td>${esc(r.name)}</td><td class="r">${fmt(r.close, 2)}</td>
      <td>${bar(r.info)}</td><td>${bar(r.chips)}</td><td>${bar(r.tech)}</td><td>${bar(r.rev ?? 0)}</td>
      <td class="r ${cls(r.total)}"><b>${signed(r.total)}</b></td>
      <td><span class="call c${r.call}">${lab[r.call]}</span></td>
      <td class="why">${r.pos.map((t) => `<span class="p">▲ ${esc(t)}</span>`).join(' ')} ${r.neg.map((t) => `<span class="n">▼ ${esc(t)}</span>`).join(' ')}</td></tr>`).join('')
      : '<tr><td colspan="10" class="empty">沒有符合的個股</td></tr>';
  }

  /* ================================================================ 選股 */
  const SCR = { key: 'f5', asc: false };
  const COLS = [
    { k: 'code', t: '代號' }, { k: 'name', t: '名稱' }, { k: 'ind', t: '產業' },
    { k: 'close', t: '收盤', r: 1 }, { k: 'pct_ma60', t: '距季線', r: 1 }, { k: 'yoy', t: '月營收 YoY%（舊→新）' },
    { k: 'f5', t: '外資 5 日', r: 1 }, { k: 't5', t: '投信 5 日', r: 1 }, { k: 'vol20', t: '均量', r: 1 },
  ];
  function renderScreener() {
    const s = DATA.screener;
    $('#rev-n').textContent = DATA.config?.revenue_months || 3;
    const saved = store.get('scr', null);
    if (saved) { $('#f-rev').checked = saved.rev; $('#f-ma').checked = saved.ma; $('#f-fi').checked = saved.fi; $('#f-vol').value = saved.vol; }
    $('#scr-table thead').innerHTML = '<tr>' + COLS.map((c) => `<th data-k="${c.k}" class="${c.r ? 'r' : ''}">${c.t}</th>`).join('') + '</tr>';
    $('#scr-table thead').addEventListener('click', (e) => {
      const k = e.target.closest('th')?.dataset.k; if (!k || k === 'yoy') return;
      SCR.asc = SCR.key === k ? !SCR.asc : (k === 'code' || k === 'name' || k === 'ind');
      SCR.key = k; drawScreener();
    });
    ['f-rev', 'f-ma', 'f-fi', 'f-vol', 'f-q'].forEach((id) => $('#' + id).addEventListener('input', drawScreener));
    $('#scr-note').textContent = `營收月份：${s.months.map((m) => m.slice(0, 4) + '/' + m.slice(4)).join('、')}。外資、投信單位為張，正數為買超。季線 = 近 60 個交易日收盤平均。點代號看 Yahoo 股市個股頁。`;
    drawScreener();
  }
  function drawScreener() {
    const rows = DATA.screener.rows;
    const f = { rev: $('#f-rev').checked, ma: $('#f-ma').checked, fi: $('#f-fi').checked, vol: +$('#f-vol').value || 0 };
    store.set('scr', f);
    const q = $('#f-q').value.trim();
    const base = rows.filter((r) => (!f.rev || r.rev_ok) && (!f.ma || r.above_ma60) && (r.vol20 ?? 0) >= f.vol);
    const list = base.filter((r) => (!f.fi || r.f5_buy) && (!q || (r.code + r.name + r.ind).includes(q)));
    const nRev = rows.filter((r) => r.rev_ok).length;
    const nBoth = rows.filter((r) => r.rev_ok && r.above_ma60).length;
    const nAll = rows.filter((r) => r.rev_ok && r.above_ma60 && r.f5_buy).length;
    $('#scr-funnel').innerHTML = `<div><b>${nRev}</b><span>營收連續成長</span></div><div><b>${nBoth}</b><span>＋站上季線</span></div><div><b>${nAll}</b><span>＋外資買超</span></div>`;
    const k = SCR.key, dir = SCR.asc ? 1 : -1;
    list.sort((a, b) => {
      const x = a[k], y = b[k];
      if (x == null) return 1; if (y == null) return -1;
      return (typeof x === 'string' ? x.localeCompare(y, 'zh-Hant') : x - y) * dir;
    });
    document.querySelectorAll('#scr-table th').forEach((th) => { th.classList.toggle('sorted', th.dataset.k === k); th.classList.toggle('asc', th.dataset.k === k && SCR.asc); });
    const tb = $('#scr-table tbody');
    if (!list.length) { tb.innerHTML = `<tr><td colspan="${COLS.length}" class="empty">沒有符合條件的個股，試著放寬條件。</td></tr>`; return; }
    tb.innerHTML = list.slice(0, 400).map((r) => `<tr>
      <td><a class="code" href="https://tw.stock.yahoo.com/quote/${r.code}" target="_blank" rel="noopener">${r.code}</a></td>
      <td>${esc(r.name)}${DATA.chips[r.code] ? ` <a href="#chips" data-chip="${r.code}" class="tag src">籌碼</a>` : ''}</td>
      <td class="mut">${esc(r.ind)}</td>
      <td class="r">${fmt(r.close, 2)}</td>
      <td class="r ${cls(r.pct_ma60)}">${signed(r.pct_ma60, 1)}%</td>
      <td><span class="yoys">${r.yoy.map((y) => `<i class="${y == null ? 'na' : y > 0 ? 'p' : 'm'}">${y == null ? '—' : signed(y, 1)}</i>`).join('')}</span></td>
      <td class="r ${cls(r.f5)}">${signed(r.f5)}</td>
      <td class="r ${cls(r.t5)}">${signed(r.t5)}</td>
      <td class="r">${fmt(r.vol20)}</td></tr>`).join('');
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-chip]');
    if (a) { CHIP.sel = a.dataset.chip; drawChips(); }
  });

  /* ================================================================ PTT 情緒 */
  const ZONE = {
    extreme_greed: ['極度貪婪', '版上一片歐印、睡飽數錢，短線過熱，追高要小心。'],
    greed: ['貪婪', '樂觀情緒偏多，留意是否開始過熱。'],
    neutral: ['中性', '情緒沒有明顯偏向。'],
    fear: ['恐懼', '悲觀情緒偏多，可以開始留意錯殺的標的。'],
    extreme_fear: ['極度恐慌', '畢業文、公園排隊洗版，反向來看接近恐慌底部。'],
    unknown: ['資料不足', '今日文章太少，無法計算。'],
  };
  function renderSentiment() {
    const S = DATA.sentiment, L = S.latest;
    if (!L) { $('#gauge').innerHTML = '<p class="empty">尚無 PTT 資料</p>'; return; }
    const z = ZONE[L.zone] || ZONE.unknown;
    $('#gauge').innerHTML = `
      <h3>恐懼貪婪指數 · ${esc(L.date)}</h3>
      <div class="g-num">${L.index == null ? '—' : fmt(L.index, 0)}</div>
      <span class="zone ${esc(L.zone)}">${z[0]}</span>
      <div><div class="g-scale"><i style="left:${L.index ?? 50}%"></i></div>
      <div class="g-ticks"><span>0 恐慌</span><span>50</span><span>貪婪 100</span></div></div>
      <p class="g-read">${z[1]}</p>
      <p class="g-meta">${fmt(L.articles)} 篇文章 · ${fmt(L.pushes)} 則推文${L.pct != null ? ` · 歷史百分位 ${fmt(L.pct, 0)}` : ''}</p>`;
    $('#w-greed').className = 'words g';
    $('#w-fear').className = 'words f';
    $('#w-greed').innerHTML = (L.top_greed || []).map(([w, n]) => `<span>${esc(w)}<b>${n}</b></span>`).join('') || '<span class="mut">無</span>';
    $('#w-fear').innerHTML = (L.top_fear || []).map(([w, n]) => `<span>${esc(w)}<b>${n}</b></span>`).join('') || '<span class="mut">無</span>';
    // PTTweb keeps copies of PTT posts; offer it as a backup when ptt.cc is down
    const mirror = (u) => String(u).replace('https://www.ptt.cc/bbs/', 'https://www.pttweb.cc/bbs/').replace(/\.html$/, '');
    $('#hot').innerHTML = (L.hot || []).map((h) => `<li><a href="${esc(h.u)}" target="_blank" rel="noopener">${esc(h.t)}</a><span class="pb">推 ${h.push} · 噓 ${h.boo} · <a class="alt" href="${esc(mirror(h.u))}" target="_blank" rel="noopener">備用連結</a></span></li>`).join('');
    const names = Object.fromEntries(DATA.screener.rows.map((r) => [r.code, r.name]));
    Object.values(DATA.chips).forEach((c) => { names[c.code] = c.name; });
    const st = Object.entries(L.stocks || {});
    $('#ptt-stocks tbody').innerHTML = st.length ? st.slice(0, 15).map(([code, s]) => `<tr>
      <td><a class="code" href="https://tw.stock.yahoo.com/quote/${code}" target="_blank" rel="noopener">${code}</a></td>
      <td>${esc(names[code] || '')}</td><td class="r">${s.n}</td><td class="r up">${s.push}</td><td class="r down">${s.boo}</td>
      <td class="r">${s.idx == null ? '—' : fmt(s.idx, 0)}</td>
      <td style="white-space:normal;min-width:240px">${s.titles.map((t) => `<a href="${esc(t.u)}" target="_blank" rel="noopener">${esc(t.t)}</a> <a class="alt" href="${esc(mirror(t.u))}" target="_blank" rel="noopener">備用</a>`).join('<br>')}</td></tr>`).join('')
      : '<tr><td colspan="7" class="empty">今天沒有標題帶股票代號的文章</td></tr>';
    drawSentChart();
  }
  function drawSentChart() {
    const ser = DATA.sentiment.series.filter((s) => s.index != null);
    const W = 760, H = 260, P = { l: 34, r: 46, t: 12, b: 26 };
    if (ser.length < 2) { $('#sent-chart').innerHTML = '<p class="empty">累積兩天以上資料後顯示走勢</p>'; return; }
    const tx = Object.fromEntries((DATA.market || []).map((m) => [m.date, m.taiex]));
    const xs = (i) => P.l + (i * (W - P.l - P.r)) / (ser.length - 1);
    const ys = (v) => P.t + (1 - v / 100) * (H - P.t - P.b);
    const hi = DATA.config?.sentiment_high ?? 70, lo = DATA.config?.sentiment_low ?? 30;
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="恐懼貪婪指數走勢">`;
    svg += `<rect x="${P.l}" y="${ys(100)}" width="${W - P.l - P.r}" height="${ys(hi) - ys(100)}" fill="var(--up-soft)"/>`;
    svg += `<rect x="${P.l}" y="${ys(lo)}" width="${W - P.l - P.r}" height="${ys(0) - ys(lo)}" fill="var(--accent-soft)"/>`;
    [0, lo, 50, hi, 100].forEach((v) => { svg += `<line x1="${P.l}" x2="${W - P.r}" y1="${ys(v)}" y2="${ys(v)}" stroke="var(--line)" stroke-dasharray="${v === 50 ? '' : '2 4'}"/><text x="${P.l - 6}" y="${ys(v) + 4}" text-anchor="end">${v}</text>`; });
    const tv = ser.map((s) => tx[s.date]).filter((v) => v != null);
    if (tv.length >= 2) {
      const mn = Math.min(...tv), mx = Math.max(...tv), span = mx - mn || 1;
      const ty = (v) => P.t + (1 - (v - mn) / span) * (H - P.t - P.b);
      let d = ''; ser.forEach((s, i) => { const v = tx[s.date]; if (v != null) d += (d ? 'L' : 'M') + xs(i).toFixed(1) + ',' + ty(v).toFixed(1); });
      svg += `<path d="${d}" fill="none" stroke="var(--taiex)" stroke-width="1.5"/>`;
      svg += `<text x="${W - P.r + 6}" y="${ty(mx) + 4}">${fmt(mx)}</text><text x="${W - P.r + 6}" y="${ty(mn) + 4}">${fmt(mn)}</text>`;
    }
    const pts = ser.map((s, i) => [xs(i), ys(s.index)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('');
    svg += `<path d="${line}L${pts.at(-1)[0]},${ys(0)}L${pts[0][0]},${ys(0)}Z" fill="var(--accent)" opacity=".08"/>`;
    svg += `<path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round"/>`;
    ser.forEach((s, i) => { if (s.zone?.startsWith('extreme')) svg += `<circle cx="${xs(i)}" cy="${ys(s.index)}" r="4" fill="${s.zone === 'extreme_greed' ? 'var(--greed)' : 'var(--fear)'}"/>`; });
    const last = pts.at(-1);
    svg += `<circle cx="${last[0]}" cy="${last[1]}" r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>`;
    const step = Math.max(1, Math.ceil(ser.length / 6));
    ser.forEach((s, i) => { if (i % step === 0 || i === ser.length - 1) svg += `<text x="${xs(i)}" y="${H - 6}" text-anchor="middle">${s.date.slice(5)}</text>`; });
    $('#sent-chart').innerHTML = svg + '</svg>';
  }

  /* ================================================================ 籌碼 */
  const CHIP = { sel: null };
  function spark(vals, w = 90, h = 30) {
    const v = vals.filter((x) => x != null);
    if (v.length < 2) return '';
    const mn = Math.min(...v), mx = Math.max(...v), sp = mx - mn || 1;
    const pts = v.map((x, i) => [(i * w) / (v.length - 1), h - 2 - ((x - mn) / sp) * (h - 4)]);
    const up = v.at(-1) >= v[0];
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('')}" fill="none" stroke="${up ? 'var(--up)' : 'var(--down)'}" stroke-width="1.6"/><circle cx="${pts.at(-1)[0]}" cy="${pts.at(-1)[1]}" r="2.2" fill="${up ? 'var(--up)' : 'var(--down)'}"/></svg>`;
  }
  function trendChart(labels, vals, color, unit) {
    const pts = vals.map((v, i) => [i, v]).filter(([, v]) => v != null);
    if (pts.length < 2) return '<p class="empty" style="padding:12px">資料累積中</p>';
    const W = 300, H = 96, P = { l: 6, r: 44, t: 10, b: 18 };
    const ys = pts.map(([, v]) => v), mn = Math.min(...ys), mx = Math.max(...ys), sp = (mx - mn) || 1;
    const x = (i) => P.l + (i / (vals.length - 1)) * (W - P.l - P.r);
    const y = (v) => P.t + (1 - (v - mn) / sp) * (H - P.t - P.b);
    const d = pts.map(([i, v], k) => (k ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1)).join('');
    const [li, lv] = pts.at(-1);
    const lab = (s) => (s.length === 8 ? s.slice(4, 6) + '/' + s.slice(6) : s.slice(5).replace('-', '/'));
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="趨勢圖">
      <line x1="${P.l}" x2="${W - P.r}" y1="${y(mx)}" y2="${y(mx)}" stroke="var(--line-soft)"/><line x1="${P.l}" x2="${W - P.r}" y1="${y(mn)}" y2="${y(mn)}" stroke="var(--line-soft)"/>
      <path d="${d}L${x(li)},${H - P.b}L${x(pts[0][0])},${H - P.b}Z" fill="${color}" opacity=".08"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${x(li)}" cy="${y(lv)}" r="3.5" fill="${color}" stroke="var(--surface)" stroke-width="1.5"/>
      <text x="${W - P.r + 6}" y="${y(mx) + 4}">${fmt(mx, 2)}${unit}</text><text x="${W - P.r + 6}" y="${y(mn) + 4}">${fmt(mn, 2)}${unit}</text>
      <text x="${P.l}" y="${H - 4}">${lab(labels[pts[0][0]])}</text><text x="${W - P.r}" y="${H - 4}" text-anchor="end">${lab(labels[li])}</text></svg>`;
  }
  function holdPanel(h) {
    if (!h) return '';
    const chg = (v, unit = ' 個百分點', d = 2) => (v == null ? '<span class="mut">—</span>' : `<b class="${cls(v)}">${signed(v, d)}</b>${unit}`);
    const last = (a) => (a.length ? fmt(a.at(-1), 2) + '%' : '—');
    return `<div class="hold">
      <div class="card-h"><h3>持股結構趨勢</h3><span class="legend">大戶 = 400 張以上 · 散戶 = 50 張以下（集保每週）</span></div>
      ${h.read.length ? `<ul class="hold-read">${h.read.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      <div class="hold-grid">
        <div class="hold-c"><div class="hold-t"><span>外資持股比例</span><b>${last(h.foreign)}</b></div>${trendChart(h.fdates, h.foreign, 'var(--accent)', '%')}
          <p>近 20 日 ${chg(h.chg.f20)} · 近 60 日 ${chg(h.chg.f60)}</p></div>
        <div class="hold-c"><div class="hold-t"><span>大戶持股（≥400 張）</span><b>${last(h.big)}</b></div>${trendChart(h.weeks, h.big, 'var(--up)', '%')}
          <p>近 4 週 ${chg(h.chg.big4)} · 近 12 週 ${chg(h.chg.big12)} · 千張大戶 ${last(h.k1000)}</p></div>
        <div class="hold-c"><div class="hold-t"><span>散戶持股（≤50 張）</span><b>${last(h.retail)}</b></div>${trendChart(h.weeks, h.retail, 'var(--down)', '%')}
          <p>近 4 週 ${chg(h.chg.retail4)} · 近 12 週 ${chg(h.chg.retail12)} · 股東人數 4 週 ${chg(h.chg.holders4, ' 人', 0)}</p></div>
      </div></div>`;
  }
  function renderChips() {
    $('#red-pct').textContent = DATA.config?.red_margin_pct ?? 20;
    const codes = DATA.chips_order || Object.keys(DATA.chips);
    CHIP.sel = store.get('chip', null);
    if (!codes.includes(CHIP.sel)) CHIP.sel = codes[0];
    $('#chip-list').addEventListener('click', (e) => { const b = e.target.closest('[data-code]'); if (b) { CHIP.sel = b.dataset.code; drawChips(); } });
    drawChips();
  }
  function drawChips() {
    const chips = (DATA.chips_order || Object.keys(DATA.chips)).map((c) => DATA.chips[c]).filter(Boolean);
    if (!chips.length) { $('#chip-detail').innerHTML = '<p class="empty">尚無籌碼資料</p>'; return; }
    store.set('chip', CHIP.sel);
    const flagOf = (c) => { const f = c.table.flatMap((t) => t.flags); return f.includes('red') ? 'red' : f.includes('warn') ? 'warn' : null; };
    $('#chip-list').innerHTML = chips.map((c) => {
      const fl = flagOf(c);
      return `<button type="button" class="chip-item" data-code="${c.code}" aria-current="${c.code === CHIP.sel}">
        <span class="nm"><span class="code">${c.code}</span>${esc(c.name)}</span>${spark(c.spark)}
        <span class="meta"><span class="tag src">${esc(c.src)}</span>${c.streak >= 2 ? `<span class="tag streak">外資連買 ${c.streak}</span>` : ''}${fl === 'red' ? '<span class="tag red">紅字</span>' : fl === 'warn' ? '<span class="tag warn">注意</span>' : ''}<span class="${cls(c.fi10)}">外資10日 ${signed(c.fi10)}</span></span>
      </button>`;
    }).join('');
    const c = DATA.chips[CHIP.sel] || chips[0];
    const last = c.table.at(-1) || {};
    const rows = c.table.map((t) => `<tr class="${t.flags.includes('red') ? 'flag-red' : t.flags.includes('warn') ? 'flag-warn' : ''}">
      <td class="n">${t.date.slice(5)}</td><td class="r">${fmt(t.close, 2)}</td>
      <td class="r ${cls(t.fi)}">${signed(t.fi)}</td><td class="r ${cls(t.it)}">${signed(t.it)}</td><td class="r ${cls(t.dl)}">${signed(t.dl)}</td>
      <td class="r">${fmt(t.mg)}</td><td class="r ${cls(t.mg_chg)}">${t.mg_chg == null ? '—' : signed(t.mg_chg, 2) + '%'}</td>
      <td>${t.flags.includes('red') ? '<span class="tag red">融資暴增＋外資賣</span>' : t.flags.includes('warn') ? '<span class="tag warn">融資異常＋外資賣</span>' : t.flags.includes('margin_abn') ? '<span class="tag src">融資異常增加</span>' : ''}</td></tr>`).join('');
    const analogs = c.analogs.map((a) => `<div class="analog">
      <p><b>${esc(a.label)}</b>：${a.count ? `這檔過去 ${a.count} 次出現同樣訊號，<b class="${a.down > a.count / 2 ? 'down' : 'up'}">${a.down} 次隔週回檔</b>，5 日後平均報酬 <b class="${cls(a.avg)}">${signed(a.avg, 2)}%</b>。` : '歷史資料內還沒有已完成的同樣訊號可以對照。'}</p>
      ${a.cases.length ? `<div class="cases">${a.cases.map((k) => `<span>${k.date.slice(5)} → ${k.ret5 == null ? '進行中' : `<b class="${cls(k.ret5)}">${signed(k.ret5, 1)}%</b>`}</span>`).join('')}</div>` : ''}
    </div>`).join('');
    $('#chip-detail').innerHTML = `
      <div class="cd-head"><h3><span class="code">${c.code}</span> ${esc(c.name)}</h3><a href="https://tw.stock.yahoo.com/quote/${c.code}/institutional-trading" target="_blank" rel="noopener">Yahoo 法人買賣 ↗</a></div>
      <div class="stats">
        <div><b>${fmt(last.close, 2)}</b><span>收盤</span></div>
        <div><b class="${c.streak ? 'up' : 'mut'}">${c.streak} 天</b><span>外資連續買超</span></div>
        <div><b class="${cls(c.fi10)}">${signed(c.fi10)}</b><span>外資 10 日（張）</span></div>
        <div><b class="${cls(c.mg10)}">${signed(c.mg10)}</b><span>融資 10 日增減（張）</span></div>
      </div>
      <div class="table-box"><table class="grid"><thead><tr><th>日期</th><th class="r">收盤</th><th class="r">外資</th><th class="r">投信</th><th class="r">自營商</th><th class="r">融資餘額</th><th class="r">融資增減</th><th>訊號</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${holdPanel(c.holders)}
      ${analogs || '<p class="foot-note">近十日沒有觸發需要對照歷史的訊號。</p>'}
      <p class="foot-note">單位：張。歷史對照用最近約半年的資料，「隔週回檔」指訊號日後第 5 個交易日收盤低於訊號日收盤。</p>`;
  }

  /* ================================================================ 法說會 */
  const LEX = {
    evasive: '不評論,無法提供,再觀察,視情況,不便透露,不方便,不予置評,無法評論,很難說,還在評估,尚未決定,目前還不確定,不排除,持續觀察,不會給,暫不,無法預測,不適合回答',
    tone: '穩健成長,審慎樂觀,樂觀,強勁,保守,審慎,挑戰,不確定,疲弱,逆風,溫和',
    topic: '資本支出,毛利率,庫存,需求,價格,匯率,展望,產能,AI,關稅',
  };
  const lexEl = { evasive: $('#lex-evasive'), tone: $('#lex-tone'), topic: $('#lex-topic') };
  Object.entries(lexEl).forEach(([k, el]) => { el.value = store.get('lex-' + k, LEX[k]); el.addEventListener('change', () => store.set('lex-' + k, el.value)); });
  const words = (k) => lexEl[k].value.split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean);
  const count = (text, w) => text.split(w).length - 1;

  function parseQA(text) {
    const paras = text.replace(/\r/g, '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const isQ = (p) => /^(Q\d*|問|提問|分析師|Analyst)[\s:：.、]/i.test(p) || /^Q\d*[:：]/.test(p) || (/[？?]/.test(p) && !/^(A\d*|答|管理層|回答)[\s:：]/i.test(p));
    const qa = [];
    let cur = null;
    for (const p of paras) {
      if (isQ(p)) { cur = { q: p, a: '' }; qa.push(cur); }
      else if (cur) cur.a += (cur.a ? '\n' : '') + p;
    }
    return qa;
  }
  function analyze(text) {
    const qa = parseQA(text);
    const len = text.replace(/\s/g, '').length || 1;
    const ev = words('evasive'), tone = words('tone'), topic = words('topic');
    const evC = Object.fromEntries(ev.map((w) => [w, count(text, w)]));
    const toneC = Object.fromEntries(tone.map((w) => [w, count(text, w)]));
    const topicLen = Object.fromEntries(topic.map((t) => {
      const as = qa.filter((x) => x.q.includes(t));
      return [t, { n: as.length, len: as.reduce((s, x) => s + x.a.replace(/\s/g, '').length, 0) }];
    }));
    const dodged = qa.filter((x) => {
      const a = x.a.replace(/\s/g, '');
      return a.length < 30 || ev.some((w) => a.includes(w));
    });
    return { qa, len, evC, evTotal: Object.values(evC).reduce((a, b) => a + b, 0), toneC, topicLen, dodged };
  }
  function hl(s) {
    let h = esc(s);
    words('evasive').forEach((w) => { h = h.split(esc(w)).join(`<mark>${esc(w)}</mark>`); });
    return h;
  }
  function runTranscript(isSample) {
    const A = analyze($('#tx-prev').value), B = analyze($('#tx-cur').value);
    if (!B.len || B.len < 20) { $('#tx-out').innerHTML = '<p class="empty">請至少貼上本季逐字稿。</p>'; return; }
    const per = (n, len) => (n / len) * 10000;
    const pct = (a, b) => (a ? ((b - a) / a) * 100 : null);
    const find = [];
    const evDelta = pct(per(A.evTotal, A.len), per(B.evTotal, B.len));
    if (A.len > 20) find.push(`閃避詞每萬字 ${fmt(per(A.evTotal, A.len), 1)} → ${fmt(per(B.evTotal, B.len), 1)}${evDelta == null ? '' : `（${signed(evDelta, 0)}%）`}，${B.evTotal / B.len > A.evTotal / A.len ? '<b class="up">本季閃避變多</b>' : '本季閃避較少'}。`);
    Object.entries(B.topicLen).forEach(([t, b]) => {
      const a = A.topicLen[t];
      if (a && a.n && b.n) {
        const d = pct(a.len / a.n, b.len / b.n);
        if (d != null && Math.abs(d) >= 25) {
          const ev = words('evasive').filter((w) => B.qa.filter((x) => x.q.includes(t)).some((x) => x.a.includes(w)));
          find.push(`本季對<b>${esc(t)}</b>問題的回答長度比上一季${d < 0 ? '短' : '長'} <b class="${d < 0 ? 'up' : ''}">${fmt(Math.abs(d), 0)}%</b>${ev.length ? `，且出現「${ev.map(esc).join('」「')}」` : ''}。`);
        }
      }
    });
    Object.entries(B.toneC).forEach(([w, n]) => { const a = A.toneC[w] || 0; if (A.len > 20 && n !== a && (n === 0 || a === 0)) find.push(`語氣詞「${esc(w)}」上一季 ${a} 次 → 本季 ${n} 次。`); });
    if (B.dodged.length) find.push(`本季有 <b>${B.dodged.length}</b> 個問題沒有正面回答（回答很短或含閃避詞）。`);
    const evRows = Object.keys(B.evC).filter((w) => B.evC[w] || A.evC[w]).map((w) => `<tr><td>${esc(w)}</td><td class="r">${A.evC[w] || 0}</td><td class="r">${B.evC[w]}</td><td class="r ${cls(B.evC[w] - (A.evC[w] || 0))}">${signed(B.evC[w] - (A.evC[w] || 0))}</td></tr>`).join('');
    const tpRows = Object.keys(B.topicLen).filter((t) => B.topicLen[t].n || A.topicLen[t]?.n).map((t) => {
      const a = A.topicLen[t], b = B.topicLen[t];
      const aa = a?.n ? a.len / a.n : null, bb = b.n ? b.len / b.n : null;
      const d = aa && bb ? pct(aa, bb) : null;
      return `<tr><td>${esc(t)}</td><td class="r">${a?.n || 0}</td><td class="r">${aa ? fmt(aa) : '—'}</td><td class="r">${b.n}</td><td class="r">${bb ? fmt(bb) : '—'}</td><td class="r ${d == null ? 'mut' : d < 0 ? 'up' : 'down'}">${d == null ? '—' : signed(d, 0) + '%'}</td></tr>`;
    }).join('');
    $('#tx-out').innerHTML = `
      <div class="findings">${isSample ? '<span class="sample-badge">範例逐字稿，非真實公司資料</span>' : ''}<h3>重點發現</h3><ul>${find.map((f) => `<li>${f}</li>`).join('') || '<li>兩季差異不明顯。</li>'}</ul></div>
      <div class="cols3" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
        <div class="table-box"><table class="grid"><thead><tr><th>閃避詞</th><th class="r">上一季</th><th class="r">本季</th><th class="r">變化</th></tr></thead><tbody>${evRows || '<tr><td colspan="4" class="empty">兩季都沒有出現閃避詞</td></tr>'}</tbody></table></div>
        <div class="table-box"><table class="grid"><thead><tr><th>主題</th><th class="r">上季題數</th><th class="r">平均答長</th><th class="r">本季題數</th><th class="r">平均答長</th><th class="r">變化</th></tr></thead><tbody>${tpRows || '<tr><td colspan="6" class="empty">沒有問到設定的主題</td></tr>'}</tbody></table></div>
      </div>
      <h3>本季沒有正面回答的問題（${B.dodged.length}）</h3>
      <div class="qa">${B.dodged.map((x) => `<div><div class="q">${esc(x.q)}</div><div class="a">${hl(x.a) || '（沒有回答）'}</div></div>`).join('') || '<p class="foot-note">沒有找到。</p>'}</div>
      <p class="foot-note">共辨識出上一季 ${A.qa.length} 題、本季 ${B.qa.length} 題問答。答長以字數計（不含空白）。</p>`;
  }
  const SAMPLE_PREV = `Q：請問明年資本支出的規劃？
答：我們明年資本支出預計在 300 億到 320 億之間，主要投入先進製程擴產與海外新廠，其中七成用於先進製程，兩成用於封裝，一成用於其他。整體來看需求非常穩健，我們對明年維持穩健成長的看法。
Q：毛利率下一季的看法？
答：受惠產品組合改善與產能利用率提升，我們預期下一季毛利率會落在 52% 到 54%，匯率假設是 1 美元兌 31 元新台幣。
Q：庫存水位目前是否健康？
答：客戶庫存已經回到健康水位，我們看到急單逐步回流，預期下半年需求持續增溫，對全年展望維持樂觀。`;
  const SAMPLE_CUR = `Q：請問明年資本支出的規劃？
答：資本支出會視情況調整，目前還在評估，會再觀察客戶需求。
Q：毛利率下一季的看法？
答：毛利率會受到匯率與產品組合影響，我們維持審慎樂觀，細節不便透露。
Q：庫存水位目前是否健康？
答：庫存部分我們持續觀察，視情況調整。
Q：關稅對你們有沒有影響？
答：不評論。
Q：海外新廠進度？
答：海外新廠依計畫進行，預計明年第二季試產，第三季開始量產，初期月產能約一萬片，後續會依客戶需求逐步擴充。`;
  $('#tx-sample').addEventListener('click', () => { $('#tx-prev').value = SAMPLE_PREV; $('#tx-cur').value = SAMPLE_CUR; runTranscript(true); });
  $('#tx-run').addEventListener('click', () => runTranscript(false));
  document.querySelectorAll('.file input').forEach((inp) => inp.addEventListener('change', () => {
    const f = inp.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { $('#' + inp.dataset.target).value = rd.result; };
    rd.readAsText(f, 'utf-8');
  }));
  // open in a working state: show the labelled sample until the user pastes their own
  $('#tx-prev').value = SAMPLE_PREV; $('#tx-cur').value = SAMPLE_CUR; runTranscript(true);
})();
