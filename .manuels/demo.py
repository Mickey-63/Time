"""Données fictives pour les captures d'écran des modes d'emploi (aucune donnée réelle)."""
import json, urllib.request, datetime, sys
B = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8773/'
def api(a, body=None):
    r = urllib.request.Request(B + 'api.php?a=' + a, json.dumps(body).encode() if body is not None else None, {'Content-Type': 'application/json'})
    try: return json.load(urllib.request.urlopen(r))
    except urllib.error.HTTPError as e: return {'HTTP': e.code, **json.load(e)}
tok = api('setup', {'password': 'demo-manuel'})['token']
adr = ['RUE DU LAC 12 - NYON', 'GRAND-RUE 5 - GLAND', 'CHEMIN DES VIGNES 8 - ROLLE', 'PLACE DU MARCHE 3 - MORGES', 'AVENUE DE LA GARE 21 - LAUSANNE', 'ROUTE DE BERNE 40 - ECHALLENS', 'QUAI DU PORT 2 - VEVEY', 'RUE DU CHATEAU 9 - AUBONNE',
       'CHEMIN DU MOULIN 4 - PRANGINS', 'RUE DE LA GARE 7 - COPPET', 'ROUTE DE GENEVE 115 - MIES', 'RUE DU TEMPLE 3 - BEGNINS', 'CHEMIN DES PINS 16 - GINGINS', 'RUE DU VILLAGE 22 - ARZIER']
ds = {d['nom']: d['id'] for d in api('dos_import', {'token': tok, 'soc': 'gi', 'commun': False, 'items': [{'nom': a} for a in adr]})['dossiers']}
def emp(prenom, nom, pin, cs):
    e = api('emp_save', {'token': tok, 'emp': {'id': '', 'prenom': prenom, 'nom': nom, 'pin': pin, 'socs': ['gi'], 'tous': True, 'dossiers': [ds[c] for c in cs], 'midi': True, 'actif': True}})['emp']
    return e['id'], api('login', {'pid': e['id'], 'pin': pin})['token']
Z = datetime.timezone(datetime.timedelta(hours=1))
def ts(h, m, day=24): return int(datetime.datetime(2026, 11, day, h, m, 7, tzinfo=Z).timestamp() * 1000)
def push(t, evs, tag):
    out = []
    for i, e in enumerate(evs):
        o = {'id': 'demo%s%04d' % (tag, i), 'ts': e[0], 't': e[1], 'seq': i + 1, 'rev': 0}
        if e[1] == 'travail': o['d'] = ds[e[2]]; o['lieu'] = e[3]
        if e[1] == 'pause': o['cat'] = e[2]; o['motif'] = e[3]
        out.append(o)
    r = api('sync', {'token': t, 'events': out}); assert len(r['events']) >= len(out), r
_, a = emp('Anna', 'Exemple', '1111', ['RUE DU LAC 12 - NYON'])
push(a, [(ts(7, 52), 'travail', 'Travail courant', 'bureau'), (ts(8, 20), 'travail', 'RUE DU LAC 12 - NYON', 'bureau'), (ts(10, 5), 'pause', 'pause', 'Pause'), (ts(10, 20), 'travail', 'RUE DU LAC 12 - NYON', 'bureau'),
         (ts(11, 10), 'travail', 'GRAND-RUE 5 - GLAND', 'mission'), (ts(12, 5), 'pause', 'midi', 'Midi'), (ts(13, 5), 'travail', 'GRAND-RUE 5 - GLAND', 'mission'), (ts(13, 50), 'travail', 'Véhicules', 'bureau')], 'a')
_, m = emp('Marc', 'Modèle', '2222', [])
push(m, [(ts(7, 30), 'travail', 'Travail courant', 'bureau'), (ts(12, 0), 'pause', 'midi', 'Midi'), (ts(13, 0), 'travail', 'Travail courant', 'bureau')], 'm')
_, z = emp('Zoé', 'Essai', '3333', [])
push(z, [(ts(8, 0), 'travail', 'Travail courant', 'bureau'), (ts(9, 10), 'travail', 'QUAI DU PORT 2 - VEVEY', 'mission'), (ts(12, 15), 'pause', 'midi', 'Midi'), (ts(13, 15), 'travail', 'QUAI DU PORT 2 - VEVEY', 'mission')], 'z')
_, l = emp('Luc', 'Démo', '4444', [])
# Luc : quelques jours d'habitudes, pour que ses bâtiments habituels apparaissent
h = []
for day, c in ((19, 'GRAND-RUE 5 - GLAND'), (20, 'GRAND-RUE 5 - GLAND'), (23, 'CHEMIN DU MOULIN 4 - PRANGINS')):
    h += [(ts(8, 0, day), 'travail', 'Travail courant', 'bureau'), (ts(9, 0, day), 'travail', c, 'mission'), (ts(12, 0, day), 'pause', 'midi', 'Midi'), (ts(13, 0, day), 'travail', c, 'mission'), (ts(16, 30, day), 'fin')]
push(l, h, 'l')
print([(p['prenom'], p['code'], p['dossier']) for p in api('etat')['people']])
