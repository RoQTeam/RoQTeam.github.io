<?php
/*
 * BreaQ Conference: are you coming? The fast end of confirm.html (roqteam.ro/confirm), on roqteam.ro itself, with
 * SQLite, so that a yes or a no takes a blink instead of a round trip through Google.
 *
 * What it answers (POST, JSON):
 *   { action: "conference-coming", code }          -> { ok, me: { name, coming, answered, open } }
 *   { action: "conference-coming", code, coming }  -> the same, after saving "yes" or "no" (until CONF_STARTS)
 *   { action: "sync", key, people }                -> for the Apps Script only (tools/register-backend.gs, confSync_):
 *        people: [{ p, n, c: [code hashes], coming, at }] adds or updates those registered for the conference (an
 *        empty list changes nothing); the answer is every answer given here, [{ p, coming, at }], which the Apps
 *        Script writes into the sheet's "Coming" and "Coming answered"
 *   GET -> { ok, service, sqlite } to check that it runs
 *
 * What it keeps: never the codes nor the emails. p is a hash of the registration's email, each code is kept as its
 * SHA-256, and n is the first name the page greets them with.
 *
 * The data lives outside the web root, in ~/breaq-data (BREAQ_DATA to put it elsewhere, for tests):
 *   confirm.sqlite  made on first use
 *   config.php      made by hand, never in this repository (which is public):
 *                   <?php return ['sync_key' => '…the CONF_SYNC_KEY of the Apps Script…'];
 */

const CONF_STARTS = '2026-11-14T09:00:00+02:00'; // answers close as the conference starts (CONF_STARTS in the Apps Script)
const MISSES_PER_HOUR = 40;                      // wrong codes from one address in an hour, past which it waits
const BODY_MAX = 2 * 1024 * 1024;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

function out(array $o, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($o, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function data_dir(): string
{
    $dir = getenv('BREAQ_DATA') ?: dirname(__DIR__, 2) . '/breaq-data';
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    return $dir;
}

function db(): PDO
{
    $pdo = new PDO('sqlite:' . data_dir() . '/confirm.sqlite', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS people (
            pkey TEXT PRIMARY KEY,
            name TEXT NOT NULL DEFAULT '',
            coming TEXT NOT NULL DEFAULT '',
            answered INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS codes (code TEXT PRIMARY KEY, pkey TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS codes_pkey ON codes (pkey);
        CREATE TABLE IF NOT EXISTS misses (ip TEXT NOT NULL, hour INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (ip, hour));
        SQL);
    return $pdo;
}

function now_ms(): int
{
    return (int) floor(microtime(true) * 1000);
}

function coming_of($v): string
{
    $v = strtolower(trim((string) $v));
    return in_array($v, ['yes', 'no'], true) ? $v : '';
}

function me(array $p): array
{
    return [
        'name' => $p['name'],
        'coming' => $p['coming'],
        'answered' => $p['answered'] ? gmdate('Y-m-d\TH:i:s\Z', intdiv((int) $p['answered'], 1000)) : '',
        'open' => time() < strtotime(CONF_STARTS),
    ];
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    out(['ok' => true, 'service' => 'breaq-conference-confirm', 'sqlite' => in_array('sqlite', PDO::getAvailableDrivers(), true)]);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') out(['ok' => false, 'error' => 'POST only.'], 405);

$raw = file_get_contents('php://input', false, null, 0, BODY_MAX + 1);
if ($raw === false || strlen($raw) > BODY_MAX) out(['ok' => false, 'error' => 'Bad request'], 413);
$in = json_decode($raw, true);
if (!is_array($in)) out(['ok' => false, 'error' => 'Bad request'], 400);
$action = (string) ($in['action'] ?? '');

try {
    $pdo = db();

    /* --- the Apps Script: who is registered, and back the answers ----------------------------------------- */
    if ($action === 'sync') {
        $config = @include data_dir() . '/config.php';
        $want = is_array($config) ? (string) ($config['sync_key'] ?? '') : '';
        if (strlen($want) < 32 || !hash_equals($want, (string) ($in['key'] ?? ''))) {
            usleep(500000);
            out(['ok' => false, 'action' => 'sync', 'denied' => true, 'error' => $want === '' ? 'Not set up: config.php is missing.' : 'Wrong key.'], 403);
        }
        $people = is_array($in['people'] ?? null) ? $in['people'] : [];
        $pdo->beginTransaction();
        $up = $pdo->prepare('INSERT INTO people (pkey, name) VALUES (?, ?) ON CONFLICT (pkey) DO UPDATE SET name = excluded.name');
        $answer = $pdo->prepare("UPDATE people SET coming = ?, answered = ? WHERE pkey = ? AND (coming = '' OR answered < ?)");
        $drop = $pdo->prepare('DELETE FROM codes WHERE pkey = ?');
        $code = $pdo->prepare('INSERT OR REPLACE INTO codes (code, pkey) VALUES (?, ?)');
        $added = 0;
        foreach ($people as $p) {
            $key = (string) ($p['p'] ?? '');
            if (!preg_match('/^[0-9a-f]{64}$/', $key)) continue;
            $name = trim((string) ($p['n'] ?? ''));
            $up->execute([$key, function_exists('mb_substr') ? mb_substr($name, 0, 80) : substr($name, 0, 80)]);
            $drop->execute([$key]);
            foreach ((array) ($p['c'] ?? []) as $c) {
                if (preg_match('/^[0-9a-f]{64}$/', (string) $c)) $code->execute([(string) $c, $key]);
            }
            // an answer in the sheet (typed there for someone who wrote to us) counts when it is newer than ours
            $said = coming_of($p['coming'] ?? '');
            if ($said !== '') $answer->execute([$said, (int) ($p['at'] ?? 0), $key, (int) ($p['at'] ?? 0)]);
            $added++;
        }
        $pdo->commit();
        $answers = $pdo->query("SELECT pkey AS p, coming, answered AS at FROM people WHERE coming <> ''")->fetchAll();
        foreach ($answers as &$a) $a['at'] = (int) $a['at'];
        out(['ok' => true, 'action' => 'sync', 'people' => $added, 'answers' => $answers]);
    }

    /* --- confirm.html: their answer, read or given ------------------------------------------------------ */
    if ($action !== 'conference-coming') out(['ok' => false, 'error' => 'Unknown action.'], 400);

    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    $hour = intdiv(time(), 3600);
    $miss = $pdo->prepare('SELECT n FROM misses WHERE ip = ? AND hour = ?');
    $miss->execute([$ip, $hour]);
    if ((int) $miss->fetchColumn() >= MISSES_PER_HOUR)
        out(['ok' => false, 'action' => 'conference-coming', 'error' => 'Too many wrong codes from here. Try again in an hour, or reply to our email.'], 429);

    $key = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string) ($in['code'] ?? '')));
    $find = $pdo->prepare('SELECT p.* FROM codes c JOIN people p ON p.pkey = c.pkey WHERE c.code = ?');
    $find->execute([hash('sha256', $key)]);
    $p = strlen($key) === 8 ? $find->fetch() : false;
    if (!$p) {
        $pdo->prepare('INSERT INTO misses (ip, hour, n) VALUES (?, ?, 1) ON CONFLICT (ip, hour) DO UPDATE SET n = n + 1')->execute([$ip, $hour]);
        $pdo->prepare('DELETE FROM misses WHERE hour < ?')->execute([$hour - 24]);
        usleep(800000); // a wrong code costs time, so guessing does not pay
        out(['ok' => false, 'action' => 'conference-coming', 'denied' => true,
            'error' => 'This link does not open a registration for the BreaQ Conference. Use the button in the email we sent you, or reply to that email.']);
    }

    $giving = isset($in['coming']) && (string) $in['coming'] !== '';
    if ($giving) {
        $said = coming_of($in['coming']);
        if ($said === '') out(['ok' => false, 'action' => 'conference-coming', 'error' => 'Answer yes or no.']);
        if (!me($p)['open'])
            out(['ok' => false, 'action' => 'conference-coming', 'error' => 'The conference has started, so this page no longer takes answers. Write to us at registrations@roqteam.ro.']);
        $at = now_ms();
        $pdo->prepare('UPDATE people SET coming = ?, answered = ? WHERE pkey = ?')->execute([$said, $at, $p['pkey']]);
        $p['coming'] = $said;
        $p['answered'] = $at;
    }
    out(['ok' => true, 'action' => 'conference-coming', 'saved' => $giving, 'me' => me($p)]);
} catch (Throwable $e) {
    error_log('confirm.php: ' . $e->getMessage());
    out(['ok' => false, 'action' => $action, 'temporary' => true, 'error' => 'That did not go through. Try again in a minute.'], 500);
}
