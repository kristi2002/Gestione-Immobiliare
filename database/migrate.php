<?php
/**
 * Migration runner — applies pending SQL migrations idempotently and records
 * them in `schema_migrations`. Safe to run repeatedly.
 *
 *   php database/migrate.php            # apply all pending migrations
 *   php database/migrate.php --status   # show applied / pending, apply nothing
 *
 * Baseline awareness: `database/schema_production.sql` already contains the
 * schema through phase28. So on a database that already has the core tables but
 * an empty `schema_migrations`, every migration up to the baseline cutoff is
 * recorded as "already applied" WITHOUT being re-run — this avoids re-executing
 * the older, partly non-idempotent phase3..phase28 files. New migrations
 * (phase29+) are written to be idempotent and are always safe to run.
 */

require_once __DIR__ . '/../config/env.php';
loadEnv(dirname(__DIR__) . '/.env');
require_once __DIR__ . '/../config/db.php';

const BASELINE_CUTOFF = 28; // schema_production.sql already includes phases <= 28

$statusOnly = in_array('--status', $argv, true);

$db = getDB();
$db->exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (
        version    VARCHAR(100) NOT NULL PRIMARY KEY,
        applied_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
);

$applied = $db->query('SELECT version FROM schema_migrations')->fetchAll(PDO::FETCH_COLUMN);
$applied = array_flip($applied);

$files = glob(__DIR__ . '/migrations/*.sql') ?: [];
usort($files, fn($a, $b) => migrationOrder(basename($a)) <=> migrationOrder(basename($b)));

// ---- Baseline seeding ------------------------------------------------------
$coreExists = (bool) $db->query(
    "SELECT COUNT(*) FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'contracts'"
)->fetchColumn();

$hasPhaseRecorded = false;
foreach ($applied as $v => $_) {
    if (str_starts_with($v, 'phase')) { $hasPhaseRecorded = true; break; }
}

if ($coreExists && !$hasPhaseRecorded) {
    $seeded = [];
    foreach ($files as $file) {
        $version = basename($file, '.sql');
        $order   = migrationOrder(basename($file));
        // Seed 000_helpers and phases <= cutoff as already-applied baseline.
        if ($order <= BASELINE_CUTOFF && !isset($applied[$version])) {
            $ins = $db->prepare('INSERT IGNORE INTO schema_migrations (version) VALUES (:v)');
            $ins->execute(['v' => $version]);
            $applied[$version] = true;
            $seeded[] = $version;
        }
    }
    if ($seeded) {
        echo 'Baseline detected — marked as already applied: ' . implode(', ', $seeded) . "\n";
    }
    // 000_helpers is idempotent and needed by later migrations — ensure it ran.
    ensureHelpers($db, $files);
}

// ---- Apply pending ---------------------------------------------------------
$pending = [];
foreach ($files as $file) {
    $version = basename($file, '.sql');
    if (!isset($applied[$version])) {
        $pending[] = $file;
    }
}

if ($statusOnly) {
    echo 'Applied migrations: ' . count($applied) . "\n";
    echo 'Pending migrations: ' . count($pending) . "\n";
    foreach ($pending as $file) {
        echo '  - ' . basename($file) . "\n";
    }
    exit(0);
}

if (!$pending) {
    echo "Nothing to migrate — database is up to date.\n";
    exit(0);
}

foreach ($pending as $file) {
    $version = basename($file, '.sql');
    echo "Applying {$version} ... ";
    try {
        runSqlFile($db, $file);
        $db->prepare('INSERT INTO schema_migrations (version) VALUES (:v)')->execute(['v' => $version]);
        echo "ok\n";
    } catch (Throwable $e) {
        echo "FAILED\n";
        fwrite(STDERR, "Migration {$version} failed: " . $e->getMessage() . "\n");
        exit(1);
    }
}

echo 'Done. Applied ' . count($pending) . " migration(s).\n";

// ---------------------------------------------------------------------------

/** Natural ordering: 000_helpers = -1, phaseN = N, anything else = large. */
function migrationOrder(string $filename): int
{
    if (str_starts_with($filename, '000')) {
        return -1;
    }
    if (preg_match('/^phase(\d+)/', $filename, $m)) {
        return (int) $m[1];
    }
    return PHP_INT_MAX;
}

/** Ensure 000_helpers.sql is executed (idempotent) even when baseline-seeded. */
function ensureHelpers(PDO $db, array $files): void
{
    foreach ($files as $file) {
        if (str_starts_with(basename($file), '000')) {
            runSqlFile($db, $file);
            return;
        }
    }
}

/**
 * Execute a .sql file, honouring `DELIMITER` directives so stored-procedure
 * bodies (BEGIN..END) are sent as a single statement.
 */
function runSqlFile(PDO $db, string $file): void
{
    $sql = file_get_contents($file);
    if ($sql === false) {
        throw new RuntimeException("Cannot read {$file}");
    }

    foreach (splitSqlStatements($sql) as $statement) {
        $statement = trim($statement);
        if ($statement === '') {
            continue;
        }
        // `USE <db>;` directives hardcode the dev database name and break on any
        // deployment whose schema is named differently (prod uses `default`).
        // The runner already connects to the configured DB, so these are both
        // wrong and unnecessary — skip them.
        if (preg_match('/^USE\s+[`\w]+\s*$/i', $statement)) {
            continue;
        }
        $db->exec($statement);
    }
}

/** Split SQL into statements, tracking DELIMITER changes and skipping comments. */
function splitSqlStatements(string $sql): array
{
    $statements = [];
    $delimiter  = ';';
    $buffer     = '';

    foreach (preg_split('/\R/', $sql) as $line) {
        $trimmed = trim($line);

        // Standalone line comments (-- / #). Block comments are left in place;
        // MySQL tolerates them inside exec().
        if ($trimmed === '' && $buffer === '') {
            continue;
        }
        if (str_starts_with($trimmed, '--') || str_starts_with($trimmed, '#')) {
            continue;
        }

        // DELIMITER directive (client-side; not real SQL).
        if (preg_match('/^DELIMITER\s+(\S+)/i', $trimmed, $m)) {
            $delimiter = $m[1];
            continue;
        }

        $buffer .= $line . "\n";

        // Emit whenever the current delimiter terminates the buffer.
        while (($pos = strpos($buffer, $delimiter)) !== false) {
            $statement = substr($buffer, 0, $pos);
            $buffer    = substr($buffer, $pos + strlen($delimiter));
            if (trim($statement) !== '') {
                $statements[] = $statement;
            }
        }
    }

    if (trim($buffer) !== '') {
        $statements[] = $buffer;
    }

    return $statements;
}
