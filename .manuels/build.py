"""Produit les deux modes d'emploi PDF publiés dans time/ à partir de detail.html et nuls.html.
Usage : python3 .manuels/build.py   (Chrome et Playwright requis). Les captures d'écran sont dans .manuels/img/."""
import pathlib
from playwright.sync_api import sync_playwright
ICI = pathlib.Path(__file__).resolve().parent
SORTIE = ICI.parent / 'time'
DOCS = [('detail.html', 'giotimepro-mode-emploi.pdf', 'GIOTimePRO · Mode d’emploi'), ('nuls.html', 'giotimepro-pour-les-nuls.pdf', '')]
PIED = '<div style="width:100%%;font-family:Liberation Sans,Arial,sans-serif;font-size:7.5pt;color:#5a6777;padding:0 15mm;display:flex;justify-content:space-between"><span>%s</span><span>page <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    pg = b.new_page()
    for src, dst, pied in DOCS:
        pg.goto((ICI / src).as_uri()); pg.wait_for_load_state('networkidle')
        pg.pdf(path=str(SORTIE / dst), format='A4', print_background=True, prefer_css_page_size=True,
               display_header_footer=bool(pied), header_template='<span></span>', footer_template=PIED % pied if pied else '<span></span>')
        print(dst, 'écrit')
    b.close()
