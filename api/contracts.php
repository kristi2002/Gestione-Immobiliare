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
            $action = trim($_GET['action'] ?? '');
            if ($action === 'generate_payments') {
                if (!$id) apiError('ID contratto mancante.');
                generatePayments($db, $id);
            } else {
                createContract($db);
            }
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
    if ($e->getCode() === '23000') {
        apiError('Operazione non consentita: esistono record collegati a questo contratto. Rimuoverli prima di procedere.', 409);
    }
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function listContracts(PDO $db): void
{
    $pagination = apiGetPagination();
    $propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : null;
    $clientId   = isset($_GET['client_id'])   ? (int) $_GET['client_id']   : null;
    $status     = trim($_GET['status'] ?? '');
    $type       = trim($_GET['type'] ?? '');
    $search     = trim($_GET['search'] ?? '');

    $where = 'WHERE 1=1';
    $params = [];

    if ($propertyId) {
        $where .= ' AND ct.property_id = :property_id';
        $params['property_id'] = $propertyId;
    }
    if ($clientId) {
        $where .= ' AND ct.client_id = :client_id';
        $params['client_id'] = $clientId;
    }
    if ($search !== '') {
        $frag = apiWordSearch($search, ['p.address', 'p.city', 't.name', 't.surname', 'c.name', 'c.surname', 'ct.title'], $params);
        if ($frag) $where .= " AND $frag";
    }
    if ($status !== '' && in_array($status, CONTRACT_STATUSES, true)) {
        $where .= ' AND ct.status = :status';
        $params['status'] = $status;
        // Time-aware state: a contract past its end date counts as "Scaduto", so it
        // should NOT show under draft/sent/signed — only under the "Scaduti" filter.
        if ($status !== 'cancelled' && $status !== 'expired') {
            $where .= " AND (ct.end_date IS NULL OR ct.end_date >= CURDATE())";
        }
    }
    if ($type !== '' && in_array($type, CONTRACT_TYPES, true)) {
        $where .= ' AND ct.contract_type = :type';
        $params['type'] = $type;
    }
    // Dedicated "Scaduti" filter: contracts past their end date (not cancelled).
    // (ct.status can be NULL for "Automatico" contracts, so guard the != comparison.)
    if (($_GET['expired'] ?? '') === '1') {
        $where .= " AND ct.end_date IS NOT NULL AND ct.end_date < CURDATE()
                    AND (ct.status IS NULL OR ct.status <> 'cancelled')";
    }
    // "Attivi" filter: in force today — Automatico (NULL) or Firmato, within the
    // date range (or open-ended) and not yet past the end date, and not cancelled.
    if (($_GET['active'] ?? '') === '1') {
        $where .= " AND (ct.status IS NULL OR ct.status = 'signed')
                    AND (ct.end_date IS NULL OR ct.end_date >= CURDATE())";
    }

    $countSql = "SELECT COUNT(*) FROM contracts ct
                 INNER JOIN properties p ON p.id = ct.property_id
                 LEFT JOIN tenants t ON t.id = ct.tenant_id
                 LEFT JOIN clients c ON c.id = ct.client_id
                 $where";

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
             start_date, end_date, monthly_rent, deposit, notes, created_by)
         VALUES
            (:property_id, :tenant_id, :client_id, :title, :contract_type, :status,
             :start_date, :end_date, :monthly_rent, :deposit, :notes, :created_by)"
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
             deposit = :deposit, notes = :notes
         WHERE id = :id"
    );
    $stmt->execute(array_merge($validated, ['id' => $id]));

    logActivity('update', 'contract', $id, 'Contratto aggiornato #' . $id . ' (' . $validated['status'] . ')');
    getContract($db, $id);
}

function deleteContract(PDO $db, int $id): void
{
    // Deleting a contract is permanent and removes legal/financial history —
    // restrict to admin+ (same convention as admin_users.php, backup_trigger.php, etc.).
    // Agents can still create/update contracts via requireWriteAccess() above.
    requireRole('super_admin', 'admin');

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
    // Empty status = "Automatico" (state derived from the dates). Stored as NULL.
    $statusRaw    = trim($data['status'] ?? '');
    $status       = ($statusRaw === '' || $statusRaw === 'auto') ? null : $statusRaw;
    $startDate    = trim($data['start_date'] ?? '') ?: null;
    $endDate      = trim($data['end_date'] ?? '') ?: null;
    $monthlyRent  = isset($data['monthly_rent']) && $data['monthly_rent'] !== '' ? (float) $data['monthly_rent'] : null;
    $deposit      = isset($data['deposit']) && $data['deposit'] !== '' ? (float) $data['deposit'] : null;
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
    if ($status !== null && !in_array($status, CONTRACT_STATUSES, true)) {
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
        'notes'         => $notes,
    ];
}

function generatePayments(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT * FROM contracts WHERE id = :id");
    $stmt->execute(['id' => $id]);
    $contract = $stmt->fetch();
    if (!$contract) apiError('Contratto non trovato.', 404);

    if ($contract['contract_type'] !== 'locazione')
        apiError('La generazione dello scadenzario è disponibile solo per contratti di locazione.');
    if (!$contract['tenant_id'])
        apiError('Il contratto non ha un inquilino associato.');
    if (!$contract['monthly_rent'])
        apiError('Il contratto non ha un canone mensile.');
    if (!$contract['start_date'])
        apiError('Il contratto non ha una data di inizio.');
    if (!$contract['end_date'])
        apiError('Il contratto non ha una data di fine.');

    $existStmt = $db->prepare("SELECT COUNT(*) FROM payments WHERE contract_id = :cid");
    $existStmt->execute(['cid' => $id]);
    if ((int) $existStmt->fetchColumn() > 0) {
        apiError('Esiste già uno scadenzario per questo contratto. Elimina i pagamenti esistenti prima di rigenerarlo.');
    }

    $start   = new DateTime($contract['start_date']);
    $end     = new DateTime($contract['end_date']);
    $current = clone $start;

    $insert = $db->prepare(
        "INSERT INTO payments (contract_id, tenant_id, property_id, amount, due_date, status)
         VALUES (:contract_id, :tenant_id, :property_id, :amount, :due_date, 'pending')"
    );

    $count = 0;
    while ($current <= $end) {
        $insert->execute([
            'contract_id' => $id,
            'tenant_id'   => $contract['tenant_id'],
            'property_id' => $contract['property_id'],
            'amount'      => $contract['monthly_rent'],
            'due_date'    => $current->format('Y-m-d'),
        ]);
        $count++;
        $current->modify('+1 month');
    }

    logActivity('create', 'contract', $id, "Scadenzario generato: $count pagamenti per contratto #$id");
    apiSuccess(['contract_id' => $id, 'payments_created' => $count, 'message' => "$count pagamenti creati."]);
}

function contractExists(PDO $db, int $id): bool
{
    $stmt = $db->prepare("SELECT id FROM contracts WHERE id = :id");
    $stmt->execute(['id' => $id]);
    return (bool) $stmt->fetch();
}
