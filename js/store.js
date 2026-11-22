// Persistence layer. Everything lives in localStorage under the same keys the
// original app used, so data saved by earlier versions loads unchanged.
import {
  CURRENCIES, DEFAULT_CATEGORIES, DEFAULT_INCOME_SOURCES,
} from './data.js';

const KEYS = {
  expenses: 'macaron.expenses.v1',
  settings: 'macaron.settings.v1',
  categories: 'macaron.categories.v1',
};

export const DEFAULT_SETTINGS = { currency: 'TWD', hapticsEnabled: true };

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage full / blocked */ }
}

// --- validation / migration -------------------------------------------------

export function migrateExpense(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw;
  if (typeof t.id !== 'string' || typeof t.amountCents !== 'number'
      || typeof t.categoryId !== 'string' || typeof t.date !== 'string') {
    return null;
  }
  const note = typeof t.note === 'string' ? t.note : '';
  const title = typeof t.title === 'string' ? t.title : note;
  return {
    id: t.id,
    kind: t.kind === 'income' ? 'income' : 'expense',
    title,
    amountCents: t.amountCents,
    categoryId: t.categoryId,
    date: t.date,
    note: typeof t.title === 'string' ? note : '',
    createdAt: typeof t.createdAt === 'number' ? t.createdAt : 0,
    updatedAt: typeof t.updatedAt === 'number' ? t.updatedAt : 0,
  };
}
export function isExpense(raw) { return migrateExpense(raw) !== null; }

export function isCategory(raw) {
  if (!raw || typeof raw !== 'object') return false;
  const t = raw;
  return typeof t.id === 'string' && typeof t.label === 'string'
    && typeof t.color === 'string' && typeof t.colorDeep === 'string';
}
export function migrateCategory(raw) {
  const t = raw;
  return {
    id: t.id,
    kind: t.kind === 'income' ? 'income' : 'expense',
    label: t.label,
    color: t.color,
    colorDeep: t.colorDeep,
    icon: typeof t.icon === 'string' ? t.icon : 'ellipsis-horizontal-circle',
  };
}

// --- load / save ------------------------------------------------------------

export function loadExpenses() {
  const raw = read(KEYS.expenses);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(migrateExpense).filter((e) => e !== null) : [];
  } catch { return []; }
}
export function saveExpenses(list) { write(KEYS.expenses, JSON.stringify(list)); }

export function loadSettings() {
  const raw = read(KEYS.settings);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const merged = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    if (!CURRENCIES.some((c) => c.code === merged.currency)) {
      merged.currency = DEFAULT_SETTINGS.currency;
    }
    return merged;
  } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s) { write(KEYS.settings, JSON.stringify(s)); }

export function loadCategories() {
  const raw = read(KEYS.categories);
  if (!raw) return DEFAULT_CATEGORIES.slice();
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed.filter(isCategory).map(migrateCategory) : [];
    if (!list.length) return DEFAULT_CATEGORIES.slice();
    // Older saves had no income sources; add them so income tracking works.
    return list.some((c) => c.kind === 'income') ? list : [...list, ...DEFAULT_INCOME_SOURCES];
  } catch { return DEFAULT_CATEGORIES.slice(); }
}
export function saveCategories(list) { write(KEYS.categories, JSON.stringify(list)); }

export function clearAll() {
  [KEYS.expenses, KEYS.settings, KEYS.categories].forEach((k) => {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  });
}

export const STORAGE_KEYS = KEYS;
