// Money helpers. Amounts are stored as integer `amountCents` (hundredths of a unit)
// so there is never any floating-point drift.
import { currencySymbol, decimalsFor } from './data.js';

function groupThousands(s) {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Format an integer cent amount for display, e.g. 123450 -> "$1,234.50".
// opts.compact collapses large numbers to 萬 / 億.
export function formatMoney(amountCents, code, opts = {}) {
  const decimals = decimalsFor(code);
  const value = amountCents / 100;
  const symbol = currencySymbol(code);
  const negative = value < 0;
  const abs = Math.abs(value);
  let body;
  if (opts.compact && abs >= 1e4) {
    body = abs >= 1e8
      ? `${groupThousands((abs / 1e8).toFixed(1))}億`
      : `${groupThousands((abs / 1e4).toFixed(1))}萬`;
  } else {
    body = groupThousands(abs.toFixed(decimals));
  }
  return `${negative ? '-' : ''}${symbol}${body}`;
}

// Parse a user-typed amount string into integer cents. Returns null if invalid.
export function parseAmount(text, code) {
  if (text == null) return null;
  const cleaned = String(text).replace(/[,\s]/g, '').replace(/[^\d.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}
