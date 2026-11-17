"""Bundle the dashboard into one page + data file for publishing as a Claude Artifact."""
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "artifact"

html = (ROOT / "index.html").read_text("utf-8")
css = (ROOT / "style.css").read_text("utf-8")
js = (ROOT / "app.js").read_text("utf-8")

title = re.search(r"<title>.*?</title>", html, re.S).group(0)
fonts = re.search(r'<link rel="stylesheet" href="https://fonts.googleapis.com[^>]+>', html).group(0)
body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
body = body.replace('<script src="app.js"></script>', "")
body = body.replace("每個交易日晚上與早上自動更新。結果同步存到 Google 雲端硬碟。", "每天自動更新，結果同步存到 Google 雲端硬碟。")

page = f"""{title}
<meta name="claude:viewport-fit-sides" content="cover">
{fonts}
<style>
{css}
</style>
{body}
<script>
{js}
</script>
"""
OUT.mkdir(exist_ok=True)
(OUT / "index.html").write_text(page, "utf-8")
(OUT / "data").mkdir(exist_ok=True)
shutil.copy(ROOT / "data" / "latest.json", OUT / "data" / "latest.json")
print("built", OUT / "index.html", len(page))
