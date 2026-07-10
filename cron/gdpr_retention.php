<?php
/**
 * Cron job — GDPR data retention.
 *
 * Purges/anonymises records whose retention period (configured in app_settings
 * `retention_*`) has elapsed. Personal documents are NOT auto-deleted (fiscal law
 * requires ~10y and deletion is irreversible) — they are only reported.
 *
 * Example crontab (weekly, Sunday 03:30):
 *   30 3 * * 0 php /path/to/cron/gdpr_retention.php
 *
 * Run manually:
 *   php cron/gdpr_retention.php
 */

require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../config/settings.php';

if (PHP_SAPI !== 'cli') {
    $secret = $_SERVER['HTTP_X_CRON_SECRET'] ?? '';
    if (CRON_SECRET === '' || $secret !== CRON_SECRET) {
        http_response_code(403);
        exit('Forbidden');
    }
}

$db = getDB();

/** Read a retention setting as int, with a default. */
function retention(string $key, int $default): int
{
    $v = getSetting($key);
    return $v === null || $v === '' ? $default : (int) $v;
}

$report = [];

/** Delete rows in $table older than $amount $unit on $dateCol. 0 = keep forever. */
function purge(PDO $db, array &$report, string $table, string $dateCol, int $amount, string $unit): void
{
    if ($amount <= 0) {
        $report[$table] = 'skipped (retention = keep forever)';
        return;
    }
    try {
        $stmt = $db->prepare(
            "DELETE FROM {$table} WHERE {$dateCol} < DATE_SUB(NOW(), INTERVAL :amt {$unit})"
        );
        $stmt->execute(['amt' => $amount]);
        $report[$table] = $stmt->rowCount() . " row(s) purged (> {$amount} {$unit})";
    } catch (Throwable $e) {
        $report[$table] = 'error: ' . $e->getMessage();
    }
}

purge($db, $report, 'data_processing_log', 'created_at',   retention('retention_data_processing_log_months', 24), 'MONTH');
purge($db, $report, 'communications',      'created_at',   retention('retention_communications_months', 36), 'MONTH');
purge($db, $report, 'whatsapp_messages',   'received_at',  retention('retention_whatsapp_months', 24), 'MONTH');
purge($db, $report, 'activity_log',        'created_at',   retention('retention_activity_log_months', 24), 'MONTH');
purge($db, $report, 'login_attempts',      'attempted_at', retention('retention_login_attempts_days', 90), 'DAY');
purge($db, $report, 'api_rate_limits',     'requested_at', 1, 'DAY');

// Report (do not delete) documents past their retention window.
$docMonths = retention('retention_documents_months', 120);
try {
    $stmt = $db->prepare(
        "SELECT COUNT(*) FROM documents WHERE created_at < DATE_SUB(NOW(), INTERVAL :m MONTH)"
    );
    $stmt->execute(['m' => $docMonths]);
    $n = (int) $stmt->fetchColumn();
    $report['documents'] = $n > 0
        ? "{$n} document(s) past retention ({$docMonths} months) — review manually (not auto-deleted)"
        : "0 documents past retention";
} catch (Throwable $e) {
    $report['documents'] = 'error: ' . $e->getMessage();
}

$ts = date('Y-m-d H:i:s');
echo "[{$ts}] GDPR retention run\n";
foreach ($report as $table => $result) {
    echo "  - {$table}: {$result}\n";
}
