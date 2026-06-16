<?php
/**
 * Cron entry point — process contract expirations.
 *
 * Example crontab (daily at 07:00):
 * 0 7 * * * php /path/to/cron/process_contract_expirations.php
 */

require_once __DIR__ . '/../config/env.php';
loadEnv(dirname(__DIR__) . '/.env');
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/contract_expirations.php';

$result = processContractExpirations(getDB());
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
