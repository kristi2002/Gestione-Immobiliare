<?php
/**
 * Gate for the cron scripts' HTTP entry point.
 *
 * DEPLOY.md has always said "CRON_SECRET gates the HTTP entry points: every
 * cron/*.php skips the check on CLI." That was not true — no cron script called
 * any check. The only thing between the open internet and
 *   /cron/backup_database.php   (dumps the whole database to backups/)
 *   /cron/gdpr_retention.php    (purges and anonymises personal data)
 *   /cron/process_reminders.php (sends mail to owners and tenants)
 * was `RewriteRule ^cron/ - [F,L]` inside <IfModule mod_rewrite.c>, which does
 * nothing on a host without mod_rewrite or without .htaccess.
 *
 * Deliberately self-contained rather than leaning on config/bootstrap.php:
 *  - five of the seven cron scripts bootstrap from env.php only and never define
 *    CRON_SECRET, so a guard that read that constant would fatal instead of
 *    answering cleanly;
 *  - it must not start a session or emit CSRF state just to say "no";
 *  - it accepts the secret ONLY in the X-Cron-Secret header. The shared
 *    requireCronAuth() also reads ?secret=, which writes the secret into every
 *    Apache access log line — this path does not.
 *
 * CLI is unconditionally allowed, so the production crontab
 * (`docker exec … php /var/www/html/cron/…`) is unaffected.
 *
 * Usage — immediately after the script's env bootstrap:
 *   require_once __DIR__ . '/../config/cron_guard.php';
 */

if (PHP_SAPI === 'cli') {
    return;
}

require_once __DIR__ . '/env.php';
loadEnv(dirname(__DIR__) . '/.env');

$cronSecret = defined('CRON_SECRET') ? CRON_SECRET : (string) env('CRON_SECRET', '');

// Fail closed: an unset secret means the HTTP entry point is simply unavailable,
// never "open to everyone".
if ($cronSecret === '') {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    exit("Not found\n");
}

if (!hash_equals($cronSecret, (string) ($_SERVER['HTTP_X_CRON_SECRET'] ?? ''))) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    exit("Forbidden\n");
}
