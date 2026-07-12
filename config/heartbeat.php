<?php
/**
 * Cron heartbeat.
 *
 * Each scheduled job calls cronHeartbeat('<job>') at the end of a successful run.
 * The timestamp is stored in app_settings (key `cron_last_<job>`) so the
 * readiness endpoint can prove a job is *actually executing on schedule* — not
 * merely that its script exists on disk (CLAUDE.md §6: "script existence ≠
 * scheduled execution").
 */

require_once __DIR__ . '/db.php';

function cronHeartbeat(string $job): void
{
    $job = preg_replace('/[^a-z0-9_]/', '', strtolower($job));
    if ($job === '') return;
    try {
        $db = getDB();
        $stmt = $db->prepare(
            'INSERT INTO app_settings (setting_key, setting_value) VALUES (:k, :v)
             ON DUPLICATE KEY UPDATE setting_value = :v2'
        );
        $now = gmdate('c');
        $stmt->execute(['k' => 'cron_last_' . $job, 'v' => $now, 'v2' => $now]);
    } catch (Throwable $e) {
        // Heartbeat is best-effort — never let it break the job itself.
        error_log('[heartbeat] ' . $job . ': ' . $e->getMessage());
    }
}
