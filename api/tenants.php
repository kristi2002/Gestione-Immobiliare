<?php
/**
 * Tenants (inquilini) CRUD API.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/auth.php';

apiHandleOptions();
requireViewAccess('tenants');

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    if ($method === 'GET') {
        $id ? getTenant($db, $id) : listTenants($db);
    } elseif ($method === 'POST') {
        requireWriteAccess();
        createTenant($db);
    } elseif ($method === 'PUT' && $id) {
        requireWriteAccess();
        updateTenant($db, $id);
    } elseif ($method === 'DELETE' && $id) {
        requireWriteAccess();
        archiveTenant($db, $id);
    } else {
        apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

function listTenants(PDO $db): void
{
    $pagination = apiGetPagination();
    $search = trim($_GET['search'] ?? '');
    $where = "WHERE t.status != 'archived'";
    $params = [];
    if ($search !== '') {
        $where .= ' AND (t.name LIKE :s OR t.surname LIKE :s OR t.email LIKE :s OR p.address LIKE :s)';
        $params['s'] = '%' . $search . '%';
    }

    $countSql = "SELECT COUNT(*) FROM tenants t
            INNER JOIN properties p ON p.id = t.property_id
            $where";

    $dataSql = "SELECT t.*, p.address AS property_address, p.city AS property_city,
                   IF((SELECT COUNT(*) FROM tenant_users tu WHERE tu.tenant_id = t.id) > 0, 1, 0) AS has_portal_access
            FROM tenants t
            INNER JOIN properties p ON p.id = t.property_id
            $where
            ORDER BY t.surname, t.name";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getTenant(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT t.*, p.address AS property_address, p.city AS property_city
         FROM tenants t INNER JOIN properties p ON p.id = t.property_id WHERE t.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    if (!$row) {
        apiError('Inquilino non trovato.', 404);
    }
    $row['has_portal_access'] = tenantHasPortal($db, $id);
    apiSuccess($row);
}

function createTenant(PDO $db): void
{
    $data = apiGetJsonBody();
    $propertyId = (int) ($data['property_id'] ?? 0);
    $name       = trim($data['name'] ?? '');
    $surname    = trim($data['surname'] ?? '');
    $email      = trim($data['email'] ?? '');
    $password   = $data['portal_password'] ?? '';

    if ($propertyId <= 0 || $name === '' || $surname === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        apiError('property_id, nome, cognome e email valida sono obbligatori.');
    }

    $stmt = $db->prepare(
        'INSERT INTO tenants (property_id, name, surname, email, phone, lease_start, lease_end, monthly_rent, notes)
         VALUES (:property_id, :name, :surname, :email, :phone, :lease_start, :lease_end, :rent, :notes)'
    );
    $stmt->execute([
        'property_id' => $propertyId,
        'name'        => $name,
        'surname'     => $surname,
        'email'       => $email,
        'phone'       => trim($data['phone'] ?? '') ?: null,
        'lease_start' => $data['lease_start'] ?? null,
        'lease_end'   => $data['lease_end'] ?? null,
        'rent'        => $data['monthly_rent'] ?? null,
        'notes'       => trim($data['notes'] ?? '') ?: null,
    ]);

    $tenantId = (int) $db->lastInsertId();
    if ($password !== '' && strlen($password) >= 8) {
        createTenantPortalUser($tenantId, $password);
    }

    logActivity('create', 'tenant', $tenantId, 'Inquilino creato: ' . $name . ' ' . $surname);
    getTenant($db, $tenantId);
}

function updateTenant(PDO $db, int $id): void
{
    $data = apiGetJsonBody();
    $existing = $db->prepare('SELECT id FROM tenants WHERE id = :id');
    $existing->execute(['id' => $id]);
    if (!$existing->fetch()) {
        apiError('Inquilino non trovato.', 404);
    }

    $fields = [];
    $params = ['id' => $id];
    foreach (['property_id','name','surname','email','phone','lease_start','lease_end','monthly_rent','notes','status'] as $f) {
        if (array_key_exists($f, $data)) {
            $fields[] = "{$f} = :{$f}";
            $params[$f] = $data[$f];
        }
    }
    if ($fields) {
        $db->prepare('UPDATE tenants SET ' . implode(', ', $fields) . ' WHERE id = :id')->execute($params);
    }

    if (!empty($data['portal_password']) && strlen($data['portal_password']) >= 8) {
        createTenantPortalUser($id, $data['portal_password']);
    }

    logActivity('update', 'tenant', $id, 'Inquilino aggiornato #' . $id);
    getTenant($db, $id);
}

function archiveTenant(PDO $db, int $id): void
{
    $db->prepare("UPDATE tenants SET status = 'archived' WHERE id = :id")->execute(['id' => $id]);
    logActivity('delete', 'tenant', $id, 'Inquilino archiviato #' . $id);
    apiSuccess(['archived' => true]);
}

function tenantHasPortal(PDO $db, int $tenantId): bool
{
    $stmt = $db->prepare('SELECT id FROM tenant_users WHERE tenant_id = :id');
    $stmt->execute(['id' => $tenantId]);
    return (bool) $stmt->fetch();
}
