<?php
/**
 * Supplier / Contractor Directory CRUD API.
 *
 * GET    /api/suppliers.php             — paginated list (category, search)
 * GET    /api/suppliers.php?id={id}     — single supplier
 * POST   /api/suppliers.php             — create
 * PUT    /api/suppliers.php?id={id}     — update
 * DELETE /api/suppliers.php?id={id}     — soft-delete (is_active = 0)
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
apiHandleOptions();

const SUPPLIER_CATEGORIES = ['idraulico','elettricista','muratore','falegname','imbianchino','giardiniere','pulizie','altro'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            $id ? getSupplier($db, $id) : listSuppliers($db);
            break;
        case 'POST':
            createSupplier($db);
            break;
        case 'PUT':
            if (!$id) apiError('ID fornitore mancante.');
            updateSupplier($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID fornitore mancante.');
            deleteSupplier($db, $id);
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

function listSuppliers(PDO $db): void
{
    $pagination = apiGetPagination();
    $category   = trim($_GET['category'] ?? '');
    $search     = trim($_GET['search'] ?? '');
    $activeOnly = !isset($_GET['include_inactive']);

    $where  = 'WHERE 1=1';
    $params = [];

    if ($activeOnly) {
        $where .= ' AND s.is_active = 1';
    }
    if ($category !== '' && in_array($category, SUPPLIER_CATEGORIES, true)) {
        $where .= ' AND s.category = :category';
        $params['category'] = $category;
    }
    if ($search !== '') {
        $where .= ' AND (s.name LIKE :search OR s.phone LIKE :search OR s.email LIKE :search)';
        $params['search'] = '%' . $search . '%';
    }

    $countSql = "SELECT COUNT(*) FROM suppliers s $where";
    $dataSql  = "SELECT s.* FROM suppliers s $where ORDER BY s.name ASC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getSupplier(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT * FROM suppliers WHERE id = :id");
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();

    if (!$row) {
        apiError('Fornitore non trovato.', 404);
    }

    apiSuccess($row);
}

function createSupplier(PDO $db): void
{
    $data      = apiGetJsonBody();
    $validated = validateSupplierInput($data);

    $stmt = $db->prepare(
        "INSERT INTO suppliers (name, category, phone, email, address, notes, rating, is_active)
         VALUES (:name, :category, :phone, :email, :address, :notes, :rating, :is_active)"
    );
    $stmt->execute($validated);

    $newId = (int) $db->lastInsertId();
    logActivity('create', 'supplier', $newId, 'Fornitore creato: ' . $validated['name']);
    getSupplier($db, $newId);
}

function updateSupplier(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT id FROM suppliers WHERE id = :id");
    $stmt->execute(['id' => $id]);
    if (!$stmt->fetch()) {
        apiError('Fornitore non trovato.', 404);
    }

    $data      = apiGetJsonBody();
    $validated = validateSupplierInput($data);

    $stmt = $db->prepare(
        "UPDATE suppliers
         SET name = :name, category = :category, phone = :phone, email = :email,
             address = :address, notes = :notes, rating = :rating, is_active = :is_active
         WHERE id = :id"
    );
    $stmt->execute(array_merge($validated, ['id' => $id]));

    logActivity('update', 'supplier', $id, 'Fornitore aggiornato: ' . $validated['name']);
    getSupplier($db, $id);
}

function deleteSupplier(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT id FROM suppliers WHERE id = :id");
    $stmt->execute(['id' => $id]);
    if (!$stmt->fetch()) {
        apiError('Fornitore non trovato.', 404);
    }

    $db->prepare("UPDATE suppliers SET is_active = 0 WHERE id = :id")->execute(['id' => $id]);

    logActivity('delete', 'supplier', $id, 'Fornitore disattivato #' . $id);
    apiSuccess(['id' => $id, 'message' => 'Fornitore disattivato.']);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateSupplierInput(array $data): array
{
    $name     = trim($data['name'] ?? '');
    $category = trim($data['category'] ?? '');
    $phone    = trim($data['phone'] ?? '') ?: null;
    $email    = trim($data['email'] ?? '') ?: null;
    $address  = trim($data['address'] ?? '') ?: null;
    $notes    = trim($data['notes'] ?? '') ?: null;
    $rating   = isset($data['rating']) && $data['rating'] !== '' ? (int) $data['rating'] : null;
    $isActive = isset($data['is_active']) ? (int) (bool) $data['is_active'] : 1;

    if ($name === '') apiError('Il nome del fornitore è obbligatorio.');
    if (!in_array($category, SUPPLIER_CATEGORIES, true)) apiError('Categoria non valida.');
    if ($email !== null && !filter_var($email, FILTER_VALIDATE_EMAIL)) apiError('Email non valida.');
    if ($rating !== null && ($rating < 1 || $rating > 5)) apiError('Il rating deve essere tra 1 e 5.');

    return [
        'name'      => $name,
        'category'  => $category,
        'phone'     => $phone,
        'email'     => $email,
        'address'   => $address,
        'notes'     => $notes,
        'rating'    => $rating,
        'is_active' => $isActive,
    ];
}
