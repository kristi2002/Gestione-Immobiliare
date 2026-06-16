<?php
/**
 * Property Applications CRUD API.
 *
 * GET    /api/property_applications.php                       — paginated list
 * GET    /api/property_applications.php?id={id}              — single application
 * PUT    /api/property_applications.php?id={id}              — update status
 * POST   /api/property_applications.php?action=convert_lead&id={id} — convert to lead
 * DELETE /api/property_applications.php?id={id}              — delete
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
requireRole('admin', 'agent', 'super_admin');

apiHandleOptions();

const APP_STATUSES = ['new', 'contacted', 'approved', 'rejected'];
const APP_TYPES    = ['affitto', 'acquisto'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $action = trim($_GET['action'] ?? '');
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            $id ? getApplication($db, $id) : listApplications($db);
            break;
        case 'POST':
            if ($action === 'convert_lead') {
                if (!$id) apiError('ID richiesta mancante.');
                convertToLead($db, $id);
            } else {
                apiError('Azione non riconosciuta.', 400);
            }
            break;
        case 'PUT':
            if (!$id) apiError('ID richiesta mancante.');
            updateApplication($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID richiesta mancante.');
            deleteApplication($db, $id);
            break;
        default:
            apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

// ── Handlers ────────────────────────────────────────────────────────────────────

function listApplications(PDO $db): void
{
    $pagination  = apiGetPagination();
    $propertyId  = isset($_GET['property_id']) ? (int) $_GET['property_id'] : null;
    $status      = trim($_GET['status'] ?? '');

    $where  = 'WHERE 1=1';
    $params = [];

    if ($propertyId) {
        $where .= ' AND pa.property_id = :property_id';
        $params[':property_id'] = $propertyId;
    }
    if ($status && in_array($status, APP_STATUSES, true)) {
        $where .= ' AND pa.status = :status';
        $params[':status'] = $status;
    }

    $countSql = "SELECT COUNT(*) FROM property_applications pa {$where}";

    $dataSql = "SELECT pa.*,
                       pr.address AS property_address,
                       pr.city    AS property_city
                  FROM property_applications pa
                  LEFT JOIN properties pr ON pr.id = pa.property_id
                {$where}
                 ORDER BY pa.created_at DESC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getApplication(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT pa.*,
                pr.address AS property_address,
                pr.city    AS property_city
           FROM property_applications pa
           LEFT JOIN properties pr ON pr.id = pa.property_id
          WHERE pa.id = :id"
    );
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();
    if (!$row) apiError('Richiesta non trovata.', 404);
    apiSuccess($row);
}

function updateApplication(PDO $db, int $id): void
{
    $body   = apiGetJsonBody();
    $status = $body['status'] ?? null;

    if ($status && !in_array($status, APP_STATUSES, true)) {
        apiError('Stato non valido.');
    }

    // Check exists
    $chk = $db->prepare('SELECT id FROM property_applications WHERE id = :id');
    $chk->execute([':id' => $id]);
    if (!$chk->fetch()) apiError('Richiesta non trovata.', 404);

    $fields = [];
    $params = [':id' => $id];

    if ($status !== null) {
        $fields[] = 'status = :status';
        $params[':status'] = $status;
    }
    if (isset($body['converted_to_lead_id'])) {
        $fields[] = 'converted_to_lead_id = :lead_id';
        $params[':lead_id'] = $body['converted_to_lead_id'] ?: null;
    }

    if (empty($fields)) apiError('Nessun campo da aggiornare.');

    $db->prepare('UPDATE property_applications SET ' . implode(', ', $fields) . ' WHERE id = :id')
       ->execute($params);

    getApplication($db, $id);
}

function convertToLead(PDO $db, int $id): void
{
    $stmt = $db->prepare('SELECT * FROM property_applications WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $app = $stmt->fetch();
    if (!$app) apiError('Richiesta non trovata.', 404);

    if ($app['converted_to_lead_id']) {
        apiError('Richiesta già convertita in lead (ID ' . $app['converted_to_lead_id'] . ').', 409);
    }

    // Insert into leads table
    $ins = $db->prepare(
        "INSERT INTO leads
            (name, email, phone, interest_type, property_id, source, status, notes)
         VALUES
            (:name, :email, :phone, :interest, :property_id, 'web', 'new', :notes)"
    );
    $ins->execute([
        ':name'        => $app['applicant_name'],
        ':email'       => $app['applicant_email'],
        ':phone'       => $app['applicant_phone'],
        ':interest'    => $app['application_type'],
        ':property_id' => $app['property_id'],
        ':notes'       => $app['message'],
    ]);
    $leadId = (int) $db->lastInsertId();

    // Update application
    $db->prepare(
        "UPDATE property_applications
            SET converted_to_lead_id = :lead_id, status = 'contacted'
          WHERE id = :id"
    )->execute([':lead_id' => $leadId, ':id' => $id]);

    apiSuccess(['lead_id' => $leadId, 'application_id' => $id]);
}

function deleteApplication(PDO $db, int $id): void
{
    $chk = $db->prepare('SELECT id FROM property_applications WHERE id = :id');
    $chk->execute([':id' => $id]);
    if (!$chk->fetch()) apiError('Richiesta non trovata.', 404);

    $db->prepare('DELETE FROM property_applications WHERE id = :id')->execute([':id' => $id]);
    apiSuccess(['deleted' => true]);
}
