<?php
/**
 * Tenant Satisfaction Surveys API.
 *
 * GET  /api/surveys.php                — admin: paginated list (filterable by property_id)
 * GET  /api/surveys.php?token=X        — public: survey form data (no auth)
 * POST /api/surveys.php?submit=1       — public: submit survey by token (no auth)
 * POST /api/surveys.php                — admin: create survey link (generates token)
 * DELETE /api/surveys.php?id={id}      — admin: delete survey
 */

require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/api_helpers.php';
require_once __DIR__ . '/../config/api_pagination.php';
require_once __DIR__ . '/../config/csrf.php';
require_once __DIR__ . '/../config/activity_log.php';
require_once __DIR__ . '/../config/auth.php';

apiHandleOptions();

$method      = $_SERVER['REQUEST_METHOD'];
$token       = trim($_GET['token'] ?? '');
$isPublicGet = $method === 'GET' && $token !== '';
$isSubmit    = $method === 'POST' && !empty($_GET['submit']);

// Public endpoints: token-based GET and submit — skip auth
if (!$isPublicGet && !$isSubmit) {
    requireAuthApi();
    if (in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
        requireWriteAccess();
        validateCsrfToken();
    }
}

try {
    $db = getDB();
    $id = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            if ($token !== '') {
                getSurveyByToken($db, $token);
            } else {
                listSurveys($db);
            }
            break;
        case 'POST':
            if ($isSubmit) {
                submitSurvey($db);
            } else {
                createSurvey($db);
            }
            break;
        case 'DELETE':
            if (!$id) apiError('ID sondaggio mancante.');
            deleteSurvey($db, $id);
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

function listSurveys(PDO $db): void
{
    $pagination = apiGetPagination();
    $propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : null;

    $where  = 'WHERE 1=1';
    $params = [];

    if ($propertyId) {
        $where .= ' AND ts.property_id = :property_id';
        $params['property_id'] = $propertyId;
    }

    $countSql = "SELECT COUNT(*) FROM tenant_surveys ts $where";

    $dataSql = "SELECT ts.*,
                   t.name AS tenant_name, t.surname AS tenant_surname,
                   p.address AS property_address, p.city AS property_city
            FROM tenant_surveys ts
            LEFT JOIN tenants t ON t.id = ts.tenant_id
            LEFT JOIN properties p ON p.id = ts.property_id
            $where
            ORDER BY ts.submitted_at DESC, ts.id DESC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getSurveyByToken(PDO $db, string $token): void
{
    $stmt = $db->prepare(
        "SELECT ts.*,
                t.name AS tenant_name, t.surname AS tenant_surname,
                p.address AS property_address, p.city AS property_city
         FROM tenant_surveys ts
         LEFT JOIN tenants t ON t.id = ts.tenant_id
         LEFT JOIN properties p ON p.id = ts.property_id
         WHERE ts.token = :token"
    );
    $stmt->execute(['token' => $token]);
    $row = $stmt->fetch();

    if (!$row) {
        apiError('Sondaggio non trovato o link non valido.', 404);
    }

    apiSuccess($row);
}

function submitSurvey(PDO $db): void
{
    $data  = apiGetJsonBody();
    $token = trim($data['token'] ?? '');

    if ($token === '') {
        apiError('Token obbligatorio.');
    }

    $stmt = $db->prepare("SELECT id, submitted_at FROM tenant_surveys WHERE token = :token");
    $stmt->execute(['token' => $token]);
    $survey = $stmt->fetch();

    if (!$survey) {
        apiError('Sondaggio non trovato.', 404);
    }
    if ($survey['submitted_at'] !== null) {
        apiError('Sondaggio già compilato.');
    }

    $overall       = isset($data['overall_rating']) && $data['overall_rating'] !== '' ? (int) $data['overall_rating'] : null;
    $maintenance   = isset($data['maintenance_rating']) && $data['maintenance_rating'] !== '' ? (int) $data['maintenance_rating'] : null;
    $communication = isset($data['communication_rating']) && $data['communication_rating'] !== '' ? (int) $data['communication_rating'] : null;
    $comment       = trim($data['comment'] ?? '') ?: null;

    foreach (['overall' => $overall, 'maintenance' => $maintenance, 'communication' => $communication] as $field => $val) {
        if ($val !== null && ($val < 1 || $val > 5)) {
            apiError('Il valore di ' . $field . ' deve essere tra 1 e 5.');
        }
    }

    $upd = $db->prepare(
        "UPDATE tenant_surveys
         SET overall_rating = :overall, maintenance_rating = :maintenance,
             communication_rating = :communication, comment = :comment,
             submitted_at = NOW()
         WHERE token = :token"
    );
    $upd->execute([
        'overall'       => $overall,
        'maintenance'   => $maintenance,
        'communication' => $communication,
        'comment'       => $comment,
        'token'         => $token,
    ]);

    apiSuccess(['message' => 'Sondaggio inviato. Grazie per il feedback!']);
}

function createSurvey(PDO $db): void
{
    $data       = apiGetJsonBody();
    $tenantId   = !empty($data['tenant_id']) ? (int) $data['tenant_id'] : null;
    $propertyId = !empty($data['property_id']) ? (int) $data['property_id'] : null;

    if ($tenantId === null && $propertyId === null) {
        apiError('Specifica almeno un inquilino o un immobile.');
    }

    $token = bin2hex(random_bytes(32)); // 64-char hex token

    $stmt = $db->prepare(
        "INSERT INTO tenant_surveys (tenant_id, property_id, token)
         VALUES (:tenant_id, :property_id, :token)"
    );
    $stmt->execute([
        'tenant_id'   => $tenantId,
        'property_id' => $propertyId,
        'token'       => $token,
    ]);

    $newId = (int) $db->lastInsertId();
    logActivity('create', 'survey', $newId, 'Sondaggio creato con token');

    // Build the public survey link
    $baseUrl = defined('APP_URL') ? rtrim(APP_URL, '/') : '';
    $link    = $baseUrl . '/survey.php?token=' . $token;

    apiSuccess([
        'id'    => $newId,
        'token' => $token,
        'link'  => $link,
    ]);
}

function deleteSurvey(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT id FROM tenant_surveys WHERE id = :id");
    $stmt->execute(['id' => $id]);
    if (!$stmt->fetch()) {
        apiError('Sondaggio non trovato.', 404);
    }

    $db->prepare("DELETE FROM tenant_surveys WHERE id = :id")->execute(['id' => $id]);

    logActivity('delete', 'survey', $id, 'Sondaggio eliminato #' . $id);
    apiSuccess(['id' => $id, 'message' => 'Sondaggio eliminato.']);
}
