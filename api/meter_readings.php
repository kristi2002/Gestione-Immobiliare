<?php
/**
 * Utility Meter Readings CRUD API.
 *
 * GET  /api/meter_readings.php?property_id=X           — list readings (paginated)
 * GET  /api/meter_readings.php?property_id=X&summary=1 — latest per type + consumption
 * POST /api/meter_readings.php                         — create
 * PUT  /api/meter_readings.php?id={id}                 — update
 * DELETE /api/meter_readings.php?id={id}               — delete
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
            if (!empty($_GET['summary']) && isset($_GET['property_id'])) {
                getMeterSummary($db, (int) $_GET['property_id']);
            } elseif ($id) {
                getMeterReading($db, $id);
            } else {
                listMeterReadings($db);
            }
            break;
        case 'POST':
            createMeterReading($db);
            break;
        case 'PUT':
            if (!$id) apiError('ID lettura mancante.');
            updateMeterReading($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID lettura mancante.');
            deleteMeterReading($db, $id);
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

function listMeterReadings(PDO $db): void
{
    $pagination = apiGetPagination();
    $propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : null;
    $meterType  = trim($_GET['meter_type'] ?? '');

    $where  = 'WHERE 1=1';
    $params = [];

    if ($propertyId) {
        $where .= ' AND mr.property_id = :property_id';
        $params['property_id'] = $propertyId;
    }
    if ($meterType !== '' && in_array($meterType, METER_TYPES, true)) {
        $where .= ' AND mr.meter_type = :meter_type';
        $params['meter_type'] = $meterType;
    }

    $countSql = "SELECT COUNT(*) FROM meter_readings mr $where";

    $dataSql = "SELECT mr.*,
                   p.address AS property_address, p.city AS property_city,
                   ROUND(mr.reading_value - COALESCE((
                       SELECT prev.reading_value FROM meter_readings prev
                       WHERE prev.property_id = mr.property_id
                         AND prev.meter_type  = mr.meter_type
                         AND prev.id          < mr.id
                       ORDER BY prev.reading_date DESC, prev.id DESC
                       LIMIT 1
                   ), mr.reading_value), 2) AS consumption
            FROM meter_readings mr
            LEFT JOIN properties p ON p.id = mr.property_id
            $where
            ORDER BY mr.reading_date DESC, mr.id DESC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getMeterReading(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT mr.*, p.address AS property_address, p.city AS property_city
         FROM meter_readings mr
         LEFT JOIN properties p ON p.id = mr.property_id
         WHERE mr.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();

    if (!$row) {
        apiError('Lettura contatore non trovata.', 404);
    }

    apiSuccess($row);
}

function getMeterSummary(PDO $db, int $propertyId): void
{
    $summary = [];

    foreach (METER_TYPES as $type) {
        // Latest reading for this type
        $stmt = $db->prepare(
            "SELECT * FROM meter_readings
             WHERE property_id = :pid AND meter_type = :type
             ORDER BY reading_date DESC, id DESC
             LIMIT 1"
        );
        $stmt->execute(['pid' => $propertyId, 'type' => $type]);
        $latest = $stmt->fetch();

        if (!$latest) {
            $summary[$type] = ['latest' => null, 'previous' => null, 'consumption' => null];
            continue;
        }

        // Previous reading for consumption delta
        $stmt2 = $db->prepare(
            "SELECT * FROM meter_readings
             WHERE property_id = :pid AND meter_type = :type AND id != :lid
             ORDER BY reading_date DESC, id DESC
             LIMIT 1"
        );
        $stmt2->execute(['pid' => $propertyId, 'type' => $type, 'lid' => $latest['id']]);
        $previous = $stmt2->fetch() ?: null;

        $consumption = null;
        if ($previous) {
            $consumption = round((float) $latest['reading_value'] - (float) $previous['reading_value'], 2);
        }

        $summary[$type] = [
            'latest'      => $latest,
            'previous'    => $previous,
            'consumption' => $consumption,
        ];
    }

    apiSuccess(['property_id' => $propertyId, 'summary' => $summary]);
}

function createMeterReading(PDO $db): void
{
    $data      = apiGetJsonBody();
    $validated = validateMeterInput($data);

    $stmt = $db->prepare(
        "INSERT INTO meter_readings (property_id, meter_type, reading_value, reading_date, notes)
         VALUES (:property_id, :meter_type, :reading_value, :reading_date, :notes)"
    );
    $stmt->execute($validated);

    $newId = (int) $db->lastInsertId();
    logActivity('create', 'meter_reading', $newId, 'Lettura contatore: ' . $validated['meter_type'] . ' = ' . $validated['reading_value']);
    getMeterReading($db, $newId);
}

function updateMeterReading(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT id FROM meter_readings WHERE id = :id");
    $stmt->execute(['id' => $id]);
    if (!$stmt->fetch()) {
        apiError('Lettura non trovata.', 404);
    }

    $data      = apiGetJsonBody();
    $validated = validateMeterInput($data);

    $stmt = $db->prepare(
        "UPDATE meter_readings
         SET property_id = :property_id, meter_type = :meter_type,
             reading_value = :reading_value, reading_date = :reading_date, notes = :notes
         WHERE id = :id"
    );
    $stmt->execute(array_merge($validated, ['id' => $id]));

    logActivity('update', 'meter_reading', $id, 'Lettura aggiornata #' . $id);
    getMeterReading($db, $id);
}

function deleteMeterReading(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT id FROM meter_readings WHERE id = :id");
    $stmt->execute(['id' => $id]);
    if (!$stmt->fetch()) {
        apiError('Lettura non trovata.', 404);
    }

    $db->prepare("DELETE FROM meter_readings WHERE id = :id")->execute(['id' => $id]);

    logActivity('delete', 'meter_reading', $id, 'Lettura eliminata #' . $id);
    apiSuccess(['id' => $id, 'message' => 'Lettura eliminata.']);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateMeterInput(array $data): array
{
    $propertyId   = !empty($data['property_id']) ? (int) $data['property_id'] : 0;
    $meterType    = trim($data['meter_type'] ?? '');
    $readingValue = isset($data['reading_value']) && $data['reading_value'] !== '' ? (float) $data['reading_value'] : null;
    $readingDate  = trim($data['reading_date'] ?? '') ?: date('Y-m-d');
    $notes        = trim($data['notes'] ?? '') ?: null;

    if ($propertyId <= 0) apiError('Immobile non valido.');
    if (!in_array($meterType, METER_TYPES, true)) apiError('Tipo contatore non valido.');
    if ($readingValue === null) apiError('Valore lettura obbligatorio.');
    if (!DateTime::createFromFormat('Y-m-d', $readingDate)) apiError('Data lettura non valida.');

    return [
        'property_id'   => $propertyId,
        'meter_type'    => $meterType,
        'reading_value' => $readingValue,
        'reading_date'  => $readingDate,
        'notes'         => $notes,
    ];
}
