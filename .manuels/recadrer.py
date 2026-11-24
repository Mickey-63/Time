"""Recadre les captures brutes (captures.py) pour les deux modes d'emploi. À lancer depuis .manuels/ après captures.py."""
from PIL import Image
D = 'img/'
def crop(src, dst, box): Image.open(D + src + '.png').crop(box).save(D + dst + '.png', optimize=True)
for n in ('commencer', 'courant', 'centre', 'pause', 'connexion'): crop(n, 'n-' + n, (0, 0, 780, 920))
crop('batiments', 'n-batiments', (0, 300, 780, 1220)); crop('centre', 'n-fin', (0, 1250, 780, 1520))
crop('journee', 'd-journee', (0, 0, 780, 1500)); crop('admin-fiche', 'd-fiche', (0, 130, 780, 1600)); crop('admin-centres', 'd-centres', (0, 0, 780, 1500)); crop('admin-export', 'd-export', (0, 0, 780, 1330)); crop('admin-absences', 'd-absences', (0, 150, 780, 1600))
