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
            if (($_GET['format'] ?? '') === 'csv') {
                exportClientsCsv($db);
            }
            $id ? getClient($db, $id) : listClients($db);
            break;
        case 'POST':
            if (($_GET['action'] ?? '') === 'import') {
                importClients($db);
            }
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
    if ($e->getCode() === '23000' && str_contains($e->getMessage(), 'uq_clients_cf')) {
        apiError('Esiste già un proprietario con questo codice fiscale.');
    }
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function listClients(PDO $db): void
{
    $pagination = apiGetPagination();
    $search = trim($_GET['search'] ?? '');
    $status = trim($_GET['status'] ?? '');

    $where = 'WHERE 1=1';
    $params = [];

    if ($search !== '') {
        $frag = apiWordSearch($search, ['c.name', 'c.surname', 'c.email', 'c.phone', 'c.codice_fiscale', 'c.internal_notes'], $params);
        if ($frag) $where .= " AND $frag";
    }

    if ($status !== '' && in_array($status, CLIENT_STATUSES, true)) {
        $where .= ' AND c.status = :status';
        $params['status'] = $status;
    } else {
        $where .= " AND c.status != 'archived'";
    }

    $countSql = "SELECT COUNT(*) FROM clients c $where";

    $dataSql = "SELECT c.id, c.name, c.surname, c.codice_fiscale, c.phone, c.email,
                   c.internal_notes, c.creation_date, c.status,
                   COUNT(p.id) AS property_count
            FROM clients c
            LEFT JOIN properties p ON p.client_id = c.id AND p.status != 'archived'
            $where
            GROUP BY c.id ORDER BY c.surname ASC, c.name ASC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
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
        "INSERT INTO clients (name, surname, codice_fiscale, phone, email, internal_notes, status)
         VALUES (:name, :surname, :codice_fiscale, :phone, :email, :internal_notes, :status)"
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
         SET name = :name, surname = :surname, codice_fiscale = :codice_fiscale,
             phone = :phone, email = :email, internal_notes = :internal_notes, status = :status
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
    $cf      = strtoupper(trim($data['codice_fiscale'] ?? '')) ?: null;
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
    if ($cf === null) {
        apiError('Il codice fiscale è obbligatorio.');
    }
    if (!preg_match('/^[A-Z0-9]{11,16}$/', $cf)) {
        apiError('Codice fiscale non valido (11-16 caratteri alfanumerici).');
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
        'codice_fiscale' => $cf,
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

// ---------------------------------------------------------------------------
// CSV export / import
// ---------------------------------------------------------------------------

function exportClientsCsv(PDO $db): void
{
    $rows = $db->query(
        "SELECT name, surname, phone, email, status
         FROM clients WHERE status != 'archived'
         ORDER BY surname ASC, name ASC"
    )->fetchAll();

    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="proprietari_' . date('Ymd') . '.csv"');

    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF"); // UTF-8 BOM for Excel
    fputcsv($out, ['nome', 'cognome', 'telefono', 'email', 'stato']);
    foreach ($rows as $r) {
        fputcsv($out, [$r['name'], $r['surname'], $r['phone'], $r['email'], $r['status']]);
    }
    fclose($out);
    exit;
}

function importClients(PDO $db): void
{
    $data = apiGetJsonBody();
    $rows = $data['rows'] ?? [];
    if (!is_array($rows) || empty($rows)) {
        apiError('Nessuna riga da importare.');
    }

    $imported = 0;
    $errors   = [];
    $stmt = $db->prepare(
        "INSERT INTO clients (name, surname, phone, email, status)
         VALUES (:name, :surname, :phone, :email, :status)"
    );

    foreach ($rows as $i => $row) {
        $name    = trim((string) ($row['nome'] ?? ''));
        $surname = trim((string) ($row['cognome'] ?? ''));
        $phone   = trim((string) ($row['telefono'] ?? '')) ?: null;
        $email   = trim((string) ($row['email'] ?? '')) ?: null;
        $status  = trim((string) ($row['stato'] ?? 'active'));

        if ($name === '' || $surname === '') {
            $errors[] = 'Riga ' . ($i + 1) . ': nome/cognome mancante.';
            continue;
        }
        if (!in_array($status, CLIENT_STATUSES, true)) {
            $status = 'active';
        }
        if ($email !== null && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $email = null;
        }

        $stmt->execute([
            'name' => $name, 'surname' => $surname,
            'phone' => $phone, 'email' => $email, 'status' => $status,
        ]);
        $imported++;
    }

    apiSuccess(['imported' => $imported, 'errors' => $errors]);
}
