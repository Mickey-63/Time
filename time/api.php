<?php
declare(strict_types=1);

/* API de pointage GIOT / OptimalGo.
   - Les données vivent dans ./data, créé au premier appel sur le serveur. Rien de réel n'est dans le dépôt.
   - Chaque fichier de données commence par une garde PHP : même appelé directement, il ne révèle rien.
   - Trois niveaux : public (tableau d'équipe), employé (PIN), administration (mot de passe). */

date_default_timezone_set('Europe/Zurich');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');

define('DATA', __DIR__ . '/data');
define('GUARD', "<?php http_response_code(403); exit; ?>\n");
define('NOW', (int) floor(microtime(true) * 1000));
define('JOUR', 86400000);
define('JSONF', JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
define('MAIL_ADMIN', 'ngiot@giot.ch'); // reçoit le mot de passe provisoire (« Mot de passe oublié »)
define('PW_MIN', 6);                   // longueur minimale pendant le développement ; à remonter à 8 avant la mise en service
define('TMP_TTL', 30 * 60000);         // durée de vie du mot de passe provisoire

function out($data, int $code = 200): void { http_response_code($code); echo json_encode($data, JSONF); exit; }
function fail(string $msg, int $code = 400): void { out(['err' => $msg], $code); }

/* ---------- fichiers ---------- */
function boot(): void {
  if (!is_dir(DATA) && !@mkdir(DATA, 0750, true) && !is_dir(DATA)) fail('Le serveur ne peut pas créer le dossier de données (droits d’écriture sur le répertoire time).', 500);
  if (!is_file(DATA . '/.htaccess')) @file_put_contents(DATA . '/.htaccess', "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nOrder allow,deny\nDeny from all\n</IfModule>\n");
}
function fpath(string $n): string { return DATA . '/' . $n . '.php'; }
function rd(string $n, array $def): array {
  $p = fpath($n);
  if (!is_file($p)) return $def;
  $s = @file_get_contents($p);
  if ($s === false) return $def;
  $i = strpos($s, "\n");
  $j = json_decode($i === false ? '' : substr($s, $i + 1), true);
  return is_array($j) ? $j : $def;
}
function wr(string $n, array $d): void {
  $p = fpath($n);
  $t = DATA . '/tmp_' . bin2hex(random_bytes(6)) . '.php';
  if (@file_put_contents($t, GUARD . json_encode($d, JSONF)) === false || !@rename($t, $p)) { @unlink($t); fail('Écriture impossible sur le serveur.', 500); }
}
function lock(): void {
  static $h = null;
  if ($h) return;
  $h = @fopen(DATA . '/lock.php', 'c');
  if (!$h || !flock($h, LOCK_EX)) fail('Serveur occupé, réessayez.', 503);
}

/* ---------- outils ---------- */
function cut(string $s, int $max): string {
  $s = trim((string) preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $s));
  if (function_exists('mb_substr')) return mb_substr($s, 0, $max, 'UTF-8');
  return (string) preg_replace('/^(.{0,' . $max . '}).*$/us', '$1', $s);
}
function newId(string $prefix): string { return $prefix . bin2hex(random_bytes(4)); }
function cfg(): array {
  $c = rd('cfg', []);
  $c += [
    'adminHash' => '',
    'socs' => ['gi' => ['nom' => 'GIOT Immobilier SA', 'court' => 'GIOT'], 'og' => ['nom' => 'OptimalGo SA', 'court' => 'OptimalGo']],
    'employes' => [], 'dossiers' => [],
    'regles' => ['midiMin' => 60, 'midiEx' => 30, 'rappelPause' => 20, 'rappelMidi' => 75],
  ];
  $c['regles'] += ['note' => false, 'noteDepuis' => 0]; // note de fin de travail : désactivée tant que l'administration ne l'active pas
  return $c;
}
function empIndex(array $c, string $id): int { foreach ($c['employes'] as $i => $e) if ($e['id'] === $id) return $i; return -1; }
function dosIndex(array $c, string $id): int { foreach ($c['dossiers'] as $i => $d) if ($d['id'] === $id) return $i; return -1; }
function auTableau(array $e): bool { return !isset($e['tableau']) || !empty($e['tableau']); } // figure au tableau d'équipe (par défaut : oui)
function empAdmin(array $e): array { $o = $e; $o['pin'] = !empty($e['pinHash']); $o['tableau'] = auTableau($e); unset($o['pinHash']); return $o; }
function mesDossiers(array $e, array $c): array {
  $o = [];
  foreach ($c['dossiers'] as $d) {
    if (empty($d['actif']) || !in_array($d['soc'], $e['socs'], true)) continue;
    $o[] = $d['id'];
  }
  return $o;
}
/* Centres épinglés : ceux cochés dans la fiche de l'employé, affichés d'office sur son écran de pointage. */
function epingles(array $e, array $c): array {
  $o = [];
  foreach ($c['dossiers'] as $d) {
    if (!empty($d['actif']) && empty($d['commun']) && in_array($d['soc'], $e['socs'], true) && in_array($d['id'], $e['dossiers'] ?? [], true)) $o[] = $d['id'];
  }
  return $o;
}
/* Ajoute une liste de centres à une société ; les noms déjà présents sont ignorés. Renvoie [ajoutés, doublons]. */
function importer(array &$c, string $soc, array $items, bool $commun): array {
  $vus = [];
  foreach ($c['dossiers'] as $d) if ($d['soc'] === $soc) $vus[nomCle($d['nom'])] = true;
  $n = 0; $dbl = 0;
  foreach ($items as $it) {
    if (!is_array($it)) continue;
    $nom = cut((string) ($it['nom'] ?? ''), 60);
    if ($nom === '') continue;
    if (isset($vus[nomCle($nom)])) { $dbl++; continue; }
    $vus[nomCle($nom)] = true;
    $c['dossiers'][] = ['id' => newId('d'), 'nom' => $nom, 'code' => cut((string) ($it['code'] ?? ''), 30), 'soc' => $soc, 'actif' => true, 'commun' => $commun, 'defaut' => false];
    $n++;
  }
  return [$n, $dbl];
}
/* Centre par défaut de l'employé : celui sur lequel la journée commence. */
function defautDe(array $e, array $c): ?string {
  foreach ($e['socs'] as $s) foreach ($c['dossiers'] as $d) {
    if ($d['soc'] === $s && !empty($d['defaut']) && !empty($d['actif'])) return $d['id'];
  }
  return null;
}
function nomCle(string $s): string { return function_exists('mb_strtolower') ? mb_strtolower(trim($s), 'UTF-8') : strtolower(trim($s)); }
/* Première mise en place des centres communs GIOT (une seule fois). Tout reste modifiable dans l'administration. */
function semis(): void {
  if ((rd('cfg', [])['semis'] ?? 0) >= 1) return;
  lock();
  $c = cfg();
  if (($c['semis'] ?? 0) >= 1) return;
  $aDefaut = false;
  foreach ($c['dossiers'] as $d) if ($d['soc'] === 'gi' && !empty($d['defaut'])) $aDefaut = true;
  foreach (['Travail courant', 'Véhicules', 'Chantiers', 'Divers', 'Immobilier', 'OptimalGo'] as $k => $nom) {
    $i = -1;
    foreach ($c['dossiers'] as $j => $d) if ($d['soc'] === 'gi' && nomCle($d['nom']) === nomCle($nom)) $i = $j;
    if ($i < 0) { $c['dossiers'][] = ['id' => newId('d'), 'nom' => $nom, 'code' => '', 'soc' => 'gi', 'actif' => true, 'commun' => true, 'defaut' => false]; $i = count($c['dossiers']) - 1; }
    else $c['dossiers'][$i]['commun'] = true;
    if ($k === 0 && !$aDefaut) { $c['dossiers'][$i]['defaut'] = true; $c['dossiers'][$i]['actif'] = true; }
  }
  $c['semis'] = 1;
  wr('cfg', $c);
}
function ip(): string { return (string) ($_SERVER['REMOTE_ADDR'] ?? '?'); }

/* ---------- sessions et limitation des essais ---------- */
function sessNew(string $who, int $ttl): string {
  lock();
  $s = rd('sess', []);
  foreach ($s as $k => $v) if (($v['exp'] ?? 0) < NOW) unset($s[$k]);
  $tok = bin2hex(random_bytes(24));
  $s[hash('sha256', $tok)] = ['who' => $who, 'exp' => NOW + $ttl];
  wr('sess', $s);
  return $tok;
}
function sessWho(array $in): string {
  $tok = (string) ($in['token'] ?? '');
  if ($tok === '') return '';
  $v = rd('sess', [])[hash('sha256', $tok)] ?? null;
  if (!$v || ($v['exp'] ?? 0) < NOW) return '';
  return (string) $v['who'];
}
function sessDrop(string $who, string $keepToken = ''): void {
  lock();
  $s = rd('sess', []);
  $keep = $keepToken === '' ? '' : hash('sha256', $keepToken);
  foreach ($s as $k => $v) if (($v['who'] ?? '') === $who && $k !== $keep) unset($s[$k]);
  wr('sess', $s);
}
function tmpOk(array $c, string $p): bool {
  return !empty($c['tmpHash']) && ($c['tmpExp'] ?? 0) > NOW && password_verify($p, (string) $c['tmpHash']);
}
function needAdmin(array $in): void { if (sessWho($in) !== 'admin') fail('Session expirée. Reconnectez-vous.', 401); }
function needEmp(array $in): string {
  $w = sessWho($in);
  if (strncmp($w, 'e:', 2) !== 0) fail('Session expirée. Reconnectez-vous.', 401);
  return substr($w, 2);
}
function triesCheck(string $key): void {
  $v = rd('tries', [])[$key] ?? null;
  if ($v && $v['n'] >= 6 && NOW - $v['t'] < 900000) fail('Trop d’essais. Réessayez dans 15 minutes.', 429);
}
function triesFail(string $key): void {
  lock();
  $t = rd('tries', []);
  foreach ($t as $k => $v) if (NOW - $v['t'] >= 900000) unset($t[$k]);
  $v = $t[$key] ?? ['n' => 0, 't' => NOW];
  $v['n']++;
  $t[$key] = $v;
  wr('tries', $t);
}
function triesClear(string $key): void {
  $t = rd('tries', []);
  if (!isset($t[$key])) return;
  lock();
  $t = rd('tries', []);
  unset($t[$key]);
  wr('tries', $t);
}

/* Mot de passe d'administration perdu : le fichier reinit.php (facultatif, posé par le dépôt) donne un identifiant et
   l'empreinte d'un mot de passe provisoire. Appliqué une seule fois par identifiant ; employés, centres et pointages intacts. */
function reinit(): void {
  $f = __DIR__ . '/reinit.php';
  if (!is_file($f)) return;
  $r = include $f;
  if (!is_array($r) || empty($r['id']) || empty($r['hash']) || !is_string($r['hash'])) return;
  if ((rd('cfg', [])['reinit'] ?? '') === $r['id']) return;
  lock();
  $c = cfg();
  if (($c['reinit'] ?? '') === $r['id']) return;
  $c['adminHash'] = $r['hash'];
  $c['reinit'] = (string) $r['id'];
  unset($c['tmpHash'], $c['tmpExp']);
  wr('cfg', $c);
  sessDrop('admin');
  $t = rd('tries', []); // lève aussi le blocage « trop d'essais »
  foreach ($t as $k => $v) if (strncmp((string) $k, 'adm:', 4) === 0) unset($t[$k]);
  wr('tries', $t);
}

/* ---------- absences (saisies par le bureau : vacances, maladie, accident, jour férié, autre) ---------- */
define('ABS_TYPES', ['vacances', 'maladie', 'accident', 'ferie', 'autre']);
function jourOk(string $d): bool {
  return (bool) preg_match('/^(\\d{4})-(\\d{2})-(\\d{2})$/', $d, $m) && checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
}
/* Absences d'un employé : les siennes et celles posées pour tous (pid « * », jours fériés). */
function absDe(string $pid): array {
  $o = [];
  foreach (rd('abs', []) as $a) if ($a['pid'] === $pid || $a['pid'] === '*') $o[] = $a;
  return $o;
}
/* Absence couvrant un jour donné ; une absence personnelle passe avant un jour férié commun. */
function absJour(array $liste, string $jour): ?array {
  $r = null;
  foreach ($liste as $a) if ($a['du'] <= $jour && $jour <= $a['au'] && ($r === null || $a['pid'] !== '*')) $r = $a;
  return $r;
}

/* ---------- événements ---------- */
function evClean(array $e, string $pid, array $dos): ?array {
  $id = (string) ($e['id'] ?? '');
  if (!preg_match('/^[A-Za-z0-9_-]{6,64}$/', $id)) return null;
  $ts = $e['ts'] ?? null;
  if (!is_int($ts) && !is_float($ts)) return null;
  $ts = (int) $ts;
  if ($ts < 1704067200000 || $ts > NOW + JOUR) return null;
  $t = (string) ($e['t'] ?? '');
  if (!in_array($t, ['travail', 'pause', 'cafe', 'fin'], true)) return null;
  $o = ['id' => $id, 'pid' => $pid, 'ts' => $ts, 't' => $t, 'seq' => (int) ($e['seq'] ?? 0), 'rev' => (int) ($e['rev'] ?? 0)];
  if ($t === 'travail') {
    $d = (string) ($e['d'] ?? '');
    if (!isset($dos[$d])) return null;
    $o['d'] = $d;
    $o['lieu'] = (($e['lieu'] ?? '') === 'mission') ? 'mission' : 'bureau';
    $note = cut((string) ($e['note'] ?? ''), 120);
    if ($note !== '') $o['note'] = $note;
    if (in_array($e['ci'] ?? '', ['D', 'R', 'G'], true)) $o['ci'] = $e['ci']; // D devis, R régie, G sous garantie
  }
  if ($t === 'pause') {
    $o['cat'] = (($e['cat'] ?? '') === 'midi') ? 'midi' : 'pause';
    $o['motif'] = cut((string) ($e['motif'] ?? 'Pause'), 40);
  }
  if (!empty($e['hist']) && is_array($e['hist'])) {
    $h = [];
    foreach (array_slice($e['hist'], -20) as $x) {
      if (!is_array($x)) continue;
      $h[] = ['old' => (int) ($x['old'] ?? 0), 'neu' => (int) ($x['neu'] ?? 0), 'at' => (int) ($x['at'] ?? 0), 'motif' => cut((string) ($x['motif'] ?? ''), 200)];
    }
    if ($h) $o['hist'] = $h;
  }
  return $o;
}
function evSort(array &$evs): void {
  usort($evs, function ($a, $b) {
    return ($a['ts'] <=> $b['ts']) ?: ((($a['seq'] ?? 0) <=> ($b['seq'] ?? 0)) ?: strcmp($a['id'], $b['id']));
  });
}
function etatSet(string $pid, array $evs): void {
  $et = rd('etat', []);
  $n = count($evs);
  if ($n) {
    $l = $evs[$n - 1];
    $et[$pid] = ['t' => $l['t'], 'd' => $l['d'] ?? null, 'lieu' => $l['lieu'] ?? null, 'ts' => $l['ts'], 'cat' => $l['cat'] ?? null];
  } else unset($et[$pid]);
  wr('etat', $et);
}

/* ---------- requête ---------- */
boot();
reinit();
semis();
$a = (string) ($_GET['a'] ?? '');
$in = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($in)) $in = [];

switch ($a) {

  /* ===== public ===== */
  case 'etat': {
    $c = cfg();
    $et = rd('etat', []);
    $dn = [];
    foreach ($c['dossiers'] as $d) $dn[$d['id']] = $d['nom'];
    $list = [];
    $abs = rd('abs', []); $jour = date('Y-m-d', (int) (NOW / 1000));
    foreach ($c['employes'] as $e) {
      if (empty($e['actif'])) continue;
      // Hors tableau d'équipe : le nom reste dans la liste de connexion, mais aucun statut n'est transmis et le tableau ne l'affiche pas.
      if (!auTableau($e)) { $list[] = ['id' => $e['id'], 'prenom' => $e['prenom'], 'nom' => $e['nom'], 'code' => 'absent', 'dossier' => null, 'since' => null, 'hors' => true]; continue; }
      $s = $et[$e['id']] ?? null;
      $o = ['id' => $e['id'], 'prenom' => $e['prenom'], 'nom' => $e['nom'], 'code' => 'absent', 'dossier' => null, 'since' => $s['ts'] ?? null];
      if ($s && $s['t'] === 'travail') { $o['code'] = ($s['lieu'] ?? '') === 'mission' ? 'mission' : 'bureau'; $o['dossier'] = $dn[$s['d'] ?? ''] ?? null; }
      elseif ($s && $s['t'] === 'pause') {
        $o['code'] = 'pause';
        // Repère « pause longue » : seuils des Réglages (rappel pause, rappel midi). Aucune durée n'est transmise.
        $lim = (int) ((($s['cat'] ?? '') === 'midi') ? $c['regles']['rappelMidi'] : $c['regles']['rappelPause']);
        if ($lim > 0 && NOW - (int) $s['ts'] > $lim * 60000) $o['long'] = true;
      }
      elseif ($s && $s['t'] === 'cafe') $o['since'] = null;
      // Absence saisie par le bureau : seuls « vacances » et « jour férié » sont affichés. Maladie, accident, autre : jamais de motif.
      if ($o['code'] === 'absent') {
        $mine = [];
        foreach ($abs as $a) if ($a['pid'] === $e['id'] || $a['pid'] === '*') $mine[] = $a;
        $a = absJour($mine, $jour);
        if ($a && $a['type'] === 'vacances') { $o['abs'] = 'vacances'; $o['jusqu'] = $a['au']; }
        elseif ($a && $a['type'] === 'ferie') $o['abs'] = 'ferie';
      }
      $list[] = $o;
    }
    usort($list, function ($x, $y) { return strcasecmp($x['prenom'] . ' ' . $x['nom'], $y['prenom'] . ' ' . $y['nom']); });
    out(['now' => NOW, 'pret' => $c['adminHash'] !== '', 'people' => $list]);
  }

  /* ===== employé ===== */
  case 'login': {
    $pid = (string) ($in['pid'] ?? '');
    $pin = (string) ($in['pin'] ?? '');
    $key = 'pin:' . $pid . ':' . ip();
    triesCheck($key);
    $c = cfg();
    $i = empIndex($c, $pid);
    if ($i < 0 || empty($c['employes'][$i]['actif']) || empty($c['employes'][$i]['pinHash']) || !password_verify($pin, $c['employes'][$i]['pinHash'])) {
      triesFail($key);
      fail('Code PIN incorrect.', 401);
    }
    triesClear($key);
    out(['token' => sessNew('e:' . $pid, 400 * JOUR)]);
  }

  case 'sync': {
    $pid = needEmp($in);
    $c = cfg();
    $i = empIndex($c, $pid);
    if ($i < 0 || empty($c['employes'][$i]['actif'])) fail('Accès désactivé.', 401);
    $e = $c['employes'][$i];
    $inc = $in['events'] ?? [];
    if (!is_array($inc)) $inc = [];
    if (count($inc) > 3000) fail('Trop d’événements en une fois.');
    $dos = [];
    foreach ($c['dossiers'] as $d) $dos[$d['id']] = true;
    if ($inc) {
      lock();
      $evs = rd('ev_' . $pid, []);
      $idx = [];
      foreach ($evs as $k => $x) $idx[$x['id']] = $k;
      foreach ($inc as $raw) {
        if (!is_array($raw)) continue;
        $x = evClean($raw, $pid, $dos);
        if (!$x) continue;
        if (isset($idx[$x['id']])) {
          $old = $evs[$idx[$x['id']]];
          if ($x['rev'] > ($old['rev'] ?? 0)) { $x['srv'] = $old['srv'] ?? NOW; $evs[$idx[$x['id']]] = $x; }
        } else {
          $x['srv'] = NOW;
          $evs[] = $x;
          $idx[$x['id']] = count($evs) - 1;
        }
      }
      evSort($evs);
      wr('ev_' . $pid, $evs);
      etatSet($pid, $evs);
    } else {
      $evs = rd('ev_' . $pid, []);
    }
    $min = NOW - 45 * JOUR;
    $recent = [];
    foreach ($evs as $x) if ($x['ts'] >= $min) { unset($x['srv']); $recent[] = $x; }
    $dl = [];
    foreach ($c['dossiers'] as $d) $dl[] = ['id' => $d['id'], 'nom' => $d['nom'], 'code' => $d['code'], 'soc' => $d['soc'], 'commun' => !empty($d['commun'])];
    out([
      'now' => NOW,
      'me' => ['id' => $e['id'], 'prenom' => $e['prenom'], 'nom' => $e['nom'], 'socs' => $e['socs'], 'midi' => !empty($e['midi'])],
      'socs' => $c['socs'], 'dossiers' => $dl, 'mes' => mesDossiers($e, $c), 'epingles' => epingles($e, $c), 'defaut' => defautDe($e, $c), 'regles' => $c['regles'], 'absences' => array_values(array_filter(absDe($pid), function ($a) { return $a['au'] >= date('Y-m-d', (int) (NOW / 1000) - 60 * 86400); })), 'events' => $recent,
    ]);
  }

  /* L'employé change lui-même son code PIN : l'ancien est exigé ; ses autres appareils sont déconnectés. */
  case 'pin_change': {
    $pid = needEmp($in);
    $key = 'pin:' . $pid . ':' . ip();
    triesCheck($key);
    lock();
    $c = cfg();
    $i = empIndex($c, $pid);
    if ($i < 0 || empty($c['employes'][$i]['actif'])) fail('Accès désactivé.', 401);
    if (empty($c['employes'][$i]['pinHash']) || !password_verify((string) ($in['old'] ?? ''), $c['employes'][$i]['pinHash'])) { triesFail($key); fail('Code PIN actuel incorrect.', 403); }
    $pin = (string) ($in['new'] ?? '');
    if (!preg_match('/^\\d{4,8}$/', $pin)) fail('Le nouveau code PIN doit compter 4 à 8 chiffres.');
    $c['employes'][$i]['pinHash'] = password_hash($pin, PASSWORD_DEFAULT);
    wr('cfg', $c);
    triesClear($key);
    sessDrop('e:' . $pid, (string) $in['token']);
    out(['ok' => true]);
  }

  case 'logout': {
    $tok = (string) ($in['token'] ?? '');
    if ($tok !== '') { lock(); $s = rd('sess', []); unset($s[hash('sha256', $tok)]); wr('sess', $s); }
    out(['ok' => true]);
  }

  /* ===== administration ===== */
  case 'setup': {
    lock();
    $c = cfg();
    if ($c['adminHash'] !== '') fail('Le mot de passe est déjà défini.', 403);
    $p = (string) ($in['password'] ?? '');
    if (strlen($p) < PW_MIN) fail('Le mot de passe doit compter au moins ' . PW_MIN . ' caractères.');
    $c['adminHash'] = password_hash($p, PASSWORD_DEFAULT);
    wr('cfg', $c);
    out(['token' => sessNew('admin', JOUR / 2)]);
  }

  case 'alogin': {
    $key = 'adm:' . ip();
    triesCheck($key);
    $c = cfg();
    if ($c['adminHash'] === '') fail('Aucun mot de passe défini.', 409);
    $p = (string) ($in['password'] ?? '');
    $prov = false;
    if (!password_verify($p, $c['adminHash'])) {
      $prov = tmpOk($c, $p); // mot de passe provisoire reçu par e-mail
      if (!$prov) { triesFail($key); fail('Mot de passe incorrect.', 401); }
    }
    triesClear($key);
    out(['token' => sessNew('admin', JOUR / 2), 'provisoire' => $prov]);
  }

  /* Mot de passe oublié : un mot de passe provisoire part par e-mail à l'adresse fixe MAIL_ADMIN.
     Le mot de passe actuel reste valable tant qu'un nouveau n'a pas été choisi : personne ne peut bloquer l'accès en cliquant ici. */
  case 'aoubli': {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail('Action inconnue.', 404);
    lock();
    $c = cfg();
    if ($c['adminHash'] === '') fail('Aucun mot de passe défini.', 409);
    if (NOW - (int) ($c['tmpAt'] ?? 0) < 5 * 60000) fail('Un e-mail vient d’être envoyé. Patientez 5 minutes avant d’en redemander un.', 429);
    $abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $tmp = '';
    for ($i = 0; $i < 10; $i++) $tmp .= $abc[random_int(0, strlen($abc) - 1)];
    $host = strtolower((string) preg_replace('/^www\\.|:\\d+$/', '', (string) ($_SERVER['HTTP_HOST'] ?? '')));
    if (!preg_match('/^[a-z0-9.-]+\\.[a-z]{2,}$/', $host)) $host = 'le-top.ch';
    $corps = "Mot de passe provisoire pour l'administration du pointage :\r\n\r\n    " . $tmp . "\r\n\r\n"
      . "Il est valable 30 minutes. Ouvrez l'administration (touchez le chat du logo), connectez-vous avec ce mot de passe, puis choisissez-en un nouveau.\r\n\r\n"
      . "Si vous n'avez rien demandé, ignorez ce message : le mot de passe actuel reste valable.\r\n";
    $tetes = 'From: Pointage GIOT <noreply@' . $host . ">\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit";
    $ok = function_exists('mail') && @mail(MAIL_ADMIN, '=?UTF-8?B?' . base64_encode('Pointage GIOT : mot de passe provisoire') . '?=', $corps, $tetes);
    if (!$ok) fail('Le serveur n’a pas pu envoyer l’e-mail.', 500);
    $c['tmpHash'] = password_hash($tmp, PASSWORD_DEFAULT);
    $c['tmpExp'] = NOW + TMP_TTL;
    $c['tmpAt'] = NOW;
    wr('cfg', $c);
    [$u, $d] = explode('@', MAIL_ADMIN);
    out(['ok' => true, 'a' => substr($u, 0, 1) . '…@' . $d]);
  }

  case 'apass': {
    needAdmin($in);
    lock();
    $c = cfg();
    $old = (string) ($in['old'] ?? '');
    if (!password_verify($old, $c['adminHash']) && !tmpOk($c, $old)) fail('Mot de passe actuel incorrect.', 403);
    $p = (string) ($in['new'] ?? '');
    if (strlen($p) < PW_MIN) fail('Le nouveau mot de passe doit compter au moins ' . PW_MIN . ' caractères.');
    $c['adminHash'] = password_hash($p, PASSWORD_DEFAULT);
    unset($c['tmpHash'], $c['tmpExp']); // le provisoire ne sert qu'une fois
    wr('cfg', $c);
    sessDrop('admin', (string) $in['token']);
    out(['ok' => true]);
  }

  case 'cfg': {
    needAdmin($in);
    $c = cfg();
    out(['socs' => $c['socs'], 'employes' => array_map('empAdmin', $c['employes']), 'dossiers' => $c['dossiers'], 'regles' => $c['regles'], 'absences' => rd('abs', [])]);
  }

  case 'emp_save': {
    needAdmin($in);
    lock();
    $c = cfg();
    $x = $in['emp'] ?? null;
    if (!is_array($x)) fail('Données manquantes.');
    $id = (string) ($x['id'] ?? '');
    $i = $id === '' ? -1 : empIndex($c, $id);
    if ($id !== '' && $i < 0) fail('Employé introuvable.', 404);
    $e = $i >= 0 ? $c['employes'][$i] : ['id' => newId('p'), 'pinHash' => ''];
    $e['prenom'] = cut((string) ($x['prenom'] ?? ''), 40);
    $e['nom'] = cut((string) ($x['nom'] ?? ''), 40);
    if ($e['prenom'] === '') fail('Le prénom est obligatoire.');
    $socs = [];
    foreach ((array) ($x['socs'] ?? []) as $s) if (is_string($s) && isset($c['socs'][$s]) && !in_array($s, $socs, true)) $socs[] = $s;
    if (!$socs) fail('Choisissez au moins une société.');
    $e['socs'] = $socs;
    $e['midi'] = !empty($x['midi']);
    $e['tous'] = !empty($x['tous']);
    $wasActif = !empty($e['actif']);
    $e['actif'] = !isset($x['actif']) || !empty($x['actif']);
    $e['tableau'] = !isset($x['tableau']) || !empty($x['tableau']); // indépendant de « actif » : on peut pointer sans figurer au tableau
    $ds = [];
    foreach ((array) ($x['dossiers'] ?? []) as $d) if (is_string($d) && dosIndex($c, $d) >= 0 && !in_array($d, $ds, true)) $ds[] = $d;
    $e['dossiers'] = $ds;
    $pin = (string) ($x['pin'] ?? '');
    $drop = false;
    if ($pin !== '') {
      if (!preg_match('/^\d{4,8}$/', $pin)) fail('Le code PIN doit compter 4 à 8 chiffres.');
      $e['pinHash'] = password_hash($pin, PASSWORD_DEFAULT);
      $drop = $i >= 0;
    } elseif ($e['pinHash'] === '') fail('Un code PIN est obligatoire pour un nouvel employé.');
    if ($wasActif && !$e['actif']) $drop = true;
    if ($i >= 0) $c['employes'][$i] = $e; else $c['employes'][] = $e;
    wr('cfg', $c);
    if ($drop) sessDrop('e:' . $e['id']);
    out(['emp' => empAdmin($e)]);
  }

  case 'abs_save': {
    needAdmin($in);
    lock();
    $c = cfg();
    $x = $in['abs'] ?? null;
    if (!is_array($x)) fail('Requête invalide.');
    $pid = (string) ($x['pid'] ?? '');
    if ($pid !== '*' && empIndex($c, $pid) < 0) fail('Choisissez l’employé.');
    $type = (string) ($x['type'] ?? '');
    if (!in_array($type, ABS_TYPES, true)) fail('Choisissez le type d’absence.');
    $du = (string) ($x['du'] ?? ''); $au = (string) ($x['au'] ?? '');
    if ($au === '') $au = $du;
    if (!jourOk($du) || !jourOk($au)) fail('Vérifiez les dates.');
    if ($au < $du) fail('La date de fin précède la date de début.');
    if ((strtotime($au) - strtotime($du)) / 86400 > 400) fail('Période trop longue : 400 jours au maximum.');
    $l = rd('abs', []);
    $id = (string) ($x['id'] ?? ''); $i = -1;
    foreach ($l as $k => $a) if ($a['id'] === $id) $i = $k;
    if ($id !== '' && $i < 0) fail('Absence introuvable.', 404);
    $a = ['id' => $i >= 0 ? $id : newId('a'), 'pid' => $pid, 'type' => $type, 'du' => $du, 'au' => $au, 'demi' => !empty($x['demi']) && $du === $au, 'note' => cut((string) ($x['note'] ?? ''), 80)];
    if ($i >= 0) $l[$i] = $a; else $l[] = $a;
    wr('abs', $l);
    out(['absences' => $l]);
  }

  case 'abs_del': {
    needAdmin($in);
    lock();
    $l = rd('abs', []);
    $id = (string) ($in['id'] ?? ''); $n = count($l);
    $l = array_values(array_filter($l, function ($a) use ($id) { return $a['id'] !== $id; }));
    if (count($l) === $n) fail('Absence introuvable.', 404);
    wr('abs', $l);
    out(['absences' => $l]);
  }

  case 'emp_del': {
    needAdmin($in);
    lock();
    $c = cfg();
    $id = (string) ($in['id'] ?? '');
    $i = empIndex($c, $id);
    if ($i < 0) fail('Employé introuvable.', 404);
    if (rd('ev_' . $id, [])) fail('Cet employé a des pointages : désactivez-le au lieu de le supprimer, ses heures restent dans les exports.', 409);
    array_splice($c['employes'], $i, 1);
    wr('cfg', $c);
    sessDrop('e:' . $id);
    $ab = rd('abs', []);
    $ab2 = array_values(array_filter($ab, function ($a) use ($id) { return $a['pid'] !== $id; }));
    if (count($ab2) !== count($ab)) wr('abs', $ab2);
    $et = rd('etat', []);
    unset($et[$id]);
    wr('etat', $et);
    out(['ok' => true]);
  }

  case 'dos_save': {
    needAdmin($in);
    lock();
    $c = cfg();
    $x = $in['dos'] ?? null;
    if (!is_array($x)) fail('Données manquantes.');
    $id = (string) ($x['id'] ?? '');
    $i = $id === '' ? -1 : dosIndex($c, $id);
    if ($id !== '' && $i < 0) fail('Dossier introuvable.', 404);
    $d = $i >= 0 ? $c['dossiers'][$i] : ['id' => newId('d')];
    $d['nom'] = cut((string) ($x['nom'] ?? ''), 60);
    if ($d['nom'] === '') fail('Le nom est obligatoire.');
    $d['code'] = cut((string) ($x['code'] ?? ''), 30);
    $soc = (string) ($x['soc'] ?? '');
    if (!isset($c['socs'][$soc])) fail('Choisissez la société.');
    $d['soc'] = $soc;
    $d['actif'] = !isset($x['actif']) || !empty($x['actif']);
    $d['commun'] = !empty($x['commun']);
    $d['defaut'] = !empty($x['defaut']) && $d['actif'];
    if ($d['defaut']) $d['commun'] = true; // on commence la journée dessus : forcément proposé à tous
    foreach ($c['dossiers'] as $k => $o) {
      if ($k !== $i && $o['soc'] === $d['soc'] && nomCle($o['nom']) === nomCle($d['nom'])) fail('Un centre porte déjà ce nom dans cette société.', 409);
      if ($d['defaut'] && $k !== $i && $o['soc'] === $d['soc']) $c['dossiers'][$k]['defaut'] = false; // un seul centre par défaut par société
    }
    if ($i >= 0) $c['dossiers'][$i] = $d; else $c['dossiers'][] = $d;
    wr('cfg', $c);
    out(['dos' => $d, 'dossiers' => $c['dossiers']]);
  }

  case 'dos_import': {
    needAdmin($in);
    lock();
    $c = cfg();
    $soc = (string) ($in['soc'] ?? '');
    if (!isset($c['socs'][$soc])) fail('Choisissez la société.');
    $items = $in['items'] ?? null;
    if (!is_array($items) || !$items) fail('La liste est vide.');
    if (count($items) > 2000) fail('Trop de lignes en une fois (2000 au maximum).');
    [$n, $dbl] = importer($c, $soc, $items, !empty($in['commun']));
    if ($n) wr('cfg', $c);
    out(['dossiers' => $c['dossiers'], 'ajoutes' => $n, 'doublons' => $dbl]);
  }

  /* Import d'une liste chiffrée posée par le dépôt (import.php) : la clé n'est jamais dans le dépôt, elle est fournie une fois à l'appel. */
  case 'import_secret': {
    $f = __DIR__ . '/import.php';
    if (!is_file($f)) fail('Rien à importer.', 404);
    $r = include $f;
    $k = (string) ($_GET['k'] ?? '');
    if (!is_array($r) || !preg_match('/^[0-9a-f]{64}$/', $k)) fail('Clé invalide.', 403);
    if (!function_exists('openssl_decrypt')) fail('OpenSSL absent sur ce serveur.', 500);
    $txt = openssl_decrypt((string) base64_decode((string) $r['data']), 'aes-256-gcm', (string) hex2bin($k), OPENSSL_RAW_DATA, (string) base64_decode((string) $r['iv']), (string) base64_decode((string) $r['tag']));
    if ($txt === false) fail('Clé invalide.', 403);
    lock();
    $c = cfg();
    $soc = (string) ($r['soc'] ?? '');
    if (!isset($c['socs'][$soc])) fail('Société inconnue.');
    $items = [];
    foreach (preg_split('/\\R/u', $txt) as $l) if (trim($l) !== '') $items[] = ['nom' => $l];
    [$n, $dbl] = importer($c, $soc, $items, false);
    if ($n) wr('cfg', $c);
    $tot = 0;
    foreach ($c['dossiers'] as $d) if ($d['soc'] === $soc && empty($d['commun'])) $tot++;
    out(['ajoutes' => $n, 'doublons' => $dbl, 'total' => $tot]);
  }

  /* Envoi d'un document à l'administratrice (adresse fixe MAIL_ADMIN) : le document est posé chiffré par le dépôt (envoi.php),
     la clé n'est jamais dans le dépôt et chaque envoi ne part qu'une fois. */
  case 'envoi_secret': {
    $f = __DIR__ . '/envoi.php';
    if (!is_file($f)) fail('Rien à envoyer.', 404);
    $r = include $f;
    $k = (string) ($_GET['k'] ?? '');
    if (!is_array($r) || !preg_match('/^[0-9a-f]{64}$/', $k)) fail('Clé invalide.', 403);
    if (!function_exists('openssl_decrypt')) fail('OpenSSL absent sur ce serveur.', 500);
    $txt = openssl_decrypt((string) base64_decode((string) $r['data']), 'aes-256-gcm', (string) hex2bin($k), OPENSSL_RAW_DATA, (string) base64_decode((string) $r['iv']), (string) base64_decode((string) $r['tag']));
    $m = $txt === false ? null : json_decode($txt, true);
    if (!is_array($m) || !isset($m['pdf'], $m['nom'], $m['sujet'], $m['texte'])) fail('Clé invalide.', 403);
    lock();
    $c = cfg();
    $id = (string) ($r['id'] ?? '');
    if ($id === '' || in_array($id, $c['envois'] ?? [], true)) fail('Ce document est déjà parti.', 409);
    $pdf = base64_decode((string) $m['pdf'], true);
    if ($pdf === false || strncmp($pdf, '%PDF', 4) !== 0) fail('Document illisible.', 400);
    $nom = (string) preg_replace('/[^A-Za-z0-9._-]/', '-', (string) $m['nom']);
    $host = strtolower((string) preg_replace('/^www\\.|:\\d+$/', '', (string) ($_SERVER['HTTP_HOST'] ?? '')));
    if (!preg_match('/^[a-z0-9.-]+\\.[a-z]{2,}$/', $host)) $host = 'le-top.ch';
    $b = 'b' . bin2hex(random_bytes(12));
    $tetes = 'From: Time GIOT <noreply@' . $host . ">\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"" . $b . '"';
    $corps = '--' . $b . "\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n" . str_replace("\n", "\r\n", str_replace("\r", '', (string) $m['texte'])) . "\r\n"
      . '--' . $b . "\r\nContent-Type: application/pdf; name=\"" . $nom . "\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"" . $nom . "\"\r\n\r\n" . chunk_split(base64_encode($pdf))
      . '--' . $b . "--\r\n";
    $ok = function_exists('mail') && @mail(MAIL_ADMIN, '=?UTF-8?B?' . base64_encode(cut((string) $m['sujet'], 120)) . '?=', $corps, $tetes);
    if (!$ok) fail('Le serveur n’a pas pu envoyer l’e-mail.', 500);
    $c['envois'][] = $id;
    wr('cfg', $c);
    [$u, $d] = explode('@', MAIL_ADMIN);
    out(['ok' => true, 'a' => substr($u, 0, 1) . '…@' . $d, 'octets' => strlen($pdf)]);
  }

  /* L'administration ouvre le pointage d'un employé, comme s'il était connecté (contrôle, essais, correction d'un oubli). */
  /* Documents de l'administration (synthèses, rapports). Le document est posé chiffré par le dépôt (depot.php) ; la clé n'est
     jamais dans le dépôt. Déchiffré, il est rangé dans data/, hors dépôt, et ne se lit qu'avec la session d'administration.
     Un dépôt portant un identifiant déjà connu remplace le document. */
  case 'doc_secret': {
    $f = __DIR__ . '/depot.php';
    if (!is_file($f)) fail('Rien à déposer.', 404);
    $r = include $f;
    $k = (string) ($_GET['k'] ?? '');
    if (!is_array($r) || !preg_match('/^[0-9a-f]{64}$/', $k)) fail('Clé invalide.', 403);
    if (!function_exists('openssl_decrypt')) fail('OpenSSL absent sur ce serveur.', 500);
    $txt = openssl_decrypt((string) base64_decode((string) $r['data']), 'aes-256-gcm', (string) hex2bin($k), OPENSSL_RAW_DATA, (string) base64_decode((string) $r['iv']), (string) base64_decode((string) $r['tag']));
    $m = $txt === false ? null : json_decode($txt, true);
    if (!is_array($m) || !isset($m['pdf'], $m['nom'], $m['titre'])) fail('Clé invalide.', 403);
    $id = (string) ($r['id'] ?? '');
    if (!preg_match('/^[a-z0-9-]{3,60}$/', $id)) fail('Identifiant invalide.');
    $pdf = base64_decode((string) $m['pdf'], true);
    if ($pdf === false || strncmp($pdf, '%PDF', 4) !== 0) fail('Document illisible.', 400);
    lock();
    $L = [];
    foreach (rd('docs', []) as $d) if (($d['id'] ?? '') !== $id) $L[] = $d;
    wr('doc_' . $id, ['pdf' => base64_encode($pdf)]);
    array_unshift($L, ['id' => $id, 'titre' => cut((string) $m['titre'], 120), 'nom' => (string) preg_replace('/[^A-Za-z0-9._-]/', '-', (string) $m['nom']), 'ts' => NOW, 'octets' => strlen($pdf)]);
    wr('docs', $L);
    out(['ok' => true, 'id' => $id, 'octets' => strlen($pdf), 'documents' => count($L)]);
  }

  case 'docs': {
    needAdmin($in);
    out(['docs' => rd('docs', [])]);
  }

  case 'doc': {
    needAdmin($in);
    $id = (string) ($in['id'] ?? '');
    if (!preg_match('/^[a-z0-9-]{3,60}$/', $id)) fail('Document introuvable.', 404);
    $meta = null;
    foreach (rd('docs', []) as $d) if (($d['id'] ?? '') === $id) $meta = $d;
    $x = rd('doc_' . $id, []);
    if (!$meta || empty($x['pdf'])) fail('Document introuvable.', 404);
    out(['id' => $id, 'nom' => $meta['nom'], 'titre' => $meta['titre'], 'pdf' => $x['pdf']]);
  }

  case 'doc_del': {
    needAdmin($in);
    $id = (string) ($in['id'] ?? '');
    if (!preg_match('/^[a-z0-9-]{3,60}$/', $id)) fail('Document introuvable.', 404);
    lock();
    $L = [];
    foreach (rd('docs', []) as $d) if (($d['id'] ?? '') !== $id) $L[] = $d;
    wr('docs', $L);
    @unlink(fpath('doc_' . $id));
    out(['docs' => $L]);
  }

  case 'emp_as': {
    needAdmin($in);
    $c = cfg();
    $id = (string) ($in['id'] ?? '');
    $i = empIndex($c, $id);
    if ($i < 0) fail('Employé introuvable.', 404);
    if (empty($c['employes'][$i]['actif'])) fail('Cet employé est désactivé : réactivez-le pour ouvrir son pointage.', 409);
    out(['token' => sessNew('e:' . $id, JOUR / 2), 'pid' => $id]);
  }

  case 'dos_del': {
    needAdmin($in);
    lock();
    $c = cfg();
    $id = (string) ($in['id'] ?? '');
    $i = dosIndex($c, $id);
    if ($i < 0) fail('Dossier introuvable.', 404);
    foreach ($c['employes'] as $e) foreach (rd('ev_' . $e['id'], []) as $x) {
      if (($x['d'] ?? '') === $id) fail('Des heures sont déjà chargées sur ce dossier : archivez-le au lieu de le supprimer.', 409);
    }
    array_splice($c['dossiers'], $i, 1);
    foreach ($c['employes'] as $k => $e) $c['employes'][$k]['dossiers'] = array_values(array_diff($e['dossiers'] ?? [], [$id]));
    wr('cfg', $c);
    out(['ok' => true]);
  }

  case 'regles_save': {
    needAdmin($in);
    lock();
    $c = cfg();
    foreach (['midiMin', 'midiEx', 'rappelPause', 'rappelMidi'] as $k) {
      if (isset($in['regles'][$k])) $c['regles'][$k] = max(0, min(240, (int) $in['regles'][$k]));
    }
    if (isset($in['regles']['note'])) {
      $on = !empty($in['regles']['note']);
      if ($on && empty($c['regles']['note'])) $c['regles']['noteDepuis'] = NOW; // seules les interventions terminées après l'activation demandent une note
      $c['regles']['note'] = $on;
    }
    wr('cfg', $c);
    out(['regles' => $c['regles']]);
  }

  case 'export': {
    needAdmin($in);
    $from = (string) ($in['from'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) fail('Date de début invalide.');
    $t = strtotime($from . ' 00:00:00');
    if ($t === false) fail('Date de début invalide.');
    $min = $t * 1000 - 2 * JOUR; // marge : une plage ouverte la veille déborde sur la période
    $c = cfg();
    $evs = [];
    foreach ($c['employes'] as $e) {
      $l = [];
      foreach (rd('ev_' . $e['id'], []) as $x) if ($x['ts'] >= $min) $l[] = $x;
      $evs[$e['id']] = $l;
    }
    out(['now' => NOW, 'socs' => $c['socs'], 'employes' => array_map('empAdmin', $c['employes']), 'dossiers' => $c['dossiers'], 'events' => (object) $evs, 'absences' => rd('abs', [])]);
  }

  default:
    fail('Action inconnue.', 404);
}
