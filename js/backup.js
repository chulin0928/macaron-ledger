// Backup download / restore. The backup is a plain JSON file the user can keep
// anywhere; restoring replaces the current browser's data.
import { migrateExpense, isExpense, isCategory, migrateCategory } from './store.js';

function downloadText(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickTextFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try { resolve({ name: file.name, text: await file.text() }); }
      catch { resolve(null); }
    };
    input.click();
  });
}

export function downloadBackup(expenses, categories) {
  const payload = {
    app: 'macaron-ledger',
    version: 2,
    exportedAt: new Date().toISOString(),
    expenses,
    categories,
  };
  const stamp = new Date().toISOString().slice(0, 10);
  downloadText(`macaron-ledger-backup-${stamp}.json`, JSON.stringify(payload, null, 2));
}

// Returns { expenses, categories } or null if the file is not a valid backup.
export async function pickBackup() {
  const file = await pickTextFile('application/json,.json');
  if (!file) return null;
  try {
    const parsed = JSON.parse(file.text);
    const rawExpenses = Array.isArray(parsed) ? parsed : parsed?.expenses;
    if (!Array.isArray(rawExpenses)) return null;
    const expenses = rawExpenses.map(migrateExpense).filter((e) => e !== null);
    const categories = Array.isArray(parsed?.categories)
      ? parsed.categories.filter(isCategory).map(migrateCategory)
      : [];
    return { expenses, categories };
  } catch { return null; }
}

export function pickCSVFile() {
  return pickTextFile('text/csv,.csv,text/plain');
}

export { isExpense };
