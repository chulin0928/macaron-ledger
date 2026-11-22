// Macaron Ledger -- main app. Wires the store to the screens and handles routing.
import {
  CURRENCIES, FLAVORS, ICON_CHOICES, DEFAULT_CATEGORIES,
  otherIdFor, nextFlavor, iconEmoji,
} from './data.js';
import {
  loadExpenses, saveExpenses, loadSettings, saveSettings,
  loadCategories, saveCategories, clearAll,
} from './store.js';
import { formatMoney, parseAmount } from './money.js';
import {
  todayISO, monthKey, shiftMonth, monthLabel, monthShort, friendlyDate, addDays,
} from './dates.js';
import {
  categoriesOf, getCategory, makeCategoryId,
} from './categories.js';
import {
  ofKind, sumCents, expensesInMonth, monthlyBalance, categoryTotals,
  monthlySeries, monthlySeriesAll, yearsAvailable, applyFilters, groupByDate,
} from './analytics.js';
import { donutChart, lineChart, barChart } from './charts.js';
import {
  downloadBackup, pickBackup, pickCSVFile,
} from './backup.js';
import { importNotionCSV } from './csv.js';
import {
  el, clear, macaron, button, card, haptic, confirmDialog,
} from './ui.js';
import {
  gateEnabled, hasOverride, checkCode, isUnlocked, rememberUnlock, forgetUnlock,
  setPassword, disablePassword, resetToDefault,
} from './gate.js';

export const APP_VERSION = '2.0.0-web';

// ---------------------------------------------------------------- state store
const store = {
  expenses: [],
  categories: [],
  settings: { currency: 'TWD', hapticsEnabled: true },
  load() {
    this.expenses = loadExpenses();
    this.categories = loadCategories();
    this.settings = loadSettings();
  },
  addExpense(e) {
    const now = Date.now();
    const full = { ...e, id: makeId(), createdAt: now, updatedAt: now };
    this.expenses = [full, ...this.expenses];
    saveExpenses(this.expenses);
  },
  addMany(list) {
    const now = Date.now();
    const full = list.map((e, i) => ({ ...e, id: makeId() + i, createdAt: now, updatedAt: now }));
    this.expenses = [...full, ...this.expenses];
    saveExpenses(this.expenses);
  },
  updateExpense(id, patch) {
    this.expenses = this.expenses.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: Date.now() } : e));
    saveExpenses(this.expenses);
  },
  removeExpense(id) {
    this.expenses = this.expenses.filter((e) => e.id !== id);
    saveExpenses(this.expenses);
  },
  setSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
  },
  setCategories(list) {
    this.categories = list;
    saveCategories(list);
  },
  replaceAll(expenses, categories) {
    this.expenses = expenses;
    saveExpenses(expenses);
    if (categories && categories.length) {
      this.categories = categories;
      saveCategories(categories);
    }
  },
};

function makeId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------- UI state
const uiState = {
  tab: 'ledger',        // ledger | insights | settings
  kind: 'expense',      // expense | income (ledger + insights share this)
  month: monthKey(todayISO()),
  year: todayISO().slice(0, 4),
  query: '',
  filter: 'all',
};

let root;

export function mountApp(container) {
  root = container;
  store.load();
  render();
}

function rerender() { render(); }

function render() {
  clear(root);
  const screen = el('div.screen');
  if (uiState.tab === 'ledger') screen.append(renderLedger());
  else if (uiState.tab === 'insights') screen.append(renderInsights());
  else screen.append(renderSettings());
  root.append(screen);
  root.append(renderTabBar());
  if (uiState.tab === 'ledger') root.append(renderFab());
}

// ---------------------------------------------------------------- tab bar + fab
function renderTabBar() {
  const bar = el('nav.tabbar');
  const tabs = [
    ['ledger', '記帳', '🧾'],
    ['insights', '分析', '📊'],
    ['settings', '設定', '⚙️'],
  ];
  for (const [id, label, glyph] of tabs) {
    const active = uiState.tab === id;
    const b = el(`button.tab${active ? '.active' : ''}`, {
      type: 'button',
      onclick: () => { uiState.tab = id; rerender(); },
    }, [el('span.tab-glyph', { text: glyph }), el('span.tab-label', { text: label })]);
    bar.append(b);
  }
  return bar;
}

function renderFab() {
  const income = uiState.kind === 'income';
  return el('button.fab', {
    type: 'button',
    'aria-label': income ? '新增收入' : '新增支出',
    style: income ? { background: '#7FA86E' } : {},
    onclick: () => { haptic(store.settings); openExpenseForm(null, uiState.kind); },
  }, '＋');
}

// ---------------------------------------------------------------- segmented kind
function kindSegmented(onChange) {
  const seg = el('div.segmented');
  for (const [k, label] of [['expense', '支出'], ['income', '收入']]) {
    const active = uiState.kind === k;
    seg.append(el(`button.seg${active ? '.active' : ''}`, {
      type: 'button',
      onclick: () => { uiState.kind = k; uiState.filter = 'all'; onChange(); },
    }, label));
  }
  return seg;
}

// ---------------------------------------------------------------- ledger screen
function renderLedger() {
  const wrap = el('div.page');
  const { currency } = store.settings;
  const kindLabel = uiState.kind === 'income' ? '收入' : '支出';

  wrap.append(el('header.page-head', {}, [
    el('h1.title', { text: '馬卡龍記帳' }),
    kindSegmented(rerender),
  ]));

  // month navigator
  const nav = el('div.month-nav');
  nav.append(button('‹', { variant: 'ghost', onClick: () => { uiState.month = shiftMonth(uiState.month, -1); rerender(); } }));
  nav.append(el('button.month-label', {
    type: 'button',
    title: '回到本月',
    onclick: () => { uiState.month = monthKey(todayISO()); rerender(); },
  }, monthLabel(uiState.month)));
  nav.append(button('›', { variant: 'ghost', onClick: () => { uiState.month = shiftMonth(uiState.month, 1); rerender(); } }));
  wrap.append(nav);

  const monthExpenses = ofKind(expensesInMonth(store.expenses, uiState.month), uiState.kind);
  const total = sumCents(monthExpenses);
  const { income, expense, balance } = monthlyBalance(store.expenses, uiState.month);

  // summary card
  wrap.append(card([
    el('div.summary-row', {}, [
      el('span.muted', { text: `${kindLabel} 總計` }),
      el('span.summary-total', { text: formatMoney(total, currency) }),
    ]),
    el('div.summary-sub', {}, [
      el('span', { html: `收入 <b style="color:#7FA86E">${formatMoney(income, currency)}</b>` }),
      el('span', { html: ` − 支出 <b style="color:#D8698A">${formatMoney(expense, currency)}</b>` }),
      el('span', { html: ` ＝ 結餘 <b>${formatMoney(balance, currency)}</b>` }),
    ]),
    el('div.muted.small', { text: `${monthExpenses.length} 筆` }),
  ]));

  // search + filter
  const search = el('input.search', {
    type: 'search',
    placeholder: '搜尋項目、備註或金額',
    value: uiState.query,
  });
  search.addEventListener('input', () => { uiState.query = search.value; refreshList(); });
  wrap.append(search);

  const filterRow = el('div.chip-row');
  const makeChip = (id, label) => {
    const active = uiState.filter === id;
    return el(`button.chip${active ? '.active' : ''}`, {
      type: 'button',
      onclick: () => { uiState.filter = id; refreshList(); },
    }, label);
  };
  filterRow.append(makeChip('all', '全部'));
  const usedCatIds = [...new Set(monthExpenses.map((e) => e.categoryId))];
  for (const cid of usedCatIds) {
    const cat = getCategory(store.categories, cid, uiState.kind);
    filterRow.append(makeChip(cid, cat.label));
  }
  wrap.append(filterRow);

  const listHost = el('div.list-host');
  wrap.append(listHost);

  function refreshList() {
    clear(listHost);
    const filtered = applyFilters(monthExpenses, { query: uiState.query, categoryId: uiState.filter });
    if (!filtered.length) {
      const msg = uiState.query || uiState.filter !== 'all'
        ? `沒有符合的${kindLabel}`
        : `這個月還沒有${kindLabel}`;
      const hint = uiState.query || uiState.filter !== 'all'
        ? '換個關鍵字，或取消分類篩選。'
        : '按右下角的 ＋ 新增第一筆，或到「設定」匯入 Notion 的 CSV。';
      listHost.append(emptyState(msg, hint));
      return;
    }
    for (const group of groupByDate(filtered)) {
      listHost.append(el('div.date-head', { text: friendlyDate(group.date) }));
      const groupCard = el('div.card.list-card');
      group.items.forEach((e, i) => {
        if (i) groupCard.append(el('div.sep'));
        groupCard.append(expenseRow(e));
      });
      listHost.append(groupCard);
    }
  }
  refreshList();
  return wrap;
}

function expenseRow(e) {
  const cat = getCategory(store.categories, e.categoryId, e.kind);
  const title = e.title || cat.label;
  const subtitle = e.note ? `${cat.label} · ${e.note}` : cat.label;
  const sign = e.kind === 'income' ? '+' : '';
  const color = e.kind === 'income' ? '#7FA86E' : '#4A3B36';
  const row = el('button.row', {
    type: 'button',
    onclick: () => openExpenseForm(e, e.kind),
  }, [
    macaron(cat, 40),
    el('div.row-main', {}, [
      el('div.row-title', { text: title }),
      el('div.row-sub.muted', { text: subtitle }),
    ]),
    el('div.row-amount', {
      style: { color },
      text: `${sign}${formatMoney(e.amountCents, store.settings.currency)}`,
    }),
  ]);
  return row;
}

function emptyState(title, body) {
  return el('div.empty', {}, [
    el('div.empty-macaron', { html: '🍬' }),
    el('div.empty-title', { text: title }),
    el('div.empty-body.muted', { text: body }),
  ]);
}

// ---------------------------------------------------------------- insights
function renderInsights() {
  const wrap = el('div.page');
  const { currency } = store.settings;
  const kindLabel = uiState.kind === 'income' ? '收入' : '支出';
  const noun = uiState.kind === 'income' ? '來源' : '分類';

  wrap.append(el('header.page-head', {}, [
    el('h1.title', { text: '分析' }),
    kindSegmented(rerender),
  ]));

  // ---- donut: category share for current month
  const monthItems = ofKind(expensesInMonth(store.expenses, uiState.month), uiState.kind);
  const totals = categoryTotals(monthItems, store.categories, uiState.kind);
  const monthTotal = sumCents(monthItems);

  const donutNav = el('div.month-nav');
  donutNav.append(button('‹', { variant: 'ghost', onClick: () => { uiState.month = shiftMonth(uiState.month, -1); rerender(); } }));
  donutNav.append(el('span.month-label', { text: monthLabel(uiState.month) }));
  donutNav.append(button('›', { variant: 'ghost', onClick: () => { uiState.month = shiftMonth(uiState.month, 1); rerender(); } }));

  const donutCard = card([el('div.heading', { text: `${noun}佔比` }), donutNav]);
  if (!totals.length) {
    donutCard.append(emptyState(`這段期間沒有${kindLabel}`, `新增${kindLabel}或匯入 Notion 的 CSV 後，這裡會出現圓環圖。`));
  } else {
    const donutWrap = el('div.donut-wrap');
    const svg = el('div.donut', { html: donutChart(totals.map((t) => ({ cents: t.cents, color: t.category.colorDeep }))) });
    const center = el('div.donut-center', {}, [
      el('div.muted.small', { text: kindLabel }),
      el('div.donut-total', { text: formatMoney(monthTotal, currency, { compact: true }) }),
    ]);
    donutWrap.append(svg, center);
    donutCard.append(donutWrap);

    const legend = el('div.legend');
    for (const t of totals) {
      const pct = monthTotal ? Math.round((t.cents / monthTotal) * 100) : 0;
      legend.append(el('div.legend-row', {}, [
        macaron(t.category, 28),
        el('span.legend-label', { text: t.category.label }),
        el('span.legend-pct.muted', { text: `${pct}%` }),
        el('span.legend-amt', { text: formatMoney(t.cents, currency) }),
      ]));
    }
    donutCard.append(legend);
  }
  wrap.append(donutCard);

  // ---- line: last 6 months trend for current kind
  const series = monthlySeries(store.expenses, uiState.month, 6, uiState.kind);
  const lineCard = card([
    el('div.heading', { text: `每月${kindLabel}曲線` }),
    el('div', { html: lineChart(series.map((s) => ({ label: monthShort(s.key), cents: s.cents })), { color: uiState.kind === 'income' ? '#7FA86E' : '#D8698A' }) }),
  ]);
  wrap.append(lineCard);

  // ---- bar: yearly income vs expense + balance
  const years = yearsAvailable(store.expenses);
  if (!years.includes(uiState.year)) uiState.year = years[0] || todayISO().slice(0, 4);
  const yearSeries = monthlySeriesAll(store.expenses, uiState.year);
  const yIncome = yearSeries.reduce((a, s) => a + s.income, 0);
  const yExpense = yearSeries.reduce((a, s) => a + s.expense, 0);

  const yearNav = el('div.chip-row');
  for (const y of years.length ? years : [uiState.year]) {
    yearNav.append(el(`button.chip${uiState.year === y ? '.active' : ''}`, {
      type: 'button', onclick: () => { uiState.year = y; rerender(); },
    }, `${y}`));
  }
  const barCard = card([
    el('div.heading', { text: `${uiState.year} 年收支結餘` }),
    yearNav,
    el('div.summary-sub', {}, [
      el('span', { html: `收入 <b style="color:#7FA86E">${formatMoney(yIncome, currency, { compact: true })}</b>` }),
      el('span', { html: ` · 支出 <b style="color:#D8698A">${formatMoney(yExpense, currency, { compact: true })}</b>` }),
      el('span', { html: ` · 結餘 <b>${formatMoney(yIncome - yExpense, currency, { compact: true })}</b>` }),
    ]),
    el('div', { html: barChart(yearSeries.map((s) => ({ label: monthShort(s.key), income: s.income, expense: s.expense }))) }),
    el('div.legend-inline.muted.small', { html: '<span style="color:#7FA86E">■</span> 收入　<span style="color:#D8698A">■</span> 支出' }),
  ]);
  wrap.append(barCard);
  return wrap;
}

// ---------------------------------------------------------------- settings
function renderSettings() {
  const wrap = el('div.page');
  wrap.append(el('header.page-head', {}, [el('h1.title', { text: '設定' })]));

  // currency
  const curCard = card([el('div.heading', { text: '幣別' }),
    el('div.muted.small', { text: '只影響顯示方式，不會換算金額。' })]);
  const pills = el('div.chip-row');
  for (const c of CURRENCIES) {
    pills.append(el(`button.chip${store.settings.currency === c.code ? '.active' : ''}`, {
      type: 'button', onclick: () => { store.setSettings({ currency: c.code }); rerender(); },
    }, `${c.label} ${c.symbol}`));
  }
  curCard.append(pills);
  wrap.append(curCard);

  // haptics
  const hapCard = card([el('div.setting-row', {}, [
    el('div', {}, [el('div.heading', { text: '儲存時震動' }), el('div.muted.small', { text: '新增一筆時的觸覺回饋。' })]),
    toggle(store.settings.hapticsEnabled, (v) => { store.setSettings({ hapticsEnabled: v }); }),
  ])]);
  wrap.append(hapCard);

  // categories
  wrap.append(card([
    el('div.heading', { text: '分類與來源' }),
    el('div.muted.small', { text: `目前有 ${store.categories.length} 個分類，可以新增、改名、換顏色或圖示。` }),
    button('管理分類', { variant: 'secondary', icon: 'pricetag', onClick: openCategoryEditor }),
  ]));

  // notion import
  wrap.append(card([
    el('div.heading', { text: '從 Notion 匯入' }),
    el('div.muted.small', { text: '支出和收入都可以匯入。在 Notion 打開「支出記帳」或「收入明細」資料庫 → 右上角 ⋯ → 匯出 → 格式選 CSV，把下載的 .csv 檔選進來。有「分類」欄的當支出、有「來源」欄的當收入，沒看過的分類或來源會自動建立，重複匯入同一個檔案也不會重複記帳。' }),
    button('選擇 CSV 檔匯入', { variant: 'secondary', icon: 'storefront', onClick: doImportCSV }),
  ]));

  // data: backup / restore / clear
  wrap.append(card([
    el('div.heading', { text: '資料' }),
    el('div.muted.small', { text: '所有支出只存在這個瀏覽器裡。馬卡龍記帳沒有帳號、沒有分析追蹤，也不會把資料傳到任何地方。瀏覽器資料有可能在清除瀏覽紀錄或換手機時遺失，建議偶爾下載備份。' }),
    el('div.btn-row', {}, [
      button('下載備份', { variant: 'secondary', icon: 'document-text', onClick: () => downloadBackup(store.expenses, store.categories) }),
      button('從備份還原', { variant: 'secondary', icon: 'time', onClick: doRestore }),
    ]),
    button('清除所有資料', { variant: 'danger', icon: 'cut', onClick: doClearAll }),
  ]));

  // family password
  wrap.append(renderPasswordCard());

  // links + version
  wrap.append(card([
    el('div.link-row', {}, [
      el('a', { href: 'about/', target: '_blank', rel: 'noopener', text: '說明 / 聯絡我們' }),
      el('a', { href: 'privacy/', target: '_blank', rel: 'noopener', text: '隱私權政策' }),
    ]),
    el('div.muted.small.center', { text: `馬卡龍記帳 Macaron Ledger v${APP_VERSION}` }),
  ]));
  return wrap;
}

function renderPasswordCard() {
  const on = gateEnabled();
  const children = [
    el('div.heading', { text: '家庭密碼' }),
    el('div.muted.small', {
      text: on
        ? '開 App 前要先輸入密碼。密碼存在這台裝置，改密碼只會影響這台裝置；其他家人的裝置要各自設定一樣的密碼。'
        : '這台裝置目前不需要密碼就能打開。可以設一組家庭密碼，借手機給別人前先上鎖。',
    }),
  ];
  if (on) {
    children.push(el('div.btn-row', {}, [
      button('修改家庭密碼', { variant: 'secondary', icon: 'key', onClick: () => openPasswordForm(false) }),
      button('鎖定這台裝置', { variant: 'secondary', icon: 'shield', onClick: () => { forgetUnlock(); location.reload(); } }),
    ]));
    children.push(button('移除密碼鎖', {
      variant: 'danger', icon: 'cut',
      onClick: () => {
        if (!confirmDialog('移除後，這台裝置開 App 就不用輸入密碼了。資料不會刪除。確定嗎？')) return;
        disablePassword();
        rerender();
      },
    }));
  } else {
    children.push(button('設定家庭密碼', { variant: 'secondary', icon: 'key', onClick: () => openPasswordForm(true) }));
  }
  if (hasOverride()) {
    children.push(el('div.muted.small', { text: '目前使用這台裝置自己設定的密碼。' }));
    children.push(button('回復預設密碼', {
      variant: 'secondary', icon: 'time',
      onClick: () => {
        if (!confirmDialog('要改回原本程式內建的家庭密碼嗎？這台裝置自訂的密碼會取消。')) return;
        resetToDefault();
        rerender();
      },
    }));
  }
  return card(children);
}

function openPasswordForm(enabling) {
  openModal((sheet, close) => {
    sheet.append(el('div.sheet-head', {}, [
      el('button.sheet-back', { type: 'button', text: '取消', onclick: close }),
      el('div.sheet-title', { text: enabling ? '設定家庭密碼' : '修改家庭密碼' }),
      el('span', { style: { width: '44px' } }),
    ]));
    const body = el('div.sheet-body');
    body.append(el('div.muted.small', { text: '密碼不分大小寫，前後空白會自動忽略。設定後這台裝置會保持解鎖，其他裝置下次打開要輸入新密碼。' }));

    const pw1 = el('input.text-input', { type: 'password', placeholder: '新密碼', autocomplete: 'new-password' });
    const pw2 = el('input.text-input', { type: 'password', placeholder: '再輸入一次', autocomplete: 'new-password' });
    const err = el('div.gate-err');
    body.append(el('div.field', {}, [el('label.field-label', { text: '新密碼' }), pw1]));
    body.append(el('div.field', {}, [el('label.field-label', { text: '確認密碼' }), pw2]));
    body.append(err);
    sheet.append(body);

    const save = async () => {
      err.textContent = '';
      const a = pw1.value.trim();
      const b = pw2.value.trim();
      if (!a) { err.textContent = '請輸入密碼。'; pw1.focus(); return; }
      if (a !== b) { err.textContent = '兩次輸入的密碼不一樣。'; pw2.focus(); return; }
      await setPassword(a);
      close();
      rerender();
    };
    pw2.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    sheet.append(el('div.sheet-foot', {}, [button('儲存', { onClick: save })]));
    setTimeout(() => pw1.focus(), 50);
  });
}

function toggle(on, onChange) {
  const t = el(`button.toggle${on ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false' });
  t.append(el('span.knob'));
  t.addEventListener('click', () => {
    const next = !t.classList.contains('on');
    t.classList.toggle('on', next);
    t.setAttribute('aria-checked', next ? 'true' : 'false');
    onChange(next);
  });
  return t;
}

async function doImportCSV() {
  const file = await pickCSVFile();
  if (!file) return;
  const result = importNotionCSV(file.text, store.categories, store.expenses);
  if (result.error) { alert(result.error); return; }
  const noun = result.kind === 'income' ? '收入' : '支出';
  const catNoun = result.kind === 'income' ? '來源' : '分類';
  if (!result.drafts.length) {
    alert(`沒有新的資料可匯入（重複 ${result.duplicates} 筆、略過 ${result.skipped} 筆）。`);
    return;
  }
  let msg = `看起來是「${noun}」資料。找到 ${result.drafts.length} 筆新${noun}`;
  if (result.newCategories.length) {
    msg += `，並會新增 ${result.newCategories.length} 個${catNoun}（${result.newCategories.map((c) => c.label).join('、')}）`;
  }
  msg += '。';
  if (result.duplicates) msg += `\n${result.duplicates} 筆已存在會略過`;
  if (result.skipped) msg += `\n${result.skipped} 筆缺少金額或日期會略過`;
  msg += '。要匯入嗎？';
  if (!confirmDialog(msg)) return;
  if (result.newCategories.length) store.setCategories([...store.categories, ...result.newCategories]);
  store.addMany(result.drafts);
  alert(`已匯入 ${result.drafts.length} 筆${noun}。`);
  rerender();
}

async function doRestore() {
  const data = await pickBackup();
  if (!data) { alert('這個檔案不是馬卡龍記帳的備份檔。'); return; }
  if (!confirmDialog(`要還原 ${data.expenses.length} 筆支出嗎？目前瀏覽器裡的 ${store.expenses.length} 筆會被取代。`)) return;
  store.replaceAll(data.expenses, data.categories);
  rerender();
}

function doClearAll() {
  const detail = `會刪除這個瀏覽器裡的 ${store.expenses.length} 筆支出和自訂分類，且無法復原。`;
  if (!confirmDialog(`確定要清除所有資料嗎？${detail}`)) return;
  clearAll();
  store.load();
  rerender();
}

// ---------------------------------------------------------------- modal shell
function openModal(builder) {
  const overlay = el('div.overlay');
  const close = () => overlay.remove();
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });
  const sheet = el('div.sheet');
  builder(sheet, close);
  overlay.append(sheet);
  document.body.append(overlay);
  return close;
}

// ---------------------------------------------------------------- expense form
function openExpenseForm(existing, kind = 'expense') {
  const theKind = existing?.kind ?? kind;
  const income = theKind === 'income';
  const noun = income ? '收入' : '支出';
  const catNoun = income ? '來源' : '分類';
  const cats = categoriesOf(store.categories, theKind);

  const state = {
    amount: existing ? (existing.amountCents / 100).toString() : '',
    categoryId: existing?.categoryId ?? (cats[0]?.id ?? otherIdFor(theKind)),
    date: existing?.date ?? todayISO(),
    title: existing?.title ?? '',
    note: existing?.note ?? '',
  };

  openModal((sheet, close) => {
    const head = el('div.sheet-head', {}, [
      el('button.sheet-back', { type: 'button', text: '取消', onclick: close }),
      el('div.sheet-title', { text: existing ? `編輯${noun}` : `新增${noun}` }),
      existing
        ? el('button.sheet-del', { type: 'button', text: '刪除', onclick: () => {
          if (confirmDialog(`確定要刪除這筆${noun}嗎？刪除後無法復原。`)) { store.removeExpense(existing.id); close(); rerender(); }
        } })
        : el('span', { style: { width: '44px' } }),
    ]);
    sheet.append(head);

    const body = el('div.sheet-body');

    // amount
    const amountInput = el('input.amount-input', {
      type: 'text', inputmode: 'decimal', placeholder: '0', value: state.amount,
    });
    amountInput.addEventListener('input', () => { state.amount = amountInput.value; });
    body.append(el('div.field', {}, [
      el('label.field-label', { text: `金額（${store.settings.currency}）` }),
      el('div.amount-wrap', {}, [el('span.amount-symbol', { text: '' }), amountInput]),
    ]));

    // category / source picker
    const catField = el('div.field');
    catField.append(el('label.field-label', { text: catNoun }));
    const catGrid = el('div.cat-grid');
    const renderCats = () => {
      clear(catGrid);
      for (const c of cats) {
        const active = state.categoryId === c.id;
        const choice = el(`button.cat-choice${active ? '.active' : ''}`, {
          type: 'button', onclick: () => { state.categoryId = c.id; renderCats(); },
        }, [macaron(c, 40), el('span.cat-choice-label', { text: c.label })]);
        catGrid.append(choice);
      }
    };
    renderCats();
    catField.append(catGrid);
    body.append(catField);

    // date
    const dateField = el('div.field');
    dateField.append(el('label.field-label', { text: '日期' }));
    const dateRow = el('div.chip-row');
    const dateInput = el('input.date-input', { type: 'date', value: state.date });
    const quick = (iso, label) => el(`button.chip${state.date === iso ? '.active' : ''}`, {
      type: 'button', onclick: () => { state.date = iso; dateInput.value = iso; refreshQuick(); },
    }, label);
    const refreshQuick = () => {
      clear(dateRow);
      dateRow.append(quick(todayISO(), '今天'));
      dateRow.append(quick(addDays(todayISO(), -1), '昨天'));
      dateRow.append(dateInput);
    };
    dateInput.addEventListener('change', () => { if (dateInput.value) { state.date = dateInput.value; refreshQuick(); } });
    refreshQuick();
    dateField.append(dateRow);
    body.append(dateField);

    // title
    const titleInput = el('input.text-input', {
      type: 'text', value: state.title,
      placeholder: income ? '例如：股利' : '買了什麼？例如：全聯、加油',
    });
    titleInput.addEventListener('input', () => { state.title = titleInput.value; });
    body.append(el('div.field', {}, [el('label.field-label', { text: '項目' }), titleInput]));

    // note
    const noteInput = el('input.text-input', { type: 'text', value: state.note, placeholder: '備註（選填）' });
    noteInput.addEventListener('input', () => { state.note = noteInput.value; });
    body.append(el('div.field', {}, [el('label.field-label', { text: '備註' }), noteInput]));

    sheet.append(body);

    sheet.append(el('div.sheet-foot', {}, [
      button(existing ? '儲存變更' : '儲存', {
        variant: income ? 'income' : 'primary',
        onClick: () => {
          const cents = parseAmount(state.amount, store.settings.currency);
          if (cents === null || cents <= 0) { alert('請輸入金額。'); amountInput.focus(); return; }
          const payload = {
            kind: theKind, title: state.title.trim(), amountCents: cents,
            categoryId: state.categoryId, date: state.date, note: state.note.trim(),
          };
          if (existing) store.updateExpense(existing.id, payload);
          else store.addExpense(payload);
          haptic(store.settings, 15);
          close();
          rerender();
        },
      }),
    ]));
    setTimeout(() => amountInput.focus(), 50);
  });
}

// ---------------------------------------------------------------- category editor
function openCategoryEditor() {
  openModal((sheet, close) => {
    let editorKind = uiState.kind;
    const head = el('div.sheet-head', {}, [
      el('span', { style: { width: '44px' } }),
      el('div.sheet-title', { text: '管理分類' }),
      el('button.sheet-back', { type: 'button', text: '完成', onclick: () => { close(); rerender(); } }),
    ]);
    sheet.append(head);

    const body = el('div.sheet-body');
    sheet.append(body);

    const renderList = () => {
      clear(body);
      const seg = el('div.segmented');
      for (const [k, label] of [['expense', '支出分類'], ['income', '收入來源']]) {
        seg.append(el(`button.seg${editorKind === k ? '.active' : ''}`, {
          type: 'button', onclick: () => { editorKind = k; renderList(); },
        }, label));
      }
      body.append(seg);
      body.append(el('div.muted.small', { text: '可以改名、換顏色或圖示。「其他」不能刪除。' }));

      const list = el('div.card.list-card');
      const kindCats = categoriesOf(store.categories, editorKind);
      kindCats.forEach((c, i) => {
        if (i) list.append(el('div.sep'));
        const isOther = c.id === otherIdFor(editorKind);
        list.append(el('button.row', {
          type: 'button', onclick: () => editCategory(c, renderList),
        }, [
          macaron(c, 40),
          el('div.row-main', {}, [el('div.row-title', { text: c.label }), isOther ? el('div.row-sub.muted', { text: '預設分類' }) : null]),
          el('span.row-chev', { text: '›' }),
        ]));
      });
      body.append(list);
      body.append(button(`新增${editorKind === 'income' ? '來源' : '分類'}`, {
        variant: 'secondary', icon: 'sparkles', onClick: () => editCategory(null, renderList, editorKind),
      }));
    };
    renderList();
  });
}

function editCategory(existing, onDone, kind) {
  const theKind = existing?.kind ?? kind ?? 'expense';
  const isOther = existing && existing.id === otherIdFor(theKind);
  const flavorIdx = Math.max(0, FLAVORS.findIndex((f) => f.color === existing?.color));
  const state = {
    label: existing?.label ?? '',
    flavor: existing ? (flavorIdx === -1 ? 0 : flavorIdx) : FLAVORS.indexOf(FLAVORS.find((f) => f.color === nextFlavor(store.categories).color) || FLAVORS[0]),
    icon: existing?.icon ?? (theKind === 'income' ? 'cash' : 'pricetag'),
  };

  openModal((sheet, close) => {
    sheet.append(el('div.sheet-head', {}, [
      el('button.sheet-back', { type: 'button', text: '取消', onclick: close }),
      el('div.sheet-title', { text: existing ? `編輯${theKind === 'income' ? '來源' : '分類'}` : `新增${theKind === 'income' ? '來源' : '分類'}` }),
      (existing && !isOther)
        ? el('button.sheet-del', { type: 'button', text: '刪除', onclick: () => {
          const affected = store.expenses.filter((e) => e.categoryId === existing.id).length;
          if (!confirmDialog(`刪除「${existing.label}」後，${affected} 筆${theKind === 'income' ? '收入' : '支出'}會改為「其他」。`)) return;
          const otherId = otherIdFor(theKind);
          const expenses = store.expenses.map((e) => (e.categoryId === existing.id ? { ...e, categoryId: otherId } : e));
          store.expenses = expenses; saveExpensesSafe(expenses);
          store.setCategories(store.categories.filter((c) => c.id !== existing.id));
          close(); onDone();
        } })
        : el('span', { style: { width: '44px' } }),
    ]));

    const body = el('div.sheet-body');

    const nameInput = el('input.text-input', { type: 'text', value: state.label, placeholder: '分類名稱', disabled: isOther });
    nameInput.addEventListener('input', () => { state.label = nameInput.value; previewUpdate(); });
    body.append(el('div.field', {}, [el('label.field-label', { text: '名稱' }), nameInput]));

    // preview
    const preview = el('div.cat-preview');
    const previewUpdate = () => {
      clear(preview);
      const f = FLAVORS[state.flavor];
      preview.append(macaron({ color: f.color, colorDeep: f.colorDeep, icon: state.icon }, 64));
      preview.append(el('span.cat-choice-label', { text: state.label || '預覽' }));
    };
    previewUpdate();
    body.append(preview);

    // flavors
    body.append(el('label.field-label', { text: '口味（顏色）' }));
    const flavorGrid = el('div.flavor-grid');
    FLAVORS.forEach((f, i) => {
      const dot = el(`button.flavor${state.flavor === i ? '.active' : ''}`, {
        type: 'button', title: f.name, style: { background: f.color, borderColor: f.colorDeep },
        onclick: () => { state.flavor = i; [...flavorGrid.children].forEach((n, j) => n.classList.toggle('active', j === i)); previewUpdate(); },
      });
      flavorGrid.append(dot);
    });
    body.append(flavorGrid);

    // icons
    body.append(el('label.field-label', { text: '圖示' }));
    const iconGrid = el('div.icon-grid');
    ICON_CHOICES.forEach((name) => {
      const choice = el(`button.icon-choice${state.icon === name ? '.active' : ''}`, {
        type: 'button', text: iconEmoji(name),
        onclick: () => { state.icon = name; [...iconGrid.children].forEach((n) => n.classList.toggle('active', n === choice)); previewUpdate(); },
      });
      iconGrid.append(choice);
    });
    body.append(iconGrid);

    sheet.append(body);
    sheet.append(el('div.sheet-foot', {}, [
      button(existing ? '儲存變更' : '新增', {
        onClick: () => {
          const label = state.label.trim();
          if (!label) { alert('請輸入名稱。'); nameInput.focus(); return; }
          const f = FLAVORS[state.flavor];
          if (existing) {
            store.setCategories(store.categories.map((c) => (c.id === existing.id
              ? { ...c, label, color: f.color, colorDeep: f.colorDeep, icon: state.icon } : c)));
          } else {
            const cat = {
              id: makeCategoryId(label, store.categories), kind: theKind, label,
              color: f.color, colorDeep: f.colorDeep, icon: state.icon,
            };
            store.setCategories([...store.categories, cat]);
          }
          close(); onDone();
        },
      }),
    ]));
  });
}

function saveExpensesSafe(list) { saveExpenses(list); }

// ---------------------------------------------------------------- gate
export async function runGate(onUnlock) {
  if (!gateEnabled() || isUnlocked()) { onUnlock(); return; }
  const host = document.getElementById('root');
  clear(host);
  const wrap = el('div.gate');
  wrap.append(el('div.gate-macaron', { html: '🧁' }));
  wrap.append(el('h1.gate-title', { text: '馬卡龍記帳' }));
  wrap.append(el('p.gate-sub.muted', { text: '輸入家庭密碼才能打開記帳本，每台裝置只需要輸入一次。' }));
  const input = el('input.gate-input', { type: 'password', placeholder: '家庭密碼', autocomplete: 'off' });
  const err = el('div.gate-err');
  const submit = async () => {
    err.textContent = '';
    if (await checkCode(input.value)) {
      rememberUnlock();
      onUnlock();
    } else {
      err.textContent = '密碼不對，請問問分享連結給你的家人。';
      input.value = '';
      input.focus();
    }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  wrap.append(input, err, button('打開記帳本', { onClick: submit }));
  host.append(wrap);
  setTimeout(() => input.focus(), 50);
}
