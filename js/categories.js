// Category helpers shared across screens.
import { OTHER_EXPENSE, otherIdFor, nextFlavor } from './data.js';

export function categoriesOf(categories, kind) {
  return categories.filter((c) => c.kind === kind);
}

// Resolve a category by id, falling back to the kind's "other" bucket.
export function getCategory(categories, id, kind = 'expense') {
  return categories.find((c) => c.id === id)
    ?? categories.find((c) => c.id === otherIdFor(kind))
    ?? OTHER_EXPENSE;
}

export function findCategoryByLabel(categories, label, kind) {
  const needle = label.trim().toLowerCase();
  return categories.find(
    (c) => (!kind || c.kind === kind) && c.label.trim().toLowerCase() === needle,
  );
}

// Build a stable, readable id from a label (keeps CJK, slugs the rest).
export function makeCategoryId(label, categories) {
  const base = label.trim().toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-|-$/g, '') || 'cat';
  let id = base;
  let n = 2;
  while (categories.some((c) => c.id === id)) id = `${base}-${n++}`;
  return id;
}

export { nextFlavor, otherIdFor };
