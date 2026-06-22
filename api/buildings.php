<?php
/**
 * Buildings / Complex Grouping CRUD API.
 *
 * GET    /api/buildings.php              — paginated list (unit_count, occupancy_count)
 * GET    /api/buildings.php?id={id}      — single building + linked properties
 * POST   /api/buildings.php              — create
 * PUT    /api/buildings.php?id={id}      — update
 * DELETE /api/buildings.php?id={id}      — delete (only if no linked properties)
 * POST   /api/buildings.php?id={id}&action=link_property   — body: {property_id}
 * DELETE /api/buildings.php?id={id}&action=unlink_property&property_id=Y
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
apiHandleOptions();

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;
    $action = trim($_GET['action'] ?? '');

    switch ($method) {
        case 'GET':
            $id ? getBuilding($db, $id) : listBuildings($db);
            break;
        case 'POST':
            if ($id && $action === 'link_property') {
                linkProperty($db, $id);
            } else {
                createBuilding($db);
            }
            break;
        case 'PUT':
            if (!$id) apiError('ID edificio mancante.');
            updateBuilding($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID edificio mancante.');
            if ($action === 'unlink_property') {
                $propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : 0;
                unlinkProperty($db, $id, $propertyId);
            } else {
                deleteBuilding($db, $id);
            }
            break;
        default:
            apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    if ($e->getCode() === '23000') {
        apiError('Operazione non consentita: esistono immobili collegati a questo edificio. Rimuoverli prima di procedere.', 409);
    }
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function listBuildings(PDO $db): void
{
    $pagination = apiGetPagination();
    $search = trim($_GET['search'] ?? '');

    $where  = 'WHERE 1=1';
    $params = [];

    if ($search !== '') {
        $where .= ' AND (b.name LIKE :search OR b.address LIKE :search OR b.city LIKE :search)';
        $params['search'] = '%' . $search . '%';
    }

    $countSql = "SELECT COUNT(*) FROM buildings b $where";

    $dataSql = "SELECT b.*,
                   COUNT(DISTINCT p.id) AS unit_count,
                   COUNT(DISTINCT CASE WHEN EXISTS (
                       SELECT 1 FROM contracts c
                       INNER JOIN tenants tn ON tn.id = c.tenant_id AND tn.status = 'active'
                       WHERE c.property_id = p.id
                         AND (c.end_date IS NULL OR c.end_date >= CURDATE())
                   ) THEN p.id END) AS occupancy_count
            FROM buildings b
            LEFT JOIN properties p ON p.building_id = b.id
            $where
            GROUP BY b.id
            ORDER BY b.name ASC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getBuilding(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT * FROM buildings WHERE id = :id");
    $stmt->execute(['id' => $id]);
    $building = $stmt->fetch();

    if (!$building) {
        apiError('Edificio non trovato.', 404);
    }

    $propStmt = $db->prepare(
        "SELECT p.id, p.address, p.city, p.sqm, p.rooms, p.status, p.price, p.price_type,
                c.name AS client_name, c.surname AS client_surname
         FROM properties p
         LEFT JOIN clients c ON c.id = p.client_id
         WHERE p.building_id = :bid
         ORDER BY p.address ASC"
    );
    $propStmt->execute(['bid' => $id]);
    $building['properties'] = $propStmt->fetchAll();
    $building['unit_count'] = count($building['properties']);

    apiSuccess($building);
}

function createBuilding(PDO $db): void
{
    $data      = apiGetJsonBody();
    $validated = validateBuildingInput($data);

    $stmt = $db->prepare(
        "INSERT INTO buildings (name, address, city, total_units, notes)
         VALUES (:name, :address, :city, :total_units, :notes)"
    );
    $stmt->execute($validated);

    $newId = (int) $db->lastInsertId();
    logActivity('create', 'building', $newId, 'Edificio creato: ' . $validated['name']);
    getBuilding($db, $newId);
}

function updateBuilding(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT id FROM buildings WHERE id = :id");
    $stmt->execute(['id' => $id]);
    if (!$stmt->fetch()) {
        apiError('Edificio non trovato.', 404);
    }

    $data      = apiGetJsonBody();
    $validated = validateBuildingInput($data);

    $stmt = $db->prepare(
        "UPDATE buildings
         SET name = :name, address = :address, city = :city, total_units = :total_units, notes = :notes
         WHERE id = :id"
    );
    $stmt->execute(array_merge($validated, ['id' => $id]));

    logActivity('update', 'building', $id, 'Edificio aggiornato: ' . $validated['name']);
    getBuilding($db, $id);
}

function deleteBuilding(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT id FROM buildings WHERE id = :id");
    $stmt->execute(['id' => $id]);
    if (!$stmt->fetch()) {
        apiError('Edificio non trovato.', 404);
    }

    // Check linked properties
    $check = $db->prepare("SELECT COUNT(*) FROM properties WHERE building_id = :id");
    $check->execute(['id' => $id]);
    if ((int) $check->fetchColumn() > 0) {
        apiError('Impossibile eliminare: ci sono immobili collegati. Scollegarli prima.');
    }

    $db->prepare("DELETE FROM buildings WHERE id = :id")->execute(['id' => $id]);

    logActivity('delete', 'building', $id, 'Edificio eliminato #' . $id);
    apiSuccess(['id' => $id, 'message' => 'Edificio eliminato.']);
}

function linkProperty(PDO $db, int $buildingId): void
{
    $stmt = $db->prepare("SELECT id FROM buildings WHERE id = :id");
    $stmt->execute(['id' => $buildingId]);
    if (!$stmt->fetch()) {
        apiError('Edificio non trovato.', 404);
    }

    $data       = apiGetJsonBody();
    $propertyId = !empty($data['property_id']) ? (int) $data['property_id'] : 0;

    if ($propertyId <= 0) {
        apiError('property_id obbligatorio.');
    }

    $propCheck = $db->prepare("SELECT id, building_id FROM properties WHERE id = :id");
    $propCheck->execute(['id' => $propertyId]);
    $prop = $propCheck->fetch();
    if (!$prop) {
        apiError('Immobile non trovato.');
    }

    // A property belongs to exactly one building — check it isn't already this one.
    if ((int) $prop['building_id'] === $buildingId) {
        apiError('Immobile già collegato a questo edificio.');
    }

    // Re-linking moves the property from any previous building to this one.
    $db->prepare(
        "UPDATE properties SET building_id = :bid WHERE id = :pid"
    )->execute(['bid' => $buildingId, 'pid' => $propertyId]);

    logActivity('update', 'building', $buildingId, 'Immobile #' . $propertyId . ' collegato all\'edificio');
    getBuilding($db, $buildingId);
}

function unlinkProperty(PDO $db, int $buildingId, int $propertyId): void
{
    if ($propertyId <= 0) {
        apiError('property_id obbligatorio.');
    }

    $stmt = $db->prepare(
        "UPDATE properties SET building_id = NULL WHERE id = :pid AND building_id = :bid"
    );
    $stmt->execute(['bid' => $buildingId, 'pid' => $propertyId]);

    if ($stmt->rowCount() === 0) {
        apiError('Collegamento non trovato.', 404);
    }

    logActivity('update', 'building', $buildingId, 'Immobile #' . $propertyId . ' scollegato dall\'edificio');
    apiSuccess(['building_id' => $buildingId, 'property_id' => $propertyId, 'message' => 'Immobile scollegato.']);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateBuildingInput(array $data): array
{
    $name       = trim($data['name'] ?? '');
    $address    = trim($data['address'] ?? '');
    $city       = trim($data['city'] ?? '');
    $totalUnits = isset($data['total_units']) && $data['total_units'] !== '' ? (int) $data['total_units'] : null;
    $notes      = trim($data['notes'] ?? '') ?: null;

    if ($name === '') apiError('Nome edificio obbligatorio.');
    if ($address === '') apiError('Indirizzo obbligatorio.');
    if ($city === '') apiError('Città obbligatoria.');
    if ($totalUnits !== null && $totalUnits < 0) apiError('Numero unità non valido.');

    return [
        'name'        => $name,
        