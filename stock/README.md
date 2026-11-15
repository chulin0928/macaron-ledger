# 台股盤後雷達

網址：https://chulin0928.github.io/macaron-ledger/stock/

| 分頁 | 做什麼 | 資料 |
|---|---|---|
| 選股 | 月營收 YoY 連續 3 個月正成長 + 站上季線（MA60），可疊加外資近 5 日買超、均量門檻 | 證交所、櫃買中心、公開資訊觀測站 |
| PTT 情緒 | Stock 板詞庫打分（推噓比加權）→ 恐懼貪婪指數，反向解讀 | PTT |
| 籌碼 | 自選股＋選股結果＋PTT 熱門股：10 日三大法人、融資變化、紅字訊號、歷史同訊號對照 | 證交所、櫃買中心 |
| 法說會 | 貼兩季逐字稿，比較閃避詞、主題回答長度、沒正面回答的問題（瀏覽器內計算） | 你貼的逐字稿 |

## 自動更新
`.github/workflows/stock-radar.yml` 每天 08:17、21:47（週一至五）台灣時間執行
`python -m stock.pipeline.run`，把結果寫進 `stock/data/` 並 commit。
在 GitHub → Actions → 「台股盤後雷達 daily update」→ Run workflow 可手動觸發。

## 設定
`stock/config.json`：自選股清單、紅字門檻（融資單日增幅 %）、情緒指數高低標。

## 同步到 Google 雲端硬碟
把 `stock/drive-sync.gs` 貼到 https://script.google.com 新專案，執行一次 `setup`。
之後每天 08:50、22:30 自動存一份日期資料夾（CSV + JSON）並更新「最新結果」試算表。

## 選用：FinMind token
公開資訊觀測站擋爬蟲時，月營收歷史會改由 FinMind 補。到 finmindtrade.com 免費註冊取得 token，
放到 GitHub repo → Settings → Secrets → Actions → `FINMIND_TOKEN`。

本工具僅供個人研究，不構成投資建議。
