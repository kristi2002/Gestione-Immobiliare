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

require_once __DIR__ . '/../config/cli_only.php';
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
}

// 000_helpers e' idempotente (DROP PROCEDURE IF EXISTS + CREATE) e serve alle
// migrazioni successive: si riesegue SEMPRE, prima di applicare le pendenti.
//
// Prima stava dentro il ramo del baseline, cioe' girava solo su un database
// nuovo. Su qualunque installazione esistente non veniva piu' eseguito, e
// 000_helpers risulta gia' "applicato" per il seed del baseline, quindi non
// entrava nemmeno fra le pendenti: una procedura AGGIUNTA al file dopo il
// baseline non arrivava mai in banca dati, e la prima migrazione che la
// chiamava falliva con "PROCEDURE ... does not exist" — bloccando da li' in
// poi tutte le successive.
ensureHelpers($db, $files);

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

/**
 * Assicura che le procedure helper esistano, senza pretendere di poterle
 * distruggere.
 *
 * Prima si rieseguiva `000_helpers.sql` per intero a ogni avvio, e il file
 * comincia con `DROP PROCEDURE IF EXISTS`. Funzionava finche' l'applicazione si
 * collegava come root. Poi il DB_USER e' passato all'utente a privilegio minimo
 * (`gestionale_app`) — cosa giusta, e una delle tre liabilita' storiche del
 * progetto — e da quel momento:
 *
 *   1227 Access denied; you need (at least one of) the SYSTEM_USER privilege(s)
 *
 * Le procedure hanno definer `root@%`: da MySQL 8.0.22 un account normale non
 * puo' toccare oggetti di un account di sistema, e nessun `IF EXISTS` lo evita
 * (il controllo sui privilegi viene prima). Risultato: `migrate.php` moriva
 * sulla PRIMA istruzione a ogni avvio del container, l'entrypoint riprovava
 * venti volte e poi partiva comunque — con lo schema fermo e il codice avanti.
 * Tre migrazioni non applicate, e l'unica traccia una riga nei log del
 * container.
 *
 * Quindi: si crea cio' che MANCA e non si tocca cio' che c'e'. Un DROP non
 * serve — una procedura presente e' gia' quella che serve.
 *
 * ⚠ Conseguenza da conoscere: cambiare il CORPO di un helper esistente non ha
 * piu' effetto da qui, perche' il CREATE viene saltato. Non e' una svista, e'
 * il prezzo di non poter fare DROP: se un helper va corretto, gli si da' un
 * nome nuovo, oppure lo si ricrea in una migrazione dedicata eseguita da un
 * utente che possa fare DROP. Il messaggio a video lo ricorda.
 */
function ensureHelpers(PDO $db, array $files): void
{
    $helperFile = null;
    foreach ($files as $file) {
        if (str_starts_with(basename($file), '000')) {
            $helperFile = $file;
            break;
        }
    }
    if ($helperFile === null) {
        return;
    }

    $existing = existingProcedures($db);
    $created  = [];
    $skipped  = [];

    foreach (splitSqlStatements((string) file_get_contents($helperFile)) as $statement) {
        $statement = trim($statement);
        if ($statement === '') {
            continue;
        }

        // `USE <db>`: si salta, esattamente come fa runSqlFile(). Il file ne
        // porta uno con il nome del database di sviluppo scritto a mano
        // (`USE gestione_immobiliare`), e in produzione lo schema si chiama
        // `default`: eseguirlo qui sposterebbe la connessione su un altro
        // database — o su nessuno. Saltandolo si resta dove il runner si e'
        // collegato, che e' l'unico posto giusto.
        //
        // Questa riga e' costata: la prima versione di questa funzione non
        // aveva il filtro, e su un database nuovo la connessione finiva su
        // `gestione_immobiliare`, dove le procedure esistono gia' —
        // "PROCEDURE migration_add_column already exists" su un DB vuoto.
        if (preg_match('/^USE\s+[`\w]+\s*$/i', $statement)) {
            continue;
        }

        // `DROP PROCEDURE IF EXISTS x`: se x c'e' non si tocca (non si puo' e non
        // serve); se non c'e' e' un no-op che non vale una query.
        if (preg_match('/^DROP\s+PROCEDURE\s+(?:IF\s+EXISTS\s+)?`?(\w+)`?/i', $statement)) {
            continue;
        }

        if (preg_match('/^CREATE\s+(?:DEFINER\s*=\s*\S+\s+)?PROCEDURE\s+`?(\w+)`?/i', $statement, $m)) {
            $name = $m[1];
            if (isset($existing[strtolower($name)])) {
                $skipped[] = $name;
                continue;
            }
            $db->exec($statement);
            $created[] = $name;
            continue;
        }

        // Tutto il resto del file (eventuali SET, commenti già filtrati…).
        $stmt = $db->query($statement);
        if ($stmt instanceof PDOStatement) {
            $stmt->closeCursor();
        }
    }

    if ($created) {
        echo 'Helper creati: ' . implode(', ', $created) . "\n";
    }
    if ($skipped) {
        echo 'Helper già presenti (non ricreati — per cambiarne il corpo serve un nome nuovo): '
            . implode(', ', $skipped) . "\n";
    }
}

/**
 * I nomi delle stored procedure presenti nello schema corrente, in minuscolo.
 *
 * @return array<string, true>
 */
function existingProcedures(PDO $db): array
{
    $stmt = $db->query(
        "SELECT ROUTINE_NAME FROM information_schema.ROUTINES
          WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_TYPE = 'PROCEDURE'"
    );

    $out = [];
    foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $name) {
        $out[strtolower((string) $name)] = true;
    }

    return $out;
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
        // query() + closeCursor() invece di exec(): i guard idempotenti delle
        // migrazioni (IF(<esiste>, 'SELECT 1', '<DDL>') + PREPARE/EXECUTE)
        // producono un result set quando prendono il ramo 'SELECT 1'; exec()
        // non lo consuma e la statement successiva fallisce con l'errore 2014
        // "Cannot execute queries while other unbuffered queries are active".
        $stmt = $db->query($statement);
        if ($stmt instanceof PDOStatement) {
            $stmt->closeCursor();
        }
    }
}

/**
 * Split SQL into statements, tracking DELIMITER changes and skipping comments.
 *
 * Lo split RISPETTA i letterali: un delimitatore dentro una stringa non taglia
 * niente. Prima non era cosi', e il costo non era teorico — un `;` dentro un
 * COMMENT spezzava la CREATE TABLE a meta' e la migrazione moriva in deploy con
 * un errore 1064 che parlava di sintassi mentre l'SQL era perfettamente valido.
 * Ne erano affette phase74, 79, 80, 81 e 82, tutte con lo stesso commento a due
 * frasi ("unico = provvigione intera; acquisitore = meta' di uno split"). E
 * siccome il runner si ferma al primo errore, bastava la piu' vecchia per
 * bloccare ogni migrazione successiva.
 *
 * Si tiene conto di apici singoli, doppi apici e backtick, del raddoppio ('')
 * come carattere letterale e dell'escape con backslash. Una riga che inizia per
 * `--` viene saltata solo se NON siamo dentro una stringa: i COMMENT su piu'
 * righe di phase74 altrimenti perderebbero pezzi.
 */
function splitSqlStatements(string $sql): array
{
    $statements = [];
    $delimiter  = ';';
    $buffer     = '';
    $quote      = null;   // null | "'" | '"' | '`' — quale letterale è aperto
    $scanned    = 0;      // quanto del buffer è già stato analizzato

    $emit = static function (string $statement) use (&$statements): void {
        if (trim($statement) !== '') {
            $statements[] = $statement;
        }
    };

    foreach (preg_split('/\R/', $sql) as $line) {
        // Le direttive di riga (commenti, DELIMITER) valgono solo fuori da un
        // letterale: dentro, sono testo del dato.
        if ($quote === null) {
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
        }

        $buffer .= $line . "\n";

        // Scansione dal punto in cui ci si era fermati: ogni carattere viene
        // guardato una volta sola anche su file lunghi.
        $i      = $scanned;
        $len    = strlen($buffer);
        $dlen   = strlen($delimiter);

        while ($i < $len) {
            $ch = $buffer[$i];

            if ($quote !== null) {
                // I backtick non conoscono l'escape con backslash.
                if ($ch === '\\' && $quote !== '`') {
                    $i += 2;
                    continue;
                }
                if ($ch === $quote) {
                    // Raddoppiato ('') = un apice dentro la stringa, non la fine.
                    if ($i + 1 < $len && $buffer[$i + 1] === $quote) {
                        $i += 2;
                        continue;
                    }
                    $quote = null;
                }
                $i++;
                continue;
            }

            if ($ch === "'" || $ch === '"' || $ch === '`') {
                $quote = $ch;
                $i++;
                continue;
            }

            if ($dlen > 0 && substr($buffer, $i, $dlen) === $delimiter) {
                $emit(substr($buffer, 0, $i));
                $buffer = substr($buffer, $i + $dlen);
                $len    = strlen($buffer);
                $i      = 0;
                continue;
            }

            $i++;
        }

        $scanned = strlen($buffer);
    }

    if (trim($buffer) !== '') {
        $statements[] = $buffer;
    }

    return $statements;
}
