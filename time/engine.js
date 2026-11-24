/* Moteur de pointage — fonctions pures, sans DOM.
   Les événements sont horodatés en instants absolus (ms epoch).
   Les journées et les exports sont calculés dans le fuseau Europe/Zurich. */
(function (G) {
  'use strict';
  var TZ = 'Europe/Zurich';
  var MIN = 60000, H = 3600000, DAY = 86400000;
  var fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function parts(ts) {
    var o = {}, p = fmt.formatToParts(new Date(ts));
    for (var i = 0; i < p.length; i++) if (p[i].type !== 'literal') o[p[i].type] = +p[i].value;
    return o;
  }
  // Heure murale suisse exprimée comme si elle était UTC (sert aux numéros de série Excel).
  function localAsUTC(ts) {
    var p = parts(ts);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) + (ts % 1000 + 1000) % 1000;
  }
  function offset(ts) { return localAsUTC(ts) - ts; }
  function fromLocal(y, m, d, h, mi, s) {
    var guess = Date.UTC(y, m - 1, d, h || 0, mi || 0, s || 0);
    var t = guess - offset(guess);
    return guess - offset(t);
  }
  function dayKey(ts) { var p = parts(ts); return p.year + '-' + pad(p.month) + '-' + pad(p.day); }
  function dayStart(key) { var a = key.split('-'); return fromLocal(+a[0], +a[1], +a[2]); }
  function nextDayStart(ts) { var p = parts(ts); return fromLocal(p.year, p.month, p.day + 1); }
  function addDays(key, n) { var a = key.split('-'); return dayKey(fromLocal(+a[0], +a[1], +a[2] + n, 12)); }
  function weekKey(ts) {
    var k = dayKey(ts), dow = new Date(localAsUTC(ts)).getUTCDay(); // 0 = dimanche
    return addDays(k, -((dow + 6) % 7)); // lundi de la semaine
  }
  function hhmm(ts) { var p = parts(ts); return pad(p.hour) + ':' + pad(p.minute); }
  function atTime(key, hm) { var a = key.split('-'), b = hm.split(':'); return fromLocal(+a[0], +a[1], +a[2], +b[0], +b[1]); }
  function excelSerial(ts) { return localAsUTC(ts) / DAY + 25569; }
  function excelDate(key) { var a = key.split('-'); return Date.UTC(+a[0], +a[1] - 1, +a[2]) / DAY + 25569; }
  // Affichage seulement : le calcul garde les millisecondes.
  function dur(ms) {
    var m = Math.round(ms / MIN), h = Math.floor(m / 60);
    return h + ' h ' + pad(m % 60);
  }
  function frDate(key) {
    var a = key.split('-');
    var d = new Date(Date.UTC(+a[0], +a[1] - 1, +a[2]));
    var j = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'][d.getUTCDay()];
    return j + ' ' + a[2] + '.' + a[1] + '.' + a[0];
  }

  /* ---------- événements → intervalles ---------- */
  function sortEvents(evs) {
    return evs.slice().sort(function (a, b) {
      return a.ts - b.ts || (a.seq || 0) - (b.seq || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
  }
  // Un intervalle = de l'événement jusqu'au suivant. « fin » n'ouvre rien.
  function segments(evs, now) {
    var s = sortEvents(evs), out = [];
    for (var i = 0; i < s.length; i++) {
      var e = s[i], n = s[i + 1];
      if (e.t === 'fin') continue;
      var end = n ? n.ts : Math.max(now, e.ts);
      out.push({
        pid: e.pid, evId: e.id, endEvId: n ? n.id : null, start: e.ts, end: end, open: !n,
        t: e.t, d: e.d || null, lieu: e.lieu || null, cat: e.cat || null,
        corr: !!(e.hist && e.hist.length) || !!(n && n.hist && n.hist.length)
      });
    }
    return out;
  }
  // Un passage à minuit est ventilé sur les deux dates locales.
  function splitByDay(seg) {
    var out = [], a = seg.start;
    for (;;) {
      var nd = nextDayStart(a);
      if (seg.end <= nd) { out.push(Object.assign({}, seg, { start: a, end: seg.end, date: dayKey(a) })); break; }
      out.push(Object.assign({}, seg, { start: a, end: nd, date: dayKey(a), open: false }));
      a = nd;
    }
    return out;
  }
  function pieces(evs, now) {
    var out = [];
    segments(evs, now).forEach(function (s) { splitByDay(s).forEach(function (p) { out.push(p); }); });
    return out;
  }
  /* Interventions : une suite d'écritures de travail sur le même centre, pauses comprises, jusqu'au changement de centre
     ou à la fin de journée. La note de fin de travail et le code d'intervention (D devis, R régie, G garantie) portent sur l'intervention. */
  function sessions(evs) {
    var s = sortEvents(evs), out = [], cur = null;
    function close(ts) { if (cur) { cur.end = ts; cur.closed = true; out.push(cur); cur = null; } }
    s.forEach(function (e) {
      if (e.t === 'travail') {
        if (cur && cur.d === e.d) { cur.ids.push(e.id); cur.carrier = e.id; }
        else { close(e.ts); cur = { d: e.d, ids: [e.id], carrier: e.id, start: e.ts, end: null, closed: false, note: '', ci: '' }; }
        if (e.note) cur.note = e.note;
        if (e.ci) cur.ci = e.ci;
      } else if (e.t !== 'pause') close(e.ts);
    });
    if (cur) out.push(cur);
    return out;
  }
  var CODES = { D: 'Devis', R: 'Régie', G: 'Garantie' };
  function statusOf(evs) {
    var s = sortEvents(evs), e = s[s.length - 1];
    if (!e || e.t === 'fin') return { code: 'absent', t: 'absent', since: e ? e.ts : null };
    if (e.t === 'travail') return { code: e.lieu === 'mission' ? 'mission' : 'bureau', t: 'travail', d: e.d, lieu: e.lieu, since: e.ts };
    return { code: 'pause', t: e.t, cat: e.cat || null, since: e.ts };
  }
  var LABEL = { bureau: 'Au bureau', mission: 'En déplacement professionnel', pause: 'En pause', absent: 'Absent' };

  /* ---------- actions du collaborateur ----------
     Renvoie { ev, ctx } ; ev = null si l'action ne change rien (double appui). */
  function act(evs, ctx, a, now, mk) {
    var cur = statusOf(evs), s = sortEvents(evs), last = s[s.length - 1];
    var ts = last ? Math.max(now, last.ts + 1) : now; // jamais d'intervalle négatif
    function ev(o) { return Object.assign({ ts: ts }, o, mk ? mk() : {}); }
    if (a.type === 'dossier') {
      var lieu = a.lieu || (cur.t === 'travail' ? cur.lieu : (ctx && ctx.lieu)) || 'bureau';
      if (cur.t === 'travail' && cur.d === a.d && cur.lieu === lieu) return { ev: null, ctx: ctx };
      return { ev: ev({ t: 'travail', d: a.d, lieu: lieu }), ctx: null };
    }
    if (a.type === 'lieu') {
      if (cur.t !== 'travail' || cur.lieu === a.lieu) return { ev: null, ctx: ctx };
      return { ev: ev({ t: 'travail', d: cur.d, lieu: a.lieu }), ctx: null };
    }
    if (a.type === 'pause') { // appel privé, pause, midi : même mécanique
      if (cur.t !== 'travail') return { ev: null, ctx: ctx };
      return { ev: ev({ t: 'pause', cat: a.cat === 'midi' ? 'midi' : 'pause', motif: a.motif || 'Pause' }), ctx: { d: cur.d, lieu: cur.lieu, motif: a.motif || 'Pause' } };
    }
    if (a.type === 'reprendre') {
      if (cur.t !== 'pause' || !ctx || !ctx.d) return { ev: null, ctx: ctx };
      return { ev: ev({ t: 'travail', d: ctx.d, lieu: ctx.lieu || 'bureau' }), ctx: null };
    }
    if (a.type === 'cafe') {
      if (cur.t !== 'absent') return { ev: null, ctx: ctx };
      return { ev: ev({ t: 'cafe' }), ctx: null };
    }
    if (a.type === 'fin') {
      if (cur.t === 'absent') return { ev: null, ctx: ctx };
      return { ev: ev({ t: 'fin' }), ctx: null };
    }
    return { ev: null, ctx: ctx };
  }

  /* ---------- totaux et règles ---------- */
  function totals(ps) {
    var o = { travail: 0, pause: 0, midi: 0, cafe: 0, parDossier: {} };
    ps.forEach(function (p) {
      var ms = p.end - p.start;
      if (p.t === 'travail') { o.travail += ms; o.parDossier[p.d] = (o.parDossier[p.d] || 0) + ms; }
      else if (p.t === 'pause') { o.pause += ms; if (p.cat === 'midi') o.midi += ms; }
      else if (p.t === 'cafe') o.cafe += ms;
    });
    return o;
  }
  // Seuils suisses : > 5 h 30 → 15 min, > 7 h → 30 min, > 9 h → 60 min. Signalement seul, jamais de retrait.
  function legalCheck(dayPieces) {
    var t = totals(dayPieces), out = [];
    var req = t.travail > 9 * H ? 60 : t.travail > 7 * H ? 30 : t.travail > 5.5 * H ? 15 : 0;
    if (req && t.pause < req * MIN) out.push({ type: 'legale', requis: req, pris: Math.floor(t.pause / MIN) });
    var run = 0, prevEnd = null, flagged = false;
    dayPieces.slice().sort(function (a, b) { return a.start - b.start; }).forEach(function (p) {
      if (p.t === 'travail' && prevEnd === p.start) run += p.end - p.start;
      else if (p.t === 'travail') run = p.end - p.start;
      else run = 0;
      prevEnd = p.end;
      if (run > 5.5 * H && !flagged) { flagged = true; out.push({ type: 'tranche', ms: run }); }
    });
    return out;
  }
  // Midi GIOT : 60 min consécutives ; une exception d'au moins 30 min par semaine (lundi–dimanche).
  function midiCheck(evs, now, rule) {
    var segs = segments(evs, now), out = [], used = {};
    segs.forEach(function (s, i) {
      if (s.t !== 'pause' || s.cat !== 'midi' || s.open) return;
      var nx = segs[i + 1];
      if (!nx || nx.t !== 'travail') return; // pas de reprise l'après-midi
      var min = (s.end - s.start) / MIN;
      if (min >= rule.min) return;
      var wk = weekKey(s.start), date = dayKey(s.start);
      if (min >= rule.exMin && !used[wk]) { used[wk] = true; out.push({ date: date, min: min, kind: 'exception' }); }
      else out.push({ date: date, min: min, kind: 'ecart', motif: min < rule.exMin ? 'moins de ' + rule.exMin + ' min' : 'deuxième exception de la semaine' });
    });
    return out;
  }

  /* ---------- interventions, rapports, coûts ---------- */
  function rkey(pid, date, d) { return pid + '|' + date + '|' + d; }
  // Une intervention = toutes les plages de travail d'un dossier sur un jour local, pauses déduites.
  function interventions(evs, now) {
    var map = {};
    pieces(evs, now).forEach(function (p) {
      if (p.t !== 'travail') return;
      var k = rkey(p.pid, p.date, p.d);
      var it = map[k] || (map[k] = { key: k, pid: p.pid, date: p.date, d: p.d, ms: 0, open: false, plages: [] });
      it.ms += p.end - p.start; it.open = it.open || p.open; it.plages.push({ start: p.start, end: p.end });
    });
    return map;
  }
  function round2(x) { return Math.round(x * 100 + 1e-9) / 100; }
  // coût = heures réelles × coût interne ; vente = heures × tarif convenu, en régie uniquement.
  function montants(ms, person, dossier) {
    var h = ms / H;
    return {
      cout: round2(h * (person.cout || 0)),
      vente: dossier && dossier.trait === 'regie' ? round2(h * (dossier.tarif || 0)) : 0
    };
  }
  function refRapport(pid, date, dossier) { return 'R-' + date.replace(/-/g, '') + '-' + pid.toUpperCase() + '-' + (dossier.code || dossier.id); }
  // Transfert comptable idempotent : la clé est référence + version.
  function transmettre(ledger, ligne) {
    var cur = ledger[ligne.ref];
    if (cur && cur.version === ligne.version) return false; // relance ou double clic : rien de plus
    ledger[ligne.ref] = Object.assign({}, ligne, { revision: !!cur });
    return true;
  }

  /* ---------- corrections ---------- */
  // Un événement ne peut être déplacé qu'entre son précédent et son suivant.
  function canMove(evs, evId, newTs, now) {
    var s = sortEvents(evs), i = -1;
    for (var k = 0; k < s.length; k++) if (s[k].id === evId) i = k;
    if (i < 0) return { ok: false, err: 'Événement introuvable.' };
    if (i > 0 && newTs <= s[i - 1].ts) return { ok: false, err: 'L’heure proposée précède l’action précédente (' + hhmm(s[i - 1].ts) + ').' };
    if (i < s.length - 1 && newTs >= s[i + 1].ts) return { ok: false, err: 'L’heure proposée dépasse l’action suivante (' + hhmm(s[i + 1].ts) + ').' };
    if (newTs > now) return { ok: false, err: 'L’heure proposée est dans le futur.' };
    return { ok: true };
  }

  /* ---------- contexte de reprise : déduit des événements, donc identique sur tous les appareils ---------- */
  function ctxOf(evs) {
    var s = sortEvents(evs), last = s[s.length - 1];
    if (!last || last.t !== 'pause') return null;
    for (var i = s.length - 2; i >= 0; i--) {
      if (s[i].t === 'travail') return { d: s[i].d, lieu: s[i].lieu || 'bureau', motif: last.motif || (last.cat === 'midi' ? 'Midi' : 'Pause') };
      if (s[i].t === 'fin') break;
    }
    return null;
  }

  /* ---------- classeur Excel ----------
     m = { people: [{id, prenom, nom, socs}], dossiers: {id: {nom, code, soc}}, socs: {id: {nom}}, evs(pid) }
     f = { soc, pid, from, to } */
  var ETAT = { brouillon: 'Brouillon', soumis: 'Soumis', valide: 'Validé', renvoye: 'Renvoyé' };
  var TRANSF = { '': '—', a_transmettre: 'À transmettre', transmis: 'Transmis', accepte: 'Accepté', a_corriger: 'À corriger' };
  /* Feuille « Centres » : la liste complète des centres et de leurs champs. Les deux premières colonnes (Centre, Code analytique)
     se recollent telles quelles dans « Importer une liste » de l'administration. */
  function centresSheet(dossiers, socs) {
    var list = Array.isArray(dossiers) ? dossiers.slice() : Object.keys(dossiers).map(function (k) { return dossiers[k]; });
    var sn = function (id) { return id && socs[id] ? socs[id].nom : '—'; };
    list.sort(function (a, b) { return sn(a.soc).localeCompare(sn(b.soc), 'fr') || ((b.commun ? 1 : 0) - (a.commun ? 1 : 0)) || ((b.defaut ? 1 : 0) - (a.defaut ? 1 : 0)) || String(a.nom).localeCompare(String(b.nom), 'fr', { numeric: true }); });
    var rows = [['Centre', 'Code analytique', 'Société', 'Type', 'Par défaut', 'Actif'].map(function (v) { return { v: v, s: 1 }; })];
    list.forEach(function (d) { rows.push([d.nom, d.code || '', sn(d.soc), d.commun ? 'Commun' : 'Bâtiment', d.defaut ? 'Oui' : '', d.actif === false ? 'Non' : 'Oui']); });
    return { name: 'Centres', rows: rows, widths: [42, 18, 24, 12, 11, 8] };
  }
  /* Absences saisies par le bureau. */
  var ABS = { vacances: 'Vacances', maladie: 'Maladie', accident: 'Accident', ferie: 'Jour férié', autre: 'Autre' };
  /* Jours ouvrés (lundi à vendredi) d'une absence, limités à la période [from, to] si elle est donnée.
     feries : jours à ne pas compter (un jour férié pendant des vacances n'est pas un jour de vacances). Demi-journée : 0,5. */
  function joursAbs(a, from, to, feries) {
    var du = from && from > a.du ? from : a.du, au = to && to < a.au ? to : a.au, n = 0, k = du, g = 0;
    while (k <= au && g++ < 800) {
      var p = k.split('-'), j = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
      if (j !== 0 && j !== 6 && !(feries && feries[k])) n++;
      k = addDays(k, 1);
    }
    return a.demi && a.du === a.au ? n / 2 : n;
  }
  /* Jours fériés applicables à une personne : absences de type « ferie », les siennes ou celles posées pour tous. */
  function feriesDe(absences, pid) {
    var o = {};
    (absences || []).forEach(function (a) {
      if (a.type !== 'ferie' || (a.pid !== pid && a.pid !== '*')) return;
      var k = a.du, g = 0; while (k <= a.au && g++ < 800) { o[k] = true; k = addDays(k, 1); }
    });
    return o;
  }
  /* Lignes d'absence par personne sur une période : une absence posée pour tous donne une ligne par employé actif. */
  function absLignes(absences, people, f) {
    var out = [];
    people.forEach(function (p) {
      if (f.pid && f.pid !== p.id) return;
      if (f.soc && (p.socs || []).indexOf(f.soc) < 0) return;
      var fer = feriesDe(absences, p.id);
      (absences || []).forEach(function (a) {
        if (a.pid !== p.id && !(a.pid === '*' && p.actif !== false)) return;
        if ((f.from && a.au < f.from) || (f.to && a.du > f.to)) return;
        out.push({ p: p, a: a, jours: joursAbs(a, f.from, f.to, a.type === 'ferie' ? null : fer) });
      });
    });
    return out;
  }
  function absSheet(absences, people, f) {
    var rows = [['Collaborateur', 'Type', 'Du', 'Au', 'Demi-journée', 'Jours ouvrés', 'Remarque'].map(function (v) { return { v: v, s: 1 }; })];
    var l = absLignes(absences, people, f);
    l.sort(function (x, y) { var a = x.p.prenom + ' ' + x.p.nom, b = y.p.prenom + ' ' + y.p.nom; return a.localeCompare(b, 'fr') || (x.a.du < y.a.du ? -1 : x.a.du > y.a.du ? 1 : 0); });
    var tot = {}, ordre = [];
    l.forEach(function (x) {
      var nom = x.p.prenom + ' ' + x.p.nom;
      rows.push([nom, ABS[x.a.type] || x.a.type, { v: excelDate(x.a.du), s: 2 }, { v: excelDate(x.a.au), s: 2 }, x.a.demi ? 'Oui' : '', x.jours, x.a.note || '']);
      var k = nom + '|' + x.a.type;
      if (!(k in tot)) { tot[k] = { nom: nom, type: x.a.type, n: 0 }; ordre.push(k); }
      tot[k].n += x.jours;
    });
    if (ordre.length) {
      rows.push(['', '', '', '', '', '', '']);
      rows.push([{ v: 'Totaux sur la période', s: 6 }, '', '', '', '', '', '']);
      ordre.forEach(function (k) { rows.push([{ v: tot[k].nom, s: 6 }, { v: ABS[tot[k].type] || tot[k].type, s: 6 }, '', '', '', { v: tot[k].n, s: 6 }, '']); });
    }
    return { name: 'Absences', rows: rows, widths: [24, 14, 12, 12, 13, 13, 40], n: l.length };
  }
  function workbook(m, f, now) {
    var S = { h: 1, date: 2, time: 3, dur: 4, chf: 5, b: 6, bdur: 7 };
    function hd(v) { return { v: v, s: S.h }; }
    function socNom(id) { return id && m.socs[id] ? m.socs[id].nom : '—'; }
    var detail = [['Date', 'Société', 'Collaborateur', 'Centre', 'Code analytique', 'Lieu', 'Début', 'Fin', 'Catégorie', 'Durée', 'Minutes', 'Plage', 'Corrigé', 'Code', 'Note'].map(hd)];
    var parD = {}, parC = {};
    m.people.forEach(function (p) {
      if (f.pid && f.pid !== p.id) return;
      var nom = p.prenom + ' ' + p.nom, socs = p.socs || [];
      var parEv = {}; // écriture → son intervention (code et note)
      sessions(m.evs(p.id)).forEach(function (se) { se.ids.forEach(function (id) { parEv[id] = se; }); });
      pieces(m.evs(p.id), now).forEach(function (x) {
        if (x.t === 'cafe') return; // avant le pointage de début : ni travail ni pause
        if ((f.from && x.date < f.from) || (f.to && x.date > f.to)) return;
        var ms = x.end - x.start, d = null, soc = null, se = x.t === 'travail' ? parEv[x.evId] : null;
        if (x.t === 'travail') {
          d = m.dossiers[x.d] || { nom: 'Centre supprimé', code: '', soc: null };
          soc = d.soc;
          if (f.soc && soc !== f.soc) return;
          var kd = (soc || '') + '|' + d.nom + '|' + x.d;
          (parD[kd] || (parD[kd] = { soc: soc, d: d, by: {} })).by[nom] = (parD[kd].by[nom] || 0) + ms;
        } else {
          if (f.soc && socs.indexOf(f.soc) < 0) return;
          soc = socs.length === 1 ? socs[0] : null;
        }
        var kc = nom + '|' + p.id + '|' + x.date;
        var c = parC[kc] || (parC[kc] = { nom: nom, date: x.date, travail: 0, pause: 0 });
        if (x.t === 'travail') c.travail += ms; else c.pause += ms;
        detail.push([
          { v: excelDate(x.date), s: S.date }, socNom(soc), nom, d ? d.nom : '—', d ? (d.code || '') : '',
          x.t === 'travail' ? (x.lieu === 'mission' ? 'Déplacement' : 'Bureau') : '—',
          { v: excelSerial(x.start), s: S.time }, { v: excelSerial(x.end), s: S.time },
          x.t === 'travail' ? 'Travail' : (x.cat === 'midi' ? 'Repas' : 'Pause'),
          { v: ms / DAY, s: S.dur }, Math.round(ms / MIN * 100) / 100, x.open ? 'Provisoire' : 'Close', x.corr ? 'Oui' : '',
          // code d'intervention : sur toutes les lignes de l'intervention dès qu'elle est notée ; note : sur sa dernière écriture
          se && (se.ci || se.note) && d && !d.commun ? (CODES[se.ci] || CODES.D) : '', se && se.carrier === x.evId ? se.note : ''
        ]);
      });
    });
    var head = detail.shift();
    detail.sort(function (a, b) { return a[0].v - b[0].v || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0) || a[6].v - b[6].v; });
    detail.unshift(head);
    // Par dossier
    var sd = [['Société', 'Centre', 'Code analytique', 'Collaborateur', 'Travail'].map(hd)], totD = 0;
    Object.keys(parD).sort().forEach(function (k) {
      var g = parD[k], t = 0;
      Object.keys(g.by).sort().forEach(function (n) { t += g.by[n]; sd.push([socNom(g.soc), g.d.nom, g.d.code || '', n, { v: g.by[n] / DAY, s: S.dur }]); });
      sd.push([{ v: socNom(g.soc), s: S.b }, { v: g.d.nom, s: S.b }, { v: g.d.code || '', s: S.b }, { v: 'Total centre', s: S.b }, { v: t / DAY, s: S.bdur }]);
      totD += t;
    });
    sd.push([{ v: 'Total période', s: S.b }, '', '', '', { v: totD / DAY, s: S.bdur }]);
    // Par collaborateur
    var sc = [['Collaborateur', 'Date', 'Travail', 'Pauses'].map(hd)], totT = 0, totP = 0, curN = null, tn = 0, pn = 0;
    function closeN() { if (curN !== null) sc.push([{ v: curN, s: S.b }, { v: 'Total période', s: S.b }, { v: tn / DAY, s: S.bdur }, { v: pn / DAY, s: S.bdur }]); }
    Object.keys(parC).sort().forEach(function (k) {
      var c = parC[k];
      if (c.nom !== curN) { closeN(); curN = c.nom; tn = 0; pn = 0; }
      tn += c.travail; pn += c.pause; totT += c.travail; totP += c.pause;
      sc.push([c.nom, { v: excelDate(c.date), s: S.date }, { v: c.travail / DAY, s: S.dur }, { v: c.pause / DAY, s: S.dur }]);
    });
    closeN();
    sc.push([{ v: 'Total général', s: S.b }, '', { v: totT / DAY, s: S.bdur }, { v: totP / DAY, s: S.bdur }]);
    var sa = absSheet(m.absences || [], m.people, f), nAbs = sa.n; delete sa.n;
    return {
      sheets: [
        { name: 'Détail', rows: detail, widths: [12, 22, 22, 30, 16, 12, 8, 8, 11, 9, 9, 11, 9, 10, 40] },
        { name: 'Par centre', rows: sd, widths: [22, 32, 16, 22, 11] },
        { name: 'Par collaborateur', rows: sc, widths: [22, 14, 11, 11] },
        sa,
        centresSheet(m.dossiers, m.socs)
      ],
      totals: { detailTravail: detail.slice(1).reduce(function (a, r) { return a + (r[8] === 'Travail' ? r[9].v : 0); }, 0) * DAY, parDossier: totD, parCollab: totT, pauses: totP, lignes: detail.length - 1, absences: nAbs }
    };
  }

  G.Engine = {
    MIN: MIN, H: H, DAY: DAY, LABEL: LABEL, ETAT: ETAT, TRANSF: TRANSF,
    parts: parts, fromLocal: fromLocal, dayKey: dayKey, dayStart: dayStart, nextDayStart: nextDayStart, addDays: addDays,
    weekKey: weekKey, hhmm: hhmm, atTime: atTime, excelSerial: excelSerial, excelDate: excelDate, dur: dur, frDate: frDate, pad: pad,
    sortEvents: sortEvents, segments: segments, splitByDay: splitByDay, pieces: pieces, statusOf: statusOf, act: act,
    totals: totals, legalCheck: legalCheck, midiCheck: midiCheck, rkey: rkey, interventions: interventions,
    montants: montants, refRapport: refRapport, transmettre: transmettre, canMove: canMove, ctxOf: ctxOf, workbook: workbook, centresSheet: centresSheet, sessions: sessions, CODES: CODES,
    ABS: ABS, joursAbs: joursAbs, feriesDe: feriesDe, absLignes: absLignes
  };
})(typeof window !== 'undefined' ? window : globalThis);

