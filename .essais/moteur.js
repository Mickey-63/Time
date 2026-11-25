// Essais du moteur : midi obligatoire entre 11 h et 14 h 30, pauses comptées, retenue dans l'export, minutes entières.
// Usage : cd .essais && node moteur.js
require('../time/engine.js'); require('../time/xlsx.js');
const E = globalThis.Engine, assert = require('assert'), fs = require('fs');
let n = 0;
const T = (d, hm) => E.atTime(d, hm);
function evs(list) { return list.map((e, i) => Object.assign({ id: 'ev' + (++n), pid: 'p1', seq: i + 1, rev: 0 }, e)); }
const W = (d, hm, c) => ({ ts: T(d, hm), t: 'travail', d: c || 'c1', lieu: 'bureau' });
const M = (d, hm) => ({ ts: T(d, hm), t: 'pause', cat: 'midi', motif: 'Midi' });
const P = (d, hm) => ({ ts: T(d, hm), t: 'pause', cat: 'pause', motif: 'Pause' });
const F = (d, hm) => ({ ts: T(d, hm), t: 'fin' });
const R = { min: 60, exMin: 0, payees: 30 }, FIN = T('2026-12-31', '23:00');
const bj = (l, r) => E.bilanJours(evs(l), FIN, r || R);
const min = ms => Math.round(ms / 60000);
const D = '2026-12-01'; // mardi
let r;
// 1. midi de 60 : rien
r = bj([W(D, '08:00'), M(D, '12:00'), W(D, '13:00'), F(D, '17:00')]); assert.equal(r.length, 1); assert.equal(r[0].kind, 'ok'); assert.equal(r[0].manque, 0); assert.equal(min(r[0].retenu), 480);
// 2. midi de 40 : 20 retenues
r = bj([W(D, '08:00'), M(D, '12:00'), W(D, '12:40'), F(D, '17:00')]); assert.equal(r[0].kind, 'retenue'); assert.equal(min(r[0].manque), 20); assert.equal(min(r[0].pris), 40); assert.equal(min(r[0].retenu), 500 - 20);
// 3. aucune pause, 8 h – 17 h : 60 retenues
r = bj([W(D, '08:00'), F(D, '17:00')]); assert.equal(min(r[0].manque), 60); assert.equal(r[0].pris, 0);
// 4. matin seul (7 h – 13 h 45) et 5. après-midi seul : midi non exigé
assert.equal(bj([W(D, '07:00'), F(D, '13:45')])[0].kind, 'libre');
assert.equal(bj([W(D, '12:30'), F(D, '18:00')])[0].kind, 'libre');
// 6. bouton Pause utilisé à midi pendant 65 min : c'est le midi, il n'est pas compté comme travail
r = bj([W(D, '08:00'), P(D, '12:00'), W(D, '13:05'), F(D, '17:00')]); assert.equal(r[0].kind, 'ok'); assert.equal(r[0].payee, 0);
// 7. fin de journée à midi puis reprise 60 min plus tard : compte
assert.equal(bj([W(D, '08:00'), F(D, '12:00'), W(D, '13:00'), F(D, '17:00')])[0].kind, 'ok');
// 8. midi 10 min puis fin (oubli), reprise à 13 h : l'interruption entière compte (60)
assert.equal(bj([W(D, '08:00'), M(D, '12:00'), F(D, '12:10'), W(D, '13:00'), F(D, '17:00')])[0].kind, 'ok');
// 9. pause de 15 min à 9 h 30 (comptée comme travail) et midi de 30 : 30 retenues
r = bj([W(D, '08:00'), P(D, '09:30'), W(D, '09:45'), M(D, '12:00'), W(D, '12:30'), F(D, '17:00')]); assert.equal(min(r[0].manque), 30); assert.equal(min(r[0].payee), 15);
assert.equal(min(r[0].travail), 495); assert.equal(min(r[0].retenu), 495 + 15 - 30);
// 10. PLAGE 11 h – 14 h 30 : un midi de 14 h à 15 h ne compte que pour 30 min ; un midi à 15 h 30 ne compte pas
r = bj([W(D, '08:00'), M(D, '14:00'), W(D, '15:00'), F(D, '18:00')]); assert.equal(min(r[0].pris), 30); assert.equal(min(r[0].manque), 30);
r = bj([W(D, '08:00'), M(D, '15:30'), W(D, '16:30'), F(D, '18:00')]); assert.equal(r[0].pris, 0); assert.equal(min(r[0].manque), 60);
r = bj([W(D, '08:00'), M(D, '10:30'), W(D, '11:45'), F(D, '17:00')]); assert.equal(min(r[0].pris), 45); // 10 h 30 – 11 h 45 : 45 min dans la plage
r = bj([W(D, '08:00'), M(D, '13:30'), W(D, '14:30'), F(D, '17:00')]); assert.equal(r[0].kind, 'ok');   // 13 h 30 – 14 h 30 : juste dans la plage
// 11. changement de centre sans interruption : pas une pause
r = bj([W(D, '08:00'), W(D, '10:00', 'c2'), M(D, '12:00'), W(D, '12:45', 'c2'), F(D, '17:00')]); assert.equal(min(r[0].manque), 15);
// 12. exception hebdomadaire : un midi de 40 par semaine passe, le deuxième est retenu, moins de 30 est retenu
const sem = [W('2026-12-01', '08:00'), M('2026-12-01', '12:00'), W('2026-12-01', '12:40'), F('2026-12-01', '17:00'),
             W('2026-12-02', '08:00'), M('2026-12-02', '12:00'), W('2026-12-02', '12:45'), F('2026-12-02', '17:00'),
             W('2026-12-07', '08:00'), M('2026-12-07', '12:00'), W('2026-12-07', '12:20'), F('2026-12-07', '17:00'),
             W('2026-12-08', '08:00'), M('2026-12-08', '12:00'), W('2026-12-08', '12:35'), F('2026-12-08', '17:00')];
r = bj(sem, { min: 60, exMin: 30 });
assert.deepEqual(r.map(x => x.kind), ['exception', 'retenue', 'retenue', 'exception']); assert.deepEqual(r.map(x => min(x.manque)), [0, 15, 40, 0]);
// 13. date de début : midi non exigé avant
r = bj(sem, { min: 60, exMin: 0, depuis: '2026-12-07' }); assert.deepEqual(r.map(x => x.kind), ['libre', 'libre', 'retenue', 'retenue']);
// 14. journée en cours, en pause de midi depuis 20 min : rien d'exigé tant qu'on n'a pas retravaillé après 14 h
assert.equal(E.bilanJours(evs([W(D, '08:00'), M(D, '12:00')]), T(D, '12:20'), R)[0].kind, 'libre');
// 15. travail sans pause, il est 14 h 30 : 60 retenues, provisoire
r = E.bilanJours(evs([W(D, '08:00')]), T(D, '14:30'), R); assert.equal(min(r[0].manque), 60); assert.equal(r[0].open, true);
// 16. midi commencé à 14 h 10, encore en cours à 15 h 15 : seules 20 min (14 h 10 – 14 h 30) comptent
r = E.bilanJours(evs([W(D, '08:00'), W(D, '14:05'), M(D, '14:10')]), T(D, '15:15'), R); assert.equal(min(r[0].pris), 20); assert.equal(min(r[0].manque), 40);
// 17. horaires libres : 9–11 puis 15–18, grande coupure : ok ; soirée 20 h – 2 h : midi non exigé
assert.equal(bj([W(D, '09:00'), F(D, '11:00'), W(D, '15:00'), F(D, '18:00')])[0].kind, 'ok');
assert.deepEqual(bj([W(D, '20:00'), F('2026-12-02', '02:00')]).map(x => x.kind), ['libre', 'libre']);
// 18. règle du midi à 0 : coupée
assert.equal(bj([W(D, '08:00'), F(D, '17:00')], { min: 0 })[0].kind, 'libre');
// 19. PAUSES COMPTÉES : deux pauses de 15 min comptent (30) ; 20 + 25 min : plafond de 30 ; plafond à 0 : rien ; le midi ne compte jamais
r = bj([W(D, '08:00'), P(D, '09:30'), W(D, '09:45'), M(D, '12:00'), W(D, '13:00'), P(D, '15:30'), W(D, '15:45'), F(D, '17:00')]);
assert.equal(min(r[0].payee), 30); assert.equal(min(r[0].travail), 450); assert.equal(min(r[0].retenu), 480); assert.equal(min(r[0].pauses), 90);
r = bj([W(D, '08:00'), P(D, '09:30'), W(D, '09:50'), M(D, '12:00'), W(D, '13:00'), P(D, '15:30'), W(D, '15:55'), F(D, '17:00')]); assert.equal(min(r[0].payee), 30);
r = bj([W(D, '08:00'), P(D, '09:30'), W(D, '09:45'), F(D, '12:00')], { min: 60, payees: 0 }); assert.equal(r[0].payee, 0);
r = bj([W(D, '07:00'), P(D, '09:30'), W(D, '09:45'), F(D, '12:00')]); assert.equal(r[0].kind, 'libre'); assert.equal(min(r[0].payee), 15); // demi-journée : la pause compte
// pause de 10 min à 11 h 15 puis vrai midi 12 h – 13 h : la petite pause est comptée, le midi non
r = bj([W(D, '08:00'), P(D, '11:15'), W(D, '11:25'), M(D, '12:00'), W(D, '13:00'), F(D, '17:00')]); assert.equal(r[0].kind, 'ok'); assert.equal(min(r[0].payee), 10);
console.log('bilanJours : 19 séries passées');

// Classeur
const people = [{ id: 'p1', prenom: 'Anna', nom: 'Exemple', socs: ['gi'], midi: true, actif: true }, { id: 'p2', prenom: 'Marc', nom: 'Modèle', socs: ['gi'], midi: false, actif: true }];
const dossiers = { c1: { id: 'c1', nom: 'Travail courant', code: '', soc: 'gi', commun: true, defaut: true, actif: true }, c2: { id: 'c2', nom: 'RUE DU LAC 12 - NYON', code: 'LAC12', soc: 'gi', actif: true } };
const data = { p1: evs(sem.concat([W('2026-12-09', '08:00'), P('2026-12-09', '10:00'), W('2026-12-09', '10:15'), M('2026-12-09', '12:00'), W('2026-12-09', '13:00'), F('2026-12-09', '17:00')])).map(e => Object.assign(e, { pid: 'p1' })),
               p2: evs([W(D, '08:00'), P(D, '10:00'), W(D, '10:20'), F(D, '17:00')]).map(e => Object.assign(e, { pid: 'p2' })) };
const wb = E.workbook({ people, dossiers, socs: { gi: { nom: 'GIOT Immobilier SA' } }, evs: pid => data[pid], absences: [], regles: { midiMin: 60, midiEx: 30, midiDepuis: '', pausesPayees: 30 } }, { from: '2026-12-01', to: '2026-12-31', pid: '', soc: '' }, FIN);
const det = wb.sheets[0].rows, ret = det.filter(r => r[8] && r[8].v === 'Retenue midi'), pay = det.filter(r => r[8] && r[8].v === 'Pauses comptées');
assert.equal(ret.length, 2); assert.deepEqual(ret.map(r => r[10].v), [-15, -40]); assert.deepEqual(ret.map(r => r[9].v), ['−0:15', '−0:40']); assert.equal(det[1][11], 'Terminée');
assert.equal(min(wb.totals.retenues), 55);
assert.deepEqual(pay.map(r => [r[2], r[10].v]), [['Marc Modèle', 20], ['Anna Exemple', 15]]); assert.equal(min(wb.totals.payees), 35);
// Marc (dispensé du midi) : aucune retenue malgré une journée sans midi, mais sa pause compte
assert.equal(det.filter(r => r[2] === 'Marc Modèle' && r[8] && r[8].v === 'Retenue midi').length, 0);
const pc = wb.sheets[2].rows; console.log(pc.map(r => r.map(c => c && typeof c === 'object' ? (typeof c.v === 'number' && c.v < 5 ? E.dur(c.v * E.DAY) : c.v) : c).join(' | ')).join('\n'));
assert.equal(Math.round(wb.totals.detailTravail / 60000), Math.round(wb.totals.parCollab / 60000));
fs.writeFileSync('/tmp/essai-giotimepro.xlsx', globalThis.XlsxLite.build(wb.sheets));
console.log('classeur écrit,', det.length - 1, 'lignes');

// Secondes : 08:00:59 – 09:26:10 se lit 08:00 – 09:26, soit 1:26 et 86 minutes entières
{
  const t0 = T(D, '08:00') + 59000, t1 = T(D, '09:26') + 10000, t2 = T(D, '09:26') + 40000;
  const ev = [{ id: 'sec001', pid: 'p9', ts: t0, t: 'travail', d: 'c1', lieu: 'bureau', seq: 1, rev: 0 }, { id: 'sec002', pid: 'p9', ts: t1, t: 'travail', d: 'c2', lieu: 'bureau', seq: 2, rev: 0 }, { id: 'sec003', pid: 'p9', ts: t2, t: 'fin', seq: 3, rev: 0 }];
  const w2 = E.workbook({ people: [{ id: 'p9', prenom: 'Sec', nom: 'Onde', socs: ['gi'], midi: true }], dossiers, socs: { gi: { nom: 'GIOT Immobilier SA' } }, evs: () => ev, absences: [], regles: { midiMin: 60 } }, { from: D, to: D }, FIN);
  const rows = w2.sheets[0].rows.slice(1);
  assert.equal(rows.length, 1, 'la plage de 30 secondes dans la même minute ne sort pas');
  assert.equal(rows[0][10].v, 86); assert.equal(rows[0][10].s, 9); assert.equal(rows[0][9].s, 8); assert.equal(Math.round(rows[0][9].v * 1440 * 1000) / 1000, 86);
  // midi de 12:00:30 à 13:00:10 : 60 minutes à l'affichage, donc aucune retenue
  r = E.bilanJours([{ id: 'm1', ts: T(D, '08:00'), t: 'travail', d: 'c1' }, { id: 'm2', ts: T(D, '12:00') + 30000, t: 'pause', cat: 'midi' }, { id: 'm3', ts: T(D, '13:00') + 10000, t: 'travail', d: 'c1' }, { id: 'm4', ts: T(D, '17:00'), t: 'fin' }], FIN, R);
  assert.equal(r[0].kind, 'ok');
  console.log('minutes entières : passé');
}

// Pointages de moins de 20 secondes : ignorés
{
  const S = (hm, s) => T(D, hm) + s * 1000, k = (ts, o) => Object.assign({ id: 'k' + ts, pid: 'p1', ts, seq: 0, rev: 0 }, o);
  const tr = (ts, d, lieu) => k(ts, { t: 'travail', d, lieu: lieu || 'bureau' });
  // 08:00:08 centre par défaut, 08:00:15 le bon chantier (7 s plus tard), 08:30:00 un autre effleuré 18 s, puis retour, pause par erreur 5 s
  const ev = [tr(S('08:00', 8), 'c1'), tr(S('08:00', 15), 'c2'), tr(S('08:30', 0), 'c1'), tr(S('08:30', 18), 'c2'),
              k(S('09:00', 0), { t: 'pause', cat: 'pause' }), tr(S('09:00', 5), 'c2'), k(S('12:00', 0), { t: 'fin' })];
  const seg = E.segments(ev, FIN);
  assert.deepEqual(seg.map(x => [x.d, E.hhmm(x.start), E.hhmm(x.end)]), [['c2', '08:00', '08:30'], ['c2', '08:30', '09:00'], ['c2', '09:00', '12:00']]);
  assert.equal(E.sessions(ev).length, 1); assert.equal(E.sessions(ev)[0].d, 'c2');
  // exactement 20 secondes : le pointage compte ; le dernier pointage compte toujours
  assert.equal(E.retenus([tr(S('08:00', 0), 'c1'), tr(S('08:00', 20), 'c2')]).length, 2); assert.equal(E.retenus([tr(S('08:00', 0), 'c1'), tr(S('08:00', 19), 'c2')]).length, 1);
  assert.equal(E.retenus([tr(S('08:00', 0), 'c1')]).length, 1);
  assert.equal(E.statusOf(ev.slice(0, 2)).d, 'c2');
  console.log('pointages de moins de 20 secondes : passé');
}
