"""Produit les trois PDF publiés dans time/ (modes d'emploi : detail.html et nuls.html ; règles du travail : regles.html), puis leurs pages en images
dans time/aide/ (lues par aide.html). Usage : python3 .manuels/build.py   (Chrome, Playwright et pdftoppm requis).
Les captures d'écran sont dans .manuels/img/. Reporter ensuite le nombre de pages et la version dans MANUELS (commun.js)."""
import pathlib, subprocess
from playwright.sync_api import sync_playwright
ICI = pathlib.Path(__file__).resolve().parent
SORTIE = ICI.parent / 'time'
DOCS = [('detail.html', 'giotimepro-mode-emploi.pdf', 'GIOTimePRO · Mode d’emploi'), ('nuls.html', 'giotimepro-pour-les-nuls.pdf', ''),
        ('regles.html', 'giotimepro-regles-travail.pdf', 'GIOTimePRO · Règles du travail · La personne responsable des RH se tient à disposition pour les expliquer')]
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
AIDE = SORTIE / 'aide'; AIDE.mkdir(exist_ok=True)
for cle, pdf in (('detail', 'giotimepro-mode-emploi.pdf'), ('nuls', 'giotimepro-pour-les-nuls.pdf'), ('regles', 'giotimepro-regles-travail.pdf')):
    for f in AIDE.glob(cle + '-*.jpg'): f.unlink()
    subprocess.run(['pdftoppm', '-r', '140', '-jpeg', '-jpegopt', 'quality=84,progressive=y', str(SORTIE / pdf), str(AIDE / ('tmp-' + cle))], check=True)
    pages = sorted(AIDE.glob('tmp-' + cle + '-*.jpg'))
    for i, f in enumerate(pages, 1): f.rename(AIDE / ('%s-%d.jpg' % (cle, i)))
    print(cle, ':', len(pages), 'page(s) en images')
