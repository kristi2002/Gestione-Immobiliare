<?php
/**
 * Clients (Proprietari) CRUD API.
 *
 * GET    /api/clients.php              — list (search, status filter)
 * GET    /api/clients.php?id={id}      — single client
 * POST   /api/clients.php              — create
 * PUT    /api/clients.php?id={id}      — update
 * DELETE /api/clients.php?id={id}      — archive (soft delete)
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();

const CLIENT_STATUSES = ['active', 'inactive', 'archived'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            $id ? getClient($db, $id) : listClients($db);
            break;
        case 'POST':
            createClient($db);
            break;
        case 'PUT':
            if (!$id) {
                apiError('ID proprietario mancante.');
            }
            updateClient($db, $id);
            break;
        case 'DELETE':
            if (!$id) {
                apiError('ID proprietario mancante.');
            }
            deleteClient($db, $id);
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

function listClients(PDO $db): void
{
    $search = trim($_GET['search'] ?? '');
    $status = trim($_GET['status'] ?? '');

    $sql = "SELECT c.id, c.name, c.surname, c.phone, c.email,
                   c.internal_notes, c.creation_date, c.status,
                   COUNT(p.id) AS property_count
            FROM clients c
            LEFT JOIN properties p ON p.client_id = c.id AND p.status != 'archived'
            WHERE 1=1";

    $params = [];

    if ($search !== '') {
        $sql .= " AND (c.name LIKE :search OR c.surname LIKE :search
                      OR c.email LIKE :search OR c.phone LIKE :search)";
        $params['search'] = '%' . $search . '%';
    }

    if ($status !== '' && in_array($status, CLIENT_STATUSES, true)) {
        $sql .= " AND c.status = :status";
        $params['status'] = $status;
    } else {
        $sql .= " AND c.status != 'archived'";
    }

    $sql .= " GROUP BY c.id ORDER BY c.surname ASC, c.name ASC";

    $stmt = $db->prepare($sql);
    $stmt->execute($params);

    apiSuccess($stmt->fetchAll());
}

function getClient(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT c.*, COUNT(p.id) AS property_count
         FROM clients c
         LEFT JOIN properties p ON p.client_id = c.id AND p.status != 'archived'
         WHERE c.id = :id
         GROUP BY c.id"
    );
    $stmt->execute(['id' => $id]);
    $client = $stmt->fetch();

    if (!$client) {
        apiError('Proprietario non trovato.', 404);
    }

    apiSuccess($client);
}

function createClient(PDO $db): void
{
    $data = apiGetJsonBody();
    $validated = validateClientInput($data);

    $stmt = $db->prepare(
        "INSERT INTO clients (name, surname, phone, email, internal_notes, status)
         VALUES (:name, :surname, :phone, :email, :internal_notes, :status)"
    );
    $stmt->execute($validated);

    $newId = (int) $db->lastInsertId();
    getClient($db, $newId);
}

function updateClient(PDO $db, int $id): void
{
    $existing = fetchClientById($db, $id);
    if (!$existing) {
        apiError('Proprietario non trovato.', 404);
    }

    $data      = apiGetJsonBody();
    $validated = validateClientInput($data);

    $stmt = $db->prepare(
        "UPDATE clients
         SET name = :name, surname = :surname, phone = :phone,
             email = :email, internal_notes = :internal_notes, status = :status
         WHERE id = :id"
    );
    $stmt->execute(array_merge($validated, ['id' => $id]));

    getClient($db, $id);
}

function deleteClient(PDO $db, int $id): void
{
    $existing = fetchClientById($db, $id);
    if (!$existing) {
        apiError('Proprietario non trovato.', 404);
    }

    // Soft-delete: archive the client
    $stmt = $db->prepare("UPDATE clients SET status = 'archived' WHERE id = :id");
    $stmt->execute(['id' => $id]);

    apiSuccess(['id' => $id, 'message' => 'Proprietario archiviato.']);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateClientInput(array $data): array
{
    $name    = trim($data['name'] ?? '');
    $surname = trim($data['surname'] ?? '');
    $phone   = trim($data['phone'] ?? '') ?: null;
    $email   = trim($data['email'] ?? '') ?: null;
    $notes   = trim($data['internal_notes'] ?? '') ?: null;
    $status  = trim($data['status'] ?? 'active');

    if ($name === '') {
        apiError('Il nome è obbligatorio.');
    }
    if ($surname === '') {
        apiError('Il cognome è obbligatorio.');
    }
    if ($email !== null && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        apiError('Indirizzo email non valido.');
    }
    if (!in_array($status, CLIENT_STATUSES, true)) {
        apiError('Stato non valido.');
    }

    return [
        'name'           => $name,
        'surname'        => $surname,
        'phone'          => $phone,
        'email'          => $email,
        'internal_notes' => $notes,
        'status'         => $status,
    ];
}

function fetchClientById(PDO $db, int $id): ?array
{
    $stmt = $db->prepare("SELECT id FROM clients WHERE id = :id");
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    return $row ?: null;
}
