/* Outils partagés par les trois pages : appels au serveur, icônes, logo, libellés. */
(function (G) {
  'use strict';
  G.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  // Sans corps : lecture publique. Avec corps : envoi JSON (le jeton voyage dans le corps).
  G.api = function (a, body) {
    var opt = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' } : { cache: 'no-store' };
    return fetch('api.php?a=' + a, opt).then(function (r) {
      return r.json().catch(function () { return { err: 'Réponse illisible du serveur (' + r.status + ').' }; }).then(function (j) {
        if (!r.ok || j.err) { var e = new Error(j.err || 'Erreur ' + r.status); e.status = r.status; throw e; }
        return j;
      });
    });
  };
  var IC = {
    bureau: '<path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 10h4a1 1 0 0 1 1 1v10M2 21h20M8 8h3M8 12h3M8 16h3"/>',
    mission: '<path d="M3 11l18-8-8 18-2-8z"/>', pause: '<path d="M8 5v14M16 5v14"/>', absent: '<circle cx="12" cy="12" r="8"/>',
    tel: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    cafe: '<path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 10h2a3 3 0 0 1 0 6h-2M7 3v3M11 3v3"/>',
    midi: '<path d="M7 3v18M4 3v5a3 3 0 0 0 6 0V3M17 3c-2.5 2-2.5 7 0 9v9"/>', fin: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9 6.6 19.8l1.1-6.1L3.2 9.4l6.1-.8z"/>'
  };
  G.ic = function (n) { return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + IC[n] + '</svg>'; };
  // Logo sans fond : lettres GIOT rouges + chat animé. Toucher le chat ouvre l'administration (protégée par mot de passe).
G.NOM = 'GIOTimePRO';
  G.LOGO = '<span class="logo"><span class="mq" role="img" aria-label="GIOTimePRO"></span>' +
    '<a class="chat" href="admin.html" aria-label="Administration"><img src="chat.png?v=12" alt="" width="76" height="82"></a></span>';
  // Aide : modes d'emploi, règles du travail et confidentialité, quatre PDF tenus à jour dans le dépôt (sources dans .manuels/). build.py écrit aussi leurs pages en images dans aide/ :
  // aide.html les affiche avec un bouton de retour, parce qu'un PDF ouvert directement enferme l'utilisateur dans l'application
  // installée sur l'écran d'accueil de l'iPhone (pas de bouton « précédent »). À chaque nouvelle version : changer v et le nombre de pages.
  G.MANUELS = { v: '2026-11-26a', docs: {
    nuls: { titre: 'GIOTimePRO pour les nuls', court: 'Pour les nuls', pdf: 'giotimepro-pour-les-nuls.pdf', pages: 1 },
    detail: { titre: 'Mode d’emploi détaillé', court: 'Mode d’emploi détaillé', pdf: 'giotimepro-mode-emploi.pdf', pages: 10 },
    regles: { titre: 'Règles du travail en Suisse', court: 'Règles du travail', pdf: 'giotimepro-regles-travail.pdf', pages: 3 },
    conf: { titre: 'Confidentialité et données', court: 'Confidentialité', pdf: 'giotimepro-confidentialite.pdf', pages: 1 }
  } };
  G.aide = function (cls) {
    return Object.keys(G.MANUELS.docs).map(function (k) { return '<a class="' + cls + '" href="aide.html?d=' + k + '">' + G.MANUELS.docs[k].titre + '</a>'; }).join('');
  };
  G.LIB = { bureau: 'Au bureau', mission: 'En déplacement', pause: 'En pause', absent: 'Absent' };
})(window);
