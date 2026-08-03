<?php
/**
 * Payments (Scadenzario Affitti) CRUD API.
 *
 * GET    /api/payments.php                       — list (tenant_id, property_id, contract_id, status, month, year)
 * GET    /api/payments.php?id={id}               — single payment
 * POST   /api/payments.php                       — create
 * PUT    /api/payments.php?id={id}               — update (mark paid, etc.)
 * DELETE /api/payments.php?id={id}               — soft-cancel
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();

const PAYMENT_STATUSES = ['pending', 'paid', 'late', 'cancelled'];

/**
 * "In ritardo" is a DERIVED state, not just a column value.
 *
 * Nothing in the app routinely flips `status` to 'late' — the only writer is
 * api/payment_reminder_log.php, as a side effect of logging a reminder. So an
 * unpaid payment past its due date almost always still reads 'pending'.
 *
 * The KPI strip on the payments page has always computed "late" as
 * (status='late' OR overdue pending), while the status filter matched only the
 * literal column — so the stat said "€ 4.500 (5)" and the "In ritardo" filter
 * came back nearly empty. These two constants are the single definition both
 * the stats and the list filter now use, so the numbers agree.
 *
 * They also partition the unpaid set: an overdue payment is "in ritardo" and is
 * therefore NOT also counted as "in attesa".
 */
const SQL_IS_LATE    = "(pay.status = 'late' OR (pay.status = 'pending' AND pay.due_date < CURDATE()))";
const SQL_IS_PENDING = "(pay.status = 'pending' AND pay.due_date >= CURDATE())";

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            if (($_GET['action'] ?? '') === 'stats') {
                paymentStats($db);
            }
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

function paymentStats(PDO $db): void
{
    $paidMonth = (float) $db->query(
        "SELECT COALESCE(SUM(amount),0) FROM payments
         WHERE status = 'paid'
           AND COALESCE(paid_date, due_date) >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
           AND COALESCE(paid_date, due_date) <= LAST_DAY(CURDATE())"
    )->fetchColumn();
    // "In attesa (mese)" excludes anything already overdue — those are counted by
    // the "In ritardo" stat below, and a payment must not appear under both.
    $pendingMonth = (float) $db->query(
        "SELECT COALESCE(SUM(amount),0) FROM payments pay
         WHERE " . SQL_IS_PENDING . "
           AND pay.due_date BETWEEN DATE_FORMAT(CURDATE(), '%Y-%m-01') AND LAST_DAY(CURDATE())"
    )->fetchColumn();
    $lateTotal = (float) $db->query(
        "SELECT COALESCE(SUM(amount),0) FROM payments pay WHERE " . SQL_IS_LATE
    )->fetchColumn();
    $lateCount = (int) $db->query(
        "SELECT COUNT(*) FROM payments pay WHERE " . SQL_IS_LATE
    )->fetchColumn();
    $yearPaid = (float) $db->query(
        "SELECT COALESCE(SUM(amount),0) FROM payments
         WHERE status = 'paid' AND YEAR(COALESCE(paid_date, due_date)) = YEAR(CURDATE())"
    )->fetchColumn();

    apiSuccess([
        'paid_month'    => $paidMonth,
        'pending_month' => $pendingMonth,
        'late_total'    => $lateTotal,
        'late_count'    => $lateCount,
        'year_paid'     => $yearPaid,
    ]);
}

function listPayments(PDO $db): void
{
    $pagination = apiGetPagination();
    $tenantId   = isset($_GET['tenant_id']) ? (int) $_GET['tenant_id'] : null;
    $propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : null;
    // Le rate NASCONO da un contratto (contracts.php?action=generate_payments le
    // scrive con contract_id), quindi chiederle per contratto e' la domanda piu'
    // naturale che si possa fare a questo elenco. Non era implementata: il
    // parametro veniva accettato e ignorato, e la risposta era l'intero
    // scadenzario dell'agenzia — con l'aria di essere quello del contratto.
    $contractId = isset($_GET['contract_id']) ? (int) $_GET['contract_id'] : null;
    $status     = trim($_GET['status'] ?? '');
    $search     = trim($_GET['search'] ?? '');
    $month      = isset($_GET['month']) && $_GET['month'] !== '' ? (int) $_GET['month'] : null;
    $year       = isset($_GET['year']) && $_GET['year'] !== '' ? (int) $_GET['year'] : null;

    $where = 'WHERE 1=1';
    $params = [];

    // Le stesse join per il conteggio e per i dati. Erano due query diverse (il
    // conteggio sulla sola tabella payments), quindi la ricerca su inquilino o
    // indirizzo avrebbe fatto esplodere il COUNT su colonne inesistenti.
    $joins = ' INNER JOIN tenants t ON t.id = pay.tenant_id
               INNER JOIN properties p ON p.id = pay.property_id
               LEFT JOIN contracts ct ON ct.id = pay.contract_id';

    if ($tenantId) {
        $where .= ' AND pay.tenant_id = :tenant_id';
        $params['tenant_id'] = $tenantId;
    }
    if ($propertyId) {
        $where .= ' AND pay.property_id = :property_id';
        $params['property_id'] = $propertyId;
    }
    if ($contractId) {
        $where .= ' AND pay.contract_id = :contract_id';
        $params['contract_id'] = $contractId;
    }
    if ($status !== '' && in_array($status, PAYMENT_STATUSES, true)) {
        // 'late' and 'pending' are derived (see SQL_IS_LATE / SQL_IS_PENDING) so the
        // filter agrees with the KPI strip; 'paid' and 'cancelled' are plain columns.
        if ($status === 'late') {
            $where .= ' AND ' . SQL_IS_LATE;
        } elseif ($status === 'pending') {
            $where .= ' AND ' . SQL_IS_PENDING;
        } else {
            $where .= ' AND pay.status = :status';
            $params['status'] = $status;
        }
    }
    if ($month !== null && $month >= 1 && $month <= 12) {
        $where .= ' AND MONTH(pay.due_date) = :month';
        $params['month'] = $month;
    }
    if ($year !== null) {
        $where .= ' AND YEAR(pay.due_date) = :year';
        $params['year'] = $year;
    }
    if ($search !== '') {
        $frag = apiWordSearch($search, [
            't.name', 't.surname', 'p.address', 'p.city', 'ct.title', 'pay.notes',
        ], $params, 'pays');
        if ($frag !== '') $where .= " AND ($frag)";
    }

    $countSql = "SELECT COUNT(*) FROM payments pay $joins $where";

    $dataSql = "SELECT pay.*, " . SQL_IS_LATE . " AS is_late,
                   t.name AS tenant_name, t.surname AS tenant_surname,
                   p.address AS property_address, p.city AS property_city
            FROM payments pay
            $joins
            $where
            ORDER BY pay.due_date DESC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getPayment(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT pay.*, " . SQL_IS_LATE . " AS is_late,
                t.name AS tenant_name, t.surname AS tenant_surname,
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
            (tenant_id, property_id, contract_id, amount, due_date, paid_date, status, notes, method)
         VALUES
            (:tenant_id, :property_id, :contract_id, :amount, :due_date, :paid_date, :status, :notes, :method)"
    );
    $stmt->execute($validated);

    $newId = (int) $db->lastInsertId();
    // Il valore grezzo finiva nel registro come "€ 1235": e' l'unico importo
    // del lato server che non passava da number_format, e si leggeva accanto
    // alle righe formattate del resto dell'app.
    logActivity('create', 'payment', $newId, 'Pagamento creato di € ' . number_format((float) $validated['amount'], 2, ',', '.'));
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
             amount = :amount, due_date = :due_date, paid_date = :paid_date, status = :status,
             notes = :notes, method = :method
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
    $methods    = ['bonifico', 'sdd', 'mav', 'contanti', 'assegno', 'pos', 'stripe', 'altro'];
    $method     = trim($data['method'] ?? 'bonifico');
    if (!in_array($method, $methods, true)) $method = 'bonifico';

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
        'tenant_id'   => $tenantId,
        'property_id' => $propertyId,
        'contract_id' => $contractId,
        'amount'      => $amount,
        'due_date'    => $dueDate,
        'paid_date'   => $paidDate,
        'status'      => $status,
        'notes'       => $notes,
        'method'      => $method,
    ];
}

function paymentExists(PDO $db, int $id): bool
{
    $stmt = $db->prepare("SELECT id FROM payments WHERE id = :id");
    $stmt->execute(['id' => $id]);
    return (bool) $stmt->fetch();
}
