<?php
/**
 * Cron entry point — chiavi non restituite.
 *
 * Example crontab (daily at 08:30):
 *   30 8 * * * php /path/to/cron/process_key_returns.php
 */

require_once __DIR__ . '/../config/env.php';
loadEnv(dirname(__DIR__) . '/.env');

// HTTP entry point gate — see config/cron_guard.php. No-op under CLI, so the
// production crontab is unaffected.
require_once __DIR__ . '/../config/cron_guard.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/key_overdue.php';

$result = processOverdueKeys(getDB());
require_once __DIR__ . '/../config/heartbeat.php';
cronHeartbeat('key_returns');
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
