<?php
/**
 * Property Insurance Policies CRUD API.
 *
 * GET  /api/insurance.php                    — list (property_id, client_id, expiring_soon)
 * GET  /api/insurance.php?id={id}            — single policy
 * POST /api/insurance.php                    — create
 * PUT  /api/insurance.php?id={id}            — update
 * DELETE /api/insurance.php?id={id}          — delete
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
apiHandleOptions();

const INSURANCE_TYPES = ['incendio', 'responsabilita', 'globale_fabbricato', 'altro'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            $id ? getInsurance($db, $id) : listInsurance($db);
            break;
        case 'POST':
            createInsurance($db);
            break;
        case 'PUT':
            if (!$id) apiError('ID polizza mancante.');
            updateInsurance($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID polizza mancante.');
            deleteInsurance($db, $id);
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

function listInsurance(PDO $db): void
{
    $pagination = apiGetPagination();
    $propertyId   = isset($_GET['property_id']) ? (int) $_GET['property_id'] : null;
    $clientId     = isset($_GET['client_id']) ? (int) $_GET['client_id'] : null;
    $expiringSoon = !empty($_GET['expiring_soon']);

    $where  = 'WHERE 1=1';
    $params = [];

    if ($propertyId) {
        $where .= ' AND pi.property_id = :property_id';
        $params['property_id'] = $propertyId;
    }
    if ($clientId) {
        $where .= ' AND pi.client_id = :client_id';
        $params['client_id'] = $clientId;
    }
    if ($expiringSoon) {
        $where .= ' AND pi.end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)';
    }

    $countSql = "SELECT COUNT(*) FROM property_insurance pi $where";

    $dataSql = "SELECT pi.*,
                   p.address AS property_address, p.city AS property_city,
                   c.name AS client_name, c.surname AS client_surname
            FROM property_insurance pi
            LEFT JOIN properties p ON p.id = pi.property_id
            LEFT JOIN clients c ON c.id = pi.client_id
            $where
            ORDER BY pi.end_date ASC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getInsurance(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT pi.*,
                p.address AS property_address, p.city AS property_city,
                c.name AS client_name, c.surname AS client_surname
         FROM property_insurance pi
         LEFT JOIN properties p ON p.id = pi.property_id
         LEFT JOIN clients c ON c.id = pi.client_id
         WHERE pi.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();

    if (!$row) {
        apiError('Polizza non trovata.', 404);
    }

    apiSuccess($row);
}

function createInsurance(PDO $db): void
{
    $data      = apiGetJsonBody();
    $validated = validateInsuranceInput($data);

    $stmt = $db->prepare(
        "INSERT INTO property_insurance
            (property_id, client_id, insurer_name, policy_number, policy_type,
             premium_annual, start_date, end_date, notes)
         VALUES
            (:property_id, :client_id, :insurer_name, :policy_number, :policy_type,
             :premium_annual, :start_date, :end_date, :notes)"
    );
    $stmt->execute($validated);

    $newId = (int) $db->lastInsertId();
    logActivity('create', 'insurance', $newId, 'Polizza creata: ' . $validated['policy_number']);
    getInsurance($db, $newId);
}

function updateInsurance(PDO $db, int $id): void
{
    if (!insuranceExists($db, $id)) {
        apiError('Polizza non trovata.', 404);
    }

    $data      = apiGetJsonBody();
    $validated = validateInsuranceInput($data);

    $stmt = $db->prepare(
        "UPDATE property_insurance
         SET property_id = :property_id, client_id = :client_id,
             insurer_name = :insurer_name, policy_number = :policy_number,
             policy_type = :policy_type, premium_annual = :premium_annual,
             start_date = :start_date, end_date = :end_date, notes = :notes
         WHERE id = :id"
    );
    $stmt->execute(array_merge($validated, ['id' => $id]));

    logActivity('update', 'insurance', $id, 'Polizza aggiornata #' . $id);
    getInsurance($db, $id);
}

function deleteInsurance(PDO $db, int $id): void
{
    if (!insuranceExists($db, $id)) {
        apiError('Polizza non trovata.', 404);
    }

    $db->prepare("DELETE FROM property_insurance WHERE id = :id")->execute(['id' => $id]);

    logActivity('delete', 'insurance', $id, 'Polizza eliminata #' . $id);
    apiSuccess(['id' => $id, 'message' => 'Polizza eliminata.']);
}

// ---------------------------------------------------------------------------
// Validation / helpers
// ---------------------------------------------------------------------------

function validateInsuranceInput(array $data): array
{
    $propertyId    = !empty($data['property_id']) ? (int) $data['property_id'] : null;
    $clientId      = !empty($data['client_id']) ? (int) $data['client_id'] : null;
    $insurerName   = trim($data['insurer_name'] ?? '');
    $policyNumber  = trim($data['policy_number'] ?? '');
    $policyType    = trim($data['policy_type'] ?? 'altro');
    $premiumAnnual = isset($data['premium_annual']) && $data['premium_annual'] !== '' ? (float) $data['premium_annual'] : null;
    $startDate     = trim($data['start_date'] ?? '') ?: null;
    $endDate       = trim($data['end_date'] ?? '') ?: null;
    $notes         = trim($data['notes'] ?? '') ?: null;

    if ($insurerName === '') apiError('Il nome dell\'assicuratore è obbligatorio.');
    if ($policyNumber === '') apiError('Il numero di polizza è obbligatorio.');
    if ($propertyId === null && $clientId === null) apiError('Specifica almeno un immobile o un cliente.');
    if (!in_array($policyType, INSURANCE_TYPES, true)) apiError('Tipo polizza non valido.');
    if ($startDate !== null && !DateTime::createFromFormat('Y-m-d', $startDate)) apiError('Data inizio non valida.');
    if ($endDate !== null && !DateTime::createFromFormat('Y-m-d', $endDate)) apiError('Data fine non valida.');

    return [
        'property_id'    => $propertyId,
        'client_id'      => $clientId,
        'insurer_name'   => $insurerName,
        'policy_number'  => $policyNumber,
        'policy_type'    => $policyType,
        'premium_annual' => $premiumAnnual,
        'start_date'     => $startDate,
        'end_date'       => $endDate,
        'notes'          => $notes,
    ];
}

function insuranceExists(PDO $db, int $id): bool
{
    $stmt = $db->prepare("SELECT id FROM property_insurance WHERE id = :id");
    $stmt->execute(['id' => $id]);
    return (bool) $stmt->fetch();
}
