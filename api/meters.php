<?php
/**
 * Meters registry API (phase76).
 *
 * Il contatore e' l'oggetto fisico; `meter_readings` sono i numeri letti sul suo
 * quadrante. Prima esisteva solo la seconda meta': vedi la migrazione per il
 * perche' la distinzione conta (due contatori gas nello stesso immobile, POD e
 * PDR, dove si trova fisicamente il quadrante).
 *
 * GET    /api/meters.php?property_id=X   — contatori dell'immobile
 * GET    /api/meters.php?id={id}         — singolo contatore
 * GET    /api/meters.php?action=stats    — censimento
 * POST   /api/meters.php                 — crea
 * PUT    /api/meters.php?id={id}         — aggiorna
 * DELETE /api/meters.php?id={id}         — elimina (solo se non ha letture)
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
apiHandleOptions();

const METER_TYPES = ['gas', 'electricity', 'water', 'heating'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            if (($_GET['action'] ?? '') === 'stats') {
                apiSuccess([
                    'total'     => (int) $db->query('SELECT COUNT(*) FROM meters')->fetchColumn(),
                    'active'    => (int) $db->query('SELECT COUNT(*) FROM meters WHERE is_active = 1')->fetchColumn(),
                    'no_code'   => (int) $db->query("SELECT COUNT(*) FROM meters WHERE code IS NULL OR code = ''")->fetchColumn(),
                    'never_read' => (int) $db->query(
                        'SELECT COUNT(*) FROM meters m
                          WHERE NOT EXISTS (SELECT 1 FROM meter_readings mr WHERE mr.meter_id = m.id)'
                    )->fetchColumn(),
                ]);
            }
            $id ? getMeter($db, $id) : listMeters($db);
            break;
        case 'POST':
            createMeter($db);
            break;
        case 'PUT':
            if (!$id) apiError('ID contatore mancante.');
            updateMeter($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID contatore mancante.');
            deleteMeter($db, $id);
            break;
        default:
            apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function meterSelect(): string
{
    // `last_reading_date` e `reading_count` servono alla UI per distinguere a
    // colpo d'occhio un contatore censito e mai letto da uno in uso.
    return "SELECT m.*,
                   p.address AS property_address, p.city AS property_city,
                   s.name AS supplier_directory_name,
                   (SELECT COUNT(*) FROM meter_readings mr WHERE mr.meter_id = m.id) AS reading_count,
                   (SELECT MAX(mr.reading_date) FROM meter_readings mr WHERE mr.meter_id = m.id) AS last_reading_date
              FROM meters m
              LEFT JOIN properties p ON p.id = m.property_id
              LEFT JOIN suppliers  s ON s.id = m.supplier_id";
}

function listMeters(PDO $db): void
{
    $pagination = apiGetPagination();
    $propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : null;
    $meterType  = trim($_GET['meter_type'] ?? '');
    $search     = trim($_GET['search'] ?? '');
    $activeOnly = ($_GET['active'] ?? '') === '1';

    $where  = 'WHERE 1=1';
    $params = [];

    if ($propertyId) {
        $where .= ' AND m.property_id = :property_id';
        $params['property_id'] = $propertyId;
    }
    if ($meterType !== '' && in_array($meterType, METER_TYPES, true)) {
        $where .= ' AND m.meter_type = :meter_type';
        $params['meter_type'] = $meterType;
    }
    if ($activeOnly) {
        $where .= ' AND m.is_active = 1';
    }
    if ($search !== '') {
        $frag = apiWordSearch($search, ['m.code', 'm.serial_number', 'm.supplier_name', 'm.location', 'p.address', 'p.city'], $params, 'mw');
        if ($frag) $where .= " AND $frag";
    }

    $countSql = "SELECT COUNT(*) FROM meters m LEFT JOIN properties p ON p.id = m.property_id $where";
    $dataSql  = meterSelect() . " $where ORDER BY m.property_id, m.meter_type, m.id";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess(array_map('decorateMeter', $items), $total, $pagination);
}

function getMeter(PDO $db, int $id): void
{
    $stmt = $db->prepare(meterSelect() . ' WHERE m.id = :id');
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();

    if (!$row) {
        apiError('Contatore non trovato.', 404);
    }

    apiSuccess(decorateMeter($row));
}

/**
 * L'etichetta del codice dipende dal tipo — POD per la luce, PDR per il gas,
 * matricola per acqua e riscaldamento. Il campo in tabella e' uno solo, quindi
 * il nome giusto lo decide il server: la UI non deve rifare questa mappa.
 */
function decorateMeter(array $row): array
{
    $labels = [
        'electricity' => 'POD',
        'gas'         => 'PDR',
        'water'       => 'Matricola',
        'heating'     => 'Matricola',
    ];

    $row['code_label'] = $labels[$row['meter_type']] ?? 'Codice';
    $row['supplier_display'] = $row['supplier_directory_name'] ?: ($row['supplier_name'] ?: null);

    return $row;
}

function createMeter(PDO $db): void
{
    $data      = apiGetJsonBody();
    $validated = validateMeterInput($db, $data);

    $stmt = $db->prepare(
        "INSERT INTO meters
            (property_id, meter_type, code, serial_number, supplier_id, supplier_name,
             location, installed_on, removed_on, is_active, notes)
         VALUES
            (:property_id, :meter_type, :code, :serial_number, :supplier_id, :supplier_name,
             :location, :installed_on, :removed_on, :is_active, :notes)"
    );

    try {
        $stmt->execute($validated);
    } catch (PDOException $e) {
        apiError(duplicateCodeMessage($e, $validated['code']), 400);
    }

    $newId = (int) $db->lastInsertId();
    logActivity('create', 'meter', $newId, 'Contatore censito: ' . $validated['meter_type'] . ($validated['code'] ? ' — ' . $validated['code'] : ''));
    getMeter($db, $newId);
}

function updateMeter(PDO $db, int $id): void
{
    $stmt = $db->prepare('SELECT id FROM meters WHERE id = :id');
    $stmt->execute(['id' => $id]);
    if (!$stmt->fetch()) {
        apiError('Contatore non trovato.', 404);
    }

    $data      = apiGetJsonBody();
    $validated = validateMeterInput($db, $data);

    $stmt = $db->prepare(
        "UPDATE meters
            SET property_id = :property_id, meter_type = :meter_type, code = :code,
                serial_number = :serial_number, supplier_id = :supplier_id,
                supplier_name = :supplier_name, location = :location,
                installed_on = :installed_on, removed_on = :removed_on,
                is_active = :is_active, notes = :notes
          WHERE id = :id"
    );

    try {
        $stmt->execute(array_merge($validated, ['id' => $id]));
    } catch (PDOException $e) {
        apiError(duplicateCodeMessage($e, $validated['code']), 400);
    }

    // Le letture portano una copia di property_id/meter_type per comodita' dei
    // filtri. Spostato o riclassificato il contatore, la copia va riallineata
    // subito: e' l'unico momento in cui potrebbe divergere.
    $db->prepare(
        'UPDATE meter_readings SET property_id = :pid, meter_type = :type WHERE meter_id = :id'
    )->execute(['pid' => $validated['property_id'], 'type' => $validated['meter_type'], 'id' => $id]);

    logActivity('update', 'meter', $id, 'Contatore aggiornato #' . $id);
    getMeter($db, $id);
}

function deleteMeter(PDO $db, int $id): void
{
    $stmt = $db->prepare('SELECT * FROM meters WHERE id = :id');
    $stmt->execute(['id' => $id]);
    $meter = $stmt->fetch();

    if (!$meter) {
        apiError('Contatore non trovato.', 404);
    }

    // La FK e' CASCADE, quindi eliminare qui porterebbe via in silenzio tutto lo
    // storico delle letture (e, tramite phase75, le loro foto). Uno storico di
    // consumi non si butta per sbaglio: chi ha un contatore sostituito lo
    // disattiva, cosi' resta consultabile e sparisce dai menu.
    $count = $db->prepare('SELECT COUNT(*) FROM meter_readings WHERE meter_id = :id');
    $count->execute(['id' => $id]);
    $readings = (int) $count->fetchColumn();

    if ($readings > 0) {
        apiError(
            "Questo contatore ha $readings letture registrate e non può essere eliminato. "
            . 'Disattivalo se non è più in uso: lo storico resta consultabile.',
            409
        );
    }

    $db->prepare('DELETE FROM meters WHERE id = :id')->execute(['id' => $id]);

    logActivity('delete', 'meter', $id, 'Contatore eliminato #' . $id);
    apiSuccess(['id' => $id, 'message' => 'Contatore eliminato.']);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function duplicateCodeMessage(PDOException $e, ?string $code): string
{
    if ($e->getCode() === '23000' && str_contains($e->getMessage(), 'uq_meters_code')) {
        return 'Il codice ' . ($code ?? '') . ' è già assegnato a un altro contatore. '
             . 'POD e PDR sono identificativi nazionali: verifica di non averlo già censito.';
    }

    return 'Errore nel salvataggio del contatore.';
}

function validateMeterInput(PDO $db, array $data): array
{
    $propertyId = !empty($data['property_id']) ? (int) $data['property_id'] : 0;
    $meterType  = trim($data['meter_type'] ?? '');
    $supplierId = !empty($data['supplier_id']) ? (int) $data['supplier_id'] : null;

    if ($propertyId <= 0) apiError('Immobile non valido.');
    if (!in_array($meterType, METER_TYPES, true)) apiError('Tipo contatore non valido.');

    $stmt = $db->prepare('SELECT id FROM properties WHERE id = :id');
    $stmt->execute(['id' => $propertyId]);
    if (!$stmt->fetch()) apiError('Immobile non trovato.');

    if ($supplierId) {
        $stmt = $db->prepare('SELECT id FROM suppliers WHERE id = :id');
        $stmt->execute(['id' => $supplierId]);
        if (!$stmt->fetch()) apiError('Fornitore non trovato.');
    }

    $installedOn = optionalDate($data['installed_on'] ?? null, 'Data di installazione');
    $removedOn   = optionalDate($data['removed_on'] ?? null, 'Data di rimozione');

    if ($installedOn && $removedOn && $removedOn < $installedOn) {
        apiError('La data di rimozione non può precedere quella di installazione.');
    }

    return [
        'property_id'   => $propertyId,
        'meter_type'    => $meterType,
        'code'          => trim($data['code'] ?? '') ?: null,
        'serial_number' => trim($data['serial_number'] ?? '') ?: null,
        'supplier_id'   => $supplierId,
        'supplier_name' => trim($data['supplier_name'] ?? '') ?: null,
        'location'      => trim($data['location'] ?? '') ?: null,
        'installed_on'  => $installedOn,
        'removed_on'    => $removedOn,
        'is_active'     => !empty($data['is_active']) || !isset($data['is_active']) ? 1 : 0,
        'notes'         => trim($data['notes'] ?? '') ?: null,
    ];
}

/**
 * Il round-trip serve anche qui: `createFromFormat` accetta l'anno a due cifre e
 * fa traboccare in silenzio i valori fuori scala (2026-13-45 -> 2027-02-14).
 */
function optionalDate(?string $value, string $label): ?string
{
    $value = trim((string) $value);
    if ($value === '') {
        return null;
    }

    $parsed = DateTime::createFromFormat('!Y-m-d', $value);
    if (!$parsed || $parsed->format('Y-m-d') !== $value || (int) $parsed->format('Y') < 1900) {
        apiError("$label non valida.");
    }

    return $value;
}
