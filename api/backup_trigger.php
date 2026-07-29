<?php
/**
 * Manual backup trigger — super_admin only.
 * POST {} → runs a PHP-based SQL dump to backups/ directory.
 */
require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/rate_limit.php';
require_once __DIR__ . '/../config/backup_cloud.php';

apiHandleOptions();
apiRequireMethod('POST');
requireRole('super_admin');

// A full SQL dump is expensive — a handful per 5 minutes is plenty.
checkRateLimit('backup_trigger', 5, 300);

$backupDir = dirname(__DIR__) . '/backups';
if (!is_dir($backupDir)) {
    @mkdir($backupDir, 0755, true);
}
if (!is_writable($backupDir)) {
    apiError('La directory backups/ non è scrivibile dal server.', 500);
}

$handle = null;

try {
    $db       = getDB();
    $filename = 'backup_manual_' . date('Ymd_His') . '.sql';
    $filePath = $backupDir . '/' . $filename;

    // Il dump si scrive riga per riga sul file. Costruirlo prima tutto in una
    // stringa PHP significa tenere in memoria l'intero database: su
    // un'installazione vera è il modo più diretto per esaurire memory_limit
    // proprio quando il backup serve.
    $handle = fopen($filePath, 'wb');
    if ($handle === false) {
        apiError('Impossibile creare il file di backup.', 500);
    }

    $tables = $db->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);

    fwrite($handle, "-- Gestionale Immobiliare — Manual backup " . date('Y-m-d H:i:s') . "\n");
    fwrite($handle, "SET FOREIGN_KEY_CHECKS=0;\n\n");

    foreach ($tables as $table) {
        // DROP + CREATE
        $createStmt = $db->query("SHOW CREATE TABLE `$table`")->fetch(PDO::FETCH_NUM);
        fwrite($handle, "DROP TABLE IF EXISTS `$table`;\n");
        fwrite($handle, $createStmt[1] . ";\n\n");

        // Data rows in batches of 500
        $count  = (int) $db->query("SELECT COUNT(*) FROM `$table`")->fetchColumn();
        $offset = 0;
        $batch  = 500;
        while ($offset < $count) {
            $rows = $db->query("SELECT * FROM `$table` LIMIT $batch OFFSET $offset")->fetchAll(PDO::FETCH_ASSOC);
            if ($rows) {
                $cols    = '`' . implode('`, `', array_keys($rows[0])) . '`';
                $values  = [];
                foreach ($rows as $row) {
                    $escaped = array_map(fn($v) => $v === null ? 'NULL' : $db->quote((string)$v), $row);
                    $values[] = '(' . implode(', ', $escaped) . ')';
                }
                fwrite($handle, "INSERT INTO `$table` ($cols) VALUES\n" . implode(",\n", $values) . ";\n");
            }
            $offset += $batch;
        }
        fwrite($handle, "\n");
    }

    fwrite($handle, "SET FOREIGN_KEY_CHECKS=1;\n");
    fclose($handle);
    $handle = null;

    $size = filesize($filePath);

    // Il backup su cloud si configurava nella stessa scheda di questo pulsante
    // ("Abilita upload cloud dopo backup") ma valeva solo per il cron notturno:
    // premere "Backup ora" lasciava il file solo su questo server, cioè sullo
    // stesso disco che il backup dovrebbe proteggere.
    $cloud       = ['attempted' => false, 'success' => false, 'error' => null];
    $cloudConfig = getBackupCloudConfig();
    if ($cloudConfig['enabled']) {
        $cloud['attempted'] = true;
        $result             = uploadBackupToCloud($filePath, $filename);
        $cloud['success']   = (bool) ($result['success'] ?? false);
        $cloud['error']     = $result['error'] ?? null;
        if (!$cloud['success']) {
            error_log('[backup_trigger] cloud upload failed: ' . (string) $cloud['error']);
        }
    }

    // 'create' e non 'backup_manual': logActivity() scarta in silenzio ogni
    // azione fuori dalla sua whitelist, quindi finora non registrava nulla.
    logActivity('create', 'backup', null, "Backup manuale: $filename (" . round($size / 1024) . " KB)");

    $message = "Backup completato: $filename";
    if ($cloud['attempted']) {
        $message .= $cloud['success']
            ? ' — caricato anche sul cloud.'
            : ' — upload sul cloud FALLITO: ' . (string) $cloud['error'];
    }

    apiSuccess([
        'filename' => $filename,
        'size_kb'  => round($size / 1024),
        'cloud'    => $cloud,
        'message'  => $message,
    ]);
} catch (Throwable $e) {
    if (is_resource($handle)) {
        fclose($handle);
    }
    // Don't leak file paths / SQL internals to the client. Detail goes to the log.
    error_log('[backup_trigger] backup failed: ' . $e->getMessage());
    apiError('Errore durante il backup. Controlla i log del server.', 500);
}
