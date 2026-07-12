<?php
/**
 * Production readiness / health probe.
 *
 * GET /api/readiness.php
 *   Auth: an admin session, OR header `X-Cron-Secret: <CRON_SECRET>` (for
 *   external monitoring). Returns a JSON report of go-live checks, each
 *   { status: ok|warn|fail, message }, plus an overall status.
 *
 * "warn" = works but not production-hardened (e.g. mail off, no backup yet).
 * "fail" = a real blocker for putting real client data in (e.g. DB user is root,
 * pending migrations, SETUP still enabled, debug on in production).
 */

require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/settings.php';

header('Content-Type: application/json; charset=utf-8');

// ── Auth: admin session OR cron secret ──────────────────────────────────────
$cronSecret = defined('CRON_SECRET') ? CRON_SECRET : '';
$providedSecret = $_SERVER['HTTP_X_CRON_SECRET'] ?? '';
$viaCron = $cronSecret !== '' && hash_equals($cronSecret, $providedSecret);

if (!$viaCron && !(function_exists('isLoggedIn') && isLoggedIn())) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Autenticazione richiesta.']);
    exit;
}

$isProd  = strtolower((string) env('APP_ENV', 'production')) === 'production';
$checks   = [];
$add = function (string $key, string $status, string $message) use (&$checks) {
    $checks[$key] = ['status' => $status, 'message' => $message];
};

// ── DB reachable + not running as root ──────────────────────────────────────
try {
    $db   = getDB();
    $user = (string) $db->query('SELECT CURRENT_USER()')->fetchColumn();
    if (stripos($user, 'root@') === 0) {
        $add('db_user', $isProd ? 'fail' : 'warn', "L'app è connessa come '$user'. In produzione usa un utente dedicato (database/create_app_user.sql), non root.");
    } else {
        $add('db_user', 'ok', "Connesso come utente dedicato ($user).");
    }
} catch (Throwable $e) {
    $add('db_user', 'fail', 'Database non raggiungibile: ' . $e->getMessage());
    echo json_encode(['success' => true, 'overall' => 'fail', 'checks' => $checks], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── Pending migrations ──────────────────────────────────────────────────────
try {
    $applied = array_flip($db->query('SELECT version FROM schema_migrations')->fetchAll(PDO::FETCH_COLUMN));
    $files   = glob(dirname(__DIR__) . '/database/migrations/*.sql') ?: [];
    $pending = [];
    foreach ($files as $f) {
        $v = basename($f, '.sql');
        if ($v === '000_helpers' || $v === 'README') continue;
        if (preg_match('/^phase(\d+)/', $v, $m) && (int) $m[1] <= 28) continue; // baseline in schema_production.sql
        if (!isset($applied[$v])) $pending[] = $v;
    }
    if ($pending) {
        $add('migrations', 'fail', 'Migrazioni non applicate: ' . implode(', ', $pending) . '. Esegui php database/migrate.php.');
    } else {
        $add('migrations', 'ok', count($applied) . ' migrazioni applicate, nessuna in sospeso.');
    }
} catch (Throwable $e) {
    $add('migrations', 'warn', 'Impossibile verificare le migrazioni: ' . $e->getMessage());
}

// ── Uploads: writable + sensitive tree denied ───────────────────────────────
$root = dirname(__DIR__);
$uplWritable = is_dir("$root/uploads") && is_writable("$root/uploads");
$denyFile    = "$root/uploads/documents/.htaccess";
$hasDeny     = is_file($denyFile) && stripos((string) @file_get_contents($denyFile), 'Require all denied') !== false;
if ($uplWritable && $hasDeny) {
    $add('uploads', 'ok', 'uploads/ scrivibile e uploads/documents/ protetto (deny-all).');
} elseif (!$uplWritable) {
    $add('uploads', 'fail', 'uploads/ non scrivibile: upload e PDF falliranno.');
} else {
    $add('uploads', 'fail', 'uploads/documents/.htaccess mancante o non deny-all: documenti sensibili potrebbero essere pubblici.');
}

// ── Setup lock + debug (production hardening) ───────────────────────────────
if (defined('SETUP_ENABLED') && SETUP_ENABLED) {
    $add('setup', $isProd ? 'fail' : 'warn', 'SETUP_ENABLED è attivo. Disattivalo (SETUP_ENABLED=false) dopo la creazione dell\'admin.');
} else {
    $add('setup', 'ok', 'Setup disabilitato.');
}
if ($isProd && defined('APP_DEBUG') && APP_DEBUG) {
    $add('debug', 'fail', 'APP_DEBUG è attivo in produzione: gli errori potrebbero trapelare. Imposta APP_DEBUG=false.');
} else {
    $add('debug', 'ok', 'Debug ' . ((defined('APP_DEBUG') && APP_DEBUG) ? 'attivo (non-prod)' : 'disattivo') . '.');
}

// ── Secrets ─────────────────────────────────────────────────────────────────
if ($cronSecret === '') {
    $add('cron_secret', $isProd ? 'warn' : 'ok', 'CRON_SECRET non impostato: gli endpoint cron non sono protetti da segreto.');
} else {
    $add('cron_secret', 'ok', 'CRON_SECRET impostato.');
}

// ── Mail configured ─────────────────────────────────────────────────────────
$mailOn   = filter_var(getSetting('mail_enabled', 'false'), FILTER_VALIDATE_BOOLEAN);
$smtpHost = (string) getSetting('smtp_host', '');
if ($mailOn && $smtpHost !== '') {
    $add('email', 'ok', "SMTP configurato ($smtpHost). Esegui un invio di prova per confermare la consegna.");
} else {
    $add('email', 'warn', 'Email non configurata: notifiche/promemoria via email non partiranno. Configura SMTP in Impostazioni.');
}

// ── Webhook secrets (fail-closed already, but flag missing) ─────────────────
$twilio = (string) (getSetting('twilio_auth_token') ?: getenv('TWILIO_AUTH_TOKEN'));
$stripe = (string) (getSetting('stripe_webhook_secret') ?: getenv('STRIPE_WEBHOOK_SECRET'));
$whMsg = [];
if ($twilio === '') $whMsg[] = 'Twilio';
if ($stripe === '') $whMsg[] = 'Stripe';
$add('webhooks', empty($whMsg) ? 'ok' : 'warn',
    empty($whMsg)
        ? 'Firme webhook configurate; richieste non firmate rifiutate.'
        : 'Segreti webhook mancanti per: ' . implode(', ', $whMsg) . ' (in produzione i webhook falliscono in modo sicuro/chiuso).');

// ── Cron freshness ──────────────────────────────────────────────────────────
$now = time();
$cronJobs = [
    'reminders'            => 2 * 3600,   // expected at least every ~2h
    'payment_reminders'    => 26 * 3600,  // daily
    'contract_expirations' => 26 * 3600,  // daily
    'backup'               => 26 * 3600,  // daily
    'gdpr_retention'       => 8 * 86400,  // weekly-ish
];
$stale = [];
$never = [];
foreach ($cronJobs as $job => $maxAge) {
    $last = getSetting('cron_last_' . $job);
    if ($last === null || $last === '') { $never[] = $job; continue; }
    $ts = strtotime($last);
    if ($ts === false || ($now - $ts) > $maxAge) $stale[] = $job;
}
if (empty($never) && empty($stale)) {
    $add('cron', 'ok', 'Tutti i job cron hanno un heartbeat recente.');
} else {
    $bits = [];
    if ($never) $bits[] = 'mai eseguiti: ' . implode(', ', $never);
    if ($stale) $bits[] = 'in ritardo: ' . implode(', ', $stale);
    $add('cron', 'warn', 'Cron — ' . implode('; ', $bits) . '. Verifica il crontab sul server.');
}

// ── Backup freshness (file on disk) ─────────────────────────────────────────
$backups = glob("$root/backups/*.sql*") ?: [];
if ($backups) {
    $newest = max(array_map('filemtime', $backups));
    $ageH   = round(($now - $newest) / 3600, 1);
    $add('backup', $ageH <= 48 ? 'ok' : 'warn', "Ultimo backup locale ~{$ageH}h fa.");
} else {
    $add('backup', 'warn', 'Nessun backup locale trovato in backups/. Verifica il job di backup.');
}

// ── Overall ─────────────────────────────────────────────────────────────────
$statuses = array_column($checks, 'status');
$overall  = in_array('fail', $statuses, true) ? 'fail' : (in_array('warn', $statuses, true) ? 'warn' : 'ok');

echo json_encode([
    'success'   => true,
    'overall'   => $overall,
    'env'       => $isProd ? 'production' : (string) env('APP_ENV', 'local'),
    'checked_at'=> gmdate('c'),
    'checks'    => $checks,
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
