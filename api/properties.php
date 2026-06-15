<?php
/**
 * Properties (Immobili) CRUD API.
 *
 * GET    /api/properties.php                  — list (search, status, client_id)
 * GET    /api/properties.php?id={id}          — single property with media count
 * POST   /api/properties.php                  — create
 * PUT    /api/properties.php?id={id}          — update
 * DELETE /api/properties.php?id={id}          — archive (soft delete)
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();

const PROPERTY_STATUSES = ['available', 'rented', 'sold', 'archived'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            $id ? getProperty($db, $id) : listProperties($db);
            break;
        case 'POST':
            createProperty($db);
            break;
        case 'PUT':
            if (!$id) {
                apiError('ID immobile mancante.');
            }
            updateProperty($db, $id);
            break;
        case 'DELETE':
            if (!$id) {
                apiError('ID immobile mancante.');
            }
            deleteProperty($db, $id);
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

function listProperties(PDO $db): void
{
    $search   = trim($_GET['search'] ?? '');
    $status   = trim($_GET['status'] ?? '');
    $clientId = isset($_GET['client_id']) ? (int) $_GET['client_id'] : null;

    $sql = "SELECT p.id, p.client_id, p.address, p.city, p.cap, p.sqm,
                   p.rooms, p.bathrooms, p.floor, p.description,
                   p.additional_features, p.internal_notes, p.status,
                   p.created_at,
                   c.name AS client_name, c.surname AS client_surname,
                   COUNT(m.id) AS media_count
            FROM properties p
            INNER JOIN clients c ON c.id = p.client_id
            LEFT JOIN property_media m ON m.property_id = p.id
            WHERE 1=1";

    $params = [];

    if ($search !== '') {
        $sql .= " AND (p.address LIKE :search OR p.city LIKE :search
                      OR p.cap LIKE :search OR p.description LIKE :search
                      OR c.name LIKE :search OR c.surname LIKE :search)";
        $params['search'] = '%' . $search . '%';
    }

    if ($status !== '' && in_array($status, PROPERTY_STATUSES, true)) {
        $sql .= " AND p.status = :status";
        $params['status'] = $status;
    } else {
        $sql .= " AND p.status != 'archived'";
    }

    if ($clientId) {
        $sql .= " AND p.client_id = :client_id";
        $params['client_id'] = $clientId;
    }

    $sql .= " GROUP BY p.id ORDER BY p.city ASC, p.address ASC";

    $stmt = $db->prepare($sql);
    $stmt->execute($params);

    apiSuccess($stmt->fetchAll());
}

function getProperty(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT p.*, c.name AS client_name, c.surname AS client_surname,
                COUNT(m.id) AS media_count
         FROM properties p
         INNER JOIN clients c ON c.id = p.client_id
         LEFT JOIN property_media m ON m.property_id = p.id
         WHERE p.id = :id
         GROUP BY p.id"
    );
    $stmt->execute(['id' => $id]);
    $property = $stmt->fetch();

    if (!$property) {
        apiError('Immobile non trovato.', 404);
    }

    apiSuccess($property);
}

function createProperty(PDO $db): void
{
    $data      = apiGetJsonBody();
    $validated = validatePropertyInput($db, $data);

    $stmt = $db->prepare(
        "INSERT INTO properties
            (client_id, address, city, cap, sqm, rooms, bathrooms, floor,
             description, additional_features, internal_notes, status)
         VALUES
            (:client_id, :address, :city, :cap, :sqm, :rooms, :bathrooms, :floor,
             :description, :additional_features, :internal_notes, :status)"
    );
    $stmt->execute($validated);

    $newId = (int) $db->lastInsertId();
    getProperty($db, $newId);
}

function updateProperty(PDO $db, int $id): void
{
    if (!fetchPropertyById($db, $id)) {
        apiError('Immobile non trovato.', 404);
    }

    $data      = apiGetJsonBody();
    $validated = validatePropertyInput($db, $data);

    $stmt = $db->prepare(
        "UPDATE properties
         SET client_id = :client_id, address = :address, city = :city, cap = :cap,
             sqm = :sqm, rooms = :rooms, bathrooms = :bathrooms, floor = :floor,
             description = :description, additional_features = :additional_features,
             internal_notes = :internal_notes, status = :status
         WHERE id = :id"
    );
    $stmt->execute(array_merge($validated, ['id' => $id]));

    getProperty($db, $id);
}

function deleteProperty(PDO $db, int $id): void
{
    if (!fetchPropertyById($db, $id)) {
        apiError('Immobile non trovato.', 404);
    }

    $stmt = $db->prepare("UPDATE properties SET status = 'archived' WHERE id = :id");
    $stmt->execute(['id' => $id]);

    apiSuccess(['id' => $id, 'message' => 'Immobile archiviato.']);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validatePropertyInput(PDO $db, array $data): array
{
    $clientId  = (int) ($data['client_id'] ?? 0);
    $address   = trim($data['address'] ?? '');
    $city      = trim($data['city'] ?? '');
    $cap       = trim($data['cap'] ?? '') ?: null;
    $sqm       = isset($data['sqm']) && $data['sqm'] !== '' ? (float) $data['sqm'] : null;
    $rooms     = isset($data['rooms']) && $data['rooms'] !== '' ? (int) $data['rooms'] : null;
    $bathrooms = isset($data['bathrooms']) && $data['bathrooms'] !== '' ? (int) $data['bathrooms'] : null;
    $floor     = trim($data['floor'] ?? '') ?: null;
    $desc      = trim($data['description'] ?? '') ?: null;
    $features  = trim($data['additional_features'] ?? '') ?: null;
    $notes     = trim($data['internal_notes'] ?? '') ?: null;
    $status    = trim($data['status'] ?? 'available');

    if ($clientId <= 0) {
        apiError('Seleziona un proprietario.');
    }
    if ($address === '') {
        apiError('L\'indirizzo è obbligatorio.');
    }
    if ($city === '') {
        apiError('La città è obbligatoria.');
    }
    if (!in_array($status, PROPERTY_STATUSES, true)) {
        apiError('Stato non valido.');
    }
    if ($sqm !== null && $sqm < 0) {
        apiError('I metri quadri non possono essere negativi.');
    }
    if ($rooms !== null && $rooms < 0) {
        apiError('Il numero di stanze non può essere negativo.');
    }
    if ($bathrooms !== null && $bathrooms < 0) {
        apiError('Il numero di bagni non può essere negativo.');
    }

    $clientStmt = $db->prepare("SELECT id FROM clients WHERE id = :id AND status != 'archived'");
    $clientStmt->execute(['id' => $clientId]);
    if (!$clientStmt->fetch()) {
        apiError('Proprietario non trovato o archiviato.');
    }

    return [
        'client_id'           => $clientId,
        'address'             => $address,
        'city'                => $city,
        'cap'                 => $cap,
        'sqm'                 => $sqm,
        'rooms'               => $rooms,
        'bathrooms'           => $bathrooms,
        'floor'               => $floor,
        'description'         => $desc,
        'additional_features' => $features,
        'internal_notes'      => $notes,
        'status'              => $status,
    ];
}

function fetchPropertyById(PDO $db, int $id): ?array
{
    $stmt = $db->prepare("SELECT id FROM properties WHERE id = :id");
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    return $row ?: null;
}
