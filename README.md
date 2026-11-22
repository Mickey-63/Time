# Time

Dépôt de publication vers www.le-top.ch.

**Règle : chaque dossier à la racine de ce dépôt est publié dans `/web/<dossier>/`, soit `www.le-top.ch/<dossier>/`.**

- `demo/` → www.le-top.ch/demo/ : Lisa la grenouille, qui se promène, coasse à chaque saut (enregistrement `coa.mp3`) et s'enfuit à grands bonds quand on tente de la toucher.
- `time/` → www.le-top.ch/time/ : pointage GIOT Immobilier SA / OptimalGo SA.
  - `index.html` : pointage des employés (nom + code PIN).
  - `etat.html` : tableau d'équipe public, en lecture seule.
  - `admin.html` : administration (mot de passe créé à la première ouverture) — employés, dossiers et codes analytiques, affectations, export Excel.
  - `api.php` : stockage côté serveur dans `/web/time/data/`, créé par le serveur. Ce dossier n'est jamais dans le dépôt et le déploiement n'y touche pas.
  - Aucune donnée réelle (noms, dossiers, mots de passe) n'est dans ce dépôt public : tout se saisit dans l'administration.
  - Mot de passe d'administration perdu : effacer `/web/time/data/cfg.php` par FTP remet l'administration à zéro (employés et dossiers à ressaisir, pointages conservés).
- Les fichiers posés à la racine du dépôt (comme ce README) ne sont pas publiés ; la racine `/web` du site n'est jamais touchée.
- Noms de dossier acceptés : lettres, chiffres, point, tiret, tiret bas. Les dossiers commençant par un point sont ignorés.
- Supprimer un dossier du dépôt ne le supprime pas du site.
- Les accès FTP sont dans les secrets du dépôt : `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`.
