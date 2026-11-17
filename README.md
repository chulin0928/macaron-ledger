# macaron-ledger
Family expense tracker

## TOEIC 字卡 (`/words/`)

Word cards, reading articles and grammar notes built from the shared Google Drive folder.

- Site: `https://chulin0928.github.io/macaron-ledger/words/` (default login `admin` / `0000`, change it in 設定).
- `.github/workflows/sync-words.yml` runs every hour (and on demand from the Actions tab). It runs
  `scripts/sync_drive.py`, which reads every `.docx` / Google Doc in the folder and writes `words/data/`.
- The Drive folder must stay shared as "Anyone with the link". To use another folder, set the repository
  variable `DRIVE_FOLDER_ID`.
- Grammar cards come from any heading in a document that contains "Grammar" or "文法"; each sub-heading under it
  becomes one card.
- Login and study progress are stored in the browser (localStorage); export/import progress in 設定 to move devices.
