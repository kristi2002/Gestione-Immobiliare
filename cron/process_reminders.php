<?php
/**
 * Cron entry point — process due reminders.
 *
 * Example crontab (every 15 minutes):
 * */15 * * * * php /path/to/cron/process_reminders.php
 */

require_once __DIR__ . '/../config/env.php';
loadEnv(dirname(__DIR__) . '/.env');
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/reminders.php';

$result = processDueReminders(getDB());
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
