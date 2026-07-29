<?php
/**
 * Cron — daily MySQL backup via mysqldump.
 *
 * Example crontab (daily at 3:00):
 * 0 3 * * * php /path/to/cron/backup_database.php
 */

require_once __DIR__ . '/../config/env.php';
loadEnv(dirname(__DIR__) . '/.env');

// HTTP entry point gate — see config/cron_guard.php. No-op under CLI, so the
// production crontab is unaffected.
require_once __DIR__ . '/../config/cron_guard.php';

$backupDir = dirname(__DIR__) . '/backups';
if (!is_dir($backupDir)) {
    mkdir($backupDir, 0750, true);
}

// Il .htaccess se lo scrive la cartella da sola, a ogni giro.
//
// backups/ e' ignorato da git (.gitignore:5) ed escluso dall'immagine
// (.dockerignore), quindi un file di protezione messo nel repository non
// arriverebbe mai dove servono i backup: la cartella nasce qui, a runtime, la
// prima volta che il job gira. L'unica regola che la copriva viveva nel
// .htaccess di radice dentro <IfModule mod_rewrite.c> — cioe' niente, su un
// host senza mod_rewrite o se quel file si perde in un deploy.
//
// Dentro ci sono i dump completi: admin_users con gli hash delle password,
// clienti e inquilini con codici fiscali, indirizzi e telefoni. Un solo file
// leggibile qui e' l'intero archivio dell'agenzia.
$guard = $backupDir . '/.htaccess';
if (!is_file($guard)) {
    file_put_contents($guard, <<<HTACCESS
# Generato da cron/backup_database.php — non modificare a mano.
# Dump completi del database: nessun accesso web, mai.
<IfModule mod_authz_core.c>
    Require all denied
</IfModule>
<IfModule !mod_authz_core.c>
    Order allow,deny
    Deny from all
</IfModule>
Options -Indexes -ExecCGI

HTACCESS);
    @chmod($guard, 0640);
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

// L'utente applicativo NON è root e non deve diventarlo per fare un backup:
//   --no-tablespaces  evita il privilegio globale PROCESS (mysqldump lo chiede
//                     per "dump tablespaces" anche su un singolo schema);
//   niente --routines perché leggere le stored procedure richiede altri
//                     privilegi, e le uniche routine dello schema sono gli
//                     helper di migrazione (migration_add_column/_add_index),
//                     ricreati in modo idempotente da 000_helpers.sql al primo
//                     `migrate.php` dopo un restore.
// Con --routines e senza --no-tablespaces mysqldump usciva con codice 2 e
// questo job falliva ogni notte in silenzio (vedi sotto).
$errFile = $filepath . '.err';
$command = sprintf(
    '%s -h %s%s -u %s %s --single-transaction --no-tablespaces --triggers %s > %s 2> %s',
    escapeshellcmd($mysqldump),
    escapeshellarg($host),
    $portArg,
    escapeshellarg($dbUser),
    $dbPass !== '' ? '-p' . escapeshellarg($dbPass) : '',
    escapeshellarg($dbName),
    escapeshellarg($filepath),
    escapeshellarg($errFile)
);

exec($command, $output, $exitCode);

// stderr va in un file SEPARATO, non dentro il dump: prima finiva in coda al
// .sql con `2>&1`, e il ramo di errore cancellava quel file — cioè cancellava
// l'unica copia del messaggio, lasciando "Backup failed (exit 2):" senza causa.
$stderr = is_file($errFile) ? trim((string) file_get_contents($errFile)) : '';
@unlink($errFile);

if ($exitCode !== 0 || !file_exists($filepath) || filesize($filepath) === 0) {
    fwrite(STDERR, "Backup failed (exit {$exitCode}): " . ($stderr !== '' ? $stderr : implode("\n", $output)) . "\n");
    if (file_exists($filepath)) {
        unlink($filepath);
    }
    exit(1);
}

// Un warning non fatale (es. una tabella saltata) non deve passare inosservato
// solo perché il dump è stato prodotto.
if ($stderr !== '') {
    fwrite(STDERR, "Backup completato con avvisi: {$stderr}\n");
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
