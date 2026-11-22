// Import expenses / income from a Notion CSV export.
// A row becomes an expense if the file has a 「分類」(category) column, income if it
// has a 「來源」(source) column. Unknown categories/sources are created automatically,
// and re-importing the same file never double-counts (rows are de-duplicated).
import { otherIdFor } from './data.js';
import { migrateExpense } from './store.js';
import { findCategoryByLabel, makeCategoryId, nextFlavor } from './categories.js';
import { parseFlexibleDate } from './dates.js';

// RFC-4180-ish CSV parser (handles quotes, escaped quotes, CRLF, BOM).
export function parseCSV(input) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = input.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else { field += c; }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else { field += c; }
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const HEADER_ALIASES = {
  title: ['項目', '名稱', '標題', 'name', 'title', 'item'],
  amount: ['金額', '花費', '支出', 'amount', 'cost', 'price', 'total'],
  category: ['分類', '類別', '類型', 'category', 'type', 'tags'],
  source: ['來源', '收入來源', 'source', 'from'],
  date: ['日期', '時間', 'date', 'time', 'created'],
  note: ['備註', '說明', '筆記', 'note', 'notes', 'memo', 'description', 'comment'],
};

export function mapHeaders(headerRow) {
  const lower = headerRow.map((h) => h.trim().toLowerCase());
  const map = {};
  for (const field of Object.keys(HEADER_ALIASES)) {
    for (const alias of HEADER_ALIASES[field]) {
      const idx = lower.findIndex((h) => h === alias.toLowerCase());
      if (idx !== -1 && !Object.values(map).includes(idx)) { map[field] = idx; break; }
    }
  }
  return map;
}

// Amount parser tuned for CSV cells: integer dollars + up to 2 decimals, must be > 0.
function parseAmountToCents(raw) {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned || cleaned === '.') return null;
  const parts = cleaned.split('.');
  if (parts.length > 2) return null;
  const whole = parts[0] || '0';
  const frac = (parts[1] ?? '').slice(0, 2).padEnd(2, '0');
  const cents = 100 * parseInt(whole, 10) + parseInt(frac, 10);
  return !Number.isFinite(cents) || cents <= 0 ? null : cents;
}

const dedupeKey = (e) => `${e.kind}|${e.date}|${e.amountCents}|${e.title.trim()}|${e.categoryId}`;

// Returns { kind, drafts, newCategories, skipped, duplicates, error? }.
export function importNotionCSV(text, categories, existingExpenses, forcedKind) {
  const rows = parseCSV(text);
  const headers = rows.length ? mapHeaders(rows[0]) : {};
  const kind = forcedKind
    ?? ((headers.source !== undefined && headers.category === undefined) ? 'income' : 'expense');
  const labelCol = kind === 'income'
    ? (headers.source ?? headers.category)
    : (headers.category ?? headers.source);

  const empty = { kind, drafts: [], newCategories: [], skipped: 0, duplicates: 0 };
  if (rows.length < 2) return { ...empty, error: '檔案裡沒有資料列。' };
  if (headers.amount === undefined || headers.date === undefined) {
    return { ...empty, error: '找不到「金額」或「日期」欄位，請確認是 Notion 匯出的 CSV。' };
  }

  const cats = [...categories];
  const newCategories = [];
  const seen = new Set(existingExpenses.map(dedupeKey));
  const drafts = [];
  let skipped = 0;
  let duplicates = 0;

  for (const r of rows.slice(1)) {
    const cell = (idx) => (idx === undefined ? '' : (r[idx] ?? '').trim());
    const cents = parseAmountToCents(cell(headers.amount));
    const date = parseFlexibleDate(cell(headers.date));
    if (cents === null || !date) { skipped++; continue; }

    const label = cell(labelCol).split(',')[0].trim();
    let cat = label ? findCategoryByLabel(cats, label, kind) : undefined;
    if (!cat) {
      if (label) {
        cat = {
          id: makeCategoryId(label, cats), kind, label,
          icon: kind === 'income' ? 'cash' : 'pricetag', ...nextFlavor(cats),
        };
        cats.push(cat);
        newCategories.push(cat);
      } else {
        cat = cats.find((c) => c.id === otherIdFor(kind)) ?? cats[0];
      }
    }

    const draft = migrateExpense({
      kind, title: cell(headers.title), amountCents: cents,
      categoryId: cat.id, date, note: cell(headers.note),
      id: `csv-${drafts.length}`,
    });
    const key = dedupeKey(draft);
    if (seen.has(key)) { duplicates++; } else { seen.add(key); drafts.push(draft); }
  }
  return { kind, drafts, newCategories, skipped, duplicates };
}
