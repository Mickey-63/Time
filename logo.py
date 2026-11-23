# Produit time/giot.png et time/chat.png à partir du GIF d'origine : python3 logo.py time/logo.gif time
import sys
from PIL import Image, ImageSequence
import numpy as np
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src)
frames = [np.asarray(f.convert('RGB')).astype(np.float32) for f in ImageSequence.Iterator(im)]
def unmatte(a):
    a = np.clip(a * (255.0 / 252.0), 0, 255)           # le blanc du GIF vaut 252
    alpha = 1.0 - a.min(axis=2) / 255.0
    alpha[alpha < 0.04] = 0
    safe = np.where(alpha > 0, alpha, 1)[..., None]
    rgb = np.clip((a - 255.0 * (1 - alpha[..., None])) / safe, 0, 255)
    return rgb, alpha
# colonnes vides entre les lettres et l'emblème
ink = (frames[0].min(axis=2) < 200).any(axis=0)
cols = np.where(ink)[0]
gaps = [(cols[i], cols[i+1]) for i in range(len(cols)-1) if cols[i+1]-cols[i] > 8]
print('fin lettres / début emblème :', gaps[-1], 'étendue', cols[0], cols[-1])
cut = (gaps[-1][0] + gaps[-1][1]) // 2
# les lettres sont-elles fixes ?
print('lettres identiques sur toutes les images :', all(np.array_equal(frames[0][:, :cut], f[:, :cut]) for f in frames))
rgb, al = unmatte(frames[0][:, :cut])
rows = np.where(al.max(axis=1) > 0)[0]; print('lettres lignes', rows[0], rows[-1])
L = np.zeros((82, cut, 4), np.uint8); L[..., 0], L[..., 1], L[..., 2] = 226, 0, 11; L[..., 3] = np.round(al * 255)
Image.fromarray(L, 'RGBA').save(out + '/giot.png', optimize=True)
e0 = frames[0][:, cut:]
dark = e0.max(axis=2) < 60
top = int(np.where(dark.sum(axis=1) > 40)[0][0])          # première ligne largement noire
sq = np.where(dark[top + 1])[0]; left, right = int(sq[0]), int(sq[-1])
bottom = top
while bottom < 82 and dark[bottom, left + 1] and dark[bottom, right - 1]: bottom += 1
print('carré : lignes', top, bottom, 'colonnes', left, right)
print('bas du carré : ligne', bottom)
cat = []
for f in frames:
    rgb, al = unmatte(f[:, cut:])
    # nettoyage des restes de palette du GIF : tout ce qui n'est ni jaune ni rouge devient noir franc ;
    # sous le carré (corps et queue du chat) il n'y a que du noir.
    src = np.clip(f[:, cut:] * (255.0 / 252.0), 0, 255)
    flame = (rgb[..., 0] >= 130)
    flame[bottom - 2:, :] = False; flame[:top + 2, :] = False; flame[:, :left + 2] = False; flame[:, right - 1:] = False
    rgb[~flame] = 0
    al2 = 1.0 - src.mean(axis=2) / 255.0
    al[bottom:, :] = np.where(al2[bottom:, :] < 0.2, 0, al2[bottom:, :])
    c = np.dstack([np.round(rgb), np.round(al * 255)[..., None]]).astype(np.uint8)
    cat.append(Image.fromarray(c, 'RGBA'))
cat[0].save(out + '/chat.png', save_all=True, append_images=cat[1:], duration=200, loop=2, disposal=1, blend=0)
print('découpe à x =', cut, '| lettres', L.shape[1], 'x 82 | chat', cat[0].size)
