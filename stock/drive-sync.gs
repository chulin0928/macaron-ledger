/**
 * 台股盤後雷達 → Google 雲端硬碟 自動同步
 *
 * 安裝（只要做一次，約 2 分鐘）：
 *   1. 打開 https://script.google.com ，按「新專案」
 *   2. 把這整個檔案的內容貼上，取代原本的程式碼，按儲存
 *   3. 上方函式選單選「setup」，按「執行」，依畫面授權（存取你的雲端硬碟）
 * 完成後每天 08:50 與 22:30（台灣時間）會自動把最新結果存進指定資料夾：
 *   - 每天一個日期資料夾，內含 選股 / 籌碼 / PTT情緒 CSV 與完整 JSON
 *   - 一份「台股盤後雷達｜最新結果」Google 試算表，每次覆寫成最新
 */
const FOLDER_ID = '1WArhW8R8LF9XLKNK4uqV0zpICkhayW5I';
const BASE = 'https://raw.githubusercontent.com/chulin0928/macaron-ledger/main/stock/data/';
const FILES = [
  { path: 'exports/screener.csv', name: '選股', sheet: '選股' },
  { path: 'exports/chips.csv', name: '籌碼', sheet: '籌碼' },
  { path: 'exports/sentiment.csv', name: 'PTT情緒', sheet: 'PTT情緒' },
  { path: 'latest.json', name: '完整資料', sheet: null },
];
const SHEET_NAME = '台股盤後雷達｜最新結果';

function setup() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncToDrive').timeBased().atHour(8).nearMinute(50).everyDays(1).inTimezone('Asia/Taipei').create();
  ScriptApp.newTrigger('syncToDrive').timeBased().atHour(22).nearMinute(30).everyDays(1).inTimezone('Asia/Taipei').create();
  syncToDrive();
}

function syncToDrive() {
  const root = DriveApp.getFolderById(FOLDER_ID);
  const meta = JSON.parse(fetchText_(BASE + 'latest.json'));
  const day = meta.trade_date; // 資料日，例如 2026-11-13
  const stamp = day.replace(/-/g, '');
  const folder = childFolder_(root, day);

  const ss = latestSheet_(root);
  FILES.forEach((f) => {
    const text = fetchText_(BASE + f.path + '?t=' + Date.now());
    const ext = f.path.endsWith('.json') ? 'json' : 'csv';
    const fileName = `${f.name}_${stamp}.${ext}`;
    const existing = folder.getFilesByName(fileName);
    while (existing.hasNext()) existing.next().setTrashed(true); // 同一天重跑就覆蓋
    folder.createFile(fileName, text, ext === 'json' ? 'application/json' : 'text/csv');
    if (f.sheet) {
      const rows = Utilities.parseCsv(text.replace(/^﻿/, ''));
      let sh = ss.getSheetByName(f.sheet) || ss.insertSheet(f.sheet);
      sh.clearContents();
      if (rows.length) sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
      sh.setFrozenRows(1);
    }
  });
  let info = ss.getSheetByName('說明') || ss.insertSheet('說明', 0);
  info.clearContents();
  info.getRange(1, 1, 4, 2).setValues([
    ['資料日', day],
    ['網頁更新時間', meta.updated],
    ['同步時間', Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm')],
    ['網頁', 'https://chulin0928.github.io/macaron-ledger/stock/'],
  ]);
  const blank = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);
}

function fetchText_(url) {
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('下載失敗 ' + res.getResponseCode() + '：' + url);
  return res.getContentText('UTF-8');
}

function childFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function latestSheet_(root) {
  const it = root.getFilesByName(SHEET_NAME);
  if (it.hasNext()) return SpreadsheetApp.open(it.next());
  const ss = SpreadsheetApp.create(SHEET_NAME);
  DriveApp.getFileById(ss.getId()).moveTo(root);
  return ss;
}
