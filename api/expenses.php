<?php
/**
 * Expenses (Gestione Spese) CRUD API.
 *
 * GET    /api/expenses.php                        — list (property_id, client_id, category, year)
 * GET    /api/expenses.php?id={id}                — single expense
 * POST   /api/expenses.php                        — create
 * PUT    /api/expenses.php?id={id}                — update
 * DELETE /api/expenses.php?id={id}                — delete
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();

const EXPENSE_CATEGORIES = ['manutenzione', 'utenze', 'tasse', 'assicurazione', 'agenzia', 'altro'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            $id ? getExpense($db, $id) : listExpenses($db);
            break;
        case 'POST':
            createExpense($db);
            break;
        case 'PUT':
            if (!$id) apiError('ID spesa mancante.');
            updateExpense($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID spesa mancante.');
            deleteExpense($db, $id);
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

function listExpenses(PDO $db): void
{
    $pagination = apiGetPagination();
    $propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : null;
    $clientId   = isset($_GET['client_id']) ? (int) $_GET['client_id'] : null;
    $supplierId = isset($_GET['supplier_id']) ? (int) $_GET['supplier_id'] : null;
    $category   = trim($_GET['category'] ?? '');
    $year       = isset($_GET['year']) && $_GET['year'] !== '' ? (int) $_GET['year'] : null;

    $where = 'WHERE 1=1';
    $params = [];

    if ($propertyId) {
        $where .= ' AND e.property_id = :property_id';
        $params['property_id'] = $propertyId;
    }
    if ($clientId) {
        $where .= ' AND e.client_id = :client_id';
        $params['client_id'] = $clientId;
    }
    if ($supplierId) {
        $where .= ' AND e.supplier_id = :supplier_id';
        $params['supplier_id'] = $supplierId;
    }
    if ($category !== '' && in_array($category, EXPENSE_CATEGORIES, true)) {
        $where .= ' AND e.category = :category';
        $params['category'] = $category;
    }
    if ($year !== null) {
        $where .= ' AND YEAR(e.expense_date) = :year';
        $params['year'] = $year;
    }

    $countSql = "SELECT COUNT(*) FROM expenses e $where";

    $dataSql = "SELECT e.*, p.address AS property_address, p.city AS property_city,
                   c.name AS client_name, c.surname AS client_surname,
                   s.name AS supplier_name
            FROM expenses e
            LEFT JOIN properties p ON p.id = e.property_id
            LEFT JOIN clients c ON c.id = e.client_id
            LEFT JOIN suppliers s ON s.id = e.supplier_id
            $where
            ORDER BY e.expense_date DESC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getExpense(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT e.*, p.address AS property_address, p.city AS property_city,
                c.name AS client_name, c.surname AS client_surname,
                s.name AS supplier_name
         FROM expenses e
         LEFT JOIN properties p ON p.id = e.property_id
         LEFT JOIN clients c ON c.id = e.client_id
         LEFT JOIN suppliers s ON s.id = e.supplier_id
         WHERE e.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();

    if (!$row) {
        apiError('Spesa non trovata.', 404);
    }

    apiSuccess($row);
}

function createExpense(PDO $db): void
{
    $data      = apiGetJsonBody();
    $validated = validateExpenseInput($data);
    $validated['created_by'] = getCurrentAdminId() ?: null;

    $stmt = $db->prepare(
        "INSERT INTO expenses
            (property_id, client_id, supplier_id, category, description, amount, expense_date, receipt_url, notes, created_by)
         VALUES
            (:property_id, :client_id, :supplier_id, :category, :description, :amount, :expense_date, :receipt_url, :notes, :created_by)"
    );
    $stmt->execute($validated);

    $newId = (int) $db->lastInsertId();
    logActivity('create', 'expense', $newId, 'Spesa creata: ' . $validated['description']);
    getExpense($db, $newId);
}

function updateExpense(PDO $db, int $id): void
{
    if (!expenseExists($db, $id)) {
        apiError('Spesa non trovata.', 404);
    }

    $data      = apiGetJsonBody();
    $validated = validateExpenseInput($data);

    $stmt = $db->prepare(
        "UPDATE expenses
         SET property_id = :property_id, client_id = :client_id, supplier_id = :supplier_id, category = :category,
             description = :description, amount = :amount, expense_date = :expense_date,
             receipt_url = :receipt_url, notes = :notes
         WHERE id = :id"
    );
    $stmt->execute(array_merge($validated, ['id' => $id]));

    logActivity('update', 'expense', $id, 'Spesa aggiornata #' . $id);
    getExpense($db, $id);
}

function deleteExpense(PDO $db, int $id): void
{
    if (!expenseExists($db, $id)) {
        apiError('Spesa non trovata.', 404);
    }

    $stmt = $db->prepare("DELETE FROM expenses WHERE id = :id");
    $stmt->execute(['id' => $id]);

    logActivity('delete', 'expense', $id, 'Spesa eliminata #' . $id);
    apiSuccess(['id' => $id, 'message' => 'Spesa eliminata.']);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateExpenseInput(array $data): array
{
    $propertyId  = !empty($data['property_id']) ? (int) $data['property_id'] : null;
    $clientId    = !empty($data['client_id']) ? (int) $data['client_id'] : null;
    $supplierId  = !empty($data['supplier_id']) ? (int) $data['supplier_id'] : null;
    $category    = trim($data['category'] ?? 'altro');
    $description = trim($data['description'] ?? '');
    $amount      = isset($data['amount']) && $data['amount'] !== '' ? (float) $data['amount'] : null;
    $expenseDate = trim($data['expense_date'] ?? '');
    $receiptUrl  = trim($data['receipt_url'] ?? '') ?: null;
    $notes       = trim($data['notes'] ?? '') ?: null;

    if ($description === '') {
        apiError('La descrizione è obbligatoria.');
    }
    if ($amount === null || $amount < 0) {
        apiError('Importo non valido.');
    }
    if ($expenseDate === '' || !DateTime::createFromFormat('Y-m-d', $expenseDate)) {
        apiError('Data spesa non valida.');
    }
    if (!in_array($category, EXPENSE_CATEGORIES, true)) {
        apiError('Categoria non valida.');
    }

    return [
        'property_id'  => $propertyId,
        'client_id'    => $clientId,
        'supplier_id'  => $supplierId,
        'category'     => $category,
        'description'  => $description,
        'amount'       => $amount,
        'expense_date' => $expenseDate,
        'receipt_url'  => $receiptUrl,
        'notes'        => $notes,
    ];
}

function expenseExists(PDO $db, int $id): bool
{
    $stmt = $db->prepare("SELECT id FROM expenses WHERE id = :id");
    $stmt->execute(['id' => $id]);
    return (bool) $stmt->fetch();
}
