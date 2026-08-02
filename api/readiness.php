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

// ── Mail: non basta che sia "configurata", deve autenticarsi ────────────────
// Prima qui bastava un host non vuoto per scrivere "ok": la configurazione è
// rimasta verde per settimane mentre OGNI invio falliva, perché host e password
// venivano da due provider diversi. Ora la sonda apre davvero la connessione e
// tenta l'autenticazione — senza spedire nulla a nessuno.
$mailOn   = filter_var(getSetting('mail_enabled', 'false'), FILTER_VALIDATE_BOOLEAN);
$smtpHost = (string) getSetting('smtp_host', '');
if (!$mailOn || $smtpHost === '') {
    $add('email', 'warn', 'Email non configurata: notifiche/promemoria via email non partiranno. Configura SMTP in Impostazioni.');
} else {
    require_once __DIR__ . '/../config/mail.php';
    $probe = smtpAuthProbe();
    if ($probe['ok']) {
        $add('email', 'ok', "SMTP $smtpHost: connessione e autenticazione riuscite.");
    } else {
        $add('email', 'fail', "SMTP $smtpHost non funzionante: {$probe['error']} Nessuna email (promemoria, scadenze, comunicazioni) sta partendo.");
    }
}

// ── Consenso marketing: il testo dell'informativa è configurato? ────────────
// consent_records conserva il testo ESATTO mostrato al contatto: è quello che
// trasforma una spunta in un consenso dimostrabile. Se il testo non è
// configurato, i consensi si raccolgono lo stesso ma restano senza prova di
// cosa sia stato accettato — e se ne accorge solo chi riceve un reclamo.
$consentText = trim((string) getSetting('marketing_consent_text', ''));
if ($consentText === '') {
    $add('marketing_consent', 'warn', 'Testo del consenso marketing non configurato in Impostazioni: i consensi raccolti non registrano a cosa il contatto ha acconsentito. Le campagne restano bloccate finché non c\'è un consenso valido.');
} else {
    $add('marketing_consent', 'ok', 'Testo del consenso marketing configurato.');
}

// ── Identità fiscale: fatture elettroniche e SDD ───────────────────────────
// Fattura e addebito NON producono un file sbagliato quando questi campi
// mancano: si rifiutano di generarlo. Il problema è quando lo si scopre —
// davanti alla prima fattura da emettere, non prima di andare in produzione.
// I fallback (`?:`) sono gli stessi dei chiamanti reali, altrimenti la sonda
// segnalerebbe come mancanti campi che in pratica vengono ereditati.
require_once __DIR__ . '/../lib/FatturaPA.php';
$agencyFiscal = [
    'piva'          => getSetting('agency_piva', ''),
    'cf'            => getSetting('agency_cf', ''),
    'denominazione' => getSetting('agency_denominazione', '') ?: getSetting('agency_name', ''),
    'indirizzo'     => getSetting('agency_indirizzo', '') ?: getSetting('agency_address', ''),
    'cap'           => getSetting('agency_cap', ''),
    'comune'        => getSetting('agency_comune', ''),
];
$missingFiscal = fatturaPaMissingAgencyFields($agencyFiscal);
$missingSdd    = [];
if (trim((string) getSetting('agency_iban', '')) === '')              $missingSdd[] = 'IBAN agenzia';
if (trim((string) getSetting('agency_sepa_creditor_id', '')) === '')  $missingSdd[] = 'Identificativo Creditore SEPA';

if (!$missingFiscal && !$missingSdd) {
    $add('fiscal_identity', 'ok', 'Identità fiscale completa: fattura elettronica e addebiti SEPA possono essere generati.');
} else {
    $bits = [];
    if ($missingFiscal) $bits[] = 'fattura elettronica — manca: ' . implode(', ', $missingFiscal);
    if ($missingSdd)    $bits[] = 'addebiti SEPA (SDD) — manca: ' . implode(', ', $missingSdd);
    $add('fiscal_identity', 'warn',
        'Impostazioni → Fatturazione incompleta. ' . implode('; ', $bits)
        . '. Finché mancano, la generazione si rifiuta di partire.');
}

// ── WhatsApp: il mittente configurato è davvero un canale WhatsApp? ─────────
// Non esisteva alcun controllo, ed è per questo che l'integrazione è rimasta
// "attiva" per settimane mentre ogni singolo invio moriva con l'errore 63007.
$waOn = filter_var(getSetting('whatsapp_enabled', 'false'), FILTER_VALIDATE_BOOLEAN);
if (!$waOn) {
    $add('whatsapp', 'warn', 'WhatsApp disattivato: i messaggi vengono registrati come "simulati", non spediti.');
} else {
    require_once __DIR__ . '/../config/whatsapp.php';
    $wa = whatsappSenderProbe();
    if ($wa['usable']) {
        $add('whatsapp', 'ok', (string) $wa['detail']);
    } else {
        // Mittente inesistente = rotto (fail). Sandbox/trial = tecnicamente
        // funzionante ma non proponibile a un cliente (warn).
        $add('whatsapp', $wa['ok'] ? 'warn' : 'fail', $wa['error'] . ($wa['detail'] ? ' ' . $wa['detail'] : ''));
    }
}

// ── Webhook secrets (fail-closed already, but flag missing) ─────────────────
// Un segnaposto copiato da .env.example (`whsec_...`, `sk_live_...`) non è vuoto,
// quindi passava il controllo e il webhook risultava "configurato" mentre il
// provider avrebbe rifiutato la chiave. Vale come mancante.
$isPlaceholder = static fn(string $v): bool => $v === '' || str_ends_with($v, '...') || preg_match('/^(sk|pk|rk)_(live|test)_\.{3}$/', $v) === 1;
$metaWa = (string) (getSetting('meta_wa_app_secret') ?: getenv('META_WA_APP_SECRET'));
$stripe = (string) (getSetting('stripe_webhook_secret') ?: getenv('STRIPE_WEBHOOK_SECRET'));
$whMsg = [];
if ($isPlaceholder($metaWa)) $whMsg[] = 'WhatsApp (Meta)';
if ($isPlaceholder($stripe)) $whMsg[] = 'Stripe';
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
    'key_returns'          => 26 * 3600,  // daily
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
