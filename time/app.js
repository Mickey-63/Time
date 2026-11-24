/* Page de pointage de l'employé.
   Chaque geste est d'abord écrit sur le téléphone, puis transmis au serveur dès que possible.
   Le serveur garde l'état en permanence : il alimente le tableau d'équipe et les exports. */
(function () {
  'use strict';
  var E = window.Engine, root = document.getElementById('app');
  var esc = window.esc, api = window.api, ic = window.ic, LIB = window.LIB, LOGO = window.LOGO;
  var uid = function () { try { return crypto.randomUUID(); } catch (e) { return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12); } };

  /* ---------- état local ---------- */
  var LS = 'pointage-v2';
  function blank() {
    return { v: 2, token: '', me: null, lastPid: '', socs: {}, dossiers: {}, mes: [], epingles: [], defaut: null, regles: { midiMin: 60, midiEx: 30, rappelPause: 20, rappelMidi: 75 },
      evs: {}, dirty: {}, favs: [], lieu: 'bureau', tab: 'pointage', jour: null, seq: 0, skew: 0 };
  }
  var S = (function () {
    try { var o = JSON.parse(localStorage.getItem(LS)); if (o && o.v === 2) return Object.assign(blank(), o); } catch (e) { }
    return blank();
  })();
  var stored = true;
  function save() { try { localStorage.setItem(LS, JSON.stringify(S)); stored = true; } catch (e) { stored = false; } }
  // L'heure du téléphone fait foi, sauf si elle s'écarte de plus de 2 minutes de celle du serveur.
  function now() { return Date.now() + (Math.abs(S.skew || 0) > 120000 ? S.skew : 0); }
  var cache = null;
  function evs() { if (!cache) cache = Object.keys(S.evs).map(function (k) { return S.evs[k]; }); return cache; }
  function touch(id) { cache = null; if (id) S.dirty[id] = true; }
  function dos(id) { return S.dossiers[id] || { nom: 'Centre supprimé', code: '', soc: '' }; }
  function socCourt(id) { return S.socs[id] ? S.socs[id].court : ''; }
  function mes() { return S.mes.filter(function (id) { return S.dossiers[id]; }); }
  // Centre par défaut : la journée commence dessus, on change ensuite au fil du travail.
  // Bâtiments : les centres non communs (adresses d'immeubles, chantiers). Tous sont accessibles par le bouton Bâtiments.
  function batiments() { return mes().filter(function (id) { return !S.dossiers[id].commun; }).sort(function (a, b) { return dos(a).nom.localeCompare(dos(b).nom, 'fr', { numeric: true }); }); }
  // Les bâtiments habituels de l'employé : ceux où il a le plus travaillé sur la période gardée (45 jours), à égalité le plus récent.
  function habituels(t, n) {
    var ms = {}, last = {};
    E.pieces(evs(), t).forEach(function (p) {
      if (p.t !== 'travail' || !S.dossiers[p.d] || S.dossiers[p.d].commun) return;
      ms[p.d] = (ms[p.d] || 0) + (p.end - p.start); last[p.d] = Math.max(last[p.d] || 0, p.end);
    });
    return Object.keys(ms).filter(function (id) { return mes().indexOf(id) >= 0; }).sort(function (a, b) { return (ms[b] - ms[a]) || (last[b] - last[a]); }).slice(0, n);
  }
  /* Note de fin de travail (activée dans les Réglages de l'administration) : demandée quand on quitte un bâtiment. */
  function noteOn() { return !!(S.regles && S.regles.note); }
  function estBat(id) { return !!S.dossiers[id] && !S.dossiers[id].commun; }
  function sessionDe(evId) { return E.sessions(evs()).filter(function (se) { return se.ids.indexOf(evId) >= 0; })[0] || null; }
  // Interventions terminées sur un bâtiment et encore sans note, la plus ancienne d'abord.
  function aNoter() {
    if (!noteOn()) return [];
    var depuis = S.regles.noteDepuis || 0;
    return E.sessions(evs()).filter(function (se) { return se.closed && estBat(se.d) && !se.note && se.end >= depuis; });
  }
  function defaut() { return S.defaut && mes().indexOf(S.defaut) >= 0 ? S.defaut : null; }

  /* ---------- synchronisation ---------- */
  var syncing = false, again = false, netErr = false, online = navigator.onLine !== false;
  function sync() {
    if (!S.token) return;
    if (syncing) { again = true; return; }
    syncing = true; again = false;
    var ids = Object.keys(S.dirty), marks = {};
    ids.forEach(function (id) { marks[id] = S.evs[id] ? S.evs[id].rev : null; });
    var sent = Date.now();
    api('sync', { token: S.token, events: ids.map(function (id) { return S.evs[id]; }).filter(Boolean) }).then(function (r) {
      netErr = false;
      S.skew = r.now - (sent + Date.now()) / 2;
      ids.forEach(function (id) { if (!S.evs[id] || S.evs[id].rev === marks[id]) delete S.dirty[id]; });
      // Le serveur fait référence ; seuls les gestes pas encore transmis restent en version locale.
      var next = {};
      r.events.forEach(function (e) { next[e.id] = e; });
      Object.keys(S.dirty).forEach(function (id) { if (S.evs[id]) next[id] = S.evs[id]; });
      S.evs = next; cache = null;
      S.me = r.me; S.socs = r.socs; S.mes = r.mes; S.epingles = r.epingles || []; S.defaut = r.defaut || null; S.regles = r.regles; S.absences = r.absences || [];
      S.dossiers = {}; r.dossiers.forEach(function (d) { S.dossiers[d.id] = d; });
    }, function (err) {
      if (err.status === 401) { S.token = ''; S.me = null; loginErr = err.message; loadPeople(); }
      else netErr = true;
    }).then(function () { syncing = false; save(); render(); if (again) sync(); });
  }
  function pending() { return Object.keys(S.dirty).length; }
  function syncLabel() {
    var n = pending();
    if (!stored) return ['wait', 'Stockage du téléphone refusé'];
    if (!online || netErr) return ['wait', 'Hors ligne' + (n ? ' · ' + n + ' à transmettre' : '')];
    return n ? ['wait', n + ' à transmettre'] : ['', 'Synchronisé'];
  }

  /* ---------- connexion ---------- */
  var people = null, loadErr = false, loginErr = '', busy = false, configured = true;
  function loadPeople() {
    loadErr = false;
    api('etat').then(function (r) { people = r.people; configured = r.pret; }, function () { loadErr = true; }).then(function () { render(); });
  }
  function login() {
    var sel = document.getElementById('lg-pid'), pin = document.getElementById('lg-pin');
    if (!sel || !pin || busy) return;
    var pid = sel.value, code = pin.value.trim();
    if (!code) { loginErr = 'Saisis ton code PIN.'; return render(true); }
    busy = true; loginErr = ''; render(true);
    api('login', { pid: pid, pin: code }).then(function (r) {
      if (S.lastPid !== pid) { var b = blank(); b.skew = S.skew; S = b; cache = null; } // autre personne sur ce téléphone : on repart à neuf
      S.token = r.token; S.lastPid = pid; save(); sync();
    }, function (err) { loginErr = err.status ? err.message : 'Serveur injoignable. Vérifie la connexion.'; })
      .then(function () { busy = false; render(true); });
  }
  function logout() {
    var tok = S.token;
    S.token = ''; S.me = null;
    Object.keys(S.evs).forEach(function (id) { if (!S.dirty[id]) delete S.evs[id]; }); // les gestes non transmis attendent la prochaine connexion
    cache = null; sheet = null; save();
    api('logout', { token: tok }).catch(function () { });
    loadPeople();
  }

  /* ---------- actions ---------- */
  var toastMsg = null, toastTimer = null, sheet = null;
  function toast(text) {
    toastMsg = { text: text };
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastMsg = null; var t = root.querySelector('.toast'); if (t) t.remove(); }, 6000);
  }
  function lieuChoisi(st, ctx) {
    if (st.t === 'travail') return st.lieu;
    if (st.t === 'pause' && ctx && ctx.lieu) return S.lieuPause || ctx.lieu;
    return S.lieu || 'bureau';
  }
  function doAct(a) {
    var list = evs(), ctx = E.ctxOf(list);
    if (a.type === 'dossier' && mes().indexOf(a.d) < 0) return; // centre non affecté : refusé
    if (a.type === 'reprendre' && ctx && S.lieuPause) ctx.lieu = S.lieuPause;
    var r = E.act(list, ctx, a, now(), function () { return { id: uid(), pid: S.me.id, seq: ++S.seq, rev: 0 }; });
    if (!r.ev) return; // double appui : rien de plus
    S.evs[r.ev.id] = r.ev; delete S.lieuPause; touch(r.ev.id);
    save(); // 1. écrit sur le téléphone avant tout le reste
    var n = aNoter()[0];
    if (n) sheet = { type: 'note', ev: n.carrier, oblig: true }; // l'heure est déjà enregistrée : la note ne retarde jamais le pointage
    render(true); sync(); // 2. puis transmis
  }

  /* ---------- petits composants ---------- */
  function tick(base, t0) { return '<span data-tick data-base="' + base + '" data-t0="' + t0 + '">' + E.dur(base + now() - t0) + '</span>'; }
  function topLine() {
    return '<div class="st-top"><button class="who" data-act="menu" aria-label="Menu">' + esc(S.me.prenom + ' ' + S.me.nom) + ' ▾</button>' + LOGO + '</div>';
  }
  function syncChip() { var l = syncLabel(); return '<span class="sync ' + l[0] + '" role="status"><i></i>' + esc(l[1]) + '</span>'; }
  function paintSync() { var el = root.querySelector('.sync'); if (el) { var l = syncLabel(); el.className = 'sync ' + l[0]; el.innerHTML = '<i></i>' + esc(l[1]); } }
  function tabs(list, cur) {
    return '<nav class="tabs" aria-label="Sections">' + list.map(function (t) {
      return '<button data-act="tab" data-t="' + t[0] + '" aria-current="' + (t[0] === cur) + '">' + t[1] + '</button>';
    }).join('') + '</nav>';
  }
  function alertes(date, t) {
    var out = [], ps = E.pieces(evs(), t).filter(function (x) { return x.date === date; });
    E.legalCheck(ps).forEach(function (a) {
      if (a.type === 'legale') out.push('Pause légale : ' + a.requis + ' min requises, ' + a.pris + ' min prises.');
      else out.push('Plus de 5 h 30 de travail d’affilée sans pause.');
    });
    if (S.me.midi) E.midiCheck(evs(), t, { min: S.regles.midiMin, exMin: S.regles.midiEx }).forEach(function (m) {
      if (m.date !== date) return;
      var mn = Math.round(m.min);
      out.push(m.kind === 'exception' ? 'Midi de ' + mn + ' min : exception hebdomadaire utilisée.' : 'Midi de ' + mn + ' min : écart signalé (' + m.motif + '). Durée réelle conservée.');
    });
    return out;
  }

  /* ---------- vues ---------- */
  function vLogin() {
    var h = '<div class="login">' + LOGO + '<h1>Pointage</h1>';
    if (!people) {
      h += '<div class="mute">' + (loadErr ? 'Serveur injoignable. Vérifie la connexion.' : 'Chargement…') + '</div>';
      if (loadErr) h += '<button class="btn full" data-act="reload">Réessayer</button>';
    } else if (!people.length) {
      h += '<div class="note">' + (configured ? 'Aucun employé n’est encore enregistré.' : 'Le site n’est pas encore configuré.') + ' L’administration crée les employés et leurs centres.</div><a class="btn full" href="admin.html">Ouvrir l’administration</a>';
    } else {
      h += '<label class="f" for="lg-pid">Qui es-tu ?<select id="lg-pid">' + people.map(function (p) {
        return '<option value="' + esc(p.id) + '"' + (p.id === S.lastPid ? ' selected' : '') + '>' + esc(p.prenom + ' ' + p.nom) + '</option>';
      }).join('') + '</select></label>' +
        '<label class="f" for="lg-pin">Code PIN<input class="pin" id="lg-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8"></label>' +
        (loginErr ? '<div class="err" role="alert">' + esc(loginErr) + '</div>' : '') +
        '<button class="btn full" data-act="login"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Connexion…' : 'Se connecter') + '</button>';
      if (pending()) h += '<div class="mute small">' + pending() + ' pointage(s) de la dernière session attendent sur ce téléphone. Ils partiront à la reconnexion de la même personne.</div>';
    }
    return h + '<div class="aide"><div class="sec"><span>Modes d’emploi</span><span>PDF</span></div>' + window.aide('btn ghost full') + '</div><a class="lnk" href="etat.html">Voir le tableau d’équipe</a></div>';
  }
  function vApp() {
    var t = now(), list = evs(), st = E.statusOf(list), ctx = E.ctxOf(list), tab = S.tab === 'journee' ? 'journee' : 'pointage', today = E.dayKey(t);
    var ps = E.pieces(list, t).filter(function (x) { return x.date === today; }), tt = E.totals(ps);
    var sub = '', meta = '';
    if (st.t === 'travail') {
      var d = dos(st.d), t0 = Math.max(st.since, E.dayStart(today)), closed = (tt.parDossier[st.d] || 0) - (t - t0);
      sub = esc(d.nom) + (socCourt(d.soc) ? ' · ' + esc(socCourt(d.soc)) : '');
      meta = '<span>depuis ' + E.hhmm(st.since) + '</span><span>Ce centre aujourd’hui ' + tick(closed, t0) + '</span>';
    } else if (st.t === 'pause') {
      sub = esc((ctx && ctx.motif) || (st.cat === 'midi' ? 'Midi' : 'Pause'));
      meta = '<span>depuis ' + E.hhmm(st.since) + ' · ' + tick(0, st.since) + '</span>';
    } else if (st.t === 'cafe') {
      sub = 'Café avant travail';
      meta = '<span>depuis ' + E.hhmm(st.since) + ' · temps non compté</span>';
    } else {
      sub = ps.length ? 'Journée terminée' : 'Journée non commencée';
    }
    var head = '<div class="strip">' + topLine() + '</div><header class="status st-' + st.code + '"><div class="st-label" role="status">' + ic(st.code) + LIB[st.code] + '</div><div class="st-sub">' + sub + '</div><div class="st-meta">' + meta + syncChip() + '</div></header>';
    var body = tab === 'journee' ? vJournee(list, t) : vPointage(st, ctx, t, tt);
    return head + '<main id="main">' + body + '</main>' + (tab === 'pointage' ? cmdBar(st) : '') + tabs([['pointage', 'Pointage'], ['journee', 'Journée']], tab);
  }
  function vPointage(st, ctx, t, tt) {
    var h = '', list = mes(), R = S.regles, def = defaut();
    var lieu = lieuChoisi(st, ctx);
    if (st.t === 'pause' && ctx && ctx.d) {
      if (list.indexOf(ctx.d) >= 0) h += '<button class="resume" data-act="reprendre"><b>Reprendre · ' + esc(dos(ctx.d).nom) + '</b><span>' + (lieu === 'mission' ? 'En déplacement' : 'Au bureau') + ' · une pression</span></button>';
      else h += '<div class="note"><b>Le centre précédent n’est plus disponible.</b> Choisis un de tes centres pour reprendre. Tes heures déjà faites sont conservées.</div>';
      var lim = (st.cat === 'midi' ? R.rappelMidi : R.rappelPause) * E.MIN;
      if (t - st.since > lim) h += '<div class="note">Pause en cours depuis ' + tick(0, st.since) + '. Poursuis-la ou reprends : ce rappel ne change jamais ton statut.</div>';
    }
    // Journée pas commencée (ou café) : un seul geste pour démarrer sur le centre par défaut.
    if ((st.t === 'absent' || st.t === 'cafe') && def) {
      h += '<button class="resume go" data-act="dossier" data-d="' + esc(def) + '"><b>Commencer la journée</b><span>Sur « ' + esc(dos(def).nom) + ' » · ' + (lieu === 'mission' ? 'en déplacement' : 'au bureau') + '</span></button>';
    }
    var manq = aNoter();
    if (manq.length) h += '<div class="note warn"><b>Note de fin de travail à écrire</b> pour ' + esc(dos(manq[0].d).nom) + (manq.length > 1 ? ' et ' + (manq.length - 1) + ' autre' + (manq.length > 2 ? 's' : '') : '') + '. <button class="btn sm" data-act="note" data-ev="' + esc(manq[0].carrier) + '">Écrire la note</button></div>';
    if (st.t === 'cafe') h += '<div class="note">Café avant travail : ce temps n’est compté ni comme travail ni comme pause. ' + (def ? 'Touche Commencer la journée ou un centre.' : 'Touche un centre pour commencer.') + '</div>';
    if (st.t === 'travail' && def && st.d === def) h += '<div class="mute small">Dès qu’une tâche dépasse 15 minutes, touche le centre concerné : le temps lui sera chargé.</div>';
    if (st.t === 'travail' && (t - st.since > 11 * E.H)) h += '<div class="note warn"><b>Fin de journée oubliée ?</b> Touche Fin de journée, puis corrige l’heure réelle dans Journée. Rien n’est retiré automatiquement.</div>';
    h += '<div class="seg" role="group" aria-label="Lieu de travail"><button data-act="lieu" data-l="bureau" aria-pressed="' + (lieu === 'bureau') + '">' + ic('bureau') + 'Au bureau</button><button data-act="lieu" data-l="mission" aria-pressed="' + (lieu === 'mission') + '">' + ic('mission') + 'En déplacement</button></div>';
    if (!list.length) return h + '<div class="note">Aucun centre n’est encore créé pour ta société. L’administration les crée ; ils apparaissent ici tout seuls.</div>';
    var favs = S.favs || [];
    var tri = function (a, b) { return ((b === def) - (a === def)) || ((favs.indexOf(b) >= 0) - (favs.indexOf(a) >= 0)) || dos(a).nom.localeCompare(dos(b).nom, 'fr', { numeric: true }); };
    var col = st.code === 'mission' ? 'bleu' : 'vert', today = E.dayKey(t);
    var tuile = function (id) {
      var d = dos(id), on = st.t === 'travail' && st.d === id, wait = st.t === 'pause' && ctx && ctx.d === id, ms = tt.parDossier[id] || 0, fav = favs.indexOf(id) >= 0;
      var t0 = on ? Math.max(st.since, E.dayStart(today)) : 0;
      return '<div class="dos' + (on ? ' on' : '') + (wait ? ' wait' : '') + '">' +
        '<button class="hit" data-act="dossier" data-d="' + esc(id) + '" aria-pressed="' + on + '" aria-label="' + esc(d.nom + (on ? ', en cours' : '')) + '">' +
        '<span class="nm">' + esc(d.nom) + '</span><span class="ft"><span class="tag">' + (id === def ? 'par défaut' : esc(socCourt(d.soc))) + '</span><span>' + (on ? tick(ms - (t - t0), t0) : (ms ? E.dur(ms) : '')) + '</span></span></button>' +
        '<button class="fav" data-act="fav" data-d="' + esc(id) + '" aria-pressed="' + fav + '" aria-label="' + (fav ? 'Retirer des favoris' : 'Ajouter aux favoris') + '">' + ic('star') + '</button></div>';
    };
    var bloc = function (titre, droite, ids) {
      return '<div class="sec"><span>' + titre + '</span><span>' + droite + '</span></div>' + (ids.length ? '<div class="grid" style="--st:var(--' + col + ');--on-st:var(--on-' + col + ')">' + ids.map(tuile).join('') + '</div>' : '');
    };
    var com = list.filter(function (id) { return dos(id).commun; }).sort(tri), bat = batiments();
    h += bloc('Centres communs', com.length, com);
    if (bat.length) {
      // À l'écran : le bâtiment en cours, les épinglés par l'administration, les favoris (étoile), puis les trois plus habituels.
      var vus = {}, mesBat = [];
      var cur = st.t === 'travail' ? st.d : (st.t === 'pause' && ctx ? ctx.d : null);
      [cur].concat(S.epingles || [], favs, habituels(t, 3)).forEach(function (id) { if (id && bat.indexOf(id) >= 0 && !vus[id]) { vus[id] = true; mesBat.push(id); } });
      h += bloc('Mes bâtiments', mesBat.length + ' sur ' + bat.length, mesBat) +
        '<button class="btn ghost full" data-act="bat">' + ic('bureau') + (mesBat.length ? 'Tous les bâtiments' : 'Choisir un bâtiment') + '</button>';
    }
    return h;
  }
  function cmdBar(st) {
    var b = function (act, icn, lab, cls) { return '<button data-act="' + act + '" class="' + (cls || '') + '">' + ic(icn) + '<span>' + lab + '</span></button>'; };
    var h = '<div class="cmd" role="group" aria-label="Commandes">';
    if (st.t === 'travail') h += b('appel', 'tel', 'Appel privé') + b('pause', 'pause', 'Pause') + b('midi', 'midi', 'Midi') + b('fin', 'fin', 'Fin de journée');
    else if (st.t === 'absent') h += b('cafe', 'cafe', 'Café avant travail', 'wide');
    else h += b('fin', 'fin', 'Fin de journée', 'wide');
    if (batiments().length) h += b('bat', 'bureau', 'Bâtiments', 'main');
    return h + '</div>';
  }
  function evLabel(e) {
    if (e.t === 'travail') return 'Travail · ' + dos(e.d).nom + ' · ' + (e.lieu === 'mission' ? 'Déplacement' : 'Bureau');
    if (e.t === 'pause') return e.cat === 'midi' ? 'Repas' : (e.motif && e.motif !== 'Pause' ? 'Pause · ' + e.motif : 'Pause');
    return e.t === 'cafe' ? 'Café avant travail (non compté)' : 'Fin de journée';
  }
  function timeline(date, t) {
    var list = evs(), ps = E.pieces(list, t).filter(function (x) { return x.date === date; }), h = '<div class="tl">';
    var parEv = {};
    E.sessions(list).forEach(function (se) { se.ids.forEach(function (id) { parEv[id] = se; }); });
    ps.forEach(function (p) {
      var e = S.evs[p.evId], own = e && e.ts === p.start, hist = own && e.hist && e.hist.length ? e.hist[e.hist.length - 1] : null;
      var se = p.t === 'travail' ? parEv[p.evId] : null, porte = se && se.carrier === p.evId && own, notee = se && (se.note || se.ci);
      h += '<div class="it"><span class="stripe s-' + (p.t === 'travail' ? (p.lieu === 'mission' ? 'mission' : 'bureau') : 'pause') + '"></span><div><div class="t1">' + E.hhmm(p.start) + ' – ' + (p.open ? 'en cours' : E.hhmm(p.end)) + ' · ' + E.dur(p.end - p.start) + '</div>' +
        '<div class="t2">' + esc(e ? evLabel(e) : '') + (hist ? ' · corrigé (avant : ' + E.hhmm(hist.old) + ')' : '') + '</div>' +
        (porte && notee ? '<div class="t3">' + (estBat(se.d) ? esc(E.CODES[se.ci] || E.CODES.D) + (se.note ? ' · ' : '') : '') + esc(se.note) + '</div>' : '') + '</div>' +
        '<span class="acts">' + (porte && (noteOn() || notee) ? '<button class="btn ghost sm" data-act="note" data-ev="' + esc(p.evId) + '">Note</button>' : '') +
        (own ? '<button class="btn ghost sm" data-act="corriger" data-ev="' + esc(p.evId) + '">Corriger</button>' : '') + '</span></div>';
    });
    list.filter(function (e) { return e.t === 'fin' && E.dayKey(e.ts) === date; }).forEach(function (e) {
      var hist = e.hist && e.hist.length ? e.hist[e.hist.length - 1] : null;
      h += '<div class="it"><span class="stripe"></span><div><div class="t1">' + E.hhmm(e.ts) + ' · Fin de journée</div>' + (hist ? '<div class="t2">corrigé (avant : ' + E.hhmm(hist.old) + ')</div>' : '') + '</div>' +
        '<button class="btn ghost sm" data-act="corriger" data-ev="' + esc(e.id) + '">Corriger</button></div>';
    });
    if (!ps.length) h += '<div class="mute">Aucun pointage ce jour-là.</div>';
    return h + '</div>';
  }
  function vJournee(list, t) {
    var today = E.dayKey(t), date = S.jour || today, ps = E.pieces(list, t).filter(function (x) { return x.date === date; }), tot = E.totals(ps);
    var h = '<div class="datenav"><button data-act="jour" data-n="-1" aria-label="Jour précédent">‹</button><b>' + E.frDate(date) + (date === today ? ' · aujourd’hui' : '') + '</b><button data-act="jour" data-n="1" aria-label="Jour suivant"' + (date >= today ? ' disabled' : '') + '>›</button></div>' +
      '<div class="kpis"><div class="kpi"><b>' + E.dur(tot.travail) + '</b><span>Travail</span></div><div class="kpi"><b>' + E.dur(tot.pause) + '</b><span>Pauses</span></div><div class="kpi"><b>' + E.dur(tot.cafe) + '</b><span>Avant travail</span></div></div>';
    // Absence saisie par le bureau pour ce jour (la sienne avant un jour férié commun).
    var ab = null;
    (S.absences || []).forEach(function (a) { if (a.du <= date && date <= a.au && (!ab || a.pid !== '*')) ab = a; });
    if (ab) h += '<div class="note">Absence enregistrée par le bureau : <b>' + esc(E.ABS[ab.type] || ab.type) + '</b>' + (ab.demi ? ', demi-journée' : '') +
      (ab.du !== ab.au ? ', du ' + E.frDate(ab.du) + ' au ' + E.frDate(ab.au) : '') + '. Une erreur ? Signale-la au bureau.</div>';
    alertes(date, t).forEach(function (a) { h += '<div class="note warn">' + esc(a) + '</div>'; });
    h += '<div class="card"><div class="sec"><span>Relevé du jour</span><span>heures réelles</span></div>' + timeline(date, t) + '</div>';
    var parD = Object.keys(tot.parDossier);
    if (parD.length) {
      h += '<div class="card"><div class="sec"><span>Par centre</span></div>';
      parD.sort(function (a, b) { return tot.parDossier[b] - tot.parDossier[a]; }).forEach(function (id) {
        h += '<div class="row"><div>' + esc(dos(id).nom) + (dos(id).code ? '<div class="mute small">' + esc(dos(id).code) + '</div>' : '') + '</div><b>' + E.dur(tot.parDossier[id]) + '</b></div>';
      });
      h += '</div>';
    }
    return h + '<div class="mute small">Les 45 derniers jours restent consultables et corrigeables ici.</div>';
  }
  function vSheet() {
    if (!sheet) return '';
    var h = '';
    if (sheet.type === 'menu') {
      h += '<h2>' + esc(S.me.prenom + ' ' + S.me.nom) + '</h2><a class="btn ghost full" href="etat.html">Tableau d’équipe</a>' + window.aide('btn ghost full');
      if (pending()) h += '<div class="note">' + pending() + ' pointage(s) pas encore transmis. Ils restent sur ce téléphone et partiront à ta prochaine connexion.</div>';
      h += '<button class="btn ghost full" data-act="pin">Changer mon code PIN</button><button class="btn ghost full" data-act="logout">Se déconnecter</button>';
    } else if (sheet.type === 'pin') {
      h += '<h2>Changer mon code PIN</h2><div class="mute">4 à 8 chiffres. Tes autres appareils devront se reconnecter avec le nouveau code.</div>' +
        '<label class="f" for="pin-old">Code PIN actuel<input class="pin" id="pin-old" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8" value="' + esc(sheet.o || '') + '"></label>' +
        '<div class="two"><label class="f" for="pin-n1">Nouveau<input class="pin" id="pin-n1" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" value="' + esc(sheet.n || '') + '"></label><label class="f" for="pin-n2">Confirmer<input class="pin" id="pin-n2" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" value="' + esc(sheet.n2 || '') + '"></label></div>' +
        (sheet.err ? '<div class="err" role="alert">' + esc(sheet.err) + '</div>' : '') + '<button class="btn full" data-act="pin-save"' + (sheet.busy ? ' disabled' : '') + '>Enregistrer</button>';
    } else if (sheet.type === 'bat') {
      var st = E.statusOf(evs()), t = now(), today = E.dayKey(t), tt = E.totals(E.pieces(evs(), t).filter(function (x) { return x.date === today; }));
      var q = (sheet.q || '').trim().toLowerCase(), bat = batiments();
      h += '<h2>Bâtiments</h2><div class="mute small">Touche l’adresse sur laquelle tu travailles : le temps lui est chargé dès maintenant.</div>' +
        (bat.length > 8 ? '<input class="search" id="q-bat" type="search" placeholder="Chercher une adresse" aria-label="Chercher une adresse" autocomplete="off" value="' + esc(sheet.q || '') + '">' : '') + '<div class="blist">';
      bat.forEach(function (id) {
        var d = dos(id), on = st.t === 'travail' && st.d === id, nm = (d.nom + ' ' + d.code).toLowerCase(), ms = tt.parDossier[id] || 0;
        h += '<button class="brow' + (on ? ' on' : '') + '" data-act="bat-pick" data-d="' + esc(id) + '" data-name="' + esc(nm) + '"' + (q && nm.indexOf(q) < 0 ? ' hidden' : '') + '><span>' + esc(d.nom) + '</span><span class="mute small">' + (on ? 'en cours' : (ms ? E.dur(ms) : '')) + '</span></button>';
      });
      h += '</div>';
    } else if (sheet.type === 'note') {
      var sn = sessionDe(sheet.ev);
      if (sn) {
        var bat1 = estBat(sn.d), ci = sheet.ci || sn.ci || 'D', txt = sheet.txt !== undefined ? sheet.txt : sn.note;
        h += '<h2>Note de fin de travail</h2><div><b>' + esc(dos(sn.d).nom) + '</b></div><div class="mute">' + E.frDate(E.dayKey(sn.start)) + ' · ' + E.hhmm(sn.start) + ' – ' + (sn.closed ? E.hhmm(sn.end) : 'en cours') + '</div>' +
          '<label class="f" for="note-txt">Ce qui a été fait, en deux ou trois mots<input id="note-txt" maxlength="120" autocomplete="off" placeholder="Par exemple : purge radiateurs, 2 téléphones" value="' + esc(txt) + '"></label>';
        if (bat1) h += '<div class="seg c3" role="group" aria-label="Code d’intervention">' + ['D', 'R', 'G'].map(function (c) { return '<button data-act="note-ci" data-c="' + c + '" aria-pressed="' + (ci === c) + '">' + E.CODES[c] + '</button>'; }).join('') + '</div>' +
          '<div class="mute small">Devis : compris dans le devis. Régie : facturé en plus. Garantie : après la mise en service.</div>';
        h += (sheet.err ? '<div class="err" role="alert">' + esc(sheet.err) + '</div>' : '') + '<button class="btn full" data-act="note-save">Enregistrer</button>';
      }
      // Sur un bâtiment la note est obligatoire : pas de bouton Fermer. Le pointage, lui, est déjà enregistré.
      if (sn && sheet.oblig) return '<div class="veil"><div class="sheet" role="dialog" aria-modal="true">' + h + '</div></div>';
    } else if (sheet.type === 'corr') {
      var e = S.evs[sheet.ev];
      if (e) h += '<h2>Corriger une heure</h2><div>' + esc(evLabel(e)) + '</div><div class="mute">Enregistré : ' + E.frDate(E.dayKey(e.ts)) + ' à ' + E.hhmm(e.ts) + '. L’ancienne valeur et ta raison restent dans l’historique et dans l’export.</div>' +
        '<div class="two"><label class="f" for="corr-date">Date réelle<input type="date" id="corr-date" value="' + esc(sheet.dt || E.dayKey(e.ts)) + '"></label><label class="f" for="corr-time">Heure réelle<input type="time" id="corr-time" value="' + esc(sheet.tm || E.hhmm(e.ts)) + '"></label></div>' +
        '<label class="f" for="corr-motif">Raison<input id="corr-motif" placeholder="Par exemple : oubli de fin de journée" maxlength="200" value="' + esc(sheet.mo || '') + '"></label>' +
        (sheet.err ? '<div class="err" role="alert">' + esc(sheet.err) + '</div>' : '') + '<button class="btn full" data-act="corr-send">Enregistrer la correction</button>';
    }
    return '<div class="veil" data-act="close-veil"><div class="sheet" role="dialog" aria-modal="true">' + h + '<button class="btn ghost full" data-act="close">Fermer</button></div></div>';
  }

  /* ---------- rendu ---------- */
  var pendingRender = false;
  function typing() { var a = document.activeElement; return a && root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); }
  function render(force) {
    if (!force && typing()) { pendingRender = true; paintSync(); return; }
    pendingRender = false;
    var m = document.getElementById('main'), sc = m ? m.scrollTop : 0;
    var pin = document.getElementById('lg-pin'), pv = pin ? pin.value : '', sel = document.getElementById('lg-pid'), sv = sel ? sel.value : '';
    root.className = 'app';
    if (!S.token) root.innerHTML = vLogin();
    else if (!S.me) root.innerHTML = '<div class="login">' + LOGO + '<h1>Pointage</h1><div class="mute">' + (netErr ? 'Serveur injoignable. Nouvel essai automatique…' : 'Chargement…') + '</div></div>';
    else root.innerHTML = vApp() + vSheet() + (toastMsg ? '<div class="toast" role="status"><span>' + esc(toastMsg.text) + '</span></div>' : '');
    m = document.getElementById('main'); if (m) m.scrollTop = sc;
    if (pv) { pin = document.getElementById('lg-pin'); if (pin) pin.value = pv; }
    if (sv) { sel = document.getElementById('lg-pid'); if (sel) sel.value = sv; }
  }
  function filterBat(v) {
    v = v.trim().toLowerCase();
    Array.prototype.forEach.call(root.querySelectorAll('.brow'), function (el) { el.hidden = !!v && el.getAttribute('data-name').indexOf(v) < 0; });
  }
  setInterval(function () {
    var t = now();
    Array.prototype.forEach.call(root.querySelectorAll('[data-tick]'), function (el) { el.textContent = E.dur(+el.getAttribute('data-base') + t - +el.getAttribute('data-t0')); });
  }, 1000);
  setInterval(function () { if (S.token) { if (!sheet) render(); sync(); } }, 30000);

  /* ---------- événements ---------- */
  var H = {
    reload: function () { loadPeople(); },
    login: function () { login(); return false; },
    logout: function () { logout(); },
    menu: function () { sheet = { type: 'menu' }; },
    note: function (ds) { var se = sessionDe(ds.ev); if (se) sheet = { type: 'note', ev: se.carrier, oblig: false }; },
    'note-ci': function (ds) { sheet.ci = ds.c; },
    'note-save': function () {
      var se = sessionDe(sheet.ev);
      if (!se) { sheet = null; return; }
      var el = document.getElementById('note-txt'), txt = (el ? el.value : (sheet.txt || '')).replace(/\s+/g, ' ').trim(), bat1 = estBat(se.d);
      sheet.txt = txt;
      if (bat1 && txt.length < 3) { sheet.err = 'Écris deux ou trois mots sur ce qui a été fait.'; return; }
      var ci = bat1 ? (sheet.ci || se.ci || 'D') : '';
      // La note et le code sont portés par la dernière écriture de l'intervention ; les autres sont vidées.
      se.ids.forEach(function (id) {
        var e = S.evs[id];
        if (!e) return;
        var n = id === se.carrier ? txt : '', c = id === se.carrier ? ci : '';
        if ((e.note || '') === n && (e.ci || '') === c) return;
        var x = Object.assign({}, e, { rev: (e.rev || 0) + 1 });
        if (n) x.note = n; else delete x.note;
        if (c) x.ci = c; else delete x.ci;
        S.evs[id] = x; touch(id);
      });
      save();
      var suite = sheet.oblig ? aNoter()[0] : null;
      sheet = suite ? { type: 'note', ev: suite.carrier, oblig: true } : null;
      toast('Note enregistrée.');
      render(true); sync();
      return false;
    },
    pin: function () { sheet = { type: 'pin' }; },
    'pin-save': function () {
      var v = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }, o = v('pin-old'), n = v('pin-n1'), n2 = v('pin-n2');
      var bad = !o ? 'Saisis ton code PIN actuel.' : !/^\d{4,8}$/.test(n) ? 'Le nouveau code PIN doit compter 4 à 8 chiffres.' : n !== n2 ? 'Les deux saisies ne correspondent pas.' : n === o ? 'Le nouveau code est identique à l’ancien.' : '';
      sheet.o = o; sheet.n = n; sheet.n2 = n2; // les saisies survivent au réaffichage
      if (bad) { sheet.err = bad; render(true); return false; }
      sheet.err = ''; sheet.busy = true; render(true);
      api('pin_change', { token: S.token, old: o, new: n }).then(function () { sheet = null; toast('Code PIN changé.'); },
        function (e) { if (sheet) { sheet.busy = false; sheet.err = e.status ? e.message : 'Serveur injoignable. Réessaie avec du réseau.'; } }).then(function () { render(true); });
      return false;
    },
    close: function () { sheet = null; },
    'close-veil': function (ds, el, ev) { if (ev.target === el) sheet = null; else return false; },
    tab: function (ds) { S.tab = ds.t; var m = document.getElementById('main'); if (m) m.scrollTop = 0; },
    bat: function () { sheet = { type: 'bat', q: '' }; },
    'bat-pick': function (ds) { var l = evs(); sheet = null; doAct({ type: 'dossier', d: ds.d, lieu: lieuChoisi(E.statusOf(l), E.ctxOf(l)) }); render(true); return false; },
    dossier: function (ds) { var l = evs(); doAct({ type: 'dossier', d: ds.d, lieu: lieuChoisi(E.statusOf(l), E.ctxOf(l)) }); return false; },
    reprendre: function () { doAct({ type: 'reprendre' }); return false; },
    appel: function () { doAct({ type: 'pause', motif: 'Appel privé' }); return false; },
    pause: function () { doAct({ type: 'pause', motif: 'Pause' }); return false; },
    midi: function () { doAct({ type: 'pause', cat: 'midi', motif: 'Midi' }); return false; },
    cafe: function () { doAct({ type: 'cafe' }); return false; },
    fin: function () { doAct({ type: 'fin' }); return false; },
    lieu: function (ds) {
      var st = E.statusOf(evs());
      if (st.t === 'travail') { doAct({ type: 'lieu', lieu: ds.l }); return false; }
      if (st.t === 'pause') S.lieuPause = ds.l; else S.lieu = ds.l;
    },
    fav: function (ds) { var f = S.favs || (S.favs = []), i = f.indexOf(ds.d); if (i >= 0) f.splice(i, 1); else f.push(ds.d); },
    jour: function (ds) { var today = E.dayKey(now()), n = E.addDays(S.jour || today, +ds.n); S.jour = n >= today ? null : n; },
    corriger: function (ds) { sheet = { type: 'corr', ev: ds.ev }; },
    'corr-send': function () {
      var e = S.evs[sheet.ev], dt = document.getElementById('corr-date').value, tm = document.getElementById('corr-time').value, mo = document.getElementById('corr-motif').value.trim();
      sheet.dt = dt; sheet.tm = tm; sheet.mo = mo;
      if (!e || !dt || !tm) { sheet.err = 'Indique la date et l’heure réelles.'; return; }
      if (mo.length < 3) { sheet.err = 'Indique la raison de la correction.'; return; }
      var neu = E.atTime(dt, tm), t = now();
      if (E.hhmm(neu) === E.hhmm(e.ts) && E.dayKey(neu) === E.dayKey(e.ts)) { sheet.err = 'L’heure proposée est identique à l’heure enregistrée.'; return; }
      var chk = E.canMove(evs(), e.id, neu, t);
      if (!chk.ok) { sheet.err = chk.err; return; }
      e.hist = (e.hist || []).concat([{ old: e.ts, neu: neu, at: t, motif: mo }]);
      e.ts = neu; e.rev = Math.max(t, (e.rev || 0) + 1); touch(e.id); sheet = null;
      toast('Heure corrigée. L’ancienne valeur reste dans l’historique.');
    }
  };
  root.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]'); if (!el || el.disabled) return;
    var fn = H[el.getAttribute('data-act')]; if (!fn) return;
    var prev = toastMsg, res = fn(el.dataset, el, ev);
    if (prev && toastMsg === prev) { toastMsg = null; }
    if (res === false) return;
    save(); render(true); sync();
  });
  root.addEventListener('input', function (ev) { if (ev.target.id === 'q-bat') { if (sheet) sheet.q = ev.target.value; filterBat(ev.target.value); }
    if (ev.target.id === 'note-txt' && sheet) sheet.txt = ev.target.value; });
  root.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && ev.target.id === 'lg-pin') { ev.preventDefault(); login(); } });
  root.addEventListener('focusout', function () { setTimeout(function () { if (pendingRender) render(); }, 50); });
  window.addEventListener('online', function () { online = true; sync(); render(); });
  window.addEventListener('offline', function () { online = false; render(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { render(); sync(); } });

  render();
  if (S.token) sync(); else loadPeople();
})();
