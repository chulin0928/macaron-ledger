// Date helpers. Dates are stored as local-time ISO day strings, "YYYY-MM-DD".
const pad = (n) => String(n).padStart(2, '0');

export function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function fromISODate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function todayISO() { return toISODate(new Date()); }
export function addDays(iso, n) {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}
export function monthKey(iso) { return iso.slice(0, 7); }   // YYYY-MM
export function yearKey(iso) { return iso.slice(0, 4); }     // YYYY

export function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export function monthLabel(key, mode = 'long') {
  const [y, m] = key.split('-').map(Number);
  return mode === 'long' ? `${y}年${m}月` : `${m}月`;
}
export function monthShort(key) { return `${Number(key.split('-')[1])}月`; }
export function daysInMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
export function friendlyDate(iso) {
  const today = todayISO();
  if (iso === today) return '今天';
  if (iso === addDays(today, -1)) return '昨天';
  const d = fromISODate(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return sameYear ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function monthFromName(s) {
  const idx = MONTHS.indexOf(s.slice(0, 3).toLowerCase());
  return idx === -1 ? null : String(idx + 1);
}
function build(y, m, d) {
  if (!m) return null;
  const year = Number(y), mon = Number(m), day = Number(d);
  if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
  const dt = new Date(year, mon - 1, day);
  if (dt.getMonth() !== mon - 1) return null;
  return toISODate(dt);
}

// Accepts the date formats Notion exports in (zh and en).
export function parseFlexibleDate(text) {
  const n = text.trim();
  if (!n) return null;
  let u;
  if ((u = n.match(/^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/))) return build(u[1], u[2], u[3]);
  if ((u = n.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return build(u[1], u[2], u[3]);
  if ((u = n.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/))) return build(u[3], monthFromName(u[1]), u[2]);
  if ((u = n.match(/^(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})/))) return build(u[3], monthFromName(u[2]), u[1]);
  if ((u = n.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return build(u[3], u[1], u[2]);
  return null;
}
