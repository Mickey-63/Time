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
  return $c;
}
function empIndex(array $c, string $id): int { foreach ($c['employes'] as $i => $e) if ($e['id'] === $id) return $i; return -1; }
function dosIndex(array $c, string $id): int { foreach ($c['dossiers'] as $i => $d) if ($d['id'] === $id) return $i; return -1; }
function empAdmin(array $e): array { $o = $e; $o['pin'] = !empty($e['pinHash']); unset($o['pinHash']); return $o; }
function mesDossiers(array $e, array $c): array {
  $o = [];
  foreach ($c['dossiers'] as $d) {
    if (empty($d['actif']) || !in_array($d['soc'], $e['socs'], true)) continue;
    if (!empty($e['tous']) || in_array($d['id'], $e['dossiers'] ?? [], true)) $o[] = $d['id'];
  }
  return $o;
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
    $et[$pid] = ['t' => $l['t'], 'd' => $l['d'] ?? null, 'lieu' => $l['lieu'] ?? null, 'ts' => $l['ts']];
  } else unset($et[$pid]);
  wr('etat', $et);
}

/* ---------- requête ---------- */
boot();
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
    foreach ($c['employes'] as $e) {
      if (empty($e['actif'])) continue;
      $s = $et[$e['id']] ?? null;
      $o = ['id' => $e['id'], 'prenom' => $e['prenom'], 'nom' => $e['nom'], 'code' => 'absent', 'dossier' => null, 'since' => $s['ts'] ?? null];
      if ($s && $s['t'] === 'travail') { $o['code'] = ($s['lieu'] ?? '') === 'mission' ? 'mission' : 'bureau'; $o['dossier'] = $dn[$s['d'] ?? ''] ?? null; }
      elseif ($s && $s['t'] === 'pause') $o['code'] = 'pause';
      elseif ($s && $s['t'] === 'cafe') $o['since'] = null;
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
    foreach ($c['dossiers'] as $d) $dl[] = ['id' => $d['id'], 'nom' => $d['nom'], 'code' => $d['code'], 'soc' => $d['soc']];
    out([
      'now' => NOW,
      'me' => ['id' => $e['id'], 'prenom' => $e['prenom'], 'nom' => $e['nom'], 'socs' => $e['socs'], 'midi' => !empty($e['midi'])],
      'socs' => $c['socs'], 'dossiers' => $dl, 'mes' => mesDossiers($e, $c), 'regles' => $c['regles'], 'events' => $recent,
    ]);
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
    if (strlen($p) < 8) fail('Le mot de passe doit compter au moins 8 caractères.');
    $c['adminHash'] = password_hash($p, PASSWORD_DEFAULT);
    wr('cfg', $c);
    out(['token' => sessNew('admin', JOUR / 2)]);
  }

  case 'alogin': {
    $key = 'adm:' . ip();
    triesCheck($key);
    $c = cfg();
    if ($c['adminHash'] === '') fail('Aucun mot de passe défini.', 409);
    if (!password_verify((string) ($in['password'] ?? ''), $c['adminHash'])) { triesFail($key); fail('Mot de passe incorrect.', 401); }
    triesClear($key);
    out(['token' => sessNew('admin', JOUR / 2)]);
  }

  case 'apass': {
    needAdmin($in);
    lock();
    $c = cfg();
    if (!password_verify((string) ($in['old'] ?? ''), $c['adminHash'])) fail('Mot de passe actuel incorrect.', 403);
    $p = (string) ($in['new'] ?? '');
    if (strlen($p) < 8) fail('Le nouveau mot de passe doit compter au moins 8 caractères.');
    $c['adminHash'] = password_hash($p, PASSWORD_DEFAULT);
    wr('cfg', $c);
    sessDrop('admin', (string) $in['token']);
    out(['ok' => true]);
  }

  case 'cfg': {
    needAdmin($in);
    $c = cfg();
    out(['socs' => $c['socs'], 'employes' => array_map('empAdmin', $c['employes']), 'dossiers' => $c['dossiers'], 'regles' => $c['regles']]);
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
    if ($i >= 0) $c['dossiers'][$i] = $d; else $c['dossiers'][] = $d;
    wr('cfg', $c);
    out(['dos' => $d]);
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
    out(['now' => NOW, 'socs' => $c['socs'], 'employes' => array_map('empAdmin', $c['employes']), 'dossiers' => $c['dossiers'], 'events' => (object) $evs]);
  }

  default:
    fail('Action inconnue.', 404);
}
