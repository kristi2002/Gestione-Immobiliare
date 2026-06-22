<?php
/**
 * Tenants (inquilini) CRUD API.
 *
 * A tenant is a person. WHERE they live and on what lease terms is recorded
 * in CONTRACTS (tenant_id + property_id), not on the tenant row itself — this
 * lets the same person be re-rented to a different property later without
 * losing or overwriting their previous lease history. See getTenantCurrentContract()
 * in config/db.php for how "current property" is resolved (active contract,
 * falling back to the most recent one).
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

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * Shared derived-table join that resolves each tenant's current contract
 * (preferring an active one, else their most recent) in a single bulk query.
 */
function currentContractJoinSql(): string
{
    return "LEFT JOIN (
                SELECT * FROM (
                    SELECT c.tenant_id, c.id AS contract_id, c.property_id,
                           c.start_date AS lease_start, c.end_date AS lease_end, c.monthly_rent,
                           ROW_NUMBER() OVER (
                               PARTITION BY c.tenant_id
                               ORDER BY (c.end_date IS NULL OR c.end_date >= CURDATE()) DESC, c.start_date DESC, c.id DESC
                           ) AS rn
                    FROM contracts c
                    WHERE c.tenant_id IS NOT NULL
                ) ranked WHERE rn = 1
            ) cc ON cc.tenant_id = t.id
            LEFT JOIN properties p ON p.id = cc.property_id";
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

    $join = currentContractJoinSql();

    $countSql = "SELECT COUNT(*) FROM tenants t $join $where";

    $dataSql = "SELECT t.*, cc.contract_id, cc.property_id, cc.lease_start, cc.lease_end, cc.monthly_rent,
                   p.address AS property_address, p.city AS property_city,
                   IF((SELECT COUNT(*) FROM tenant_users tu WHERE tu.tenant_id = t.id) > 0, 1, 0) AS has_portal_access
            FROM tenants t
            $join
            $where
            ORDER BY t.surname, t.name";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getTenant(PDO $db, int $id): void
{
    $stmt = $db->prepare('SELECT * FROM tenants WHERE id = :id');
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    if (!$row) {
        apiError('Inquilino non trovato.', 404);
    }

    $contract = getTenantCurrentContract($db, $id);
    $row['contract_id']      = $contract['contract_id'] ?? null;
    $row['property_id']      = $contract['property_id'] ?? null;
    $row['property_address'] = $contract['address'] ?? null;
    $row['property_city']    = $contract['city'] ?? null;
    $row['lease_start']      = $contract['lease_start'] ?? null;
    $row['lease_end']        = $contract['lease_end'] ?? null;
    $row['monthly_rent']     = $contract['monthly_rent'] ?? null;
    $row['has_portal_access'] = tenantHasPortal($db, $id);
    apiSuccess($row);
}

function createTenant(PDO $db): void
{
    $data       = apiGetJsonBody();
    $propertyId = (int) ($data['property_id'] ?? 0);
    $name       = trim($data['name'] ?? '');
    $surname    = trim($data['surname'] ?? '');
    $email      = trim($data['email'] ?? '');
    $password   = $data['portal_password'] ?? '';

    if ($propertyId <= 0 || $name === '' || $surname === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        apiError('property_id, nome, cognome e email valida sono obbligatori.');
    }

    $propStmt = $db->prepare('SELECT client_id FROM properties WHERE id = :id');
    $propStmt->execute(['id' => $propertyId]);
    $prop = $propStmt->fetch();
    if (!$prop) {
        apiError('Immobile non trovato.');
    }

    $stmt = $db->prepare(
        'INSERT INTO tenants (name, surname, email, phone, notes)
         VALUES (:name, :surname, :email, :phone, :notes)'
    );
    $stmt->execute([
        'name'    => $name,
        'surname' => $surname,
        'email'   => $email,
        'phone'   => trim($data['phone'] ?? '') ?: null,
        'notes'   => trim($data['notes'] ?? '') ?: null,
    ]);

    $tenantId = (int) $db->lastInsertId();

    // Property + lease info goes into a CONTRACTS row, not onto the tenant.
    createOrUpdateLeaseContract($db, $tenantId, $propertyId, (int) $prop['client_id'], $data);

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
    foreach (['name', 'surname', 'email', 'phone', 'notes', 'status'] as $f) {
        if (array_key_exists($f, $data)) {
            $fields[] = "{$f} = :{$f}";
            $params[$f] = $data[$f];
        }
    }
    if ($fields) {
        $db->prepare('UPDATE tenants SET ' . implode(', ', $fields) . ' WHERE id = :id')->execute($params);
    }

    // A property_id in the payload means the lease/property was edited from
    // the tenant form — reflect it as a contract change, not a tenant column.
    if (!empty($data['property_id'])) {
        $propertyId = (int) $data['property_id'];
        $propStmt = $db->prepare('SELECT client_id FROM properties WHERE id = :id');
        $propStmt->execute(['id' => $propertyId]);
        $prop = $propStmt->fetch();
        if (!$prop) {
            apiError('Immobile non trovato.');
        }
        createOrUpdateLeaseContract($db, $id, $propertyId, (int) $prop['client_id'], $data);
    }

    if (!empty($data['portal_password']) && strlen($data['portal_password']) >= 8) {
        createTenantPortalUser($id, $data['portal_password']);
    }

    logActivity('update', 'tenant', $id, 'Inquilino aggiornato #' . $id);
    getTenant($db, $id);
}

/**
 * Reflects a property/lease assignment as a CONTRACTS row.
 * - Same property as the tenant's current contract → update that contract's
 *   lease terms in place (this is just editing an existing lease).
 * - Different property (or no contract yet) → insert a NEW contract, leaving
 *   any previous one untouched as history.
 */
function createOrUpdateLeaseContract(PDO $db, int $tenantId, int $propertyId, int $clientId, array $data): void
{
    $leaseStart = trim($data['lease_start'] ?? '') ?: null;
    $leaseEnd   = trim($data['lease_end'] ?? '') ?: null;
    $rent       = isset($data['monthly_rent']) && $data['monthly_rent'] !== '' ? (float) $data['monthly_rent'] : null;

    $current = getTenantCurrentContract($db, $tenantId);

    if ($current && (int) $current['property_id'] === $propertyId) {
        $db->prepare(
            'UPDATE contracts SET start_date = :start_date, end_date = :end_date, monthly_rent = :monthly_rent WHERE id = :id'
        )->execute([
            'start_date'   => $leaseStart,
            'end_date'     => $leaseEnd,
            'monthly_rent' => $rent,
            'id'           => $current['contract_id'],
        ]);
        return;
    }

    $propStmt = $db->prepare('SELECT address, city FROM properties WHERE id = :id');
    $propStmt->execute(['id' => $propertyId]);
    $prop  = $propStmt->fetch();
    $title = 'Locazione ' . ($prop ? $prop['address'] . ', ' . $prop['city'] : "immobile #$propertyId");

    $db->prepare(
        "INSERT INTO contracts
            (property_id, tenant_id, client_id, title, contract_type, status, start_date, end_date, monthly_rent, created_by)
         VALUES
            (:property_id, :tenant_id, :client_id, :title, 'locazione', 'signed', :start_date, :end_date, :monthly_rent, :created_by)"
    )->execute([
        'property_id'  => $propertyId,
        'tenant_id'    => $tenantId,
        'client_id'    => $clientId,
        'title'        => $title,
        'start_date'   => $leaseStart,
        'end_date'     => $leaseEnd,
        'monthly_rent' => $rent,
        'created_by'   => getCurrentAdminId() ?: null,
    ]);
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
