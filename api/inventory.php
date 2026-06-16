<?php
/**
 * Property Inventory (Furnished Items) CRUD API.
 *
 * GET    /api/inventory.php?property_id=X                 — list items (paginated)
 * GET    /api/inventory.php?property_id=X&checkin_report=1 — all items with condition
 * GET    /api/inventory.php?id={id}                       — single item
 * POST   /api/inventory.php                               — create
 * PUT    /api/inventory.php?id={id}                       — update
 * DELETE /api/inventory.php?id={id}                       — delete
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
apiHandleOptions();

const INVENTORY_CATEGORIES = ['mobile','elettrodomestico','arredamento','impianto','altro'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            if (!$id && !empty($_GET['checkin_report']) && isset($_GET['property_id'])) {
                getCheckinReport($db, (int) $_GET['property_id']);
            } elseif ($id) {
                getInventoryItem($db, $id);
            } else {
                listInventory($db);
            }
            break;
        case 'POST':
            createInventoryItem($db);
            break;
        case 'PUT':
            if (!$id) apiError('ID articolo mancante.');
            updateInventoryItem($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID articolo mancante.');
            deleteInventoryItem($db, $id);
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

function listInventory(PDO $db): void
{
    $pagination = apiGetPagination();
    $propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : null;
    $category   = trim($_GET['category'] ?? '');

    $where  = 'WHERE 1=1';
    $params = [];

    if ($propertyId) {
        $where .= ' AND pi.property_id = :property_id';
        $params['property_id'] = $propertyId;
    }
    if ($category !== '' && in_array($category, INVENTORY_CATEGORIES, true)) {
        $where .= ' AND pi.category = :category';
        $params['category'] = $category;
    }

    $countSql = "SELECT COUNT(*) FROM property_inventory pi $where";

    $dataSql = "SELECT pi.*, p.address AS property_address, p.city AS property_city
            FROM property_inventory pi
            LEFT JOIN properties p ON p.id = pi.property_id
            $where
            ORDER BY pi.category ASC, pi.item_name ASC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getInventoryItem(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT pi.*, p.address AS property_address, p.city AS property_city
         FROM property_inventory pi
         LEFT JOIN properties p ON p.id = pi.property_id
         WHERE pi.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();

    if (!$row) {
        apiError('Articolo non trovato.', 404);
    }

    apiSuccess($row);
}

function getCheckinReport(PDO $db, int $propertyId): void
{
    $stmt = $db->prepare(
        "SELECT pi.*, p.address AS property_address, p.city AS property_city
         FROM property_inventory pi
         LEFT JOIN properties p ON p.id = pi.property_id
         WHERE pi.property_id = :property_id
         ORDER BY pi.category ASC, pi.item_name ASC"
    );
    $stmt->execute(['property_id' => $propertyId]);
    $items = $stmt->fetchAll();

    $propStmt = $db->prepare("SELECT address, city FROM properties WHERE id = :id");
    $propStmt->execute(['id' => $propertyId]);
    $property = $propStmt->fetch();

    apiSuccess([
        'property_id'      => $propertyId,
        'property_address' => $property['address'] ?? null,
        'property_city'    => $property['city'] ?? null,
        'report_date'      => date('Y-m-d'),
        'total_items'      => count($items),
        'items'            => $items,
    ]);
}

function createInventoryItem(PDO $db): void
{
    $data      = apiGetJsonBody();
    $validated = validateInventoryInput($data);

    $stmt = $db->prepare(
        "INSERT INTO property_inventory
            (property_id, item_name, category, quantity, condition_rating, notes, check_in_date, check_out_date)
         VALUES
            (:property_id, :item_name, :category, :quantity, :condition_rating, :notes, :check_in_date, :check_out_date)"
    );
    $stmt->execute($validated);

    $newId = (int) $db->lastInsertId();
    logActivity('create', 'inventory', $newId, 'Articolo inventario: ' . $validated['item_name']);
    getInventoryItem($db, $newId);
}

function updateInventoryItem(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT id FROM property_inventory WHERE id = :id");
    $stmt->execute(['id' => $id]);
    if (!$stmt->fetch()) {
        apiError('Articolo non trovato.', 404);
    }

    $data      = apiGetJsonBody();
    $validated = validateInventoryInput($data);

    $stmt = $db->prepare(
        "UPDATE property_inventory
         SET property_id = :property_id, item_name = :item_name, category = :category,
             quantity = :quantity, condition_rating = :condition_rating, notes = :notes,
             check_in_date = :check_in_date, check_out_date = :check_out_date
         WHERE id = :id"
    );
    $stmt->execute(array_merge($validated, ['id' => $id]));

    logActivity('update', 'inventory', $id, 'Articolo inventario aggiornato #' . $id);
    getInventoryItem($db, $id);
}

function deleteInventoryItem(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT id FROM property_inventory WHERE id = :id");
    $stmt->execute(['id' => $id]);
    if (!$stmt->fetch()) {
        apiError('Articolo non trovato.', 404);
    }

    $db->prepare("DELETE FROM property_inventory WHERE id = :id")->execute(['id' => $id]);

    logActivity('delete', 'inventory', $id, 'Articolo inventario eliminato #' . $id);
    apiSuccess(['id' => $id, 'message' => 'Articolo eliminato.']);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateInventoryInput(array $data): array
{
    $propertyId      = !empty($data['property_id']) ? (int) $data['property_id'] : 0;
    $itemName        = trim($data['item_name'] ?? '');
    $category        = trim($data['category'] ?? '');
    $quantity        = isset($data['quantity']) && $data['quantity'] !== '' ? (int) $data['quantity'] : 1;
    $conditionRating = isset($data['condition_rating']) && $data['condition_rating'] !== '' ? (int) $data['condition_rating'] : null;
    $notes           = trim($data['notes'] ?? '') ?: null;
    $checkInDate     = trim($data['check_in_date'] ?? '') ?: null;
    $checkOutDate    = trim($data['check_out_date'] ?? '') ?: null;

    if ($propertyId <= 0) apiError('Immobile obbligatorio.');
    if ($itemName === '') apiError('Nome articolo obbligatorio.');
    if (!in_array($category, INVENTORY_CATEGORIES, true)) apiError('Categoria non valida.');
    if ($quantity < 1) apiError('Quantità non valida.');
    if ($conditionRating !== null && ($conditionRating < 1 || $conditionRating > 5)) apiError('Condizione deve essere tra 1 e 5.');
    if ($checkInDate !== null && !DateTime::createFromFormat('Y-m-d', $checkInDate)) apiError('Data check-in non valida.');
    if ($checkOutDate !== null && !DateTime::createFromFormat('Y-m-d', $checkOutDate)) apiError('Data check-out non valida.');

    return [
        'property_id'      => $propertyId,
        'item_name'        => $itemName,
        'category'         => $category,
        'quantity'         => $quantity,
        'condition_rating' => $conditionRating,
        'notes'            => $notes,
        'check_in_date'    => $checkInDate,
        'check_out_date'   => $checkOutDate,
    ];
}
