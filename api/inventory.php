<?php
/**
 * Property Inventory (Furnished Items) CRUD API.
 *
 * GET    /api/inventory.php?property_id=X                 — list items (paginated)
 * GET    /api/inventory.php?property_id=X&checkin_report=1 — all items with condition
 * GET    /api/inventory.php?id={id}                       — single item
 * GET    /api/inventory.php?action=categories             — categorie configurate
 * POST   /api/inventory.php                               — create
 * PUT    /api/inventory.php?id={id}                       — update
 * DELETE /api/inventory.php?id={id}                       — delete
 *
 * Le categorie NON sono più una costante: vivono in `inventory_categories`
 * (phase78). Un'agenzia che affitta case vacanza aggiunge "Biancheria" con una
 * riga, e la stessa lista alimenta form, filtri e validazione — che era il modo
 * in cui l'ENUM e la costante PHP finivano per divergere.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/inventory_snapshots.php';
apiHandleOptions();

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;
    $action = trim($_GET['action'] ?? '');

    switch ($method) {
        case 'GET':
            if ($action === 'categories') {
                apiSuccess(inventoryCategories($db));
            } elseif (!$id && !empty($_GET['checkin_report']) && isset($_GET['property_id'])) {
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
    $propertyId   = isset($_GET['property_id']) ? (int) $_GET['property_id'] : null;
    $category     = trim($_GET['category'] ?? '');
    $minCondition = isset($_GET['min_condition']) && $_GET['min_condition'] !== '' ? (int) $_GET['min_condition'] : null;

    $where  = 'WHERE 1=1';
    $params = [];

    if ($propertyId) {
        $where .= ' AND pi.property_id = :property_id';
        $params['property_id'] = $propertyId;
    }
    if ($category !== '' && in_array($category, inventoryCategorySlugs($db), true)) {
        $where .= ' AND pi.category = :category';
        $params['category'] = $category;
    }
    if ($minCondition !== null && $minCondition >= 1 && $minCondition <= 5) {
        $where .= ' AND pi.condition_rating >= :min_condition';
        $params['min_condition'] = $minCondition;
    }

    $countSql = "SELECT COUNT(*) FROM property_inventory pi $where";

    $dataSql = "SELECT pi.*, p.address AS property_address, p.city AS property_city,
                   ic.label AS category_label,
                   (SELECT COUNT(*) FROM documents d WHERE d.inventory_item_id = pi.id) AS photo_count
            FROM property_inventory pi
            LEFT JOIN properties p ON p.id = pi.property_id
            LEFT JOIN inventory_categories ic ON ic.slug = pi.category
            $where
            ORDER BY pi.category ASC, pi.item_name ASC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getInventoryItem(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT pi.*, p.address AS property_address, p.city AS property_city,
                ic.label AS category_label
         FROM property_inventory pi
         LEFT JOIN properties p ON p.id = pi.property_id
         LEFT JOIN inventory_categories ic ON ic.slug = pi.category
         WHERE pi.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();

    if (!$row) {
        apiError('Articolo non trovato.', 404);
    }

    $row['photos']      = inventoryItemPhotos($db, $id);
    $row['photo_count'] = count($row['photos']);

    apiSuccess($row);
}

/**
 * Le foto del bene sono righe `documents`: stesso ramo protetto (deny Apache +
 * streamer autenticato + log GDPR) delle carte d'identità e delle letture
 * contatore. Qui si espone solo il metadato — il file passa da
 * download_document.php, che verifica chi sta chiedendo.
 */
function inventoryItemPhotos(PDO $db, int $itemId): array
{
    $stmt = $db->prepare(
        "SELECT id, original_name, mime_type, file_size, notes, created_at
           FROM documents
          WHERE inventory_item_id = :id
       ORDER BY created_at ASC, id ASC"
    );
    $stmt->execute(['id' => $itemId]);

    $photos = $stmt->fetchAll();
    foreach ($photos as &$p) {
        $p['download_url'] = 'api/download_document.php?id=' . $p['id'];
    }
    unset($p);

    return $photos;
}

function getCheckinReport(PDO $db, int $propertyId): void
{
    $stmt = $db->prepare(
        "SELECT pi.*, p.address AS property_address, p.city AS property_city,
                ic.label AS category_label,
                (SELECT COUNT(*) FROM documents d WHERE d.inventory_item_id = pi.id) AS photo_count
         FROM property_inventory pi
         LEFT JOIN properties p ON p.id = pi.property_id
         LEFT JOIN inventory_categories ic ON ic.slug = pi.category
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
            (property_id, item_name, category, quantity, condition_rating, notes, check_in_date, check_out_date,
             brand, model, serial_number, estimated_value, warranty_until)
         VALUES
            (:property_id, :item_name, :category, :quantity, :condition_rating, :notes, :check_in_date, :check_out_date,
             :brand, :model, :serial_number, :estimated_value, :warranty_until)"
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
             check_in_date = :check_in_date, check_out_date = :check_out_date,
             brand = :brand, model = :model, serial_number = :serial_number,
             estimated_value = :estimated_value, warranty_until = :warranty_until
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

    // La FK CASCADE toglie le righe `documents` delle foto, ma NON i file su
    // disco: resterebbero sotto uploads/documents/ senza più niente che li
    // colleghi a qualcosa — dati personali orfani. Stesso trattamento delle
    // foto contatore (phase75).
    require_once __DIR__ . '/../config/upload_guard.php';
    $photos = $db->prepare("SELECT id, file_path FROM documents WHERE inventory_item_id = :id");
    $photos->execute(['id' => $id]);
    $attached = $photos->fetchAll();

    foreach ($attached as $photo) {
        $fullPath = safeUploadRealPath((string) $photo['file_path']);
        if ($fullPath && is_file($fullPath)) {
            @unlink($fullPath);
        }
    }

    $db->prepare("DELETE FROM property_inventory WHERE id = :id")->execute(['id' => $id]);

    logActivity('delete', 'inventory', $id, 'Articolo inventario eliminato #' . $id
        . ($attached ? ' (con ' . count($attached) . ' foto)' : ''));
    apiSuccess(['id' => $id, 'message' => 'Articolo eliminato.']);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateInventoryInput(array $data): array
{
    $db              = getDB();
    $propertyId      = !empty($data['property_id']) ? (int) $data['property_id'] : 0;
    $itemName        = trim($data['item_name'] ?? '');
    $category        = trim($data['category'] ?? '');
    $quantity        = isset($data['quantity']) && $data['quantity'] !== '' ? (int) $data['quantity'] : 1;
    $conditionRating = isset($data['condition_rating']) && $data['condition_rating'] !== '' ? (int) $data['condition_rating'] : null;
    $notes           = trim($data['notes'] ?? '') ?: null;
    $checkInDate     = trim($data['check_in_date'] ?? '') ?: null;
    $checkOutDate    = trim($data['check_out_date'] ?? '') ?: null;
    $brand           = trim($data['brand'] ?? '') ?: null;
    $model           = trim($data['model'] ?? '') ?: null;
    $serialNumber    = trim($data['serial_number'] ?? '') ?: null;
    $estimatedValue  = isset($data['estimated_value']) && $data['estimated_value'] !== '' && $data['estimated_value'] !== null
        ? (float) $data['estimated_value'] : null;
    $warrantyUntil   = trim($data['warranty_until'] ?? '') ?: null;

    if ($propertyId <= 0) apiError('Immobile obbligatorio.');
    if ($itemName === '') apiError('Nome articolo obbligatorio.');
    // La lista viva, non una costante: se l'agenzia aggiunge "Biancheria" il
    // form la mostra e l'API la accetta nello stesso istante.
    if (!in_array($category, inventoryCategorySlugs($db), true)) apiError('Categoria non valida.');
    if ($quantity < 1) apiError('Quantità non valida.');
    if ($conditionRating !== null && ($conditionRating < 1 || $conditionRating > 5)) apiError('Condizione deve essere tra 1 e 5.');
    if ($checkInDate !== null && !DateTime::createFromFormat('!Y-m-d', $checkInDate)) apiError('Data check-in non valida.');
    if ($checkOutDate !== null && !DateTime::createFromFormat('!Y-m-d', $checkOutDate)) apiError('Data check-out non valida.');
    if ($warrantyUntil !== null && !DateTime::createFromFormat('!Y-m-d', $warrantyUntil)) apiError('Data garanzia non valida.');
    if ($estimatedValue !== null && ($estimatedValue < 0 || $estimatedValue > 99999999.99)) apiError('Valore stimato non valido.');

    return [
        'property_id'      => $propertyId,
        'item_name'        => $itemName,
        'category'         => $category,
        'quantity'         => $quantity,
        'condition_rating' => $conditionRating,
        'notes'            => $notes,
        'check_in_date'    => $checkInDate,
        'check_out_date'   => $checkOutDate,
        'brand'            => $brand,
        'model'            => $model,
        'serial_number'    => $serialNumber,
        'estimated_value'  => $estimatedValue,
        'warranty_until'   => $warrantyUntil,
    ];
}
