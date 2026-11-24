"""Captures d'écran des modes d'emploi, prises sur un site de démonstration local (voir demo.py)."""
import sys
from playwright.sync_api import sync_playwright
OUT = '/home/claude/time/.manuels/img/'
B = 'http://127.0.0.1:8773/'
OFF = int(open('off.txt').read())
INIT = "(() => { const off = %d, D = Date; class F extends D { constructor(...a) { if (a.length) super(...a); else super(D.now() + off); } static now() { return D.now() + off; } } window.Date = F; })();" % OFF
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    def phone(h=760):
        c = b.new_context(viewport={'width': 390, 'height': h}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme='light'); c.add_init_script(INIT); c.route('**/fonts.g*', lambda r: r.abort()); return c.new_page()
    def login(pg, label, pin):
        pg.goto(B + 'index.html'); pg.wait_for_selector('#lg-pid'); pg.select_option('#lg-pid', label=label); pg.fill('#lg-pin', pin)
    def top(pg): pg.evaluate("document.getElementById('main').scrollTop = 0")
    errs = []
    pg = phone(640); pg.on('pageerror', lambda e: errs.append(str(e))); login(pg, 'Luc Démo', '4444'); pg.screenshot(path=OUT + 'connexion.png')
    pg.click('[data-act=login]'); pg.wait_for_selector('.resume'); pg.set_viewport_size({'width': 390, 'height': 760}); pg.wait_for_timeout(300); pg.screenshot(path=OUT + 'commencer.png')
    pg.click('.resume'); pg.wait_for_timeout(700); pg.screenshot(path=OUT + 'courant.png')
    pg.evaluate("document.getElementById('main').scrollTop = 9999"); pg.wait_for_timeout(200); pg.screenshot(path=OUT + 'centres.png'); top(pg)
    pg.click('.cmd [data-act=bat]'); pg.wait_for_selector('.blist'); pg.wait_for_timeout(200); pg.screenshot(path=OUT + 'batiments.png')
    pg.click('.brow:has-text("RUE DU LAC 12")'); pg.wait_for_timeout(500); pg.click('[data-l=mission]'); pg.wait_for_timeout(600); top(pg); pg.screenshot(path=OUT + 'centre.png')
    pg.click('[data-act=pause]'); pg.wait_for_timeout(600); pg.screenshot(path=OUT + 'pause.png')
    pg2 = phone(900); pg2.on('pageerror', lambda e: errs.append(str(e))); login(pg2, 'Anna Exemple', '1111'); pg2.click('[data-act=login]'); pg2.wait_for_selector('.dos')
    pg2.click('[data-t=journee]'); pg2.wait_for_timeout(500); pg2.screenshot(path=OUT + 'journee.png')
    c = b.new_context(viewport={'width': 1180, 'height': 470}, device_scale_factor=2, color_scheme='light'); c.add_init_script(INIT); c.route('**/fonts.g*', lambda r: r.abort())
    pg3 = c.new_page(); pg3.goto(B + 'etat.html'); pg3.wait_for_selector('.btile'); pg3.wait_for_timeout(300); pg3.screenshot(path=OUT + 'equipe.png')
    pg4 = phone(560); pg4.on('pageerror', lambda e: errs.append(str(e))); pg4.goto(B + 'admin.html'); pg4.wait_for_selector('#pw'); pg4.screenshot(path=OUT + 'admin-connexion.png')
    pg4.set_viewport_size({'width': 390, 'height': 800}); pg4.fill('#pw', 'demo-manuel'); pg4.click('[data-act=alogin]'); pg4.wait_for_selector('nav.tabs'); pg4.wait_for_timeout(200); pg4.screenshot(path=OUT + 'admin-employes.png')
    pg4.click('.lst .row:has-text("Anna Exemple") [data-act=emp-edit]'); pg4.wait_for_timeout(300); pg4.evaluate("document.querySelector('.sheet').scrollTop = 9999"); pg4.wait_for_timeout(200); pg4.screenshot(path=OUT + 'admin-fiche.png'); pg4.click('[data-act=close]')
    pg4.click('[data-t=dossiers]'); pg4.wait_for_timeout(300); pg4.screenshot(path=OUT + 'admin-centres.png')
    pg4.click('[data-t=export]'); pg4.wait_for_timeout(300); pg4.screenshot(path=OUT + 'admin-export.png')
    pg4.set_viewport_size({'width': 390, 'height': 860}); pg4.click('[data-t=absences]'); pg4.wait_for_timeout(300); pg4.screenshot(path=OUT + 'admin-absences.png')
    print('erreurs :', errs); b.close()
