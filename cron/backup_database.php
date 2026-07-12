<?php
/**
 * Cron — daily MySQL backup via mysqldump.
 *
 * Example crontab (daily at 3:00):
 * 0 3 * * * php /path/to/cron/backup_database.php
 */

require_once __DIR__ . '/../config/env.php';
loadEnv(dirname(__DIR__) . '/.env');

$backupDir = dirname(__DIR__) . '/backups';
if (!is_dir($backupDir)) {
    mkdir($backupDir, 0750, true);
}

$host = (string) env('DB_HOST', 'localhost');
$port = '';
if (str_contains($host, ':')) {
    [$host, $port] = explode(':', $host, 2);
}

$dbName = (string) env('DB_NAME', 'gestione_immobiliare');
$dbUser = (string) env('DB_USER', 'root');
$dbPass = (string) env('DB_PASS', '');

$timestamp = date('Y-m-d_His');
$filename  = "backup_{$dbName}_{$timestamp}.sql";
$filepath  = $backupDir . '/' . $filename;

$mysqldump = getenv('MYSQLDUMP_PATH') ?: 'mysqldump';
$portArg   = $port !== '' ? ' -P ' . escapeshellarg($port) : '';

$command = sprintf(
    '%s -h %s%s -u %s %s --single-transaction --routines --triggers %s > %s 2>&1',
    escapeshellcmd($mysqldump),
    escapeshellarg($host),
    $portArg,
    escapeshellarg($dbUser),
    $dbPass !== '' ? '-p' . escapeshellarg($dbPass) : '',
    escapeshellarg($dbName),
    escapeshellarg($filepath)
);

exec($command, $output, $exitCode);

if ($exitCode !== 0 || !file_exists($filepath) || filesize($filepath) === 0) {
    fwrite(STDERR, "Backup failed (exit {$exitCode}): " . implode("\n", $output) . "\n");
    if (file_exists($filepath)) {
        unlink($filepath);
    }
    exit(1);
}

// Keep last 14 backups
$files = glob($backupDir . '/backup_*.sql');
if ($files) {
    rsort($files);
    foreach (array_slice($files, 14) as $old) {
        @unlink($old);
    }
}

echo json_encode([
    'success'  => true,
    'file'     => $filename,
    'size'     => filesize($filepath),
    'created'  => date('c'),
    'cloud'    => null,
], JSON_UNESCAPED_UNICODE) . "\n";

require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/backup_cloud.php';

$cloud = uploadBackupToCloud($filepath, $filename);
if ($cloud['success']) {
    echo json_encode(['cloud_upload' => $cloud], JSON_UNESCAPED_UNICODE) . "\n";
}

require_once __DIR__ . '/../config/heartbeat.php';
cronHeartbeat('backup');
