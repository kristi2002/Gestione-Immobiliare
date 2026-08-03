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

const EXPENSE_CATEGORIES = ['manutenzione', 'utenze', 'tasse', 'assicurazione', 'agenzia', 'condominio', 'altro'];

/**
 * Le quote di una ripartizione millesimale (phase77) sono figlie della spesa
 * condominiale che le ha generate: la fattura pagata e' UNA, la riga padre.
 * Sommare padre e figlie conterebbe gli stessi soldi due volte, quindi le
 * figlie restano fuori dai totali e dall'elenco generale; compaiono solo
 * quando si guarda l'immobile (o l'edificio) a cui sono state imputate.
 */
const CHILD_EXPENSE_EXCLUSION = ' AND e.parent_expense_id IS NULL';

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            if (($_GET['action'] ?? '') === 'stats') {
                // Ogni riga esclude le quote-figlie: sono la stessa spesa vista
                // per unita', e sommarle al padre raddoppierebbe ogni totale.
                apiSuccess([
                    'month_total' => (float) $db->query("SELECT COALESCE(SUM(e.amount),0) FROM expenses e WHERE e.expense_date BETWEEN DATE_FORMAT(CURDATE(), '%Y-%m-01') AND LAST_DAY(CURDATE())" . CHILD_EXPENSE_EXCLUSION)->fetchColumn(),
                    'year_total'  => (float) $db->query('SELECT COALESCE(SUM(e.amount),0) FROM expenses e WHERE YEAR(e.expense_date) = YEAR(CURDATE())' . CHILD_EXPENSE_EXCLUSION)->fetchColumn(),
                    'count_month' => (int) $db->query("SELECT COUNT(*) FROM expenses e WHERE e.expense_date BETWEEN DATE_FORMAT(CURDATE(), '%Y-%m-01') AND LAST_DAY(CURDATE())" . CHILD_EXPENSE_EXCLUSION)->fetchColumn(),
                    'top_category'=> (string) ($db->query("SELECT e.category FROM expenses e WHERE YEAR(e.expense_date) = YEAR(CURDATE())" . CHILD_EXPENSE_EXCLUSION . " GROUP BY e.category ORDER BY SUM(e.amount) DESC LIMIT 1")->fetchColumn() ?: '—'),
                ]);
            }
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
    $buildingId = isset($_GET['building_id']) ? (int) $_GET['building_id'] : null;
    $parentId   = isset($_GET['parent_expense_id']) ? (int) $_GET['parent_expense_id'] : null;
    $category   = trim($_GET['category'] ?? '');
    $year       = isset($_GET['year']) && $_GET['year'] !== '' ? (int) $_GET['year'] : null;

    $where = 'WHERE 1=1';
    $params = [];

    if ($propertyId) {
        $where .= ' AND e.property_id = :property_id';
        $params['property_id'] = $propertyId;
    }
    if ($buildingId) {
        $where .= ' AND e.building_id = :building_id';
        $params['building_id'] = $buildingId;
    }
    if ($parentId) {
        $where .= ' AND e.parent_expense_id = :parent_expense_id';
        $params['parent_expense_id'] = $parentId;
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

    // Le quote-figlie compaiono solo quando si sta guardando proprio il posto in
    // cui sono state imputate: un immobile, un edificio, o la ripartizione stessa.
    // Nell'elenco generale sono rumore che raddoppia gli importi.
    if (!$propertyId && !$buildingId && !$parentId) {
        $where .= CHILD_EXPENSE_EXCLUSION;
    }

    $countSql = "SELECT COUNT(*) FROM expenses e $where";

    $dataSql = "SELECT e.*, p.address AS property_address, p.city AS property_city,
                   c.name AS client_name, c.surname AS client_surname,
                   s.name AS supplier_name, b.name AS building_name,
                   (SELECT COUNT(*) FROM expenses ch WHERE ch.parent_expense_id = e.id) AS allocation_count
            FROM expenses e
            LEFT JOIN properties p ON p.id = e.property_id
            LEFT JOIN clients c ON c.id = e.client_id
            LEFT JOIN suppliers s ON s.id = e.supplier_id
            LEFT JOIN buildings b ON b.id = e.building_id
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
                s.name AS supplier_name, b.name AS building_name,
                (SELECT COUNT(*) FROM expenses ch WHERE ch.parent_expense_id = e.id) AS allocation_count,
                (SELECT COALESCE(SUM(ch.amount),0) FROM expenses ch WHERE ch.parent_expense_id = e.id) AS allocated_total
         FROM expenses e
         LEFT JOIN properties p ON p.id = e.property_id
         LEFT JOIN clients c ON c.id = e.client_id
         LEFT JOIN suppliers s ON s.id = e.supplier_id
         LEFT JOIN buildings b ON b.id = e.building_id
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
            (property_id, building_id, client_id, supplier_id, category, description, amount, expense_date, receipt_url, notes, created_by)
         VALUES
            (:property_id, :building_id, :client_id, :supplier_id, :category, :description, :amount, :expense_date, :receipt_url, :notes, :created_by)"
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

    // Una quota millesimale non si modifica a mano: il suo importo e' un
    // ventiseiesimo calcolato di una fattura, e ritoccarlo scollegherebbe in
    // silenzio la somma delle quote dall'importo davvero pagato. Si cambia la
    // tabella millesimale (o la spesa padre) e si ri-lancia la ripartizione.
    $parent = $db->prepare('SELECT parent_expense_id FROM expenses WHERE id = :id');
    $parent->execute(['id' => $id]);
    if ((int) $parent->fetchColumn() > 0) {
        apiError('Questa è una quota di ripartizione millesimale: modifica la spesa condominiale di origine e ri-esegui la ripartizione.', 409);
    }

    $data      = apiGetJsonBody();
    $validated = validateExpenseInput($data);

    $stmt = $db->prepare(
        "UPDATE expenses
         SET property_id = :property_id, building_id = :building_id, client_id = :client_id,
             supplier_id = :supplier_id, category = :category,
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

    // Le eventuali quote-figlie se ne vanno con il padre (FK CASCADE, phase77):
    // sono l'imputazione di una fattura che non esiste piu'. Lo diciamo nel
    // messaggio, perche' l'agente non se lo aspetta guardando una riga sola.
    $kids = $db->prepare('SELECT COUNT(*) FROM expenses WHERE parent_expense_id = :id');
    $kids->execute(['id' => $id]);
    $childCount = (int) $kids->fetchColumn();

    $stmt = $db->prepare("DELETE FROM expenses WHERE id = :id");
    $stmt->execute(['id' => $id]);

    logActivity('delete', 'expense', $id, 'Spesa eliminata #' . $id
        . ($childCount ? " (e $childCount quote millesimali collegate)" : ''));
    apiSuccess([
        'id'      => $id,
        'message' => 'Spesa eliminata.' . ($childCount ? " Rimosse anche $childCount quote millesimali collegate." : ''),
    ]);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateExpenseInput(array $data): array
{
    $propertyId  = !empty($data['property_id']) ? (int) $data['property_id'] : null;
    $buildingId  = !empty($data['building_id']) ? (int) $data['building_id'] : null;
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
        'building_id'  => $buildingId,
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
