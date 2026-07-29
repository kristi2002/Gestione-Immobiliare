<?php
/**
 * Indici ISTAT FOI — anagrafica dei valori usati per l'adeguamento dei canoni.
 *
 *   GET    /api/istat_index.php                  — elenco + copertura
 *   POST   /api/istat_index.php                  — inserisce/corregge un indice (manuale)
 *   POST   /api/istat_index.php?action=import    — import da CSV (dry_run per l'anteprima)
 *   DELETE /api/istat_index.php?id={id}          — elimina un indice
 *
 * Perche' un endpoint separato e non un'azione dentro contracts.php: questi
 * valori non appartengono a un contratto, sono un dato di riferimento
 * dell'agenzia che ogni locazione indicizzata legge. Tenerli qui significa che
 * l'aggiornamento e' UNO e vale per tutti i contratti, che e' esattamente il
 * problema che l'array scritto nel codice non risolveva.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../lib/istat.php';

apiHandleOptions();
// Dato di riferimento che muove importi su ogni contratto indicizzato: sta in
// Impostazioni e ne segue il livello di accesso.
requireViewAccess('settings');

// Il bollettino FOI di un decennio sta in poche decine di KB: oltre questa
// soglia il file caricato non e' una serie di indici.
const ISTAT_IMPORT_MAX_BYTES = 1048576; // 1 MB

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $action = trim($_GET['action'] ?? '');

    switch ($method) {
        case 'GET':
            listIstatIndices($db);
            break;
        case 'POST':
            if ($action === 'import') {
                importIstatIndices($db);
            } else {
                upsertIstatIndex($db);
            }
            break;
        case 'DELETE':
            deleteIstatIndex($db, (int) ($_GET['id'] ?? 0));
            break;
        default:
            apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    error_log('[istat_index] ' . $e->getMessage());
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------

function listIstatIndices(PDO $db): void
{
    $coverage = istatCoverage($db);
    if (!$coverage['available']) {
        apiSuccess([
            'items'    => [],
            'coverage' => $coverage,
            'message'  => 'Tabella indici non ancora creata: esegui le migrazioni (phase80).',
        ]);
    }

    $limit = min(500, max(1, (int) ($_GET['limit'] ?? 240)));
    $stmt  = $db->prepare(
        'SELECT id, ref_year, ref_month, index_value, source, notes, updated_at
           FROM istat_foi_index
          ORDER BY ref_year DESC, ref_month DESC
          LIMIT ' . $limit
    );
    $stmt->execute();

    $items = [];
    foreach ($stmt->fetchAll() as $row) {
        $row['period'] = istatFormatPeriod((int) $row['ref_year'], (int) $row['ref_month']);
        $items[] = $row;
    }

    apiSuccess(['items' => $items, 'coverage' => $coverage]);
}

function upsertIstatIndex(PDO $db): void
{
    requireRole('super_admin', 'admin');

    $data   = apiGetJsonBody();
    $period = istatParsePeriod($data['period'] ?? null);
    $value  = istatParseDecimal(isset($data['index_value']) ? (string) $data['index_value'] : null);

    if ($period === null) {
        apiError('Periodo non valido. Usa AAAA-MM per un mese oppure AAAA per la media annua.');
    }
    if ($value === null || $value <= 0) {
        apiError('Valore dell\'indice non valido.');
    }

    // Un indice inserito a mano e' un override: l'import non deve sovrascriverlo
    // (stessa regola delle quotazioni OMI, phase73).
    $stmt = $db->prepare(
        "INSERT INTO istat_foi_index (ref_year, ref_month, index_value, source, notes)
         VALUES (:y, :m, :v, 'manuale', :n)
         ON DUPLICATE KEY UPDATE index_value = VALUES(index_value),
                                 source      = 'manuale',
                                 notes       = VALUES(notes)"
    );
    $stmt->execute([
        'y' => $period['year'],
        'm' => $period['month'],
        'v' => $value,
        'n' => trim((string) ($data['notes'] ?? '')) ?: null,
    ]);

    logActivity('update', 'istat', 0, 'Indice ISTAT ' . istatFormatPeriod($period['year'], $period['month']) . ' = ' . $value);
    apiSuccess([
        'period'      => istatFormatPeriod($period['year'], $period['month']),
        'index_value' => $value,
        'message'     => 'Indice salvato.',
    ]);
}

function deleteIstatIndex(PDO $db, int $id): void
{
    requireRole('super_admin', 'admin');
    if ($id <= 0) apiError('ID mancante.');

    $stmt = $db->prepare('SELECT ref_year, ref_month FROM istat_foi_index WHERE id = :id');
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    if (!$row) apiError('Indice non trovato.', 404);

    $db->prepare('DELETE FROM istat_foi_index WHERE id = :id')->execute(['id' => $id]);

    logActivity('delete', 'istat', $id, 'Indice ISTAT ' . istatFormatPeriod((int) $row['ref_year'], (int) $row['ref_month']) . ' eliminato');
    apiSuccess(['id' => $id, 'message' => 'Indice eliminato.']);
}

/**
 * Import da CSV.
 *
 * Il formato non e' imposto perche' l'ISTAT pubblica gli stessi numeri in piu'
 * fogli diversi, e chiedere all'agente di rimontare le colonne prima di
 * caricarle vanificherebbe il senso dell'import. Bastano due colonne
 * riconoscibili: un periodo e un valore.
 */
function importIstatIndices(PDO $db): void
{
    requireRole('super_admin', 'admin');

    $body   = apiGetJsonBody();
    $csv    = (string) ($body['csv'] ?? '');
    $dryRun = !empty($body['dry_run']);

    if (trim($csv) === '') apiError('Nessun contenuto CSV ricevuto.');
    if (strlen($csv) > ISTAT_IMPORT_MAX_BYTES) {
        apiError('File troppo grande: attesa una serie di indici, non un dataset completo.');
    }

    $parsed = istatParseCsv($csv);
    if (!$parsed['rows']) {
        apiError('Nessuna riga utilizzabile. Servono due colonne: periodo (AAAA-MM o AAAA) e valore dell\'indice. Righe lette: '
            . $parsed['data_lines'] . ', scartate: ' . $parsed['skipped'] . '.');
    }

    // Righe protette: quelle corrette a mano.
    $manual = [];
    foreach ($db->query("SELECT ref_year, ref_month FROM istat_foi_index WHERE source = 'manuale'")->fetchAll() as $m) {
        $manual[$m['ref_year'] . '-' . $m['ref_month']] = true;
    }

    $toWrite = [];
    $skippedManual = 0;
    foreach ($parsed['rows'] as $key => $row) {
        if (isset($manual[$key])) { $skippedManual++; continue; }
        $toWrite[$key] = $row;
    }

    $report = [
        'dry_run'        => $dryRun,
        'rows_in_file'   => $parsed['data_lines'],
        'rows_ready'     => count($toWrite),
        'skipped_manual' => $skippedManual,
        'skipped_bad'    => $parsed['skipped'],
        'preview'        => array_slice(array_values($toWrite), 0, 15),
    ];

    if ($dryRun) {
        $report['message'] = 'Anteprima: nessuna riga scritta.';
        apiSuccess($report);
    }

    if (!$toWrite) {
        $report['message'] = 'Nessuna riga da scrivere: erano tutte override manuali.';
        apiSuccess($report);
    }

    $stmt = $db->prepare(
        "INSERT INTO istat_foi_index (ref_year, ref_month, index_value, source, notes)
         VALUES (:y, :m, :v, 'import', NULL)
         ON DUPLICATE KEY UPDATE index_value = VALUES(index_value),
                                 source      = 'import',
                                 notes       = NULL"
    );

    $db->beginTransaction();
    try {
        foreach ($toWrite as $row) {
            $stmt->execute(['y' => $row['ref_year'], 'm' => $row['ref_month'], 'v' => $row['index_value']]);
        }
        $db->commit();
    } catch (PDOException $e) {
        $db->rollBack();
        throw $e;
    }

    // logActivity accetta solo create/update/delete: 'import' verrebbe scartato
    // in silenzio e l'operazione non lascerebbe traccia (stessa nota di OMI).
    logActivity('create', 'istat', 0, 'Import indici ISTAT: ' . count($toWrite) . ' periodi');

    $report['message'] = count($toWrite) . ' indici importati.';
    apiSuccess($report);
}
