<?php
/**
 * Agent Commission Tracking CRUD API.
 *
 * GET    /api/commissions.php                  — paginated list (admin_user_id, status)
 * GET    /api/commissions.php?id={id}          — single commission
 * GET    /api/commissions.php?summary=1        — total pending + paid per agent
 * POST   /api/commissions.php                  — create
 * PUT    /api/commissions.php?id={id}          — update (can mark as paid)
 * DELETE /api/commissions.php?id={id}          — delete
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
apiHandleOptions();

requireRole('admin', 'super_admin');

const COMMISSION_TYPES    = ['vendita', 'locazione', 'gestione'];
const COMMISSION_STATUSES = ['pending', 'paid'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            if (!empty($_GET['summary'])) {
                getCommissionSummary($db);
            } elseif ($id) {
                getCommission($db, $id);
            } else {
                listCommissions($db);
            }
            break;
        case 'POST':
            createCommission($db);
            break;
        case 'PUT':
            if (!$id) apiError('ID commissione mancante.');
            updateCommission($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID commissione mancante.');
            deleteCommission($db, $id);
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

function listCommissions(PDO $db): void
{
    $pagination  = apiGetPagination();
    $adminUserId = isset($_GET['admin_user_id']) ? (int) $_GET['admin_user_id'] : null;
    $status      = trim($_GET['status'] ?? '');

    $where  = 'WHERE 1=1';
    $params = [];

    if ($adminUserId) {
        $where .= ' AND ac.admin_user_id = :admin_user_id';
        $params['admin_user_id'] = $adminUserId;
    }
    if ($status !== '' && in_array($status, COMMISSION_STATUSES, true)) {
        $where .= ' AND ac.status = :status';
        $params['status'] = $status;
    }

    $countSql = "SELECT COUNT(*) FROM agent_commissions ac $where";

    $dataSql = "SELECT ac.*,
                   au.username AS agent_username,
                   p.address AS property_address, p.city AS property_city,
                   c.name AS client_name, c.surname AS client_surname
            FROM agent_commissions ac
            LEFT JOIN admin_users au ON au.id = ac.admin_user_id
            LEFT JOIN properties p ON p.id = ac.property_id
            LEFT JOIN clients c ON c.id = ac.client_id
            $where
            ORDER BY ac.created_at DESC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getCommission(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT ac.*,
                au.username AS agent_username,
                p.address AS property_address, p.city AS property_city,
                c.name AS client_name, c.surname AS client_surname
         FROM agent_commissions ac
         LEFT JOIN admin_users au ON au.id = ac.admin_user_id
         LEFT JOIN properties p ON p.id = ac.property_id
         LEFT JOIN clients c ON c.id = ac.client_id
         WHERE ac.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();

    if (!$row) {
        apiError('Commissione non trovata.', 404);
    }

    apiSuccess($row);
}

function getCommissionSummary(PDO $db): void
{
    $stmt = $db->query(
        "SELECT au.id AS admin_user_id, au.username,
                SUM(CASE WHEN ac.status = 'pending' THEN ac.amount ELSE 0 END) AS total_pending,
                SUM(CASE WHEN ac.status = 'paid' THEN ac.amount ELSE 0 END) AS total_paid,
                COUNT(CASE WHEN ac.status = 'pending' THEN 1 END) AS count_pending,
                COUNT(CASE WHEN ac.status = 'paid' THEN 1 END) AS count_paid
         FROM admin_users au
         INNER JOIN agent_commissions ac ON ac.admin_user_id = au.id
         GROUP BY au.id, au.username
         ORDER BY total_pending DESC"
    );
    $rows = $stmt->fetchAll();

    apiSuccess(['agents' => $rows]);
}

function createCommission(PDO $db): void
{
    $data      = apiGetJsonBody();
    $validated = validateCommissionInput($data);

    $stmt = $db->prepare(
        "INSERT INTO agent_commissions
            (admin_user_id, contract_id, property_id, client_id, amount, percentage,
             commission_type, status, notes, due_date, paid_at)
         VALUES
            (:admin_user_id, :contract_id, :property_id, :client_id, :amount, :percentage,
             :commission_type, :status, :notes, :due_date, :paid_at)"
    );
    $stmt->execute($validated);

    $newId = (int) $db->lastInsertId();
    logActivity('create', 'commission', $newId, 'Commissione creata: € ' . $validated['amount']);
    getCommission($db, $newId);
}

function updateCommission(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT id FROM agent_commissions WHERE id = :id");
    $stmt->execute(['id' => $id]);
    if (!$stmt->fetch()) {
        apiError('Commissione non trovata.', 404);
    }

    $data      = apiGetJsonBody();
    $validated = validateCommissionInput($data);

    // Auto-set paid_at when marking as paid
    if ($validated['status'] === 'paid' && $validated['paid_at'] === null) {
        $validated['paid_at'] = date('Y-m-d H:i:s');
    }

    $stmt = $db->prepare(
        "UPDATE agent_commissions
         SET admin_user_id = :admin_user_id, contract_id = :contract_id,
             property_id = :property_id, client_id = :client_id,
             amount = :amount, percentage = :percentage,
             commission_type = :commission_type, status = :status,
             notes = :notes, due_date = :due_date, paid_at = :paid_at
         WHERE id = :id"
    );
    $stmt->execute(array_merge($validated, ['id' => $id]));

    logActivity('update', 'commission', $id, 'Commissione aggiornata #' . $id . ' (' . $validated['status'] . ')');
    getCommission($db, $id);
}

function deleteCommission(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT id FROM agent_commissions WHERE id = :id");
    $stmt->execute(['id' => $id]);
    if (!$stmt->fetch()) {
        apiError('Commissione non trovata.', 404);
    }

    $db->prepare("DELETE FROM agent_commissions WHERE id = :id")->execute(['id' => $id]);

    logActivity('delete', 'commission', $id, 'Commissione eliminata #' . $id);
    apiSuccess(['id' => $id, 'message' => 'Commissione eliminata.']);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateCommissionInput(array $data): array
{
    $adminUserId     = !empty($data['admin_user_id']) ? (int) $data['admin_user_id'] : 0;
    $contractId      = !empty($data['contract_id']) ? (int) $data['contract_id'] : null;
    $propertyId      = !empty($data['property_id']) ? (int) $data['property_id'] : null;
    $clientId        = !empty($data['client_id']) ? (int) $data['client_id'] : null;
    $amount          = isset($data['amount']) && $data['amount'] !== '' ? (float) $data['amount'] : null;
    $percentage      = isset($data['percentage']) && $data['percentage'] !== '' ? (float) $data['percentage'] : null;
    $commissionType  = trim($data['commission_type'] ?? '');
    $status          = trim($data['status'] ?? 'pending');
    $notes           = trim($data['notes'] ?? '') ?: null;
    $dueDate         = trim($data['due_date'] ?? '') ?: null;
    $paidAt          = trim($data['paid_at'] ?? '') ?: null;

    if ($adminUserId <= 0) apiError('Agente obbligatorio.');
    if ($amount === null || $amount < 0) apiError('Importo non valido.');
    if (!in_array($commissionType, COMMISSION_TYPES, true)) apiError('Tipo commissione non valido.');
    if (!in_array($status, COMMISSION_STATUSES, true)) apiError('Stato non valido.');
    if ($dueDate !== null && !DateTime::createFromFormat('Y-m-d', $dueDate)) apiError('Data scadenza non valida.');
    if ($percentage !== null && ($percentage < 0 || $percentage > 100)) apiError('Percentuale non valida.');

    return [
        'admin_user_id'   => $adminUserId,
        'contract_id'     => $contractId,
        'property_id'     => $propertyId,
        'client_id'       => $clientId,
        'amount'          => $amount,
        'percentage'      => $percentage,
        'commission_type' => $commissionType,
        'status'          => $status,
        'notes'           => $notes,
        'due_date'        => $dueDate,
        'paid_at'         => $paidAt,
    ];
}
