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
require_once __DIR__ . '/../config/istat_adjustments.php';

$db = getDB();

// Tre passaggi sullo stesso insieme di contratti: l'avviso PRIMA della scadenza
// (ora sul termine di preavviso, non a -30 giorni), il verbale di riconsegna
// DOPO, e l'adeguamento ISTAT durante. Stanno insieme perche' la domanda e' la
// stessa — "quali locazioni chiedono attenzione oggi?" — e perche' aggiungere
// una riga al crontab di produzione e' un'operazione a rischio: un filtro
// sbagliato li' ha già tenuto fermi tutti i job per mesi. Un job che gira e'
// meglio di un job perfetto che nessuno installa.
$result = [
    'expirations' => processContractExpirations($db),
    'checkouts'   => processInventoryCheckouts($db),
    'istat'       => processIstatAdjustments($db),
];

require_once __DIR__ . '/../config/heartbeat.php';
cronHeartbeat('contract_expirations');
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
