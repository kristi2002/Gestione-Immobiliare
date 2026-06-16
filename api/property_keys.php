<?php
/**
 * Property keys (gestione chiavi) API.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();

const KEY_STATUSES = ['out', 'in_office', 'lost'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            $id ? getKey($db, $id) : listKeys($db);
            break;
        case 'POST':
            createKey($db);
            break;
        case 'PUT':
            if (!$id) apiError('ID chiavi mancante.');
            updateKey($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID chiavi mancante.');
            deleteKey($db, $id);
            break;
        default:
            apiError('Metodo non consentito.', 405);
    }
} catch (PDOException) {
    apiError('Errore database.', 500);
}

function listKeys(PDO $db): void
{
    $pagination = apiGetPagination();
    $propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : null;
    $holderId   = isset($_GET['holder_id']) ? (int) $_GET['holder_id'] : null;
    $status     = trim($_GET['status'] ?? '');
    $search     = trim($_GET['search'] ?? '');

    $where  = ' WHERE 1=1';
    $params = [];

    if ($propertyId) {
        $where .= ' AND k.property_id = :property_id';
        $params['property_id'] = $propertyId;
    }
    if ($holderId) {
        $where .= ' AND k.holder_id = :holder_id';
        $params['holder_id'] = $holderId;
    }
    if ($status !== '' && in_array($status, KEY_STATUSES, true)) {
        $where .= ' AND k.status = :status';
        $params['status'] = $status;
    }
    if ($search !== '') {
        $where .= ' AND (p.address LIKE :search OR p.city LIKE :search OR k.holder_name LIKE :search OR a.username LIKE :search)';
        $params['search'] = '%' . $search . '%';
    }

    $from = "FROM property_keys k
             INNER JOIN properties p ON p.id = k.property_id
             LEFT JOIN admin_users a ON a.id = k.holder_id";

    $countSql = "SELECT COUNT(*) " . $from . $where;
    $dataSql  = "SELECT k.*, p.address, p.city, a.username AS holder_username " . $from . $where
              . " ORDER BY k.updated_at DESC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getKey(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT k.*, p.address, p.city, a.username AS holder_username
         FROM property_keys k
         INNER JOIN properties p ON p.id = k.property_id
         LEFT JOIN admin_users a ON a.id = k.holder_id
         WHERE k.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    if (!$row) apiError('Registro chiavi non trovato.', 404);
    apiSuccess($row);
}

function createKey(PDO $db): void
{
    $data = apiGetJsonBody();
    $stmt = $db->prepare(
        "INSERT INTO property_keys (property_id, holder_id, holder_name, location, notes, handed_at, returned_at, status)
         VALUES (:property_id, :holder_id, :holder_name, :location, :notes, :handed_at, :returned_at, :status)"
    );
    $stmt->execute(validateKeyInput($data));
    getKey($db, (int) $db->lastInsertId());
}

function updateKey(PDO $db, int $id): void
{
    $data = apiGetJsonBody();
    $stmt = $db->prepare(
        "UPDATE property_keys SET property_id=:property_id, holder_id=:holder_id, holder_name=:holder_name,
         location=:location, notes=:notes, handed_at=:handed_at, returned_at=:returned_at, status=:status
         WHERE id=:id"
    );
    $params = validateKeyInput($data);
    $params['id'] = $id;
    $stmt->execute($params);
    getKey($db, $id);
}

function deleteKey(PDO $db, int $id): void
{
    $db->prepare('DELETE FROM property_keys WHERE id = :id')->execute(['id' => $id]);
    apiSuccess(['id' => $id]);
}

function validateKeyInput(array $data): array
{
    $propertyId = (int) ($data['property_id'] ?? 0);
    if ($propertyId <= 0) apiError('Immobile obbligatorio.');

    $status = $data['status'] ?? 'in_office';
    if (!in_array($status, KEY_STATUSES, true)) apiError('Stato non valido.');

    return [
        'property_id'  => $propertyId,
        'holder_id'    => !empty($data['holder_id']) ? (int) $data['holder_id'] : null,
        'holder_name'  => trim($data['holder_name'] ?? '') ?: null,
        'location'     => trim($data['location'] ?? '') ?: null,
        'notes'        => trim($data['notes'] ?? '') ?: null,
        'handed_at'    => $data['handed_at'] ?? null,
        'returned_at'  => $data['returned_at'] ?? null,
        'status'       => $status,
    ];
}
