<?php
/**
 * Property appraisals (Valutazioni immobile) CRUD API.
 *
 * GET    /api/property_appraisals.php?property_id={id} — list for a property
 * GET    /api/property_appraisals.php?id={id}          — single
 * POST   /api/property_appraisals.php                  — create
 * PUT    /api/property_appraisals.php?id={id}          — update
 * DELETE /api/property_appraisals.php?id={id}          — delete
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();

const APPRAISAL_RATINGS = ['ottimo', 'buono', 'discreto', 'da_ristrutturare'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            $id ? getAppraisal($db, $id) : listAppraisals($db);
            break;
        case 'POST':
            createAppraisal($db);
            break;
        case 'PUT':
            if (!$id) apiError('ID valutazione mancante.');
            updateAppraisal($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID valutazione mancante.');
            deleteAppraisal($db, $id);
            break;
        default:
            apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

function listAppraisals(PDO $db): void
{
    $pagination = apiGetPagination();
    $propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : null;
    $where = 'WHERE 1=1';
    $params = [];
    if ($propertyId) {
        $where .= ' AND a.property_id = :pid';
        $params['pid'] = $propertyId;
    }

    $countSql = "SELECT COUNT(*) FROM property_appraisals a $where";

    $dataSql = "SELECT a.*, u.username AS appraiser_name
            FROM property_appraisals a
            LEFT JOIN admin_users u ON u.id = a.appraised_by
            $where
            ORDER BY a.appraisal_date DESC, a.id DESC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getAppraisal(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT a.*, u.username AS appraiser_name
         FROM property_appraisals a
         LEFT JOIN admin_users u ON u.id = a.appraised_by
         WHERE a.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    if (!$row) apiError('Valutazione non trovata.', 404);
    apiSuccess($row);
}

function createAppraisal(PDO $db): void
{
    $validated = validateAppraisalInput($db, apiGetJsonBody());
    $validated['appraised_by'] = getCurrentAdminId() ?: null;
    $stmt = $db->prepare(
        "INSERT INTO property_appraisals
            (property_id, appraised_by, estimated_value, estimated_rent, condition_rating,
             notes, comparable_1_address, comparable_1_price, comparable_2_address,
             comparable_2_price, appraisal_date)
         VALUES
            (:property_id, :appraised_by, :estimated_value, :estimated_rent, :condition_rating,
             :notes, :comparable_1_address, :comparable_1_price, :comparable_2_address,
             :comparable_2_price, :appraisal_date)"
    );
    $stmt->execute($validated);
    getAppraisal($db, (int) $db->lastInsertId());
}

function updateAppraisal(PDO $db, int $id): void
{
    if (!appraisalExists($db, $id)) apiError('Valutazione non trovata.', 404);
    $validated = validateAppraisalInput($db, apiGetJsonBody());
    unset($validated['property_id']);
    $stmt = $db->prepare(
        "UPDATE property_appraisals SET
            estimated_value = :estimated_value, estimated_rent = :estimated_rent,
            condition_rating = :condition_rating, notes = :notes,
            comparable_1_address = :comparable_1_address, comparable_1_price = :comparable_1_price,
            comparable_2_address = :comparable_2_address, comparable_2_price = :comparable_2_price,
            appraisal_date = :appraisal_date
         WHERE id = :id"
    );
    $stmt->execute(array_merge($validated, ['id' => $id]));
    getAppraisal($db, $id);
}

function deleteAppraisal(PDO $db, int $id): void
{
    if (!appraisalExists($db, $id)) apiError('Valutazione non trovata.', 404);
    $db->prepare("DELETE FROM property_appraisals WHERE id = :id")->execute(['id' => $id]);
    apiSuccess(['id' => $id, 'message' => 'Valutazione eliminata.']);
}

function validateAppraisalInput(PDO $db, array $data): array
{
    $propertyId = (int) ($data['property_id'] ?? 0);
    $value      = isset($data['estimated_value']) && $data['estimated_value'] !== '' ? (float) $data['estimated_value'] : null;
    $rent       = isset($data['estimated_rent']) && $data['estimated_rent'] !== '' ? (float) $data['estimated_rent'] : null;
    $rating     = trim($data['condition_rating'] ?? 'buono');
    $notes      = trim($data['notes'] ?? '') ?: null;
    $c1addr     = trim($data['comparable_1_address'] ?? '') ?: null;
    $c1price    = isset($data['comparable_1_price']) && $data['comparable_1_price'] !== '' ? (float) $data['comparable_1_price'] : null;
    $c2addr     = trim($data['comparable_2_address'] ?? '') ?: null;
    $c2price    = isset($data['comparable_2_price']) && $data['comparable_2_price'] !== '' ? (float) $data['comparable_2_price'] : null;
    $date       = trim($data['appraisal_date'] ?? '') ?: date('Y-m-d');

    if ($propertyId <= 0) apiError('Immobile mancante.');
    if ($value === null || $value < 0) apiError('Valore stimato non valido.');
    if (!in_array($rating, APPRAISAL_RATINGS, true)) apiError('Stato di conservazione non valido.');
    if (!DateTime::createFromFormat('Y-m-d', $date)) apiError('Data non valida.');

    $check = $db->prepare("SELECT id FROM properties WHERE id = :id");
    $check->execute(['id' => $propertyId]);
    if (!$check->fetch()) apiError('Immobile non trovato.');

    return [
        'property_id'          => $propertyId,
        'estimated_value'      => $value,
        'estimated_rent'       => $rent,
        'condition_rating'     => $rating,
        'notes'                => $notes,
        'comparable_1_address' => $c1addr,
        'comparable_1_price'   => $c1price,
        'comparable_2_address' => $c2addr,
        'comparable_2_price'   => $c2price,
        'appraisal_date'       => $date,
    ];
}

function appraisalExists(PDO $db, int $id): bool
{
    $stmt = $db->prepare("SELECT id FROM property_appraisals WHERE id = :id");
    $stmt->execute(['id' => $id]);
    return (bool) $stmt->fetch();
}
