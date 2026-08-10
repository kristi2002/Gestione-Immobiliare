<?php
/**
 * Cron entry point — process due reminders.
 *
 * Example crontab (every 15 minutes):
 *   0,15,30,45 * * * * php /path/to/cron/process_reminders.php
 */

require_once __DIR__ . '/../config/env.php';
loadEnv(dirname(__DIR__) . '/.env');

// HTTP entry point gate — see config/cron_guard.php. No-op under CLI, so the
// production crontab is unaffected.
require_once __DIR__ . '/../config/cron_guard.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/reminders.php';
require_once __DIR__ . '/../lib/schema_drift.php';

$db     = getDB();
$result = processDueReminders($db);

// Guardia sulla deriva dello schema.
//
// Sta appesa QUI, e non in un job suo, per la ragione scritta in
// process_contract_expirations.php: aggiungere una riga al crontab di produzione
// e' un'operazione a rischio — un filtro sbagliato li' ha tenuto fermi tutti i
// job per mesi — e un job che gira batte un job perfetto che nessuno installa.
// Questo e' il job piu' frequente e con il battito piu' recente, quindi e'
// l'ospite giusto. Il controllo costa una query e un glob.
//
// Non fallisce mai verso l'ospite: checkSchemaDrift() cattura tutto per conto
// suo, perche' un avviso che rompe il lavoro di cui e' ospite sarebbe un secondo
// guasto invece della segnalazione del primo.
$result['schema_drift'] = checkSchemaDrift($db);

require_once __DIR__ . '/../config/heartbeat.php';
cronHeartbeat('reminders');
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
