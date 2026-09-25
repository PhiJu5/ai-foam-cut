# BENUTZERHANDBUCH.md -> BENUTZERHANDBUCH.pdf (Playwright)
import markdown, pathlib
from playwright.sync_api import sync_playwright
R = pathlib.Path(__file__).resolve().parent.parent
md = (R/'BENUTZERHANDBUCH.md').read_text('utf-8')
body = markdown.markdown(md, extensions=['tables','toc','md_in_html'])
css = """body{font-family:'Segoe UI',Arial,sans-serif;font-size:10.5pt;line-height:1.45;color:#222}
h1{color:#1a5fb4;border-bottom:2px solid #1a5fb4}h2{color:#1a5fb4;margin-top:1.6em;border-bottom:1px solid #ccc;page-break-after:avoid}
h2{page-break-before:always}h1+p+p+hr+h2{page-break-before:auto}h3{page-break-after:avoid}
img{max-width:100%;border:1px solid #bbb;page-break-inside:avoid;margin:6px 0}
table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #ccc;padding:3px 7px;vertical-align:top}th{background:#eef3fa}
code{background:#f2f2f2;padding:0 3px}hr{border:0;border-top:1px solid #ddd}a{color:#1a5fb4;text-decoration:none}"""
html = f"<html><head><meta charset='utf-8'><base href='{R.as_uri()}/'><style>{css}</style></head><body>{body}</body></html>"
tmp = R/'handbuch_bilder'/'_tmp_handbuch.html'; tmp.write_text(html,'utf-8')
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(); pg.goto(tmp.as_uri()); pg.wait_for_timeout(800)
    pg.pdf(path=str(R/'BENUTZERHANDBUCH.pdf'), format='A4', margin={'top':'18mm','bottom':'18mm','left':'16mm','right':'16mm'},
      display_header_footer=True, header_template='<span></span>',
      footer_template='<div style="font-size:8pt;width:100%;text-align:center;color:#888">AI Foam Cut – Benutzerhandbuch · Seite <span class="pageNumber"></span>/<span class="totalPages"></span></div>')
    b.close()
tmp.unlink()
