/* TOEIC word cards — single-page app, no build step.
 * Data comes from data/*.json, which a GitHub Action rebuilds from the Google Drive folder.
 * Account, progress and settings live in this browser's localStorage. */
(() => {
  'use strict';

  // ------------------------------------------------------------------ storage helpers
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full / blocked */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };
  const sess = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
  };
  const K = { account: 'wc_account', session: 'wc_session', srs: 'wc_srs', prefs: 'wc_prefs', days: 'wc_days' };

  // ------------------------------------------------------------------ small utils
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAY = 86400000;
  const todayStr = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const reRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fmtDate = (s) => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${y}/${+m}/${+d}`; };
  const weekday = (s) => { const d = new Date(s + 'T00:00:00'); return isNaN(d) ? '' : '週' + '日一二三四五六'[d.getDay()]; };
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  const ICON = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    cards: '<rect x="3" y="6" width="14" height="14" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v12"/>',
    quiz: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><circle cx="12" cy="17.5" r=".6" fill="currentColor"/>',
    read: '<path d="M3 5c3-1 6-1 9 1 3-2 6-2 9-1v14c-3-1-6-1-9 1-3-2-6-2-9-1z"/><path d="M12 6v14"/>',
    grammar: '<path d="M4 19h16M6 15l4-10 4 10M7.5 11.5h5"/><path d="M16 9h4M18 7v4"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    speak: '<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    next: '<path d="M9 18l6-6-6-6"/>',
    shuffle: '<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

  // ------------------------------------------------------------------ preferences / theme
  const prefs = Object.assign({ dir: 'en2zh', deck: 'due', newPerDay: 20, rate: 0.9, theme: 'auto', showSummary: false }, store.get(K.prefs, {}));
  const savePrefs = () => store.set(K.prefs, prefs);
  function applyTheme() {
    if (prefs.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', prefs.theme);
  }
  applyTheme();

  // ------------------------------------------------------------------ account (local only)
  const DEFAULT_USER = 'admin';
  const DEFAULT_PASS = '0000';

  function fallbackHash(s) { // used only where WebCrypto is unavailable (e.g. opened from file://)
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 + c, 2246822519) ^ (h2 >>> 13); }
    return 'f' + (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
  }
  async function hash(user, pass, salt) {
    const s = `${salt}|${user}|${pass}`;
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    return fallbackHash(s);
  }
  function newSalt() {
    const a = new Uint8Array(12);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.random() * 256; });
    return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  async function getAccount() {
    let acc = store.get(K.account, null);
    if (!acc || !acc.hash) {
      const salt = newSalt();
      acc = { user: DEFAULT_USER, salt, hash: await hash(DEFAULT_USER, DEFAULT_PASS, salt), isDefault: true };
      store.set(K.account, acc);
    }
    return acc;
  }
  async function checkLogin(user, pass) {
    const acc = await getAccount();
    return user.trim() === acc.user && (await hash(acc.user, pass, acc.salt)) === acc.hash;
  }
  function isLoggedIn() {
    const s = sess.get(K.session) || store.get(K.session, null);
    return !!(s && s.ok);
  }
  function setLoggedIn(remember) {
    const v = { ok: true, t: Date.now() };
    sess.set(K.session, v);
    if (remember) store.set(K.session, v); else store.del(K.session);
  }
  function logout() { sess.del(K.session); store.del(K.session); location.hash = ''; render(); }

  // ------------------------------------------------------------------ data
  const D = { index: null, vocab: [], grammar: [], lessons: {}, loaded: false, error: null };
  const bust = () => `?t=${Date.now()}`;
  async function getJSON(path) {
    const r = await fetch(path + bust(), { cache: 'no-store' });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }
  async function loadData() {
    try {
      const [index, vocab, grammar] = await Promise.all([getJSON('data/index.json'), getJSON('data/vocab.json'), getJSON('data/grammar.json')]);
      const changed = D.index && D.index.updated !== index.updated && JSON.stringify(D.index.counts) !== JSON.stringify(index.counts);
      Object.assign(D, { index, vocab, grammar, loaded: true, error: null });
      buildCards();
      return changed;
    } catch (e) {
      D.loaded = true; D.error = e; return false;
    }
  }
  async function getLesson(id) {
    if (!D.lessons[id]) D.lessons[id] = await getJSON(`data/lessons/${encodeURIComponent(id)}.json`);
    return D.lessons[id];
  }

  // Cards: one per word, one "fill the collocation" card per word that has a collocation, one per grammar note.
  let CARDS = [];
  const CARD_BY_ID = new Map();
  function blankCollocation(colloc, word) {
    const base = word.replace(/\(.*?\)/g, '').trim();
    const parts = base.split(/\s+/).filter((p) => p.length > 1);
    let out = colloc, hit = false;
    for (const p of parts) {
      const stem = p.length > 4 && /e$/i.test(p) ? p.slice(0, -1) : p;
      const rx = new RegExp(`\\b${reRx(stem)}\\w*`, 'gi');
      if (rx.test(out)) { hit = true; out = out.replace(rx, (m) => '＿'.repeat(Math.min(Math.max(m.length, 3), 8))); }
    }
    return hit ? out : null;
  }
  function buildCards() {
    CARDS = [];
    for (const v of D.vocab) {
      const u = v.uses[v.uses.length - 1] || {};
      CARDS.push({ id: 'w:' + v.key, type: 'word', v, use: u, date: v.first, phrase: /phr/i.test(v.pos) || /\s/.test(v.key) });
      const colloc = v.uses.map((x) => x.colloc).find(Boolean);
      const blanked = colloc && blankCollocation(colloc, v.word);
      if (blanked) CARDS.push({ id: 'c:' + v.key, type: 'colloc', v, use: u, colloc, blanked, date: v.first, phrase: true });
    }
    for (const g of D.grammar) CARDS.push({ id: 'g:' + g.id, type: 'grammar', g, date: g.date });
    CARD_BY_ID.clear();
    CARDS.forEach((c) => CARD_BY_ID.set(c.id, c));
  }

  // ------------------------------------------------------------------ spaced repetition (Leitner-style)
  const INTERVALS = [0, 1, 2, 4, 7, 15, 30, 60, 120]; // days for box 0..8
  let SRS = store.get(K.srs, {});
  const saveSRS = () => store.set(K.srs, SRS);
  const st = (id) => SRS[id];
  function status(id) {
    const s = st(id);
    if (!s) return 'new';
    if (s.box >= 5) return 'known';
    return 'learning';
  }
  const isDue = (id) => { const s = st(id); return !!s && s.due <= Date.now(); };
  function grade(id, g) { // g: 1 again, 2 hard, 3 good, 4 easy
    const s = SRS[id] || { box: 0, due: 0, right: 0, wrong: 0, first: Date.now() };
    if (g === 1) { s.box = 0; s.wrong++; s.due = Date.now() + 60 * 1000; }
    else {
      if (g === 2) s.box = Math.max(1, s.box);
      if (g === 3) s.box = Math.min(INTERVALS.length - 1, s.box + 1);
      if (g === 4) s.box = Math.min(INTERVALS.length - 1, s.box + 2);
      s.right++;
      const days = g === 2 ? Math.max(1, Math.round(INTERVALS[s.box] / 2)) : INTERVALS[s.box];
      const d = new Date(); d.setHours(4, 0, 0, 0); // due at 4am so "tomorrow" means tomorrow morning
      s.due = d.getTime() + days * DAY;
    }
    s.last = Date.now();
    SRS[id] = s; saveSRS();
    const days = store.get(K.days, {}); const t = todayStr();
    days[t] = (days[t] || 0) + 1; store.set(K.days, days);
  }
  function streak() {
    const days = store.get(K.days, {});
    let n = 0; const d = new Date();
    if (!days[todayStr(d)]) d.setDate(d.getDate() - 1);
    while (days[todayStr(d)]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function newIntroducedToday() {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return Object.values(SRS).filter((s) => s.first >= start.getTime()).length;
  }

  // ------------------------------------------------------------------ speech
  function speak(text, lang = 'en-US') {
    if (!('speechSynthesis' in window) || !text) { toast('這個瀏覽器不支援朗讀'); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/\(.*?\)/g, ''));
    u.lang = lang; u.rate = prefs.rate;
    const voice = speechSynthesis.getVoices().find((v) => v.lang === lang && /Samantha|Google US|Aria|Jenny|Daniel/i.test(v.name)) ||
      speechSynthesis.getVoices().find((v) => v.lang.startsWith(lang.slice(0, 2)));
    if (voice) u.voice = voice;
    speechSynthesis.speak(u);
  }
  if ('speechSynthesis' in window) speechSynthesis.getVoices();

  // ------------------------------------------------------------------ highlighting
  function wordRegex(word) {
    const base = word.replace(/\(.*?\)/g, '').trim();
    const toks = base.split(/\s+/).filter(Boolean);
    if (!toks.length) return null;
    const parts = toks.map((t) => {
      const low = t.toLowerCase();
      if (low.length < 4) return reRx(t);
      let stem = low;
      if (/e$/.test(stem)) stem = stem.slice(0, -1);
      else if (/y$/.test(stem)) stem = stem.slice(0, -1) + '(?:y|i)';
      else return reRx(stem) + '\\w{0,4}';
      return (stem.includes('(?:') ? stem : reRx(stem)) + '\\w{0,4}';
    });
    return new RegExp(`\\b${parts.join('[\\s-]+')}\\b`, 'i');
  }
  function highlight(text, word) {
    const rx = wordRegex(word);
    const safe = esc(text);
    if (!rx) return safe;
    const g = new RegExp(rx.source, 'gi');
    return safe.replace(g, (m) => `<mark>${m}</mark>`);
  }

  // ------------------------------------------------------------------ routing
  const ROUTES = [
    ['home', '首頁', 'home'], ['cards', '單字卡', 'cards'], ['quiz', '測驗', 'quiz'],
    ['read', '文章', 'read'], ['grammar', '文法片語', 'grammar'], ['words', '單字表', 'list'], ['settings', '設定', 'gear'],
  ];
  const TABBAR = ['home', 'cards', 'read', 'grammar', 'settings'];
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [name, ...rest] = h.split('/');
    return { name: name || 'home', args: rest.map(decodeURIComponent) };
  }
  function chrome(active, inner) {
    return `
      <header class="topbar"><div class="topbar-inner">
        <a class="brand" href="#/home"><img src="icon.svg" alt="">TOEIC 字卡</a>
        <nav class="nav">${ROUTES.map(([r, label]) => `<a href="#/${r}" class="${r === active ? 'active' : ''}">${label}</a>`).join('')}</nav>
      </div></header>
      <main class="shell" id="main">${inner}</main>
      <nav class="tabbar">${ROUTES.filter(([r]) => TABBAR.includes(r)).map(([r, label, ic]) =>
        `<a href="#/${r}" class="${r === active || (r === 'cards' && ['quiz', 'words'].includes(active)) ? 'active' : ''}">${icon(ic)}${label}</a>`).join('')}</nav>`;
  }

  let cleanup = null;
  async function render() {
    if (cleanup) { cleanup(); cleanup = null; }
    const app = $('#app');
    if (!isLoggedIn()) { renderLogin(app); return; }
    if (!D.loaded) { app.innerHTML = chrome('home', '<div class="empty">載入中…</div>'); await loadData(); }
    const { name, args } = parseHash();
    const view = VIEWS[name] || VIEWS.home;
    const active = name === 'lesson' || name === 'article' ? 'read' : (VIEWS[name] ? name : 'home');
    app.innerHTML = chrome(active, '');
    const main = $('#main');
    try {
      const ret = await view(main, ...args);
      if (typeof ret === 'function') cleanup = ret;
    } catch (e) {
      console.error(e);
      main.innerHTML = `<div class="empty"><div class="big">⚠️</div>載入失敗：${esc(e.message)}</div>`;
    }
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', render);

  // ------------------------------------------------------------------ login view
  async function renderLogin(app) {
    const acc = await getAccount();
    app.innerHTML = `
      <div class="login-wrap"><form class="login card" autocomplete="on">
        <div class="logo"><img src="icon.svg" alt=""><div><h1>TOEIC 字卡</h1><div class="muted small">每日新聞・單字・文法複習</div></div></div>
        <div class="field"><label for="u">帳號</label><input id="u" name="username" type="text" autocomplete="username" autocapitalize="off" required></div>
        <div class="field"><label for="p">密碼</label><input id="p" name="password" type="password" autocomplete="current-password" inputmode="text" required></div>
        <div class="err" id="err"></div>
        <label class="check"><input type="checkbox" id="rem" checked> 在這台裝置保持登入</label>
        <button class="btn primary big" style="width:100%" type="submit">登入</button>
        ${acc.isDefault ? '<p class="muted small" style="margin:14px 0 0">第一次使用：帳號 <b>admin</b>，密碼 <b>0000</b>。登入後可在「設定」更改密碼。</p>' : ''}
      </form></div>`;
    const form = $('form', app);
    $('#u').focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (await checkLogin($('#u').value, $('#p').value)) {
        setLoggedIn($('#rem').checked);
        render();
      } else {
        $('#err').textContent = '帳號或密碼錯誤';
        $('#p').value = ''; $('#p').focus();
      }
    });
  }

  // ------------------------------------------------------------------ views
  const VIEWS = {};
  const noData = () => `<div class="card empty"><div class="big">📭</div>
    <p>還沒有任何內容。</p>
    <p class="small">Google 雲端硬碟資料夾裡的 .docx 會每小時自動同步到這裡。${D.error ? `<br>（讀取資料失敗：${esc(D.error.message)}）` : ''}</p></div>`;

  VIEWS.home = (main) => {
    if (!D.index || !D.index.lessons.length) { main.innerHTML = `<div class="page-head"><h1>首頁</h1></div>${noData()}`; return; }
    const wordCards = CARDS.filter((c) => c.type === 'word');
    const due = CARDS.filter((c) => isDue(c.id)).length;
    const newLeft = Math.max(0, prefs.newPerDay - newIntroducedToday());
    const newAvail = Math.min(newLeft, wordCards.filter((c) => !st(c.id)).length);
    const known = wordCards.filter((c) => status(c.id) === 'known').length;
    const latest = D.index.lessons[0];
    const h = new Date().getHours();
    const hi = h < 11 ? '早安' : h < 18 ? '午安' : '晚安';
    main.innerHTML = `
      <div class="page-head"><div><div class="muted small">${fmtDate(todayStr())} ${weekday(todayStr())}</div><h1>${hi}！今天也來複習吧</h1></div></div>
      <div class="grid grid-4">
        <div class="card stat accent"><div class="num">${due + newAvail}</div><div class="lbl">今日待複習</div></div>
        <div class="card stat"><div class="num">${wordCards.length}</div><div class="lbl">單字總數</div></div>
        <div class="card stat"><div class="num">${known}</div><div class="lbl">已熟記</div></div>
        <div class="card stat"><div class="num">${streak()}</div><div class="lbl">連續天數</div></div>
      </div>
      <div class="row" style="margin:16px 0 4px">
        <a class="btn primary big" href="#/cards">${icon('cards')} 開始複習 ${due + newAvail ? `(${due + newAvail})` : ''}</a>
        <a class="btn big" href="#/quiz">${icon('quiz')} 小測驗</a>
        <a class="btn big" href="#/read/${encodeURIComponent(latest.id)}">${icon('read')} 今日文章</a>
      </div>
      <h2 style="margin-top:26px">最新一期</h2>
      ${lessonCard(latest)}
      ${D.index.lessons.length > 1 ? `<h2 style="margin-top:26px">之前的內容</h2>${D.index.lessons.slice(1, 6).map(lessonCard).join('')}
        ${D.index.lessons.length > 6 ? '<p><a href="#/read">看全部 →</a></p>' : ''}` : ''}
      <p class="footer-note">資料最後同步：${new Date(D.index.updated).toLocaleString('zh-TW')}${D.index.folder ? ` ・ <a href="${esc(D.index.folder)}" target="_blank" rel="noopener">雲端硬碟資料夾</a>` : ''}</p>`;
  };

  function lessonCard(l) {
    const words = l.articles.reduce((n, a) => n + a.words, 0);
    return `<div class="card">
      <div class="row"><b>${fmtDate(l.date)} ${weekday(l.date)}</b><span class="tag">${l.articles.length} 篇文章</span><span class="tag">${words} 單字</span>
        ${l.grammar ? `<span class="tag">${l.grammar} 文法</span>` : ''}<span class="spacer"></span>
        <a class="btn small" href="#/cards/lesson/${encodeURIComponent(l.id)}">複習這期單字</a></div>
      <ul class="headlines">${l.articles.map((a) => `<li><span class="tag">${esc(a.category.split(/\s+(?=[一-鿿])/)[0] || '文章')}</span>
        <a href="#/read/${encodeURIComponent(l.id)}/${a.n}">${esc(a.title)}</a></li>`).join('')}</ul></div>`;
  }

  // ---------- flashcards
  function deckCards(deck, lessonId) {
    let pool = CARDS;
    switch (deck) {
      case 'due': {
        const dueCards = shuffle(pool.filter((c) => isDue(c.id))).sort((a, b) => st(a.id).due - st(b.id).due);
        const n = Math.max(0, prefs.newPerDay - newIntroducedToday());
        const fresh = pool.filter((c) => c.type === 'word' && !st(c.id)).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, n);
        return [...dueCards, ...fresh];
      }
      case 'all': return shuffle(pool.filter((c) => c.type === 'word'));
      case 'star': return shuffle(pool.filter((c) => c.type === 'word' && c.v.star));
      case 'hard': return shuffle(pool.filter((c) => c.type !== 'grammar' && st(c.id) && (st(c.id).box <= 1 || st(c.id).wrong > st(c.id).right)));
      case 'phrase': return shuffle(pool.filter((c) => c.type === 'word' && c.phrase));
      case 'colloc': return shuffle(pool.filter((c) => c.type === 'colloc'));
      case 'grammar': return shuffle(pool.filter((c) => c.type === 'grammar'));
      case 'lesson': return shuffle(pool.filter((c) => c.type === 'word' && c.v.uses.some((u) => u.lesson === lessonId)));
      default: return [];
    }
  }
  const DECKS = [['due', '今日複習'], ['all', '全部單字'], ['star', '★ 高頻'], ['hard', '常錯的'], ['phrase', '片語'], ['colloc', '搭配詞填空'], ['grammar', '文法']];

  VIEWS.cards = (main, deckArg, lessonArg) => {
    if (!CARDS.length) { main.innerHTML = `<div class="page-head"><h1>單字卡</h1></div>${noData()}`; return; }
    const deck = deckArg || prefs.deck;
    if (deckArg && deckArg !== 'lesson') { prefs.deck = deckArg; savePrefs(); }
    let queue = deckCards(deck, lessonArg);
    const total = queue.length;
    let done = 0, flipped = false, cur = null;
    const lesson = deck === 'lesson' && D.index.lessons.find((l) => l.id === lessonArg);

    main.innerHTML = `
      <div class="page-head"><h1>單字卡</h1>
        <div class="seg" id="dir">${[['en2zh', '英→中'], ['zh2en', '中→英'], ['mix', '混合']].map(([k, l]) => `<button data-k="${k}" class="${prefs.dir === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="chips" id="decks">${DECKS.map(([k, l]) => `<a class="chip ${deck === k ? 'on' : ''}" href="#/cards/${k}">${l}</a>`).join('')}
        ${lesson ? `<span class="chip on">${fmtDate(lesson.date)} 這期</span>` : ''}</div>
      <div class="study-top"><div class="progress"><div id="bar" style="width:0"></div></div><span class="muted small" id="count"></span></div>
      <div id="stage"></div>`;
    $$('#dir button', main).forEach((b) => b.addEventListener('click', () => {
      prefs.dir = b.dataset.k; savePrefs(); $$('#dir button', main).forEach((x) => x.classList.toggle('on', x === b)); show();
    }));

    function frontBack(c) {
      const dir = prefs.dir === 'mix' ? (c._dir ||= Math.random() < 0.5 ? 'en2zh' : 'zh2en') : prefs.dir;
      const corner = (extra = '') => `<div class="corner">${c.type === 'word' && c.v.star ? '<span class="tag star">★ TOEIC</span>' : ''}
        <span class="tag ${status(c.id)}">${{ new: '新字', learning: '學習中', known: '已熟記' }[status(c.id)]}</span>${extra}<span class="spacer"></span>
        ${c.type !== 'grammar' ? `<button class="btn icon ghost" data-say="${esc(c.v.word)}" aria-label="朗讀">${icon('speak')}</button>` : ''}</div>`;
      if (c.type === 'grammar') {
        const g = c.g;
        return [
          `${corner('<span class="tag">文法</span>')}<div class="big-zh">${esc(g.title)}</div><div class="hint">回想這個文法的用法與例句，再點一下翻面</div>`,
          `${corner('<span class="tag">文法</span>')}<div class="back-head"><span class="w" style="font-family:var(--font);font-size:1.3rem">${esc(g.title)}</span></div>
           <div class="grammar-body" style="margin-top:10px">${grammarBody(g)}</div>`,
        ];
      }
      const v = c.v, u = c.use;
      const uses = v.uses.slice().reverse();
      const backBody = `
        <div class="back-head"><span class="w">${esc(v.word)}</span><span class="pos">${esc(v.pos)}</span><span class="ipa">${esc(v.ipa)}</span></div>
        <div class="back-zh">${esc(v.zh)}</div>
        <dl class="kv">
          ${u.colloc ? `<dt>搭配詞 Collocation</dt><dd>${highlight(u.colloc, v.word)}</dd>` : ''}
          ${uses.filter((x) => x.example).slice(0, 2).map((x, i) => `<dt>${i ? '另一個例句' : '例句 Example'}</dt><dd class="example">${highlight(x.example, v.word)}
            <button class="btn icon ghost small" style="width:30px;min-height:30px;vertical-align:middle" data-say="${esc(x.example)}" aria-label="朗讀例句">${icon('speak')}</button></dd>`).join('')}
          <dt>出處</dt><dd class="small">${uses.slice(0, 3).map((x) => `<a href="#/read/${encodeURIComponent(x.lesson)}/${x.article}">${fmtDate(x.date)} · ${esc(x.category.split(/\s+(?=[一-鿿])/)[0] || '文章')}</a>`).join('、')}</dd>
        </dl>`;
      if (c.type === 'colloc') {
        return [
          `${corner('<span class="tag">搭配詞</span>')}<div class="big-word" style="font-size:clamp(1.5rem,5vw,2.2rem)">${esc(c.blanked)}</div>
           <div class="ipa" style="margin-top:12px">提示：${esc(v.zh)}</div><div class="hint">說出空格的字，點一下翻面</div>`,
          `${corner('<span class="tag">搭配詞</span>')}<div class="back-head"><span class="w">${highlight(c.colloc, v.word)}</span></div>${backBody}`,
        ];
      }
      const front = dir === 'en2zh'
        ? `<div class="big-word">${esc(v.word)}</div><div class="ipa">${esc(v.ipa)} <span class="pos">${esc(v.pos)}</span></div><div class="hint">想想中文意思，點一下翻面</div>`
        : `<div class="big-zh">${esc(v.zh)}</div><div class="ipa"><span class="pos">${esc(v.pos)}</span></div>
           ${u.colloc ? `<div class="hint" style="margin-top:14px">${esc(blankCollocation(u.colloc, v.word) || '')}</div>` : ''}<div class="hint">拼出英文單字，點一下翻面</div>`;
      return [corner() + front, corner() + backBody];
    }

    function show() {
      const stage = $('#stage', main);
      $('#bar', main).style.width = total ? `${(done / total) * 100}%` : '0';
      $('#count', main).textContent = total ? `${done} / ${total}` : '';
      if (!queue.length) {
        flipped = false; cur = null;
        stage.innerHTML = total
          ? `<div class="card done"><div class="big">🎉</div><h2>這一輪完成了！</h2><p class="muted">共複習 ${done} 張。明天會依記憶程度再排給你。</p>
             <div class="row" style="justify-content:center"><a class="btn primary" href="#/quiz">做個小測驗</a><a class="btn" href="#/home">回首頁</a></div></div>`
          : `<div class="card empty"><div class="big">✅</div><p>${deck === 'due' ? '今天的複習都完成了！' : '這個牌組目前沒有卡片。'}</p>
             <div class="row" style="justify-content:center"><a class="btn" href="#/cards/all">複習全部單字</a><a class="btn" href="#/cards/star">★ 高頻字</a></div></div>`;
        return;
      }
      cur = queue[0]; flipped = false;
      const [front, back] = frontBack(cur);
      stage.innerHTML = `
        <div class="flash-stage"><div class="flash" id="flash" tabindex="0" role="button" aria-label="翻面">
          <div class="face front">${front}</div><div class="face back">${back}</div></div></div>
        <div class="grade hidden" id="grade">
          <button class="g1" data-g="1"><b>忘記了</b><span>馬上再看</span></button>
          <button class="g2" data-g="2"><b>有點模糊</b><span>${nextLabel(cur.id, 2)}</span></button>
          <button class="g3" data-g="3"><b>記得</b><span>${nextLabel(cur.id, 3)}</span></button>
          <button class="g4" data-g="4"><b>太簡單</b><span>${nextLabel(cur.id, 4)}</span></button>
        </div>
        <div class="row hidden" id="flipHint" style="justify-content:center;margin-top:14px"><button class="btn primary big" id="flipBtn">翻面看答案</button></div>
        <div class="kbd">空白鍵：翻面　1–4：評分　S：朗讀</div>`;
      $('#flipHint', main).classList.remove('hidden');
      const flash = $('#flash', main);
      flash.addEventListener('click', (e) => { if (!e.target.closest('[data-say], a')) flip(); });
      $('#flipBtn', main).addEventListener('click', flip);
      $$('#grade button', main).forEach((b) => b.addEventListener('click', () => answer(+b.dataset.g)));
      // auto-adjust card height to content
      requestAnimationFrame(() => {
        const h = Math.max(...$$('.face', flash).map((f) => f.scrollHeight));
        flash.style.minHeight = Math.max(window.innerWidth < 720 ? 380 : 340, h) + 'px';
      });
    }
    function nextLabel(id, g) {
      const s = st(id) || { box: 0 };
      let box = s.box;
      if (g === 2) box = Math.max(1, box); if (g === 3) box = Math.min(8, box + 1); if (g === 4) box = Math.min(8, box + 2);
      const d = g === 2 ? Math.max(1, Math.round(INTERVALS[box] / 2)) : INTERVALS[box];
      return d >= 30 ? `${Math.round(d / 30)} 個月後` : `${d} 天後`;
    }
    function flip() {
      if (!cur) return;
      flipped = !flipped;
      $('#flash', main).classList.toggle('flipped', flipped);
      if (flipped) { $('#grade', main).classList.remove('hidden'); $('#flipHint', main).classList.add('hidden'); }
    }
    function answer(g) {
      if (!cur || !flipped) return;
      grade(cur.id, g);
      const c = queue.shift();
      if (g === 1) { queue.splice(Math.min(queue.length, 3), 0, c); } else done++;
      show();
    }
    function onClick(e) { const s = e.target.closest('[data-say]'); if (s) { e.stopPropagation(); speak(s.dataset.say); } }
    function onKey(e) {
      if (e.target.matches('input, textarea, select')) return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
      else if (/^[1-4]$/.test(e.key)) answer(+e.key);
      else if (e.key.toLowerCase() === 's' && cur && cur.v) speak(cur.v.word);
    }
    main.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey);
    show();
    return () => document.removeEventListener('keydown', onKey);
  };

  // ---------- quiz
  VIEWS.quiz = (main) => {
    const words = CARDS.filter((c) => c.type === 'word');
    if (words.length < 4) { main.innerHTML = `<div class="page-head"><h1>測驗</h1></div>${noData()}`; return; }
    let mode = 'en2zh', N = 10, qs = [], i = 0, score = 0, wrong = [];
    const setup = () => {
      main.innerHTML = `
        <div class="page-head"><h1>小測驗</h1></div>
        <div class="card">
          <h3>題型</h3>
          <div class="chips" id="mode" style="margin-bottom:14px">${[['en2zh', '看英文選中文'], ['zh2en', '看中文選英文'], ['colloc', '例句填空']].map(([k, l]) => `<button class="chip ${mode === k ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div>
          <h3>範圍</h3>
          <div class="chips" id="scope" style="margin-bottom:14px">
            <button class="chip on" data-k="weak">優先考不熟的</button><button class="chip" data-k="latest">最新一期</button><button class="chip" data-k="all">全部隨機</button><button class="chip" data-k="star">★ 高頻</button></div>
          <h3>題數</h3>
          <div class="chips" id="num" style="margin-bottom:18px">${[10, 20, 30].map((n) => `<button class="chip ${n === N ? 'on' : ''}" data-k="${n}">${n} 題</button>`).join('')}</div>
          <button class="btn primary big" id="go">開始</button>
          <p class="muted small" style="margin:12px 0 0">答對的字會延後複習，答錯的會排進下次的單字卡。</p>
        </div>`;
      let scope = 'weak';
      const pick = (id, fn) => $$(`#${id} .chip`, main).forEach((b) => b.addEventListener('click', () => { $$(`#${id} .chip`, main).forEach((x) => x.classList.toggle('on', x === b)); fn(b.dataset.k); }));
      pick('mode', (k) => { mode = k; }); pick('scope', (k) => { scope = k; }); pick('num', (k) => { N = +k; });
      $('#go', main).addEventListener('click', () => {
        let pool = words;
        if (mode === 'colloc') pool = pool.filter((c) => c.v.uses.some((u) => u.example && wordRegex(c.v.word)?.test(u.example)));
        if (scope === 'latest') pool = pool.filter((c) => c.v.uses.some((u) => u.lesson === D.index.lessons[0].id));
        if (scope === 'star') pool = pool.filter((c) => c.v.star);
        if (scope === 'weak') {
          const w = (c) => { const s = st(c.id); return s ? s.box - (s.wrong - s.right) * 0.5 + Math.random() : 1.5 + Math.random(); };
          pool = pool.slice().sort((a, b) => w(a) - w(b));
        } else pool = shuffle(pool);
        if (pool.length < 1) { toast('這個範圍沒有題目'); return; }
        qs = pool.slice(0, N).map((c) => makeQ(c));
        i = 0; score = 0; wrong = [];
        ask();
      });
    };
    const makeQ = (c) => {
      const others = shuffle(words.filter((x) => x !== c && x.v.zh !== c.v.zh));
      // prefer distractors with the same part of speech
      const samePos = others.filter((x) => x.v.pos === c.v.pos);
      const ds = [...samePos, ...others].filter((x, k, a) => a.indexOf(x) === k).slice(0, 3);
      const opts = shuffle([c, ...ds]);
      let prompt, sub = '';
      if (mode === 'en2zh') { prompt = `<div class="big-word">${esc(c.v.word)}</div>`; sub = `<div class="ipa">${esc(c.v.ipa)} <span class="pos">${esc(c.v.pos)}</span></div>`; }
      else if (mode === 'zh2en') { prompt = `<div class="big-zh">${esc(c.v.zh)}</div>`; sub = `<div class="ipa"><span class="pos">${esc(c.v.pos)}</span></div>`; }
      else {
        const u = c.v.uses.find((x) => x.example && wordRegex(c.v.word)?.test(x.example));
        const rx = new RegExp(wordRegex(c.v.word).source, 'gi');
        prompt = `<div class="example" style="font-size:1.25rem">${esc(u.example).replace(rx, '<b>＿＿＿＿</b>')}</div>`;
        sub = `<div class="ipa" style="margin-top:10px">${esc(c.v.zh)}</div>`;
      }
      return { c, opts, prompt, sub, label: (x) => (mode === 'en2zh' ? esc(x.v.zh) : `<span style="font-family:var(--serif)">${esc(x.v.word)}</span>`) };
    };
    const ask = () => {
      if (i >= qs.length) return finish();
      const q = qs[i];
      main.innerHTML = `
        <div class="page-head"><h1>小測驗</h1><span class="muted">${i + 1} / ${qs.length}・答對 ${score}</span></div>
        <div class="study-top"><div class="progress"><div style="width:${(i / qs.length) * 100}%"></div></div></div>
        <div class="card quiz-q">${q.prompt}${q.sub}</div>
        <div class="options">${q.opts.map((o, k) => `<button class="opt" data-k="${k}">${k + 1}. ${q.label(o)}</button>`).join('')}</div>
        <div class="row hidden" id="after" style="margin-top:14px"><span id="fb"></span><span class="spacer"></span>
          <button class="btn icon" id="say" aria-label="朗讀">${icon('speak')}</button><button class="btn primary" id="nextQ">下一題 →</button></div>`;
      let answered = false;
      const choose = (k) => {
        if (answered) return; answered = true;
        const right = q.opts[k] === q.c;
        $$('.opt', main).forEach((b, j) => { if (q.opts[j] === q.c) b.classList.add('right'); else if (j === k) b.classList.add('wrong'); b.disabled = true; });
        if (right) score++; else wrong.push(q.c);
        grade(q.c.id, right ? 3 : 1);
        $('#fb', main).innerHTML = right ? '<b style="color:var(--good)">答對了！</b>' : `<b style="color:var(--bad)">答案：</b>${esc(q.c.v.word)}・${esc(q.c.v.zh)}`;
        $('#after', main).classList.remove('hidden');
        speak(q.c.v.word);
        $('#nextQ', main).focus();
      };
      $$('.opt', main).forEach((b) => b.addEventListener('click', () => choose(+b.dataset.k)));
      $('#nextQ', main).addEventListener('click', () => { i++; ask(); });
      $('#say', main).addEventListener('click', () => speak(q.c.v.word));
      keyHandler = (e) => {
        if (/^[1-4]$/.test(e.key) && !answered) choose(+e.key - 1);
        else if ((e.key === 'Enter' || e.key === ' ') && answered) { e.preventDefault(); i++; ask(); }
      };
    };
    const finish = () => {
      keyHandler = null;
      const pct = Math.round((score / qs.length) * 100);
      main.innerHTML = `
        <div class="page-head"><h1>測驗結果</h1></div>
        <div class="card done"><div class="big">${pct >= 90 ? '🏆' : pct >= 70 ? '👍' : '💪'}</div><h2>${score} / ${qs.length}（${pct}%）</h2>
          <div class="row" style="justify-content:center"><button class="btn primary" id="again">再考一次</button><a class="btn" href="#/cards">去複習單字卡</a></div></div>
        ${wrong.length ? `<div class="card"><h3>答錯的字</h3><div class="list">${wrong.map((c) => wordRow(c)).join('')}</div></div>` : ''}`;
      $('#again', main).addEventListener('click', setup);
    };
    let keyHandler = null;
    const onKey = (e) => { if (keyHandler && !e.target.matches('input, textarea')) keyHandler(e); };
    document.addEventListener('keydown', onKey);
    main.addEventListener('click', (e) => { const s = e.target.closest('[data-say]'); if (s) speak(s.dataset.say); });
    setup();
    return () => document.removeEventListener('keydown', onKey);
  };

  // ---------- word list
  function wordRow(c) {
    const v = c.v, s = status(c.id);
    const due = isDue(c.id);
    return `<div class="item"><div class="main">
        <div class="row" style="gap:6px"><span class="w">${esc(v.word)}</span><span class="pos small">${esc(v.pos)}</span>
          ${v.star ? '<span class="tag star">★</span>' : ''}<span class="tag ${due ? 'due' : s}">${due ? '待複習' : { new: '新字', learning: '學習中', known: '已熟記' }[s]}</span></div>
        <div>${esc(v.zh)} <span class="muted small">${esc(v.ipa)}</span></div>
        <details><summary>例句與出處（${v.uses.length}）</summary>${v.uses.slice().reverse().map((u) => `
          <div style="margin:8px 0">${u.colloc ? `<div class="small muted">${esc(u.colloc)}</div>` : ''}<div class="example">${highlight(u.example, v.word)}</div>
          <div class="small"><a href="#/read/${encodeURIComponent(u.lesson)}/${u.article}">${fmtDate(u.date)} · ${esc(u.category)}</a></div></div>`).join('')}</details>
      </div><button class="btn icon ghost" data-say="${esc(v.word)}" aria-label="朗讀 ${esc(v.word)}">${icon('speak')}</button></div>`;
  }
  VIEWS.words = (main) => {
    const words = CARDS.filter((c) => c.type === 'word');
    if (!words.length) { main.innerHTML = `<div class="page-head"><h1>單字表</h1></div>${noData()}`; return; }
    let filter = 'all', q = '';
    main.innerHTML = `
      <div class="page-head"><h1>單字表</h1><span class="muted">${words.length} 個單字</span></div>
      <input type="search" id="q" placeholder="搜尋英文或中文…" aria-label="搜尋">
      <div class="chips" id="f" style="margin:12px 0">${[['all', '全部'], ['due', '待複習'], ['new', '新字'], ['learning', '學習中'], ['known', '已熟記'], ['star', '★ 高頻']].map(([k, l]) => `<button class="chip ${k === filter ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div>
      <div class="card" style="padding:4px 14px"><div class="list" id="list"></div></div>`;
    const draw = () => {
      const qq = q.trim().toLowerCase();
      const rows = words.filter((c) => {
        if (filter === 'star' && !c.v.star) return false;
        if (filter === 'due' && !isDue(c.id)) return false;
        if (['new', 'learning', 'known'].includes(filter) && status(c.id) !== filter) return false;
        return !qq || c.v.word.toLowerCase().includes(qq) || c.v.zh.includes(qq);
      });
      $('#list', main).innerHTML = rows.length ? rows.slice(0, 400).map(wordRow).join('') : '<div class="empty">沒有符合的單字</div>';
    };
    $('#q', main).addEventListener('input', (e) => { q = e.target.value; draw(); });
    $$('#f .chip', main).forEach((b) => b.addEventListener('click', () => { filter = b.dataset.k; $$('#f .chip', main).forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
    main.addEventListener('click', (e) => { const s = e.target.closest('[data-say]'); if (s) speak(s.dataset.say); });
    draw();
  };

  // ---------- reading
  VIEWS.read = async (main, lessonId, artN) => {
    if (!D.index || !D.index.lessons.length) { main.innerHTML = `<div class="page-head"><h1>文章</h1></div>${noData()}`; return; }
    if (!lessonId) {
      main.innerHTML = `<div class="page-head"><h1>閱讀文章</h1><span class="muted">${D.index.counts.articles} 篇</span></div>` +
        D.index.lessons.map(lessonCard).join('');
      return;
    }
    const lesson = await getLesson(lessonId);
    if (!artN) {
      main.innerHTML = `
        <div class="page-head"><div><a href="#/read" class="small">← 全部文章</a><h1>${fmtDate(lesson.date)} ${weekday(lesson.date)}</h1><div class="muted">${esc(lesson.title)}</div></div></div>
        ${lesson.articles.map((a) => `<a class="lesson-link" href="#/read/${encodeURIComponent(lesson.id)}/${a.n}"><div class="card">
          <div class="muted small">Article ${a.n} · ${esc(a.category)}</div><h2 style="margin:4px 0;font-family:var(--serif)">${esc(a.title)}</h2>
          <div class="muted small">${a.body.length} 段 · ${a.vocab.length} 個重點字</div></div></a>`).join('')}
        ${lesson.grammar.length ? `<h2 style="margin-top:24px">本期文法</h2>${lesson.grammar.map((g) => `<div class="card"><h3>${esc(g.title)}</h3><div class="grammar-body">${grammarBody(g)}</div></div>`).join('')}` : ''}
        <div class="row" style="margin-top:16px"><a class="btn primary" href="#/cards/lesson/${encodeURIComponent(lesson.id)}">${icon('cards')} 複習這期單字</a></div>`;
      return;
    }
    const idx = lesson.articles.findIndex((a) => String(a.n) === String(artN));
    const a = lesson.articles[idx];
    if (!a) { main.innerHTML = '<div class="empty">找不到這篇文章</div>'; return; }
    // Highlight this article's words, longest first so phrases win over single words.
    const vocab = a.vocab.slice().sort((x, y) => y.word.length - x.word.length);
    const marked = (p) => {
      // find every match in the plain text, keep non-overlapping ones (longer words first), then build HTML once
      const hits = [];
      vocab.forEach((v, vi) => {
        const rx = wordRegex(v.word); if (!rx) return;
        for (const m of p.matchAll(new RegExp(rx.source, 'gi'))) {
          const s0 = m.index, e0 = s0 + m[0].length;
          if (!hits.some((h) => s0 < h.e && e0 > h.s)) hits.push({ s: s0, e: e0, vi });
        }
      });
      hits.sort((x, y) => x.s - y.s);
      let out = '', pos = 0;
      for (const h of hits) {
        out += esc(p.slice(pos, h.s)) + `<span class="vw" data-vi="${h.vi}" tabindex="0">${esc(p.slice(h.s, h.e))}</span>`;
        pos = h.e;
      }
      return out + esc(p.slice(pos));
    };
    const prev = lesson.articles[idx - 1], next = lesson.articles[idx + 1];
    main.innerHTML = `
      <article class="article">
        <div style="margin-top:18px"><a href="#/read/${encodeURIComponent(lesson.id)}" class="small">← ${fmtDate(lesson.date)} 全部文章</a></div>
        <div class="muted small" style="margin-top:14px">Article ${a.n} · ${esc(a.category)}</div>
        <h1>${esc(a.title)}</h1>
        <div class="meta row">${a.source ? `<span>來源：${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.source)}</a>` : esc(a.source)}</span>` : ''}<span class="spacer"></span>
          <button class="btn small" id="readAll">${icon('speak')} 朗讀全文</button></div>
        ${a.body.map((p) => `<p class="para">${marked(p)}</p>`).join('')}
        ${a.summary ? `<div class="row"><button class="btn small" id="sumBtn">${prefs.showSummary ? '隱藏' : '顯示'}中文摘要</button><span class="muted small">建議先讀完全文再看摘要</span></div>
          <div class="summary-box ${prefs.showSummary ? '' : 'hidden'}" id="sum"><b>中文摘要</b><br>${esc(a.summary)}</div>` : ''}
        <h2 style="margin-top:28px">重點單字（${a.vocab.length}）</h2>
        <div class="card" style="padding:4px 14px"><div class="list">${a.vocab.map((v) => CARD_BY_ID.get('w:' + v.key)).filter(Boolean).map(wordRow).join('')}</div></div>
        <div class="row" style="margin-top:12px"><a class="btn primary" href="#/cards/lesson/${encodeURIComponent(lesson.id)}">${icon('cards')} 複習這期單字</a></div>
        <div class="article-nav">
          ${prev ? `<a class="btn" href="#/read/${encodeURIComponent(lesson.id)}/${prev.n}">${icon('back')} 上一篇</a>` : '<span></span>'}
          ${next ? `<a class="btn" href="#/read/${encodeURIComponent(lesson.id)}/${next.n}">下一篇 ${icon('next')}</a>` : ''}
        </div>
      </article>`;
    let pop = null;
    const closePop = () => { if (pop) { pop.remove(); pop = null; } };
    const openPop = (el) => {
      closePop();
      const v = vocab[+el.dataset.vi];
      pop = document.createElement('div');
      pop.className = 'pop';
      pop.innerHTML = `<div class="row" style="gap:6px"><span class="w">${esc(v.word)}</span><span class="pos small">${esc(v.pos)}</span>${v.star ? '<span class="tag star">★</span>' : ''}
        <span class="spacer"></span><button class="btn icon ghost small" style="width:32px;min-height:32px" data-say="${esc(v.word)}" aria-label="朗讀">${icon('speak')}</button></div>
        <div class="muted small">${esc(v.ipa)}</div><div style="margin-top:4px"><b>${esc(v.zh)}</b></div>${v.colloc ? `<div class="small muted" style="margin-top:4px">${esc(v.colloc)}</div>` : ''}`;
      document.body.appendChild(pop);
      const r = el.getBoundingClientRect();
      const w = Math.min(300, window.innerWidth - 32);
      pop.style.width = w + 'px';
      pop.style.left = Math.max(16, Math.min(window.scrollX + r.left, window.scrollX + window.innerWidth - w - 16)) + 'px';
      pop.style.top = window.scrollY + r.bottom + 8 + 'px';
    };
    const onDoc = (e) => {
      const say = e.target.closest('[data-say]');
      if (say) { speak(say.dataset.say); return; }
      const vw = e.target.closest('.vw');
      if (vw) { openPop(vw); return; }
      if (!e.target.closest('.pop')) closePop();
    };
    const onKey = (e) => { if (e.key === 'Enter' && e.target.classList?.contains('vw')) openPop(e.target); if (e.key === 'Escape') closePop(); };
    document.addEventListener('click', onDoc);
    document.addEventListener('keydown', onKey);
    $('#readAll', main).addEventListener('click', () => speak(a.body.join(' ')));
    const sumBtn = $('#sumBtn', main);
    if (sumBtn) sumBtn.addEventListener('click', () => {
      prefs.showSummary = !prefs.showSummary; savePrefs();
      $('#sum', main).classList.toggle('hidden', !prefs.showSummary);
      sumBtn.textContent = (prefs.showSummary ? '隱藏' : '顯示') + '中文摘要';
    });
    return () => { closePop(); document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey); if ('speechSynthesis' in window) speechSynthesis.cancel(); };
  };
  VIEWS.lesson = VIEWS.read;

  // ---------- grammar & phrases
  function grammarBody(g) {
    return g.body.map((b) => b.p ? `<p>${esc(b.p).replace(/\n/g, '<br>')}</p>`
      : `<div class="tbl-wrap"><table>${b.table.map((r) => `<tr>${r.map((c) => `<td>${esc(c).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`).join('')}</table></div>`).join('');
  }
  VIEWS.grammar = (main) => {
    const phrases = CARDS.filter((c) => c.type === 'word' && c.phrase);
    const collocs = CARDS.filter((c) => c.type === 'colloc');
    let tab = D.grammar.length ? 'grammar' : 'phrase';
    main.innerHTML = `
      <div class="page-head"><h1>文法・片語</h1></div>
      <div class="seg" id="tabs" style="margin-bottom:14px">
        <button data-k="grammar">文法（${D.grammar.length}）</button><button data-k="phrase">片語（${phrases.length}）</button><button data-k="colloc">搭配詞（${collocs.length}）</button></div>
      <div id="pane"></div>`;
    const draw = () => {
      $$('#tabs button', main).forEach((b) => b.classList.toggle('on', b.dataset.k === tab));
      const pane = $('#pane', main);
      if (tab === 'grammar') {
        pane.innerHTML = D.grammar.length
          ? `<div class="row" style="margin-bottom:12px"><a class="btn primary" href="#/cards/grammar">${icon('cards')} 用卡片複習文法</a></div>` +
            D.grammar.slice().reverse().sort((a, b) => (a.date < b.date ? 1 : -1)).map((g) => `<div class="card"><div class="row"><h3 style="margin:0">${esc(g.title)}</h3><span class="spacer"></span>
              <a class="small" href="#/read/${encodeURIComponent(g.lesson)}">${fmtDate(g.date)}</a></div><div class="grammar-body" style="margin-top:8px">${grammarBody(g)}</div></div>`).join('')
          : `<div class="card empty"><div class="big">📘</div><p>目前的檔案裡還沒有文法段落。</p>
             <p class="small">在雲端硬碟的 Word 檔中加一個標題，名稱包含「Grammar」或「文法」（例如「Grammar Focus 文法重點」），<br>下面的每個小標題就會變成一張文法卡，下次同步後自動出現在這裡。</p>
             <p class="small">現在可以先練習「片語」與「搭配詞」→</p></div>`;
      } else if (tab === 'phrase') {
        pane.innerHTML = `<div class="row" style="margin-bottom:12px"><a class="btn primary" href="#/cards/phrase">${icon('cards')} 片語卡片</a></div>
          <div class="card" style="padding:4px 14px"><div class="list">${phrases.map(wordRow).join('') || '<div class="empty">沒有片語</div>'}</div></div>`;
      } else {
        pane.innerHTML = `<div class="row" style="margin-bottom:12px"><a class="btn primary" href="#/cards/colloc">${icon('cards')} 搭配詞填空卡</a></div>
          <div class="card" style="padding:4px 14px"><div class="list">${collocs.map((c) => `<div class="item"><div class="main">
            <div class="example" style="font-size:1.1rem">${highlight(c.colloc, c.v.word)}</div>
            <div class="small muted">${esc(c.v.word)} ${esc(c.v.pos)} · ${esc(c.v.zh)}</div></div>
            <button class="btn icon ghost" data-say="${esc(c.colloc)}" aria-label="朗讀">${icon('speak')}</button></div>`).join('')}</div></div>`;
      }
    };
    $$('#tabs button', main).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.k; draw(); }));
    main.addEventListener('click', (e) => { const s = e.target.closest('[data-say]'); if (s) speak(s.dataset.say); });
    draw();
  };

  // ---------- settings
  VIEWS.settings = async (main) => {
    const acc = await getAccount();
    main.innerHTML = `
      <div class="page-head"><h1>設定</h1></div>
      <div class="grid grid-2">
        <form class="card" id="pw">
          <h2>更改密碼</h2>
          ${acc.isDefault ? '<p class="small" style="color:var(--warn)">你還在使用預設密碼 0000，建議改掉。</p>' : ''}
          <div class="field"><label for="acc">帳號</label><input id="acc" type="text" value="${esc(acc.user)}" autocomplete="username" autocapitalize="off" required></div>
          <div class="field"><label for="old">目前密碼</label><input id="old" type="password" autocomplete="current-password" required></div>
          <div class="field"><label for="n1">新密碼</label><input id="n1" type="password" autocomplete="new-password" required></div>
          <div class="field"><label for="n2">再輸入一次新密碼</label><input id="n2" type="password" autocomplete="new-password" required></div>
          <div class="err" id="pwErr"></div>
          <button class="btn primary" type="submit">儲存</button>
        </form>
        <div class="card">
          <h2>學習設定</h2>
          <div class="field"><label for="npd">每天新字數量</label>
            <select id="npd">${[10, 20, 30, 50, 100].map((n) => `<option ${n === prefs.newPerDay ? 'selected' : ''} value="${n}">${n} 個</option>`).join('')}</select></div>
          <div class="field"><label for="rate">朗讀速度</label>
            <select id="rate">${[[0.7, '慢'], [0.9, '稍慢'], [1, '正常'], [1.15, '快']].map(([v, l]) => `<option ${v === prefs.rate ? 'selected' : ''} value="${v}">${l}</option>`).join('')}</select></div>
          <div class="field"><label for="theme">外觀</label>
            <select id="theme">${[['auto', '跟隨系統'], ['light', '淺色'], ['dark', '深色']].map(([v, l]) => `<option ${v === prefs.theme ? 'selected' : ''} value="${v}">${l}</option>`).join('')}</select></div>
        </div>
        <div class="card">
          <h2>學習紀錄</h2>
          <p class="small muted">紀錄存在這台裝置的瀏覽器裡。換手機或電腦時，先「匯出」再到新裝置「匯入」。</p>
          <div class="row"><button class="btn" id="exp">匯出紀錄</button><label class="btn" for="impFile">匯入紀錄</label>
            <input type="file" id="impFile" accept="application/json,.json" class="hidden"></div>
          <div class="row" style="margin-top:10px"><button class="btn ghost small" id="reset" style="color:var(--bad)">清除所有學習紀錄</button></div>
        </div>
        <div class="card">
          <h2>資料來源</h2>
          <p class="small">新增到 Google 雲端硬碟資料夾的 Word 檔（.docx）或 Google 文件，每小時會自動轉成這裡的單字卡、文章和文法。</p>
          <p class="small muted">最後同步：${D.index ? new Date(D.index.updated).toLocaleString('zh-TW') : '—'}<br>
            ${D.index ? `${D.index.counts.lessons} 期 · ${D.index.counts.articles} 篇文章 · ${D.index.counts.words} 個單字 · ${D.index.counts.grammar} 則文法` : ''}</p>
          <div class="row">${D.index && D.index.folder ? `<a class="btn small" href="${esc(D.index.folder)}" target="_blank" rel="noopener">開啟資料夾</a>` : ''}
            <button class="btn small" id="reload">重新載入資料</button></div>
        </div>
      </div>
      <div class="row" style="margin-top:16px"><button class="btn" id="logout">登出</button></div>
      <p class="footer-note">帳號密碼只保存在這台裝置的瀏覽器中，用來防止別人隨手打開；它不是伺服器端的加密保護。</p>`;

    $('#pw', main).addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#pwErr', main); err.textContent = '';
      const user = $('#acc', main).value.trim();
      const old = $('#old', main).value, n1 = $('#n1', main).value, n2 = $('#n2', main).value;
      if (!(await hash(acc.user, old, acc.salt) === acc.hash)) { err.textContent = '目前密碼不正確'; return; }
      if (!user) { err.textContent = '帳號不能空白'; return; }
      if (n1.length < 4) { err.textContent = '新密碼至少 4 個字元'; return; }
      if (n1 !== n2) { err.textContent = '兩次輸入的新密碼不一樣'; return; }
      const salt = newSalt();
      store.set(K.account, { user, salt, hash: await hash(user, n1, salt), isDefault: false });
      $$('#pw input[type=password]', main).forEach((i) => { i.value = ''; });
      toast('已更新帳號密碼');
      VIEWS.settings(main);
    });
    $('#npd', main).addEventListener('change', (e) => { prefs.newPerDay = +e.target.value; savePrefs(); toast('已儲存'); });
    $('#rate', main).addEventListener('change', (e) => { prefs.rate = +e.target.value; savePrefs(); speak('This is the reading speed.'); });
    $('#theme', main).addEventListener('change', (e) => { prefs.theme = e.target.value; savePrefs(); applyTheme(); });
    $('#exp', main).addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ app: 'toeic-word-cards', v: 1, srs: SRS, days: store.get(K.days, {}), prefs }, null, 1)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `word-cards-progress-${todayStr()}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    $('#impFile', main).addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (data.app !== 'toeic-word-cards' || !data.srs) throw new Error('format');
        for (const [k, v] of Object.entries(data.srs)) if (!SRS[k] || (v.last || 0) > (SRS[k].last || 0)) SRS[k] = v;
        saveSRS();
        const days = store.get(K.days, {});
        for (const [k, v] of Object.entries(data.days || {})) days[k] = Math.max(days[k] || 0, v);
        store.set(K.days, days);
        toast('已匯入學習紀錄');
      } catch { toast('檔案格式不正確'); }
    });
    $('#reset', main).addEventListener('click', () => {
      if (!confirm('確定要清除所有學習紀錄？（帳號密碼不受影響）')) return;
      SRS = {}; saveSRS(); store.del(K.days); toast('已清除');
    });
    $('#reload', main).addEventListener('click', async () => { D.lessons = {}; await loadData(); toast('資料已更新'); VIEWS.settings(main); });
    $('#logout', main).addEventListener('click', logout);
  };

  // ------------------------------------------------------------------ boot
  render();
  // Check for new lessons every 10 minutes while the page is open, and when it comes back into view.
  const refresh = async () => {
    if (!isLoggedIn() || !D.loaded) return;
    if (await loadData()) { D.lessons = {}; toast('有新的內容，已自動更新'); if (['home', 'read', 'words'].includes(parseHash().name)) render(); }
  };
  setInterval(refresh, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    addEventListener('load', () => navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {}));
  }
})();
