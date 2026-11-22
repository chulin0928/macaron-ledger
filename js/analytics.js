// Pure selectors over the expense list. Nothing here touches storage or the DOM.
import { monthKey, yearKey } from './dates.js';

export function ofKind(expenses, kind) {
  return expenses.filter((e) => e.kind === kind);
}
export function sumCents(expenses) {
  return expenses.reduce((acc, e) => acc + e.amountCents, 0);
}
export function expensesInMonth(expenses, key) {
  return expenses.filter((e) => monthKey(e.date) === key);
}
export function expensesInYear(expenses, year) {
  return expenses.filter((e) => yearKey(e.date) === year);
}

// Income - expense for a given month key.
export function monthlyBalance(expenses, key) {
  const inMonth = expensesInMonth(expenses, key);
  const income = sumCents(ofKind(inMonth, 'income'));
  const expense = sumCents(ofKind(inMonth, 'expense'));
  return { income, expense, balance: income - expense };
}

// Totals grouped by category id, sorted high -> low. `kind` selects expense/income.
export function categoryTotals(expenses, categories, kind) {
  const totals = new Map();
  for (const e of ofKind(expenses, kind)) {
    totals.set(e.categoryId, (totals.get(e.categoryId) || 0) + e.amountCents);
  }
  return [...totals.entries()]
    .map(([categoryId, cents]) => ({
      categoryId, cents,
      category: categories.find((c) => c.id === categoryId),
    }))
    .filter((t) => t.category)
    .sort((a, b) => b.cents - a.cents);
}

// Build a month-by-month series for the last `count` months ending at `endKey`.
export function monthlySeries(expenses, endKey, count, kind) {
  const [ey, em] = endKey.split('-').map(Number);
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(ey, em - 1 - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const cents = sumCents(ofKind(expensesInMonth(expenses, key), kind));
    out.push({ key, cents });
  }
  return out;
}

// All months in a year with income + expense, oldest first.
export function monthlySeriesAll(expenses, year) {
  const out = [];
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    const inMonth = expensesInMonth(expenses, key);
    out.push({
      key,
      income: sumCents(ofKind(inMonth, 'income')),
      expense: sumCents(ofKind(inMonth, 'expense')),
    });
  }
  return out;
}

export function yearsAvailable(expenses) {
  const years = new Set(expenses.map((e) => yearKey(e.date)));
  return [...years].sort((a, b) => b.localeCompare(a));
}

export function dailyTotals(expenses, key, kind) {
  const totals = new Map();
  for (const e of ofKind(expensesInMonth(expenses, key), kind)) {
    totals.set(e.date, (totals.get(e.date) || 0) + e.amountCents);
  }
  return totals;
}

// Search + category filter for the list screen.
export function applyFilters(expenses, { query = '', categoryId = 'all' } = {}) {
  const q = query.trim().toLowerCase();
  return expenses.filter((e) => {
    if (categoryId !== 'all' && e.categoryId !== categoryId) return false;
    if (!q) return true;
    const hay = `${e.title} ${e.note} ${(e.amountCents / 100)}`.toLowerCase();
    return hay.includes(q);
  });
}

// Group a list of expenses by date, newest day first, each day's items newest first.
export function groupByDate(expenses) {
  const byDate = new Map();
  for (const e of expenses) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  return [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, items]) => ({
      date,
      items: items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    }));
}
