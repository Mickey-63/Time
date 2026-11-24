# Time

Dépôt de publication vers www.le-top.ch.

**Règle : chaque dossier à la racine de ce dépôt est publié dans `/web/<dossier>/`, soit `www.le-top.ch/<dossier>/`.**

- `demo/` → www.le-top.ch/demo/ : Lisa la grenouille, qui se promène, coasse à chaque saut (enregistrement `coa.mp3`) et s'enfuit à grands bonds quand on tente de la toucher.
- `time/` → www.le-top.ch/time/ : pointage GIOT Immobilier SA / OptimalGo SA.
  - `index.html` : pointage des employés (nom + code PIN).
  - `etat.html` : tableau d'équipe public, en lecture seule.
  - `admin.html` : administration (mot de passe créé à la première ouverture) — employés, centres analytiques, affectations, export Excel.
  - Centres analytiques : un centre **commun** s'affiche d'office sur l'écran de tous les employés de la société ; les autres sont les **bâtiments** (adresses d'immeubles, chantiers), tous accessibles à chacun par le bouton « Bâtiments » en bas à droite. L'écran de pointage montre en plus le bâtiment en cours, ceux épinglés dans la fiche de l'employé, ses favoris (étoile) et ses trois plus habituels sur 45 jours. Un centre commun par société est le centre **par défaut** (« Commencer la journée »). Les six centres communs GIOT sont créés une fois par le serveur ; les adresses s'importent dans l'onglet Centres (« Importer une liste ») ou par `import.php`, liste chiffrée dont la clé n'est jamais dans le dépôt (`api.php?a=import_secret&k=…`).
  - Depuis la fiche d'un employé, « Ouvrir son pointage » ouvre la page de pointage comme s'il était connecté sur l'appareil (contrôle, essais, correction d'un oubli).
  - Logo : `giot.png` (lettres rouges, sans fond) + `chat.png` (chat animé, sans fond), produits depuis `logo.gif` par `logo.py` (racine du dépôt, non publié). Sur toutes les pages, toucher le chat ouvre l'administration.
  - Modes d'emploi : `time-giot-mode-emploi.pdf` (détaillé) et `time-giot-pour-les-nuls.pdf` (résumé d'une page), liés depuis la page de connexion et le menu de l'employé. Sources dans `.manuels/` (`detail.html`, `nuls.html`, captures dans `img/`, données fictives) ; régénérer avec `python3 .manuels/build.py`, puis changer `DOC` dans `commun.js`. Les dossiers commençant par un point ne sont pas publiés.
  - Export Excel : feuilles Détail, Par centre, Par collaborateur et Centres (liste complète des centres, sauvegarde rechargeable par « Importer une liste ») ; l'onglet Centres a aussi « Exporter la liste ».
  - L'employé change lui-même son code PIN depuis son menu (ancien code exigé).
  - `api.php` : stockage côté serveur dans `/web/time/data/`, créé par le serveur. Ce dossier n'est jamais dans le dépôt et le déploiement n'y touche pas.
  - Aucune donnée réelle (noms, dossiers, mots de passe) n'est dans ce dépôt public : tout se saisit dans l'administration.
  - Mot de passe d'administration perdu : bouton « Mot de passe oublié » de la page de connexion. Le serveur envoie un mot de passe provisoire (valable 30 minutes) à l'adresse fixée dans `api.php` (`MAIL_ADMIN`) ; on se connecte avec, puis on choisit le nouveau. Le mot de passe en place reste valable tant qu'il n'est pas remplacé. En dernier recours, `reinit.php` (posé par le dépôt, appliqué une seule fois) impose un mot de passe ; à retirer avant la mise en service, de même que `PW_MIN` est à remonter à 8.
- Les fichiers posés à la racine du dépôt (comme ce README) ne sont pas publiés ; la racine `/web` du site n'est jamais touchée.
- Noms de dossier acceptés : lettres, chiffres, point, tiret, tiret bas. Les dossiers commençant par un point sont ignorés.
- Supprimer un dossier du dépôt ne le supprime pas du site.
- Les accès FTP sont dans les secrets du dépôt : `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`.
