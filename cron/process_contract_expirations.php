<?php
/**
 * Cron entry point — process contract expirations.
 *
 * Example crontab (daily at 07:00):
 * 0 7 * * * php /path/to/cron/process_contract_expirations.php
 */

require_once __DIR__ . '/../config/env.php';
loadEnv(dirname(__DIR__) . '/.env');

// HTTP entry point gate — see config/cron_guard.php. No-op under CLI, so the
// production crontab is unaffected.
require_once __DIR__ . '/../config/cron_guard.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/contract_expirations.php';
require_once __DIR__ . '/../config/inventory_snapshots.php';

$db = getDB();

// Due passaggi sullo stesso insieme di contratti: l'avviso PRIMA della scadenza
// (promemoria a -30 giorni) e il verbale di riconsegna DOPO. Il secondo sta qui
// e non in un cron proprio perche' la domanda e' la stessa — "quali locazioni
// stanno finendo?" — e una risposta sola basta a entrambe.
$result = [
    'expirations' => processContractExpirations($db),
    'checkouts'   => processInventoryCheckouts($db),
];

require_once __DIR__ . '/../config/heartbeat.php';
cronHeartbeat('contract_expirations');
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
