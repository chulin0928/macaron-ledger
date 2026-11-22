# 馬卡龍記帳 Macaron Ledger

A sweet, simple **family expense tracker**. Private, offline, and every category is
a macaron. Track expenses *and* income, see where the month went, import from
Notion, and keep every bit of it on your own device.

**Live app:** https://chulin0928.github.io/macaron-ledger/

---

## What this is

A lightweight, **no-build** web app (a PWA). The files in this repo *are* the app
— there is no compiler, bundler, or `node_modules` to install. You edit a file,
commit, and GitHub Pages serves it. That makes it easy to create and improve
features without any toolchain.

All data lives in the browser's `localStorage`. There is no account, no server,
and no network request of its own — so each device keeps its own ledger. Use
**設定 → 下載備份** now and then, and restore with **從備份還原**.

## How to run it locally

It's plain static files, so any static server works. From the repo root:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

> Opening `index.html` directly with `file://` will **not** work — browsers block
> ES modules and service workers over `file://`. Always use a local server.

## Project layout

```
index.html            App shell: loads app.css + js/boot.js
app.css               All styles (design tokens live in :root at the top)
sw.js                 Service worker (offline cache). Bump CACHE after big changes.
manifest.webmanifest  PWA metadata (home-screen install)
icons/                App icons
about/  privacy/      Static info pages linked from Settings
js/
  boot.js         Entry point: runs the password gate, then mounts the app
  app.js          Main app: state store, routing, and every screen
  data.js         Flavours (colours), icons, default categories, currencies
  store.js        localStorage load/save + data validation/migration
  money.js        Money formatting + parsing (amounts are integer cents)
  dates.js        ISO date helpers + flexible date parsing (for CSV)
  categories.js   Category lookup helpers
  analytics.js    Pure selectors: totals, monthly series, filters, grouping
  charts.js       Dependency-free SVG donut / line / bar charts
  csv.js          Notion CSV import (expense + income)
  backup.js       Backup download / restore, file pickers
  ui.js           DOM helpers + the macaron renderer
  gate.js         Optional family-password gate
```

Data model (stored under `macaron.*.v1` keys):

- **Expense/income**: `{ id, kind: 'expense'|'income', title, amountCents, categoryId, date: 'YYYY-MM-DD', note, createdAt, updatedAt }`
- **Category**: `{ id, kind, label, color, colorDeep, icon }`
- **Settings**: `{ currency, hapticsEnabled }`

## Common changes

- **Add a default category** → edit `DEFAULT_EXPENSE_CATEGORIES` /
  `DEFAULT_INCOME_SOURCES` in `js/data.js`. (Existing users keep their saved
  categories; defaults only seed a fresh install.)
- **Add a macaron flavour / colour** → add to `FLAVORS` in `js/data.js`.
- **Add a currency** → add to `CURRENCIES` in `js/data.js` (and
  `ZERO_DECIMAL` there if it has no cents).
- **Change colours / spacing** → the `:root` tokens at the top of `app.css`.
- **A new screen or button** → `js/app.js` (screens are plain functions that
  build DOM with the `el()` helper from `js/ui.js`).

After a change that users must re-fetch (e.g. new JS files), bump `CACHE` in
`sw.js` so the service worker refreshes their cached copy.

## The family password

The app can show a soft "family password" gate on first open. It is **not real
security** — the password's hash ships in the page and all data is unencrypted in
the browser — it just keeps a borrowed phone from casually opening the ledger.

Everything lives in `js/gate.js`:

- **Change the password:** open the app, run this in the browser console, and
  paste the 64-character result into `FAMILY_CODE_HASH`:
  ```js
  const m = await import('./js/gate.js');
  console.log(await m.sha256Hex(m.normalizeCode('your-new-password')));
  ```
- **Disable the gate entirely:** set `FAMILY_CODE_HASH = ''` in `js/gate.js`.

## Deploying

GitHub Pages serves this repo's default branch at the URL above. Keep the repo
named `macaron-ledger` (paths are relative, so it also works under a sub-path).
`.nojekyll` is required so folders are served as-is.
