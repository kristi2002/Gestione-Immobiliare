<?php
/**
 * Manual backup trigger — super_admin only.
 * POST {} → runs a PHP-based SQL dump to backups/ directory.
 */
require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/db.php';

apiHandleOptions();
apiRequireMethod('POST');
requireRole('super_admin');

$backupDir = dirname(__DIR__) . '/backups';
if (!is_dir($backupDir)) {
    @mkdir($backupDir, 0755, true);
}
if (!is_writable($backupDir)) {
    apiError('La directory backups/ non è scrivibile dal server.', 500);
}

try {
    $db       = getDB();
    $filename = 'backup_manual_' . date('Ymd_His') . '.sql';
    $filePath = $backupDir . '/' . $filename;

    $tables = $db->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);

    $sql  = "-- Gestionale Immobiliare — Manual backup " . date('Y-m-d H:i:s') . "\n";
    $sql .= "SET FOREIGN_KEY_CHECKS=0;\n\n";

    foreach ($tables as $table) {
        // DROP + CREATE
        $createStmt = $db->query("SHOW CREATE TABLE `$table`")->fetch(PDO::FETCH_NUM);
        $sql .= "DROP TABLE IF EXISTS `$table`;\n";
        $sql .= $createStmt[1] . ";\n\n";

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
                $sql .= "INSERT INTO `$table` ($cols) VALUES\n" . implode(",\n", $values) . ";\n";
            }
            $offset += $batch;
        }
        $sql .= "\n";
    }

    $sql .= "SET FOREIGN_KEY_CHECKS=1;\n";

    file_put_contents($filePath, $sql);
    $size = filesize($filePath);

    logActivity('backup_manual', 'system', null, "Backup manuale: $filename (" . round($size / 1024) . " KB)");

    apiSuccess([
        'filename' => $filename,
        'size_kb'  => round($size / 1024),
        'message'  => "Backup completato: $filename",
    ]);
} catch (Throwable $e) {
    apiError('Errore durante il backup: ' . $e->getMessage(), 500);
}
