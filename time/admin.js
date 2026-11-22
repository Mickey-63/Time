/* Administration : employés, dossiers (chantiers, immeubles, centres analytiques), affectations, export Excel, réglages.
   Protégée par un mot de passe créé à la première ouverture ; il n'existe que sur le serveur, sous forme hachée. */
(function () {
  'use strict';
  var E = window.Engine, root = document.getElementById('app');
  var esc = window.esc, api = window.api, LOGO = window.LOGO;
  var KEY = 'pointage-admin';
  var token = '';
  try { token = sessionStorage.getItem(KEY) || ''; } catch (e) { }
  var pret = null, cfg = null, tab = 'employes', sheet = null, err = '', busy = false, flash = '', loadErr = false;
  var today = E.dayKey(Date.now());
  var ex = { from: today.slice(0, 8) + '01', to: today, pid: '', soc: '' }, exMsg = '', exErr = '';

  function setToken(t) { token = t || ''; try { if (token) sessionStorage.setItem(KEY, token); else sessionStorage.removeItem(KEY); } catch (e) { } }
  function call(a, body) {
    return api(a, Object.assign({ token: token }, body || {})).catch(function (e) {
      if (e.status === 401) { setToken(''); cfg = null; sheet = null; err = 'Session expirée. Reconnectez-vous.'; render(); }
      throw e;
    });
  }
  function msgOf(e) { return e && e.status ? e.message : 'Serveur injoignable. Vérifiez la connexion.'; }
  function start() {
    loadErr = false;
    api('etat').then(function (r) {
      pret = r.pret;
      if (pret && token) return loadCfg();
    }, function () { loadErr = true; }).then(render);
  }
  function loadCfg() { return call('cfg').then(function (r) { cfg = r; }, function () { }); }
  function socNom(id) { return cfg.socs[id] ? cfg.socs[id].court : id; }
  function byName(a, b) { return (a.prenom + ' ' + a.nom).localeCompare(b.prenom + ' ' + b.nom, 'fr'); }

  /* ---------- vues ---------- */
  function head(sub) {
    return '<header class="bar"><div class="row"><h1>Administration</h1>' + LOGO + '</div><div class="mute small">' + sub + '</div></header>';
  }
  function vGate() {
    var h = head('Pointage GIOT Immobilier SA et OptimalGo SA') + '<main id="main">';
    if (pret === null) return h + '<div class="mute">' + (loadErr ? 'Serveur injoignable.' : 'Chargement…') + '</div>' + (loadErr ? '<button class="btn" data-act="retry">Réessayer</button>' : '') + '</main>';
    if (!pret) {
      h += '<div class="card"><h3>Créer le mot de passe d’administration</h3><div class="mute">Première ouverture : ce mot de passe protège les employés, les dossiers et les exports. Il n’est enregistré que sur votre serveur. Au moins 8 caractères.</div>' +
        '<label class="f" for="pw1">Mot de passe<input id="pw1" type="password" autocomplete="new-password"></label>' +
        '<label class="f" for="pw2">Confirmer<input id="pw2" type="password" autocomplete="new-password"></label>' +
        (err ? '<div class="err" role="alert">' + esc(err) + '</div>' : '') +
        '<button class="btn full" data-act="setup"' + (busy ? ' disabled' : '') + '>Créer le mot de passe</button></div>';
    } else {
      h += '<div class="card"><h3>Connexion</h3><label class="f" for="pw">Mot de passe<input id="pw" type="password" autocomplete="current-password"></label>' +
        (err ? '<div class="err" role="alert">' + esc(err) + '</div>' : '') +
        '<button class="btn full" data-act="alogin"' + (busy ? ' disabled' : '') + '>Se connecter</button></div>';
    }
    return h + '<a class="lnk" href="etat.html">Voir le tableau d’équipe</a></main>';
  }
  function tabsBar() {
    var list = [['employes', 'Employés'], ['dossiers', 'Dossiers'], ['export', 'Export Excel'], ['reglages', 'Réglages']];
    return '<nav class="tabs" aria-label="Sections">' + list.map(function (t) { return '<button data-act="tab" data-t="' + t[0] + '" aria-current="' + (t[0] === tab) + '">' + t[1] + '</button>'; }).join('') + '</nav>';
  }
  function vEmployes() {
    var h = '<button class="btn full" data-act="emp-new">Ajouter un employé</button>';
    if (!cfg.employes.length) return h + '<div class="note">Aucun employé pour l’instant. Chaque employé se connecte ensuite sur la page de pointage avec son nom et son code PIN.</div>';
    h += '<div class="card lst">';
    cfg.employes.slice().sort(byName).forEach(function (e) {
      var nb = e.tous ? 'tous les dossiers' : (e.dossiers.length + ' dossier' + (e.dossiers.length > 1 ? 's' : ''));
      h += '<div class="row' + (e.actif ? '' : ' off') + '"><div><div class="nm">' + esc(e.prenom + ' ' + e.nom) + '</div><div class="mute small">' + esc(e.socs.map(socNom).join(' et ')) + ' · ' + nb + (e.midi ? ' · midi 60 min' : '') + (e.actif ? '' : ' · désactivé') + '</div></div>' +
        '<button class="btn ghost sm" data-act="emp-edit" data-id="' + esc(e.id) + '">Modifier</button></div>';
    });
    return h + '</div>';
  }
  function vDossiers() {
    var h = '<button class="btn full" data-act="dos-new">Ajouter un dossier</button>' +
      '<div class="mute small">Un dossier est ce sur quoi on charge le temps : chantier, immeuble ou centre analytique. Le code analytique figure dans l’export Excel.</div>';
    if (!cfg.dossiers.length) return h + '<div class="note">Aucun dossier pour l’instant. Sans dossier, personne ne peut pointer.</div>';
    Object.keys(cfg.socs).forEach(function (s) {
      var list = cfg.dossiers.filter(function (d) { return d.soc === s; }).sort(function (a, b) { return (b.actif - a.actif) || a.nom.localeCompare(b.nom, 'fr'); });
      if (!list.length) return;
      h += '<div class="card lst"><div class="sec"><span>' + esc(cfg.socs[s].nom) + '</span><span>' + list.length + '</span></div>';
      list.forEach(function (d) {
        h += '<div class="row' + (d.actif ? '' : ' off') + '"><div><div class="nm">' + esc(d.nom) + '</div><div class="mute small">' + (d.code ? esc(d.code) : 'sans code analytique') + (d.actif ? '' : ' · archivé') + '</div></div>' +
          '<button class="btn ghost sm" data-act="dos-edit" data-id="' + esc(d.id) + '">Modifier</button></div>';
      });
      h += '</div>';
    });
    return h;
  }
  function vExport() {
    var opt = function (v, l, cur) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(l) + '</option>'; };
    return '<div class="card"><div class="btns"><button class="btn ghost sm" data-act="ex-p" data-p="mois">Ce mois</button><button class="btn ghost sm" data-act="ex-p" data-p="prec">Mois dernier</button><button class="btn ghost sm" data-act="ex-p" data-p="an">Cette année</button></div>' +
      '<div class="two"><label class="f" for="ex-from">Du<input type="date" id="ex-from" data-ex="from" value="' + esc(ex.from) + '"></label><label class="f" for="ex-to">Au<input type="date" id="ex-to" data-ex="to" value="' + esc(ex.to) + '"></label></div>' +
      '<label class="f" for="ex-pid">Collaborateur<select id="ex-pid" data-ex="pid">' + opt('', 'Tous', ex.pid) + cfg.employes.slice().sort(byName).map(function (p) { return opt(p.id, p.prenom + ' ' + p.nom + (p.actif ? '' : ' (désactivé)'), ex.pid); }).join('') + '</select></label>' +
      '<label class="f" for="ex-soc">Société<select id="ex-soc" data-ex="soc">' + opt('', 'Toutes', ex.soc) + Object.keys(cfg.socs).map(function (s) { return opt(s, cfg.socs[s].nom, ex.soc); }).join('') + '</select></label>' +
      (exErr ? '<div class="err" role="alert">' + esc(exErr) + '</div>' : '') + (exMsg ? '<div class="ok-msg" role="status">' + esc(exMsg) + '</div>' : '') +
      '<button class="btn full" data-act="export"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Préparation…' : 'Télécharger le classeur .xlsx') + '</button></div>' +
      '<div class="mute small">Trois feuilles : Détail (chaque plage avec début, fin, dossier, code analytique), Par dossier, Par collaborateur. Dates et durées numériques, cumuls au-delà de 24 h, minuit ventilé sur deux dates. Une plage encore ouverte est marquée « Provisoire », une heure corrigée « Oui » dans la colonne Corrigé.</div>';
  }
  function vReglages() {
    var R = cfg.regles, base = location.href.replace(/[^/]*([?#].*)?$/, '');
    var num = function (id, lab, v) { return '<label class="f" for="rg-' + id + '">' + lab + '<input type="number" inputmode="numeric" min="0" max="240" id="rg-' + id + '" value="' + v + '"></label>'; };
    return '<div class="card"><div class="sec"><span>Adresses à transmettre</span></div>' +
      '<div class="row"><div><div>Tableau d’équipe, public</div><div class="mute small">' + esc(base) + 'etat.html</div></div><a class="btn ghost sm" href="etat.html">Ouvrir</a></div>' +
      '<div class="row"><div><div>Page de pointage des employés</div><div class="mute small">' + esc(base) + '</div></div><a class="btn ghost sm" href="index.html">Ouvrir</a></div></div>' +
      '<div class="card"><div class="sec"><span>Règles</span><span>minutes</span></div><div class="two">' + num('midiMin', 'Midi obligatoire', R.midiMin) + num('midiEx', 'Exception hebdo.', R.midiEx) + num('rappelPause', 'Rappel pause', R.rappelPause) + num('rappelMidi', 'Rappel midi', R.rappelMidi) + '</div>' +
      '<div class="mute small">Pauses légales fixes : plus de 5 h 30 → 15 min, plus de 7 h → 30 min, plus de 9 h → 60 min. Les écarts sont signalés à l’employé, jamais déduits. La règle du midi ne s’applique qu’aux employés chez qui elle est cochée.</div>' +
      '<button class="btn" data-act="regles">Enregistrer les règles</button></div>' +
      '<div class="card"><div class="sec"><span>Mot de passe d’administration</span></div>' +
      '<label class="f" for="pw-old">Mot de passe actuel<input id="pw-old" type="password" autocomplete="current-password"></label>' +
      '<div class="two"><label class="f" for="pw-new">Nouveau<input id="pw-new" type="password" autocomplete="new-password"></label><label class="f" for="pw-new2">Confirmer<input id="pw-new2" type="password" autocomplete="new-password"></label></div>' +
      (err ? '<div class="err" role="alert">' + esc(err) + '</div>' : '') +
      '<button class="btn" data-act="apass">Changer le mot de passe</button></div>' +
      '<button class="btn ghost full" data-act="alogout">Se déconnecter</button>';
  }
  function vSheet() {
    if (!sheet) return '';
    var x = sheet.x, h = '';
    var chk = function (attr, on, lab) { return '<label class="chk"><input type="checkbox" ' + attr + (on ? ' checked' : '') + '>' + lab + '</label>'; };
    if (sheet.type === 'emp') {
      h += '<h2>' + (x.id ? 'Modifier l’employé' : 'Nouvel employé') + '</h2>' +
        '<div class="two"><label class="f" for="e-prenom">Prénom<input id="e-prenom" data-f="prenom" maxlength="40" value="' + esc(x.prenom) + '"></label><label class="f" for="e-nom">Nom<input id="e-nom" data-f="nom" maxlength="40" value="' + esc(x.nom) + '"></label></div>' +
        '<label class="f" for="e-pin">Code PIN (4 à 8 chiffres)<input id="e-pin" data-f="pin" inputmode="numeric" maxlength="8" autocomplete="off" placeholder="' + (x.id ? 'Laisser vide pour le conserver' : 'Obligatoire') + '" value="' + esc(x.pin || '') + '"></label>' +
        '<div class="sec"><span>Société</span></div><div class="checks">' + Object.keys(cfg.socs).map(function (s) { return chk('data-soc="' + s + '"', x.socs.indexOf(s) >= 0, esc(cfg.socs[s].nom)); }).join('') + '</div>' +
        '<div class="sec"><span>Dossiers où il charge son temps</span></div>' + chk('data-b="tous"', x.tous, 'Tous les dossiers de sa société, y compris les futurs');
      if (!x.tous) {
        var list = cfg.dossiers.filter(function (d) { return x.socs.indexOf(d.soc) >= 0 && (d.actif || x.dossiers.indexOf(d.id) >= 0); }).sort(function (a, b) { return a.nom.localeCompare(b.nom, 'fr'); });
        h += list.length ? '<div class="checks">' + list.map(function (d) { return chk('data-dos="' + esc(d.id) + '"', x.dossiers.indexOf(d.id) >= 0, esc(d.nom) + (d.code ? ' <span class="mute small">' + esc(d.code) + '</span>' : '') + (d.actif ? '' : ' <span class="mute small">archivé</span>')); }).join('') + '</div>'
          : '<div class="mute small">Aucun dossier pour cette société. Créez-les dans l’onglet Dossiers.</div>';
      }
      h += chk('data-b="midi"', x.midi, 'Midi obligatoire de ' + cfg.regles.midiMin + ' min (règle GIOT)') + chk('data-b="actif"', x.actif, 'Actif : peut pointer et figure au tableau d’équipe');
    } else if (sheet.type === 'dos') {
      h += '<h2>' + (x.id ? 'Modifier le dossier' : 'Nouveau dossier') + '</h2>' +
        '<label class="f" for="d-nom">Nom (chantier, immeuble, centre)<input id="d-nom" data-f="nom" maxlength="60" value="' + esc(x.nom) + '"></label>' +
        '<label class="f" for="d-code">Code analytique<input id="d-code" data-f="code" maxlength="30" value="' + esc(x.code) + '"></label>' +
        '<label class="f" for="d-soc">Société<select id="d-soc" data-f="soc">' + Object.keys(cfg.socs).map(function (s) { return '<option value="' + s + '"' + (s === x.soc ? ' selected' : '') + '>' + esc(cfg.socs[s].nom) + '</option>'; }).join('') + '</select></label>' +
        chk('data-b="actif"', x.actif, 'Actif : proposé au pointage (décocher pour archiver)');
    }
    h += (sheet.err ? '<div class="err" role="alert">' + esc(sheet.err) + '</div>' : '') +
      '<button class="btn full" data-act="' + sheet.type + '-save"' + (busy ? ' disabled' : '') + '>Enregistrer</button>' +
      (x.id ? '<button class="btn ghost full" data-act="' + sheet.type + '-del"' + (busy ? ' disabled' : '') + '>Supprimer</button>' : '');
    return '<div class="veil" data-act="close-veil"><div class="sheet" role="dialog" aria-modal="true">' + h + '<button class="btn ghost full" data-act="close">Fermer</button></div></div>';
  }
  function render() {
    var m = document.getElementById('main'), sc = m ? m.scrollTop : 0, sh = root.querySelector('.sheet'), ssc = sh ? sh.scrollTop : 0;
    if (!cfg) { root.innerHTML = vGate(); return; }
    var body = tab === 'dossiers' ? vDossiers() : tab === 'export' ? vExport() : tab === 'reglages' ? vReglages() : vEmployes();
    var actifs = cfg.employes.filter(function (e) { return e.actif; }).length, dAct = cfg.dossiers.filter(function (d) { return d.actif; }).length;
    root.innerHTML = head(actifs + ' employé' + (actifs > 1 ? 's' : '') + ' actif' + (actifs > 1 ? 's' : '') + ', ' + dAct + ' dossier' + (dAct > 1 ? 's' : '') + ' ouvert' + (dAct > 1 ? 's' : '')) +
      '<main id="main">' + (flash ? '<div class="ok-msg" role="status">' + esc(flash) + '</div>' : '') + body + '</main>' + tabsBar() + vSheet();
    m = document.getElementById('main'); if (m) m.scrollTop = sc;
    sh = root.querySelector('.sheet'); if (sh) sh.scrollTop = ssc;
  }

  /* ---------- actions ---------- */
  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function run(p, okMsg) {
    busy = true; render();
    return p.then(function (r) { busy = false; if (okMsg) flash = okMsg; return r; }, function (e) { busy = false; throw e; });
  }
  function download(name, bytes) {
    var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
  }
  var H = {
    retry: function () { start(); },
    tab: function (ds) { tab = ds.t; err = ''; flash = ''; exMsg = ''; exErr = ''; var m = document.getElementById('main'); if (m) m.scrollTop = 0; },
    close: function () { sheet = null; },
    'close-veil': function (ds, el, ev) { if (ev.target === el) sheet = null; else return false; },
    setup: function () {
      var a = val('pw1'), b = val('pw2');
      if (a.length < 8) { err = 'Au moins 8 caractères.'; return; }
      if (a !== b) { err = 'Les deux saisies ne correspondent pas.'; return; }
      err = '';
      run(api('setup', { password: a })).then(function (r) { setToken(r.token); pret = true; return loadCfg(); }, function (e) { err = msgOf(e); }).then(render);
      return false;
    },
    alogin: function () {
      err = '';
      run(api('alogin', { password: val('pw') })).then(function (r) { setToken(r.token); return loadCfg(); }, function (e) { err = msgOf(e); }).then(render);
      return false;
    },
    alogout: function () { var t = token; setToken(''); cfg = null; err = ''; flash = ''; api('logout', { token: t }).catch(function () { }); },
    'emp-new': function () { sheet = { type: 'emp', x: { id: '', prenom: '', nom: '', pin: '', socs: Object.keys(cfg.socs).slice(0, 1), tous: true, dossiers: [], midi: false, actif: true } }; },
    'emp-edit': function (ds) {
      var e = cfg.employes.filter(function (p) { return p.id === ds.id; })[0]; if (!e) return;
      sheet = { type: 'emp', x: { id: e.id, prenom: e.prenom, nom: e.nom, pin: '', socs: e.socs.slice(), tous: !!e.tous, dossiers: (e.dossiers || []).slice(), midi: !!e.midi, actif: !!e.actif } };
    },
    'emp-save': function () {
      var x = sheet.x; sheet.err = '';
      if (!x.prenom.trim()) { sheet.err = 'Le prénom est obligatoire.'; return; }
      if (!x.socs.length) { sheet.err = 'Choisissez au moins une société.'; return; }
      if (x.pin && !/^\d{4,8}$/.test(x.pin)) { sheet.err = 'Le code PIN doit compter 4 à 8 chiffres.'; return; }
      if (!x.id && !x.pin) { sheet.err = 'Un code PIN est obligatoire pour un nouvel employé.'; return; }
      run(call('emp_save', { emp: x }), 'Employé enregistré.').then(function (r) {
        var i = -1; cfg.employes.forEach(function (p, k) { if (p.id === r.emp.id) i = k; });
        if (i >= 0) cfg.employes[i] = r.emp; else cfg.employes.push(r.emp);
        sheet = null;
      }, function (e) { if (sheet) sheet.err = msgOf(e); }).then(render);
      return false;
    },
    'emp-del': function () {
      if (!sheet.sure) { sheet.sure = true; sheet.err = 'Appuyez une seconde fois sur Supprimer pour confirmer.'; return; }
      var id = sheet.x.id;
      run(call('emp_del', { id: id }), 'Employé supprimé.').then(function () { cfg.employes = cfg.employes.filter(function (p) { return p.id !== id; }); sheet = null; }, function (e) { if (sheet) { sheet.err = msgOf(e); sheet.sure = false; } }).then(render);
      return false;
    },
    'dos-new': function () { sheet = { type: 'dos', x: { id: '', nom: '', code: '', soc: sheet && sheet.x ? sheet.x.soc : (cfg.lastSoc || Object.keys(cfg.socs)[0]), actif: true } }; },
    'dos-edit': function (ds) {
      var d = cfg.dossiers.filter(function (p) { return p.id === ds.id; })[0]; if (!d) return;
      sheet = { type: 'dos', x: { id: d.id, nom: d.nom, code: d.code || '', soc: d.soc, actif: !!d.actif } };
    },
    'dos-save': function () {
      var x = sheet.x; sheet.err = '';
      if (!x.nom.trim()) { sheet.err = 'Le nom est obligatoire.'; return; }
      run(call('dos_save', { dos: x }), 'Dossier enregistré.').then(function (r) {
        var i = -1; cfg.dossiers.forEach(function (p, k) { if (p.id === r.dos.id) i = k; });
        if (i >= 0) cfg.dossiers[i] = r.dos; else cfg.dossiers.push(r.dos);
        cfg.lastSoc = r.dos.soc; sheet = null;
      }, function (e) { if (sheet) sheet.err = msgOf(e); }).then(render);
      return false;
    },
    'dos-del': function () {
      if (!sheet.sure) { sheet.sure = true; sheet.err = 'Appuyez une seconde fois sur Supprimer pour confirmer.'; return; }
      var id = sheet.x.id;
      run(call('dos_del', { id: id }), 'Dossier supprimé.').then(function () {
        cfg.dossiers = cfg.dossiers.filter(function (p) { return p.id !== id; });
        cfg.employes.forEach(function (p) { p.dossiers = (p.dossiers || []).filter(function (d) { return d !== id; }); });
        sheet = null;
      }, function (e) { if (sheet) { sheet.err = msgOf(e); sheet.sure = false; } }).then(render);
      return false;
    },
    'ex-p': function (ds) {
      var t = E.dayKey(Date.now()), y = +t.slice(0, 4), mo = +t.slice(5, 7);
      if (ds.p === 'mois') { ex.from = t.slice(0, 8) + '01'; ex.to = t; }
      else if (ds.p === 'an') { ex.from = y + '-01-01'; ex.to = t; }
      else { var py = mo === 1 ? y - 1 : y, pm = mo === 1 ? 12 : mo - 1; ex.from = py + '-' + E.pad(pm) + '-01'; ex.to = E.addDays(t.slice(0, 8) + '01', -1); }
      exMsg = ''; exErr = '';
    },
    export: function () {
      exMsg = ''; exErr = '';
      if (!ex.from || !ex.to || ex.from > ex.to) { exErr = 'Vérifiez les dates : le début doit précéder la fin.'; return; }
      run(call('export', { from: ex.from })).then(function (r) {
        var ds = {}; r.dossiers.forEach(function (d) { ds[d.id] = d; });
        var people = r.employes.slice().sort(byName), now = Date.now();
        var wb = E.workbook({ people: people, dossiers: ds, socs: r.socs, evs: function (pid) { return r.events[pid] || []; } }, { from: ex.from, to: ex.to, pid: ex.pid, soc: ex.soc }, now);
        if (!wb.totals.lignes) { exErr = 'Aucun pointage sur cette période avec ces filtres.'; return; }
        var name = 'Heures_' + ex.from + '_au_' + ex.to + '.xlsx';
        download(name, window.XlsxLite.build(wb.sheets));
        exMsg = name + ' : ' + wb.totals.lignes + ' lignes, ' + E.dur(wb.totals.parCollab) + ' de travail, ' + E.dur(wb.totals.pauses) + ' de pauses.';
      }, function (e) { exErr = msgOf(e); }).then(render);
      return false;
    },
    regles: function () {
      var R = {}; ['midiMin', 'midiEx', 'rappelPause', 'rappelMidi'].forEach(function (k) { R[k] = parseInt(val('rg-' + k), 10) || 0; });
      run(call('regles_save', { regles: R }), 'Règles enregistrées.').then(function (r) { cfg.regles = r.regles; }, function (e) { err = msgOf(e); }).then(render);
      return false;
    },
    apass: function () {
      var o = val('pw-old'), n = val('pw-new'), n2 = val('pw-new2'); flash = '';
      if (n.length < 8) { err = 'Le nouveau mot de passe doit compter au moins 8 caractères.'; return; }
      if (n !== n2) { err = 'Les deux saisies ne correspondent pas.'; return; }
      err = '';
      run(call('apass', { old: o, new: n }), 'Mot de passe changé.').then(function () { }, function (e) { err = msgOf(e); }).then(render);
      return false;
    }
  };
  root.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]'); if (!el || el.disabled) return;
    var fn = H[el.getAttribute('data-act')]; if (!fn) return;
    if (!/-(save|del)$|^(regles|apass|export|setup|alogin)$/.test(el.getAttribute('data-act'))) flash = '';
    if (fn(el.dataset, el, ev) === false) return;
    render();
  });
  root.addEventListener('input', function (ev) {
    var t = ev.target;
    if (sheet && t.hasAttribute('data-f') && t.tagName !== 'SELECT') sheet.x[t.getAttribute('data-f')] = t.value;
  });
  root.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.hasAttribute('data-ex')) { ex[t.getAttribute('data-ex')] = t.value; exMsg = ''; exErr = ''; return; }
    if (!sheet) return;
    var x = sheet.x;
    if (t.hasAttribute('data-f')) { x[t.getAttribute('data-f')] = t.value; return; }
    if (t.hasAttribute('data-b')) x[t.getAttribute('data-b')] = t.checked;
    else if (t.hasAttribute('data-soc')) { var s = t.getAttribute('data-soc'), i = x.socs.indexOf(s); if (t.checked && i < 0) x.socs.push(s); if (!t.checked && i >= 0) x.socs.splice(i, 1); }
    else if (t.hasAttribute('data-dos')) { var d = t.getAttribute('data-dos'), k = x.dossiers.indexOf(d); if (t.checked && k < 0) x.dossiers.push(d); if (!t.checked && k >= 0) x.dossiers.splice(k, 1); return; }
    else return;
    render();
  });
  root.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter') return;
    if (ev.target.id === 'pw') { ev.preventDefault(); H.alogin(); }
    if (ev.target.id === 'pw2') { ev.preventDefault(); if (H.setup() !== false) render(); }
  });

  render();
  start();
})();
