<?php
/**
 * Contracts (Contratti) CRUD API — lifecycle management.
 *
 * GET    /api/contracts.php                       — list (property_id, status, type)
 * GET    /api/contracts.php?id={id}               — single contract
 * POST   /api/contracts.php                       — create
 * PUT    /api/contracts.php?id={id}               — update
 * DELETE /api/contracts.php?id={id}               — delete
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();
requireViewAccess('contracts');

const CONTRACT_TYPES    = ['locazione', 'compravendita', 'preliminare', 'mandato', 'altro'];
const CONTRACT_STATUSES = ['draft', 'sent', 'signed', 'expired', 'cancelled'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            $id ? getContract($db, $id) : listContracts($db);
            break;
        case 'POST':
            createContract($db);
            break;
        case 'PUT':
            if (!$id) apiError('ID contratto mancante.');
            updateContract($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID contratto mancante.');
            deleteContract($db, $id);
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

function listContracts(PDO $db): void
{
    $pagination = apiGetPagination();
    $propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : null;
    $status     = trim($_GET['status'] ?? '');
    $type       = trim($_GET['type'] ?? '');
    $search     = trim($_GET['search'] ?? '');

    $where = 'WHERE 1=1';
    $params = [];

    if ($propertyId) {
        $where .= ' AND ct.property_id = :property_id';
        $params['property_id'] = $propertyId;
    }
    if ($search !== '') {
        $frag = apiWordSearch($search, ['p.address', 'p.city', 't.name', 't.surname', 'c.name', 'c.surname', 'ct.title'], $params);
        if ($frag) $where .= " AND $frag";
    }
    if ($status !== '' && in_array($status, CONTRACT_STATUSES, true)) {
        $where .= ' AND ct.status = :status';
        $params['status'] = $status;
    }
    if ($type !== '' && in_array($type, CONTRACT_TYPES, true)) {
        $where .= ' AND ct.contract_type = :type';
        $params['type'] = $type;
    }

    $countSql = "SELECT COUNT(*) FROM contracts ct $where";

    $dataSql = "SELECT ct.*, p.address AS property_address, p.city AS property_city,
                   t.name AS tenant_name, t.surname AS tenant_surname,
                   c.name AS client_name, c.surname AS client_surname
            FROM contracts ct
            INNER JOIN properties p ON p.id = ct.property_id
            LEFT JOIN tenants t ON t.id = ct.tenant_id
            LEFT JOIN clients c ON c.id = ct.client_id
            $where
            ORDER BY ct.created_at DESC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getContract(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT ct.*, p.address AS property_address, p.city AS property_city,
                t.name AS tenant_name, t.surname AS tenant_surname,
                c.name AS client_name, c.surname AS client_surname
         FROM contracts ct
         INNER JOIN properties p ON p.id = ct.property_id
         LEFT JOIN tenants t ON t.id = ct.tenant_id
         LEFT JOIN clients c ON c.id = ct.client_id
         WHERE ct.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();

    if (!$row) {
        apiError('Contratto non trovato.', 404);
    }

    apiSuccess($row);
}

function createContract(PDO $db): void
{
    $data      = apiGetJsonBody();
    $validated = validateContractInput($data);
    $validated['created_by'] = getCurrentAdminId() ?: null;

    $stmt = $db->prepare(
        "INSERT INTO contracts
            (property_id, tenant_id, client_id, title, contract_type, status,
             start_date, end_date, monthly_rent, deposit, document_id, notes, created_by)
         VALUES
            (:property_id, :tenant_id, :client_id, :title, :contract_type, :status,
             :start_date, :end_date, :monthly_rent, :deposit, :document_id, :notes, :created_by)"
    );
    $stmt->execute($validated);

    $newId = (int) $db->lastInsertId();
    logActivity('create', 'contract', $newId, 'Contratto creato: ' . $validated['title']);
    getContract($db, $newId);
}

function updateContract(PDO $db, int $id): void
{
    if (!contractExists($db, $id)) {
        apiError('Contratto non trovato.', 404);
    }

    $data      = apiGetJsonBody();
    $validated = validateContractInput($data);

    $stmt = $db->prepare(
        "UPDATE contracts
         SET property_id = :property_id, tenant_id = :tenant_id, client_id = :client_id,
             title = :title, contract_type = :contract_type, status = :status,
             start_date = :start_date, end_date = :end_date, monthly_rent = :monthly_rent,
             deposit = :deposit, document_id = :document_id, notes = :notes
         WHERE id = :id"
    );
    $stmt->execute(array_merge($validated, ['id' => $id]));

    logActivity('update', 'contract', $id, 'Contratto aggiornato #' . $id . ' (' . $validated['status'] . ')');
    getContract($db, $id);
}

function deleteContract(PDO $db, int $id): void
{
    if (!contractExists($db, $id)) {
        apiError('Contratto non trovato.', 404);
    }

    $stmt = $db->prepare("DELETE FROM contracts WHERE id = :id");
    $stmt->execute(['id' => $id]);

    logActivity('delete', 'contract', $id, 'Contratto eliminato #' . $id);
    apiSuccess(['id' => $id, 'message' => 'Contratto eliminato.']);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateContractInput(array $data): array
{
    $propertyId   = (int) ($data['property_id'] ?? 0);
    $tenantId     = !empty($data['tenant_id']) ? (int) $data['tenant_id'] : null;
    $clientId     = !empty($data['client_id']) ? (int) $data['client_id'] : null;
    $title        = trim($data['title'] ?? '');
    $contractType = trim($data['contract_type'] ?? 'locazione');
    $status       = trim($data['status'] ?? 'draft');
    $startDate    = trim($data['start_date'] ?? '') ?: null;
    $endDate      = trim($data['end_date'] ?? '') ?: null;
    $monthlyRent  = isset($data['monthly_rent']) && $data['monthly_rent'] !== '' ? (float) $data['monthly_rent'] : null;
    $deposit      = isset($data['deposit']) && $data['deposit'] !== '' ? (float) $data['deposit'] : null;
    $documentId   = !empty($data['document_id']) ? (int) $data['document_id'] : null;
    $notes        = trim($data['notes'] ?? '') ?: null;

    if ($propertyId <= 0) {
        apiError('Seleziona un immobile.');
    }
    if ($title === '') {
        apiError('Il titolo è obbligatorio.');
    }
    if (!in_array($contractType, CONTRACT_TYPES, true)) {
        apiError('Tipo contratto non valido.');
    }
    if (!in_array($status, CONTRACT_STATUSES, true)) {
        apiError('Stato non valido.');
    }
    if ($startDate !== null && !DateTime::createFromFormat('Y-m-d', $startDate)) {
        apiError('Data inizio non valida.');
    }
    if ($endDate !== null && !DateTime::createFromFormat('Y-m-d', $endDate)) {
        apiError('Data fine non valida.');
    }

    return [
        'property_id'   => $propertyId,
        'tenant_id'     => $tenantId,
        'client_id'     => $clientId,
        'title'         => $title,
        'contract_type' => $contractType,
        'status'        => $status,
        'start_date'    => $startDate,
        'end_date'      => $endDate,
        'monthly_rent'  => $monthlyRent,
        'deposit'       => $deposit,
        'document_id'   => $documentId,
        'notes'         => $notes,
    ];
}

function contractExists(PDO $db, int $id): bool
{
    $stmt = $db->prepare("SELECT id FROM contracts WHERE id = :id");
    $stmt->execute(['id' => $id]);
    return (bool) $stmt->fetch();
}
