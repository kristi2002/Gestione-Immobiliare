<?php
/**
 * Payments (Scadenzario Affitti) CRUD API.
 *
 * GET    /api/payments.php                       — list (tenant_id, property_id, status, month, year)
 * GET    /api/payments.php?id={id}               — single payment
 * POST   /api/payments.php                       — create
 * PUT    /api/payments.php?id={id}               — update (mark paid, etc.)
 * DELETE /api/payments.php?id={id}               — soft-cancel
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();

const PAYMENT_STATUSES = ['pending', 'paid', 'late', 'cancelled'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            $id ? getPayment($db, $id) : listPayments($db);
            break;
        case 'POST':
            createPayment($db);
            break;
        case 'PUT':
            if (!$id) apiError('ID pagamento mancante.');
            updatePayment($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID pagamento mancante.');
            cancelPayment($db, $id);
            break;
        default:
            apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    if ($e->getCode() === '23000') {
        apiError('Operazione non consentita: esistono record collegati a questo elemento. Rimuoverli prima di procedere.', 409);
    }
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function listPayments(PDO $db): void
{
    $pagination = apiGetPagination();
    $tenantId   = isset($_GET['tenant_id']) ? (int) $_GET['tenant_id'] : null;
    $propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : null;
    $status     = trim($_GET['status'] ?? '');
    $month      = isset($_GET['month']) && $_GET['month'] !== '' ? (int) $_GET['month'] : null;
    $year       = isset($_GET['year']) && $_GET['year'] !== '' ? (int) $_GET['year'] : null;

    $where = 'WHERE 1=1';
    $params = [];

    if ($tenantId) {
        $where .= ' AND pay.tenant_id = :tenant_id';
        $params['tenant_id'] = $tenantId;
    }
    if ($propertyId) {
        $where .= ' AND pay.property_id = :property_id';
        $params['property_id'] = $propertyId;
    }
    if ($status !== '' && in_array($status, PAYMENT_STATUSES, true)) {
        $where .= ' AND pay.status = :status';
        $params['status'] = $status;
    }
    if ($month !== null && $month >= 1 && $month <= 12) {
        $where .= ' AND MONTH(pay.due_date) = :month';
        $params['month'] = $month;
    }
    if ($year !== null) {
        $where .= ' AND YEAR(pay.due_date) = :year';
        $params['year'] = $year;
    }

    $countSql = "SELECT COUNT(*) FROM payments pay $where";

    $dataSql = "SELECT pay.*, t.name AS tenant_name, t.surname AS tenant_surname,
                   p.address AS property_address, p.city AS property_city
            FROM payments pay
            INNER JOIN tenants t ON t.id = pay.tenant_id
            INNER JOIN properties p ON p.id = pay.property_id
            LEFT JOIN contracts ct ON ct.id = pay.contract_id
            $where
            ORDER BY pay.due_date DESC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getPayment(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT pay.*, t.name AS tenant_name, t.surname AS tenant_surname,
                p.address AS property_address, p.city AS property_city
         FROM payments pay
         INNER JOIN tenants t ON t.id = pay.tenant_id
         INNER JOIN properties p ON p.id = pay.property_id
         WHERE pay.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();

    if (!$row) {
        apiError('Pagamento non trovato.', 404);
    }

    apiSuccess($row);
}

function createPayment(PDO $db): void
{
    $data      = apiGetJsonBody();
    $validated = validatePaymentInput($data);

    $stmt = $db->prepare(
        "INSERT INTO payments
            (tenant_id, property_id, contract_id, amount, due_date, paid_date, status, notes)
         VALUES
            (:tenant_id, :property_id, :contract_id, :amount, :due_date, :paid_date, :status, :notes)"
    );
    $stmt->execute($validated);

    $newId = (int) $db->lastInsertId();
    logActivity('create', 'payment', $newId, 'Pagamento creato di € ' . $validated['amount']);
    getPayment($db, $newId);
}

function updatePayment(PDO $db, int $id): void
{
    if (!paymentExists($db, $id)) {
        apiError('Pagamento non trovato.', 404);
    }

    $data      = apiGetJsonBody();
    $validated = validatePaymentInput($data);

    $stmt = $db->prepare(
        "UPDATE payments
         SET tenant_id = :tenant_id, property_id = :property_id, contract_id = :contract_id,
             amount = :amount, due_date = :due_date, paid_date = :paid_date, status = :status, notes = :notes
         WHERE id = :id"
    );
    $stmt->execute(array_merge($validated, ['id' => $id]));

    logActivity('update', 'payment', $id, 'Pagamento aggiornato #' . $id . ' (' . $validated['status'] . ')');
    getPayment($db, $id);
}

function cancelPayment(PDO $db, int $id): void
{
    if (!paymentExists($db, $id)) {
        apiError('Pagamento non trovato.', 404);
    }

    $stmt = $db->prepare("UPDATE payments SET status = 'cancelled' WHERE id = :id");
    $stmt->execute(['id' => $id]);

    logActivity('delete', 'payment', $id, 'Pagamento annullato #' . $id);
    apiSuccess(['id' => $id, 'message' => 'Pagamento annullato.']);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validatePaymentInput(array $data): array
{
    $tenantId   = (int) ($data['tenant_id'] ?? 0);
    $propertyId = (int) ($data['property_id'] ?? 0);
    $contractId = isset($data['contract_id']) && $data['contract_id'] !== '' && $data['contract_id'] !== null
        ? (int) $data['contract_id'] : null;
    $amount     = isset($data['amount']) && $data['amount'] !== '' ? (float) $data['amount'] : null;
    $dueDate    = trim($data['due_date'] ?? '');
    $paidDate   = trim($data['paid_date'] ?? '') ?: null;
    $status     = trim($data['status'] ?? 'pending');
    $notes      = trim($data['notes'] ?? '') ?: null;

    if ($tenantId <= 0) {
        apiError('Seleziona un inquilino.');
    }
    if ($propertyId <= 0) {
        apiError('Seleziona un immobile.');
    }
    if ($amount === null || $amount < 0) {
        apiError('Importo non valido.');
    }
    if ($dueDate === '' || !DateTime::createFromFormat('Y-m-d', $dueDate)) {
        apiError('Data di scadenza non valida.');
    }
    if ($paidDate !== null && !DateTime::createFromFormat('Y-m-d', $paidDate)) {
        apiError('Data di pagamento non valida.');
    }
    if (!in_array($status, PAYMENT_STATUSES, true)) {
        apiError('Stato non valido.');
    }

    // Marking as paid without a paid_date defaults to today.
    if ($status === 'paid' && $paidDate === null) {
        $paidDate = date('Y-m-d');
    }

    return [
