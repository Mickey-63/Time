/* Administration : employés, centres analytiques (communs à tous ou attribués), affectations, export Excel, réglages, documents.
   Protégée par un mot de passe créé à la première ouverture ; il n'existe que sur le serveur, sous forme hachée. */
(function () {
  'use strict';
  var E = window.Engine, root = document.getElementById('app');
  var esc = window.esc, api = window.api, LOGO = window.LOGO;
  var KEY = 'pointage-admin';
  var token = '';
  try { token = sessionStorage.getItem(KEY) || ''; } catch (e) { }
  var pret = null, cfg = null, tab = 'employes', sheet = null, err = '', busy = false, flash = '', loadErr = false, prov = '', info = '';
  var PW_MIN = 6;
  var today = E.dayKey(Date.now());
  var ex = { from: today.slice(0, 8) + '01', to: today, pid: '', soc: '' }, exMsg = '', exErr = '';
  // Documents (synthèses, rapports) : la liste vient du serveur, chaque PDF n'est chargé qu'à la demande.
  var docs = null, docErr = '', docMsg = '', docBusy = '', docF = {};
  var appli = !!navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);

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
  function dosById(id) { return cfg.dossiers.filter(function (d) { return d.id === id; })[0]; }
  function byNom(a, b) { return a.nom.localeCompare(b.nom, 'fr', { numeric: true }); }
  function byName(a, b) { return (a.prenom + ' ' + a.nom).localeCompare(b.prenom + ' ' + b.nom, 'fr'); }

  /* ---------- vues ---------- */
  function head(sub) {
    return '<header class="bar"><div class="row"><h1>Administration</h1>' + LOGO + '</div><div class="mute small">' + sub + '</div></header>';
  }
  function vGate() {
    var h = head('GIOT Immobilier SA et OptimalGo SA') + '<main id="main">';
    if (pret === null) return h + '<div class="mute">' + (loadErr ? 'Serveur injoignable.' : 'Chargement…') + '</div>' + (loadErr ? '<button class="btn" data-act="retry">Réessayer</button>' : '') + '</main>';
    if (!pret) {
      h += '<div class="card"><h3>Créer le mot de passe d’administration</h3><div class="mute">Première ouverture : ce mot de passe protège les employés, les centres analytiques et les exports. Il n’est enregistré que sur votre serveur. Au moins ' + PW_MIN + ' caractères.</div>' +
        '<label class="f" for="pw1">Mot de passe<input id="pw1" type="password" autocomplete="new-password"></label>' +
        '<label class="f" for="pw2">Confirmer<input id="pw2" type="password" autocomplete="new-password"></label>' +
        (err ? '<div class="err" role="alert">' + esc(err) + '</div>' : '') +
        '<button class="btn full" data-act="setup"' + (busy ? ' disabled' : '') + '>Créer le mot de passe</button></div>';
    } else {
      h += '<div class="card"><h3>Connexion</h3><label class="f" for="pw">Mot de passe<input id="pw" type="password" autocomplete="current-password"></label>' +
        (err ? '<div class="err" role="alert">' + esc(err) + '</div>' : '') +
        (info ? '<div class="ok-msg" role="status">' + esc(info) + '</div>' : '') +
        '<button class="btn full" data-act="alogin"' + (busy ? ' disabled' : '') + '>Se connecter</button>' +
        '<button class="btn ghost full" data-act="oubli"' + (busy ? ' disabled' : '') + '>Mot de passe oublié</button></div>';
    }
    return h + '<a class="lnk" href="etat.html">Voir le tableau d’équipe</a></main>';
  }
  // Connexion avec le mot de passe provisoire reçu par e-mail : on choisit tout de suite le nouveau.
  function vProv() {
    return head('GIOT Immobilier SA et OptimalGo SA') + '<main id="main"><div class="card"><h3>Choisir un nouveau mot de passe</h3>' +
      '<div class="mute">Vous êtes connecté avec le mot de passe provisoire. Choisissez maintenant le vôtre : au moins ' + PW_MIN + ' caractères.</div>' +
      '<label class="f" for="pn1">Nouveau mot de passe<input id="pn1" type="password" autocomplete="new-password"></label>' +
      '<label class="f" for="pn2">Confirmer<input id="pn2" type="password" autocomplete="new-password"></label>' +
      (err ? '<div class="err" role="alert">' + esc(err) + '</div>' : '') +
      '<button class="btn full" data-act="prov-save"' + (busy ? ' disabled' : '') + '>Enregistrer</button></div></main>';
  }
  function tabsBar() {
    var list = [['employes', 'Employés'], ['dossiers', 'Centres'], ['absences', 'Absences'], ['export', 'Export'], ['reglages', 'Réglages'], ['docs', 'Docs']];
    return '<nav class="tabs" aria-label="Sections">' + list.map(function (t) { return '<button data-act="tab" data-t="' + t[0] + '" aria-current="' + (t[0] === tab) + '">' + t[1] + '</button>'; }).join('') + '</nav>';
  }
  function vEmployes() {
    var h = '<button class="btn full" data-act="emp-new">Ajouter un employé</button>';
    if (!cfg.employes.length) return h + '<div class="note">Aucun employé pour l’instant. Chaque employé se connecte ensuite sur la page de pointage avec son nom et son code PIN.</div>';
    h += '<div class="card lst">';
    cfg.employes.slice().sort(byName).forEach(function (e) {
      var nA = e.dossiers.filter(function (id) { var d = dosById(id); return d && d.actif && !d.commun; }).length;
      var nC = cfg.dossiers.filter(function (d) { return d.actif && d.commun && e.socs.indexOf(d.soc) >= 0; }).length;
      var nb = nA ? nA + ' bâtiment' + (nA > 1 ? 's' : '') + ' épinglé' + (nA > 1 ? 's' : '') : 'aucun bâtiment épinglé';
      h += '<div class="row' + (e.actif ? '' : ' off') + '"><div><div class="nm">' + esc(e.prenom + ' ' + e.nom) + '</div><div class="mute small">' + esc(e.socs.map(socNom).join(' et ')) + ' · ' + nb + (e.midi ? ' · midi 60 min' : '') + (e.tableau === false ? ' · hors tableau' : '') + (e.actif ? '' : ' · désactivé') + '</div></div>' +
        '<button class="btn ghost sm" data-act="emp-edit" data-id="' + esc(e.id) + '">Modifier</button></div>';
    });
    return h + '</div>';
  }
  function vDossiers() {
    var h = '<div class="btns"><button class="btn" data-act="dos-new">Ajouter un centre</button><button class="btn ghost" data-act="imp-new">Importer une liste</button>' + (cfg.dossiers.length ? '<button class="btn ghost" data-act="dos-xlsx">Exporter la liste</button>' : '') + '</div>' +
      '<div class="mute small">Un centre analytique est ce sur quoi on charge le temps. Les centres communs s’affichent d’office sur l’écran de tous les employés de la société. Les autres (adresses d’immeubles, chantiers) sont accessibles à tous par le bouton Bâtiments.</div>';
    if (!cfg.dossiers.length) return h + '<div class="note">Aucun centre pour l’instant. Sans centre, personne ne peut pointer.</div>';
    var ligne = function (d) {
      return '<div class="row' + (d.actif ? '' : ' off') + '"><div><div class="nm">' + esc(d.nom) + (d.defaut ? ' <span class="badge">par défaut</span>' : '') + '</div><div class="mute small">' + (d.code ? esc(d.code) : 'sans code analytique') + (d.actif ? '' : ' · archivé') + '</div></div>' +
        '<button class="btn ghost sm" data-act="dos-edit" data-id="' + esc(d.id) + '">Modifier</button></div>';
    };
    Object.keys(cfg.socs).forEach(function (s) {
      var tri = function (a, b) { return (b.actif - a.actif) || ((b.defaut ? 1 : 0) - (a.defaut ? 1 : 0)) || byNom(a, b); };
      var com = cfg.dossiers.filter(function (d) { return d.soc === s && d.commun; }).sort(tri), att = cfg.dossiers.filter(function (d) { return d.soc === s && !d.commun; }).sort(tri);
      if (!com.length && !att.length) return;
      h += '<h3 class="soc">' + esc(cfg.socs[s].nom) + '</h3>';
      if (com.length) h += '<div class="card lst"><div class="sec"><span>Centres communs · tous les employés</span><span>' + com.length + '</span></div>' + com.map(ligne).join('') + '</div>';
      if (att.length) h += '<div class="card lst"><div class="sec"><span>Bâtiments · bouton Bâtiments</span><span>' + att.length + '</span></div>' + att.map(ligne).join('') + '</div>';
    });
    return h;
  }
  /* Absences : saisies ici par le bureau, à partir de la fiche remise par l'employé. Jamais par l'employé lui-même. */
  function jm(k) { var a = k.split('-'); return a[2] + '.' + a[1] + '.' + a[0]; }
  function absQui(a) {
    if (a.pid === '*') return 'Tous les employés';
    var e = cfg.employes.filter(function (p) { return p.id === a.pid; })[0];
    return e ? e.prenom + ' ' + e.nom : 'Employé supprimé';
  }
  function nj(n) { return String(n).replace('.', ',') + ' jour' + (n >= 2 ? 's' : '') + ' ouvré' + (n >= 2 ? 's' : ''); }
  function vAbsences() {
    var L = cfg.absences || [], an = today.slice(0, 4);
    var h = '<button class="btn full" data-act="abs-new">Saisir une absence</button>' +
      '<div class="mute small">Vacances, maladie, accident, jour férié : c’est le bureau qui les saisit ici, d’après la fiche remise par l’employé. L’employé ne peut pas les saisir lui-même ; il les voit dans son onglet Journée. Au tableau d’équipe, seuls « En vacances » et « Jour férié » s’affichent ; maladie et accident restent un simple « Absent ».</div>';
    if (!L.length) return h + '<div class="note">Aucune absence saisie pour l’instant.</div>';
    var ligne = function (a) {
      var n = E.joursAbs(a, null, null, a.type === 'ferie' ? null : E.feriesDe(L, a.pid));
      return '<div class="row"><div><div class="nm">' + esc(absQui(a)) + ' <span class="badge">' + esc(E.ABS[a.type] || a.type) + '</span></div><div class="mute small">' +
        (a.du === a.au ? 'le ' + jm(a.du) : 'du ' + jm(a.du) + ' au ' + jm(a.au)) + ' · ' + (a.demi ? 'demi-journée' : nj(n)) + (a.note ? ' · ' + esc(a.note) : '') + '</div></div>' +
        '<button class="btn ghost sm" data-act="abs-edit" data-id="' + esc(a.id) + '">Modifier</button></div>';
    };
    var cours = L.filter(function (a) { return a.au >= today; }).sort(function (a, b) { return a.du < b.du ? -1 : a.du > b.du ? 1 : 0; });
    var pass = L.filter(function (a) { return a.au < today; }).sort(function (a, b) { return a.du < b.du ? 1 : a.du > b.du ? -1 : 0; });
    if (cours.length) h += '<div class="card lst"><div class="sec"><span>En cours et à venir</span><span>' + cours.length + '</span></div>' + cours.map(ligne).join('') + '</div>';
    // Décompte de l'année : jours ouvrés par employé et par type, jours fériés déduits des vacances.
    var f = { from: an + '-01-01', to: an + '-12-31' }, par = {};
    E.absLignes(L, cfg.employes, f).forEach(function (x) {
      if (x.a.type === 'ferie') return;
      var o = par[x.p.id] || (par[x.p.id] = { p: x.p, t: {} });
      o.t[x.a.type] = (o.t[x.a.type] || 0) + x.jours;
    });
    var ids = Object.keys(par).sort(function (a, b) { return byName(par[a].p, par[b].p); });
    if (ids.length) {
      h += '<div class="card lst"><div class="sec"><span>Décompte ' + an + '</span><span>jours ouvrés</span></div>';
      ids.forEach(function (id) {
        var o = par[id];
        h += '<div class="row"><div><div class="nm">' + esc(o.p.prenom + ' ' + o.p.nom) + '</div><div class="mute small">' +
          ['vacances', 'maladie', 'accident', 'autre'].filter(function (k) { return o.t[k]; }).map(function (k) { return E.ABS[k] + ' ' + String(o.t[k]).replace('.', ','); }).join(' · ') + '</div></div></div>';
      });
      h += '</div>';
    }
    if (pass.length) h += '<div class="card lst"><div class="sec"><span>Passées</span><span>' + pass.length + '</span></div>' + pass.slice(0, 40).map(ligne).join('') + '</div>' +
      (pass.length > 40 ? '<div class="mute small">Les 40 plus récentes. Les autres sortent dans l’export.</div>' : '');
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
      '<div class="mute small">Cinq feuilles : Détail (chaque plage avec début, fin, centre, code analytique, code d’intervention et note), Par centre, Par collaborateur, Absences (vacances, maladie, accident, jours fériés de la période, avec les jours ouvrés et les totaux par personne) et Centres (la liste complète des centres et bâtiments, à garder comme sauvegarde). Dates et durées numériques, cumuls au-delà de 24 h, minuit ventilé sur deux dates. Une plage encore ouverte est marquée « Provisoire », une heure corrigée « Oui » dans la colonne Corrigé.</div>';
  }
  function partageable(f) { try { return !!(window.File && navigator.canShare && navigator.canShare({ files: [f] })); } catch (e) { return false; } }
  function vDocs() {
    var h = '<div class="mute small">Synthèses et rapports du projet, déposés par Claude. Ils ne se lisent qu’ici, avec le mot de passe d’administration : les employés n’y ont pas accès.</div>' +
      (docErr ? '<div class="err" role="alert">' + esc(docErr) + '</div>' : '') + (docMsg ? '<div class="ok-msg" role="status">' + esc(docMsg) + '</div>' : '');
    if (!docs) return h + (docErr ? '<button class="btn ghost full" data-act="docs-load">Réessayer</button>' : '<div class="note">Chargement…</div>');
    if (!docs.length) return h + '<div class="note">Aucun document pour l’instant.</div>';
    h += '<div class="card lst">';
    docs.forEach(function (d) {
      var f = docF[d.id], b;
      if (!f) b = '<button class="btn sm" data-act="doc-open" data-id="' + esc(d.id) + '"' + (docBusy ? ' disabled' : '') + '>' + (docBusy === d.id ? 'Chargement…' : 'Ouvrir') + '</button>';
      else b = (partageable(f.file) ? '<button class="btn sm" data-act="doc-share" data-id="' + esc(d.id) + '">Enregistrer ou imprimer</button>' : '') +
        (appli ? '' : '<a class="btn ghost sm" href="' + f.url + '" download="' + esc(d.nom) + '" target="_blank" rel="noopener">Télécharger</a>');
      h += '<div class="row top"><div><b>' + esc(d.titre) + '</b><div class="mute small">PDF du ' + E.frDate(E.dayKey(d.ts)) + ' · ' + Math.max(1, Math.round(d.octets / 1024)) + ' Ko</div></div><div class="btns">' + b + '</div></div>';
    });
    return h + '</div>';
  }
  function docsLoad() {
    docErr = '';
    call('docs').then(function (r) { docs = r.docs || []; }, function (e) { docErr = msgOf(e); }).then(render);
  }
  function vReglages() {
    var R = cfg.regles, base = location.href.replace(/[^/]*([?#].*)?$/, '');
    var num = function (id, lab, v) { return '<label class="f" for="rg-' + id + '">' + lab + '<input type="number" inputmode="numeric" min="0" max="240" id="rg-' + id + '" value="' + v + '"></label>'; };
    return '<div class="card"><div class="sec"><span>Adresses à transmettre</span></div>' +
      '<div class="row"><div><div>Tableau d’équipe, public</div><div class="mute small">' + esc(base) + 'etat.html</div></div><a class="btn ghost sm" href="etat.html">Ouvrir</a></div>' +
      '<div class="row"><div><div>Page de pointage des employés</div><div class="mute small">' + esc(base) + '</div></div><a class="btn ghost sm" href="index.html">Ouvrir</a></div></div>' +
      '<div class="card"><div class="sec"><span>Règles</span><span>minutes</span></div><div class="two">' + num('midiMin', 'Midi obligatoire', R.midiMin) + num('midiEx', 'Exception hebdo.', R.midiEx) + num('rappelPause', 'Rappel pause', R.rappelPause) + num('rappelMidi', 'Rappel midi', R.rappelMidi) + '</div>' +
      '<div class="mute small">Pauses légales fixes : plus de 5 h 30 → 15 min, plus de 7 h → 30 min, plus de 9 h → 60 min. Les écarts sont signalés à l’employé, jamais déduits. La règle du midi ne s’applique qu’aux employés chez qui elle est cochée.</div>' +
      '<div class="sec"><span>Note de fin de travail</span></div>' +
      '<label class="chk"><input type="checkbox" id="rg-note"' + (R.note ? ' checked' : '') + '>Demander une note à l’employé quand il quitte un bâtiment</label>' +
      '<div class="mute small">Deux ou trois mots sur ce qui a été fait, avec le code Devis, Régie ou Garantie (Devis par défaut). Obligatoire sur les bâtiments, possible sur les centres communs depuis l’onglet Journée. Le pointage n’est jamais retardé : l’heure est enregistrée avant que la note soit demandée. La note et le code sortent dans l’export Excel.</div>' +
      '<div class="mute small">Tableau d’équipe : la tuile d’une personne affiche « Pause longue » quand sa pause dépasse le rappel pause, ou son midi le rappel midi. Mettre 0 pour ne rien afficher.</div>' +
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
        '<div class="sec"><span>Bâtiments épinglés sur son écran</span></div>' +
        '<div class="mute small">Tous les centres communs et tous les bâtiments lui sont accessibles (bouton Bâtiments). Cochez ici ceux qui doivent s’afficher d’office sur son écran ; ses bâtiments les plus habituels s’y ajoutent tout seuls.</div>';
      {
        var list = cfg.dossiers.filter(function (d) { return !d.commun && x.socs.indexOf(d.soc) >= 0 && (d.actif || x.dossiers.indexOf(d.id) >= 0); }).sort(byNom);
        var q = (sheet.q || '').trim().toLowerCase(), nSel = list.filter(function (d) { return x.dossiers.indexOf(d.id) >= 0; }).length;
        if (list.length) {
          h += '<div class="row"><span class="mute small" id="e-cnt">' + nSel + ' sur ' + list.length + ' cochés</span><span class="btns"><button class="btn ghost sm" data-act="emp-all">Tout cocher</button><button class="btn ghost sm" data-act="emp-none">Tout décocher</button></span></div>' +
            (list.length > 8 ? '<input class="search" id="e-q" type="search" placeholder="Chercher une adresse" aria-label="Chercher une adresse" autocomplete="off" value="' + esc(sheet.q || '') + '">' : '') +
            '<div class="checks tall">' + list.map(function (d) {
              var nm = (d.nom + ' ' + (d.code || '')).toLowerCase();
              return '<label class="chk" data-name="' + esc(nm) + '"' + (q && nm.indexOf(q) < 0 ? ' hidden' : '') + '><input type="checkbox" data-dos="' + esc(d.id) + '"' + (x.dossiers.indexOf(d.id) >= 0 ? ' checked' : '') + '>' + esc(d.nom) + (d.code ? ' <span class="mute small">' + esc(d.code) + '</span>' : '') + (d.actif ? '' : ' <span class="mute small">archivé</span>') + '</label>';
            }).join('') + '</div>';
        } else h += '<div class="mute small">Aucun bâtiment pour cette société. Créez-les ou importez-les dans l’onglet Centres.</div>';
      }
      h += chk('data-b="midi"', x.midi, 'Midi obligatoire de ' + cfg.regles.midiMin + ' min (règle GIOT)') + chk('data-b="tableau"', x.tableau !== false, 'Figure au tableau d’équipe (décoché : la personne pointe normalement, mais n’est pas affichée)') +
        chk('data-b="actif"', x.actif, 'Actif : peut se connecter et pointer (décocher seulement pour un départ)');
    } else if (sheet.type === 'dos') {
      h += '<h2>' + (x.id ? 'Modifier le centre' : 'Nouveau centre') + '</h2>' +
        '<label class="f" for="d-nom">Nom (adresse de l’immeuble, chantier, centre général)<input id="d-nom" data-f="nom" maxlength="60" value="' + esc(x.nom) + '"></label>' +
        '<label class="f" for="d-code">Code analytique (facultatif)<input id="d-code" data-f="code" maxlength="30" value="' + esc(x.code) + '"></label>' +
        '<label class="f" for="d-soc">Société<select id="d-soc" data-f="soc">' + Object.keys(cfg.socs).map(function (s) { return '<option value="' + s + '"' + (s === x.soc ? ' selected' : '') + '>' + esc(cfg.socs[s].nom) + '</option>'; }).join('') + '</select></label>' +
        chk('data-b="commun"', x.commun || x.defaut, 'Centre commun : affiché d’office sur l’écran de tous les employés') +
        chk('data-b="defaut"', x.defaut, 'Centre par défaut : la journée commence dessus (un seul par société)') +
        chk('data-b="actif"', x.actif, 'Actif : proposé au pointage (décocher pour archiver)');
    } else if (sheet.type === 'abs') {
      var o2 = function (v, l, cur) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(l) + '</option>'; };
      h += '<h2>' + (x.id ? 'Modifier l’absence' : 'Saisir une absence') + '</h2>' +
        '<label class="f" for="a-pid">Employé<select id="a-pid" data-f="pid">' + o2('', 'Choisir…', x.pid) +
        cfg.employes.filter(function (p) { return p.actif || p.id === x.pid; }).sort(byName).map(function (p) { return o2(p.id, p.prenom + ' ' + p.nom, x.pid); }).join('') +
        o2('*', 'Tous les employés (jour férié, fermeture)', x.pid) + '</select></label>' +
        '<label class="f" for="a-type">Type<select id="a-type" data-f="type">' + Object.keys(E.ABS).map(function (k) { return o2(k, E.ABS[k], x.type); }).join('') + '</select></label>' +
        '<div class="two"><label class="f" for="a-du">Du<input type="date" id="a-du" data-f="du" value="' + esc(x.du) + '"></label><label class="f" for="a-au">Au (inclus)<input type="date" id="a-au" data-f="au" value="' + esc(x.au) + '"></label></div>' +
        chk('data-b="demi"', x.demi, 'Demi-journée (absence d’un seul jour)') +
        '<label class="f" for="a-note">Remarque (facultative)<input id="a-note" data-f="note" maxlength="80" value="' + esc(x.note) + '"></label>' +
        '<div class="mute small">Pas de diagnostic ni de détail médical ici : le type suffit. Le certificat reste dans le dossier du personnel.</div>';
    } else if (sheet.type === 'imp') {
      h += '<h2>Importer une liste de centres</h2>' +
        '<label class="f" for="i-soc">Société<select id="i-soc" data-f="soc">' + Object.keys(cfg.socs).map(function (s) { return '<option value="' + s + '"' + (s === x.soc ? ' selected' : '') + '>' + esc(cfg.socs[s].nom) + '</option>'; }).join('') + '</select></label>' +
        '<label class="f" for="i-txt">Un centre par ligne<textarea id="i-txt" data-f="txt" rows="9" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="BATAILLES 18 - VERNIER&#10;JONCTION 9&#10;…">' + esc(x.txt) + '</textarea></label>' +
        '<div class="mute small">Collez la liste telle quelle. Pour ajouter un code analytique, écrivez-le après un point-virgule : « Nom ; code ». Les centres déjà présents sont ignorés.</div>' +
        chk('data-b="commun"', x.commun, 'Centres communs : affichés d’office sur l’écran de tous (sinon : bâtiments)');
    }
    h += (sheet.err ? '<div class="err" role="alert">' + esc(sheet.err) + '</div>' : '') +
      '<button class="btn full" data-act="' + sheet.type + '-save"' + (busy ? ' disabled' : '') + '>' + (sheet.type === 'imp' ? 'Importer' : 'Enregistrer') + '</button>' +
      (x.id && sheet.type === 'emp' ? '<button class="btn ghost full" data-act="emp-as"' + (busy ? ' disabled' : '') + '>Ouvrir son pointage</button>' : '') +
      (x.id ? '<button class="btn ghost full" data-act="' + sheet.type + '-del"' + (busy ? ' disabled' : '') + '>Supprimer</button>' : '');
    return '<div class="veil" data-act="close-veil"><div class="sheet" role="dialog" aria-modal="true">' + h + '<button class="btn ghost full" data-act="close">Fermer</button></div></div>';
  }
  function render() {
    var m = document.getElementById('main'), sc = m ? m.scrollTop : 0, sh = root.querySelector('.sheet'), ssc = sh ? sh.scrollTop : 0;
    if (!cfg) { root.innerHTML = vGate(); return; }
    if (prov) { root.innerHTML = vProv(); return; }
    var body = tab === 'dossiers' ? vDossiers() : tab === 'absences' ? vAbsences() : tab === 'export' ? vExport() : tab === 'reglages' ? vReglages() : tab === 'docs' ? vDocs() : vEmployes();
    var actifs = cfg.employes.filter(function (e) { return e.actif; }).length, dAct = cfg.dossiers.filter(function (d) { return d.actif; }).length;
    root.innerHTML = head(actifs + ' employé' + (actifs > 1 ? 's' : '') + ' actif' + (actifs > 1 ? 's' : '') + ', ' + dAct + ' centre' + (dAct > 1 ? 's' : '') + ' actif' + (dAct > 1 ? 's' : '')) +
      '<main id="main">' + (flash ? '<div class="ok-msg" role="status">' + esc(flash) + '</div>' : '') + body + '</main>' + tabsBar() + vSheet();
    m = document.getElementById('main'); if (m) m.scrollTop = sc;
    sh = root.querySelector('.sheet'); if (sh) sh.scrollTop = ssc;
  }

  /* ---------- actions ---------- */
  function empCoche(on) {
    var x = sheet.x, q = (sheet.q || '').trim().toLowerCase();
    cfg.dossiers.forEach(function (d) {
      if (d.commun || !d.actif || x.socs.indexOf(d.soc) < 0) return;
      if (q && (d.nom + ' ' + (d.code || '')).toLowerCase().indexOf(q) < 0) return; // seulement ce que la recherche affiche
      var k = x.dossiers.indexOf(d.id);
      if (on && k < 0) x.dossiers.push(d.id);
      if (!on && k >= 0) x.dossiers.splice(k, 1);
    });
  }
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
    tab: function (ds) { tab = ds.t; err = ''; flash = ''; exMsg = ''; exErr = ''; docMsg = ''; var m = document.getElementById('main'); if (m) m.scrollTop = 0; if (tab === 'docs') docsLoad(); },
    'docs-load': function () { docsLoad(); },
    // Le PDF est chargé au premier toucher ; sur iPhone, le partage doit suivre immédiatement un toucher, d'où le second bouton.
    'doc-open': function (ds) {
      docErr = ''; docMsg = ''; docBusy = ds.id;
      call('doc', { id: ds.id }).then(function (r) {
        var bin = atob(r.pdf), u = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        var blob = new Blob([u], { type: 'application/pdf' });
        docF[ds.id] = { file: window.File ? new File([blob], r.nom, { type: 'application/pdf' }) : null, url: URL.createObjectURL(blob), titre: r.titre };
        if (appli && !partageable(docF[ds.id].file)) docMsg = 'Pour enregistrer ce PDF, ouvrez l’administration dans le navigateur du téléphone.';
      }, function (e) { docErr = msgOf(e); }).then(function () { docBusy = ''; render(); });
    },
    'doc-share': function (ds) {
      var f = docF[ds.id]; if (!f) return;
      navigator.share({ files: [f.file], title: f.titre }).catch(function (e) {
        if (e && e.name === 'AbortError') return;
        docErr = 'Le partage n’a pas abouti. Ouvrez l’administration dans le navigateur pour récupérer le PDF.'; render();
      });
      return false;
    },
    close: function () { sheet = null; },
    'close-veil': function (ds, el, ev) { if (ev.target === el) sheet = null; else return false; },
    setup: function () {
      var a = val('pw1'), b = val('pw2');
      if (a.length < PW_MIN) { err = 'Au moins ' + PW_MIN + ' caractères.'; return; }
      if (a !== b) { err = 'Les deux saisies ne correspondent pas.'; return; }
      err = '';
      run(api('setup', { password: a })).then(function (r) { setToken(r.token); pret = true; return loadCfg(); }, function (e) { err = msgOf(e); }).then(render);
      return false;
    },
    alogin: function () {
      err = '';
      var p = val('pw'); info = '';
      run(api('alogin', { password: p })).then(function (r) { setToken(r.token); prov = r.provisoire ? p : ''; return loadCfg(); }, function (e) { err = msgOf(e); }).then(render);
      return false;
    },
    oubli: function () {
      err = ''; info = '';
      run(api('aoubli', { demande: 1 })).then(function (r) { info = 'Un mot de passe provisoire vient d’être envoyé à ' + r.a + '. Il est valable 30 minutes ; regardez aussi dans les indésirables.'; }, function (e) { err = msgOf(e); }).then(render);
      return false;
    },
    'prov-save': function () {
      var n = val('pn1'), n2 = val('pn2');
      if (n.length < PW_MIN) { err = 'Au moins ' + PW_MIN + ' caractères.'; return; }
      if (n !== n2) { err = 'Les deux saisies ne correspondent pas.'; return; }
      err = '';
      run(call('apass', { old: prov, new: n }), 'Mot de passe changé.').then(function () { prov = ''; }, function (e) { err = msgOf(e); }).then(render);
      return false;
    },
    alogout: function () { var t = token; setToken(''); cfg = null; err = ''; flash = ''; prov = ''; info = ''; api('logout', { token: t }).catch(function () { }); },
    'emp-new': function () { sheet = { type: 'emp', x: { id: '', prenom: '', nom: '', pin: '', socs: Object.keys(cfg.socs).slice(0, 1), tous: true, dossiers: [], midi: false, actif: true, tableau: true } }; },
    'emp-edit': function (ds) {
      var e = cfg.employes.filter(function (p) { return p.id === ds.id; })[0]; if (!e) return;
      sheet = { type: 'emp', x: { id: e.id, prenom: e.prenom, nom: e.nom, pin: '', socs: e.socs.slice(), tous: !!e.tous, dossiers: (e.dossiers || []).slice(), midi: !!e.midi, actif: !!e.actif, tableau: e.tableau !== false } };
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
      run(call('emp_del', { id: id }), 'Employé supprimé.').then(function () { cfg.employes = cfg.employes.filter(function (p) { return p.id !== id; }); cfg.absences = (cfg.absences || []).filter(function (a) { return a.pid !== id; }); sheet = null; }, function (e) { if (sheet) { sheet.err = msgOf(e); sheet.sure = false; } }).then(render);
      return false;
    },
    // Ouvre la page de pointage comme si l'employé était connecté sur cet appareil.
    'emp-as': function () {
      var id = sheet.x.id, LS = 'pointage-v2', old = null;
      try { old = JSON.parse(localStorage.getItem(LS)); } catch (e) { }
      if (old && old.lastPid && old.lastPid !== id && old.dirty && Object.keys(old.dirty).length) {
        sheet.err = 'Des pointages d’une autre personne ne sont pas encore transmis depuis cet appareil. Ouvrez d’abord la page de pointage avec du réseau, puis recommencez.'; return;
      }
      run(call('emp_as', { id: id })).then(function (r) {
        var st = old && old.v === 2 && old.lastPid === id ? old : { v: 2 };
        st.token = r.token; st.lastPid = id;
        try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) { if (sheet) sheet.err = 'Stockage refusé par ce navigateur.'; render(); return; }
        location.href = 'index.html';
      }, function (e) { if (sheet) sheet.err = msgOf(e); render(); });
      return false;
    },
    'emp-all': function () { empCoche(true); },
    'emp-none': function () { empCoche(false); },
    'dos-new': function () { sheet = { type: 'dos', x: { id: '', nom: '', code: '', soc: cfg.lastSoc || Object.keys(cfg.socs)[0], actif: true, commun: false, defaut: false } }; },
    // Sauvegarde de la liste des centres : un classeur d'une feuille, rechargeable par « Importer une liste ».
    'dos-xlsx': function () {
      var name = 'Centres_' + E.dayKey(Date.now()) + '.xlsx';
      download(name, window.XlsxLite.build([E.centresSheet(cfg.dossiers, cfg.socs)]));
      flash = name + ' : ' + cfg.dossiers.length + ' centres.';
    },
    'imp-new': function () { sheet = { type: 'imp', x: { soc: cfg.lastSoc || Object.keys(cfg.socs)[0], txt: '', commun: false } }; },
    'imp-save': function () {
      var x = sheet.x, vus = {}, items = [];
      x.txt.split(/\r?\n/).forEach(function (l) {
        var m = l.split(/[;\t]/), nom = (m[0] || '').replace(/\s+/g, ' ').trim(), code = (m[1] || '').trim();
        if (!nom || vus[nom.toLowerCase()]) return;
        vus[nom.toLowerCase()] = true; items.push({ nom: nom, code: code });
      });
      sheet.err = '';
      if (!items.length) { sheet.err = 'Collez au moins une ligne.'; return; }
      var trop = items.filter(function (i) { return i.nom.length > 60; });
      if (trop.length) { sheet.err = 'Nom trop long (60 caractères au maximum) : ' + trop[0].nom; return; }
      run(call('dos_import', { soc: x.soc, commun: x.commun, items: items })).then(function (r) {
        cfg.dossiers = r.dossiers; cfg.lastSoc = x.soc; sheet = null;
        flash = r.ajoutes + ' centre' + (r.ajoutes > 1 ? 's' : '') + ' ajouté' + (r.ajoutes > 1 ? 's' : '') + (r.doublons ? ', ' + r.doublons + ' déjà présent' + (r.doublons > 1 ? 's' : '') + ' ignoré' + (r.doublons > 1 ? 's' : '') : '') + '.';
      }, function (e) { if (sheet) sheet.err = msgOf(e); }).then(render);
      return false;
    },
    'dos-edit': function (ds) {
      var d = cfg.dossiers.filter(function (p) { return p.id === ds.id; })[0]; if (!d) return;
      sheet = { type: 'dos', x: { id: d.id, nom: d.nom, code: d.code || '', soc: d.soc, actif: !!d.actif, commun: !!d.commun, defaut: !!d.defaut } };
    },
    'dos-save': function () {
      var x = sheet.x; sheet.err = '';
      if (!x.nom.trim()) { sheet.err = 'Le nom est obligatoire.'; return; }
      run(call('dos_save', { dos: x }), 'Centre enregistré.').then(function (r) {
        cfg.dossiers = r.dossiers; // le serveur renvoie la liste : un nouveau centre par défaut retire l'ancien
        cfg.lastSoc = r.dos.soc; sheet = null;
      }, function (e) { if (sheet) sheet.err = msgOf(e); }).then(render);
      return false;
    },
    'dos-del': function () {
      if (!sheet.sure) { sheet.sure = true; sheet.err = 'Appuyez une seconde fois sur Supprimer pour confirmer.'; return; }
      var id = sheet.x.id;
      run(call('dos_del', { id: id }), 'Centre supprimé.').then(function () {
        cfg.dossiers = cfg.dossiers.filter(function (p) { return p.id !== id; });
        cfg.employes.forEach(function (p) { p.dossiers = (p.dossiers || []).filter(function (d) { return d !== id; }); });
        sheet = null;
      }, function (e) { if (sheet) { sheet.err = msgOf(e); sheet.sure = false; } }).then(render);
      return false;
    },
    'abs-new': function () { sheet = { type: 'abs', x: { id: '', pid: '', type: 'vacances', du: today, au: today, demi: false, note: '' } }; },
    'abs-edit': function (ds) {
      var a = (cfg.absences || []).filter(function (p) { return p.id === ds.id; })[0]; if (!a) return;
      sheet = { type: 'abs', x: { id: a.id, pid: a.pid, type: a.type, du: a.du, au: a.au, demi: !!a.demi, note: a.note || '' } };
    },
    'abs-save': function () {
      var x = sheet.x; sheet.err = '';
      if (!x.pid) { sheet.err = 'Choisissez l’employé.'; return; }
      if (!x.du) { sheet.err = 'Indiquez la date de début.'; return; }
      if (!x.au) x.au = x.du;
      if (x.au < x.du) { sheet.err = 'La date de fin précède la date de début.'; return; }
      if (x.demi && x.du !== x.au) { sheet.err = 'Une demi-journée ne peut porter que sur un seul jour.'; return; }
      run(call('abs_save', { abs: x }), 'Absence enregistrée.').then(function (r) { cfg.absences = r.absences; sheet = null; }, function (e) { if (sheet) sheet.err = msgOf(e); }).then(render);
      return false;
    },
    'abs-del': function () {
      if (!sheet.sure) { sheet.sure = true; sheet.err = 'Appuyez une seconde fois sur Supprimer pour confirmer.'; return; }
      run(call('abs_del', { id: sheet.x.id }), 'Absence supprimée.').then(function (r) { cfg.absences = r.absences; sheet = null; }, function (e) { if (sheet) { sheet.err = msgOf(e); sheet.sure = false; } }).then(render);
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
        var wb = E.workbook({ people: people, dossiers: ds, socs: r.socs, evs: function (pid) { return r.events[pid] || []; }, absences: r.absences || [] }, { from: ex.from, to: ex.to, pid: ex.pid, soc: ex.soc }, now);
        if (!wb.totals.lignes && !wb.totals.absences) { exErr = 'Aucun pointage ni absence sur cette période avec ces filtres. Pour la seule liste des centres : onglet Centres, « Exporter la liste ».'; return; }
        var name = 'Heures_' + ex.from + '_au_' + ex.to + '.xlsx';
        download(name, window.XlsxLite.build(wb.sheets));
        exMsg = name + ' : ' + wb.totals.lignes + ' lignes, ' + E.dur(wb.totals.parCollab) + ' de travail, ' + E.dur(wb.totals.pauses) + ' de pauses' + (wb.totals.absences ? ', ' + wb.totals.absences + ' absence' + (wb.totals.absences > 1 ? 's' : '') : '') + '.';
      }, function (e) { exErr = msgOf(e); }).then(render);
      return false;
    },
    regles: function () {
      var R = {}; ['midiMin', 'midiEx', 'rappelPause', 'rappelMidi'].forEach(function (k) { R[k] = parseInt(val('rg-' + k), 10) || 0; });
      var cn = document.getElementById('rg-note'); R.note = !!(cn && cn.checked);
      run(call('regles_save', { regles: R }), 'Règles enregistrées.').then(function (r) { cfg.regles = r.regles; }, function (e) { err = msgOf(e); }).then(render);
      return false;
    },
    apass: function () {
      var o = val('pw-old'), n = val('pw-new'), n2 = val('pw-new2'); flash = '';
      if (n.length < PW_MIN) { err = 'Le nouveau mot de passe doit compter au moins ' + PW_MIN + ' caractères.'; return; }
      if (n !== n2) { err = 'Les deux saisies ne correspondent pas.'; return; }
      err = '';
      run(call('apass', { old: o, new: n }), 'Mot de passe changé.').then(function () { }, function (e) { err = msgOf(e); }).then(render);
      return false;
    }
  };
  root.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]'); if (!el || el.disabled) return;
    var fn = H[el.getAttribute('data-act')]; if (!fn) return;
    if (!/-(save|del)$|^(regles|apass|export|setup|alogin|oubli|prov-save|emp-as|dos-xlsx)$/.test(el.getAttribute('data-act'))) flash = '';
    if (fn(el.dataset, el, ev) === false) return;
    render();
  });
  // Dès qu'on reprend la saisie, le message d'erreur de la fiche n'a plus lieu d'être.
  function errOff() { if (!sheet || !sheet.err || sheet.sure) return; sheet.err = ''; var e = root.querySelector('.sheet .err'); if (e) e.remove(); }
  root.addEventListener('input', function (ev) {
    var t = ev.target;
    if (sheet && t.id === 'e-q') {
      sheet.q = t.value; var q = t.value.trim().toLowerCase();
      Array.prototype.forEach.call(root.querySelectorAll('.checks .chk[data-name]'), function (el) { el.hidden = !!q && el.getAttribute('data-name').indexOf(q) < 0; });
      return;
    }
    if (sheet && t.hasAttribute('data-f') && t.tagName !== 'SELECT') { sheet.x[t.getAttribute('data-f')] = t.value; errOff(); }
  });
  root.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.hasAttribute('data-ex')) { ex[t.getAttribute('data-ex')] = t.value; exMsg = ''; exErr = ''; return; }
    if (!sheet) return;
    var x = sheet.x;
    if (t.hasAttribute('data-f')) { x[t.getAttribute('data-f')] = t.value; errOff(); return; }
    if (t.hasAttribute('data-b')) x[t.getAttribute('data-b')] = t.checked;
    else if (t.hasAttribute('data-soc')) { var s = t.getAttribute('data-soc'), i = x.socs.indexOf(s); if (t.checked && i < 0) x.socs.push(s); if (!t.checked && i >= 0) x.socs.splice(i, 1); }
    else if (t.hasAttribute('data-dos')) { var d = t.getAttribute('data-dos'), k = x.dossiers.indexOf(d); if (t.checked && k < 0) x.dossiers.push(d); if (!t.checked && k >= 0) x.dossiers.splice(k, 1);
      var c = document.getElementById('e-cnt'), bs = root.querySelectorAll('.checks input[data-dos]');
      if (c) c.textContent = root.querySelectorAll('.checks input[data-dos]:checked').length + ' sur ' + bs.length + ' cochés';
      return; }
    else return;
    render();
  });
  root.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter') return;
    if (ev.target.id === 'pw') { ev.preventDefault(); H.alogin(); }
    if (ev.target.id === 'pn2') { ev.preventDefault(); if (H['prov-save']() !== false) render(); }
    if (ev.target.id === 'pw2') { ev.preventDefault(); if (H.setup() !== false) render(); }
  });

  render();
  start();
})();
