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
require_once __DIR__ . '/../lib/schema_drift.php';

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

// Questa sonda racconta l'utente del database, lo stato delle migrazioni,
// l'host SMTP e QUALI segreti sono impostati: e' una radiografia
// dell'installazione, non un cruscotto operativo. Era leggibile da qualsiasi
// ruolo collegato, `agent` e `readonly` compresi. Chi arriva col segreto del
// cron passa lo stesso: li' non c'e' una sessione da interrogare.
if (!$viaCron && function_exists('getCurrentRole') && getCurrentRole() !== 'super_admin') {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'Permesso negato: sezione riservata al super amministratore.']);
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
//
// Il rilevamento sta in lib/schema_drift.php e non piu' qui: lo stesso conto
// serve al cron, che e' cio' che ha reso questo controllo utile davvero. Per
// cinque giorni ha detto correttamente `fail` nominando phase97/98/99 e non l'ha
// letto nessuno — una sonda che si consulta non e' un allarme.
try {
    $applied = $db->query('SELECT version FROM schema_migrations')->fetchAll(PDO::FETCH_COLUMN);
    $pending = pendingMigrations($db);
    if ($pending) {
        $add('migrations', 'fail', 'Migrazioni non applicate: ' . implode(', ', $pending) . '. Esegui php database/migrate.php.');
    } else {
        $add('migrations', 'ok', count($applied) . ' migrazioni applicate, nessuna in sospeso.');
    }
} catch (Throwable $e) {
    $add('migrations', 'warn', 'Impossibile verificare le migrazioni: ' . $e->getMessage());
}

// ── Unicità del codice fiscale dei proprietari ──────────────────────────────
// phase67 crea uq_clients_cf solo se non ci sono gia' duplicati, altrimenti
// salta e si registra come applicata: su un database che al momento della
// migrazione aveva anche una sola coppia di CF ripetuti il vincolo non esiste,
// nessuna migrazione futura ci riprova, e niente lo dice. Qui lo dice.
try {
    $hasIdx = (int) $db->query(
        "SELECT COUNT(*) FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients' AND INDEX_NAME = 'uq_clients_cf'"
    )->fetchColumn();

    if ($hasIdx > 0) {
        $add('clients_cf_unique', 'ok', 'Vincolo di unicità sul codice fiscale dei proprietari attivo.');
    } else {
        $dupes = (int) $db->query(
            "SELECT COUNT(*) FROM (
                SELECT codice_fiscale FROM clients
                 WHERE codice_fiscale IS NOT NULL AND codice_fiscale <> ''
                 GROUP BY codice_fiscale HAVING COUNT(*) > 1) d"
        )->fetchColumn();

        $add('clients_cf_unique', 'warn', $dupes > 0
            ? "Il codice fiscale dei proprietari NON è univoco: $dupes codici risultano duplicati. "
              . 'Unisci i duplicati (Proprietari → Unisci duplicati): il vincolo viene creato da solo appena non ce ne sono più.'
            : 'Il codice fiscale dei proprietari non ha un vincolo di unicità, ma non ci sono duplicati: '
              . 'verrà creato alla prossima unione duplicati, oppure a mano con '
              . 'ALTER TABLE clients ADD UNIQUE INDEX uq_clients_cf (codice_fiscale).');
    }
} catch (Throwable $e) {
    $add('clients_cf_unique', 'warn', 'Impossibile verificare l\'unicità del codice fiscale: ' . $e->getMessage());
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
        $add('email', 'ok', "SMTP $smtpHost: connessione, autenticazione e mittente <"
            . ($probe['sender_checked'] ?? '?') . "> accettati dal server. "
            . 'Resta da provare la consegna vera (che finisca in posta in arrivo, non nello spam).');
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
// Un job che scrive un battito e non compare qui e' peggio di un job senza
// battito: scrive una prova che nessuno legge. `social_posts` e' rimasto fuori
// da questa lista pur chiamando cronHeartbeat() come gli altri sei, quindi
// poteva restare fermo per mesi senza che Stato sistema dicesse niente — che e'
// esattamente il guasto per cui il battito era stato introdotto.
// Regola: una riga qui per OGNI cronHeartbeat() in cron/.
$cronJobs = [
    'reminders'            => 2 * 3600,   // expected at least every ~2h
    'payment_reminders'    => 26 * 3600,  // daily
    'contract_expirations' => 26 * 3600,  // daily
    'key_returns'          => 26 * 3600,  // daily
    'backup'               => 26 * 3600,  // daily
    'social_posts'         => 26 * 3600,  // daily
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
