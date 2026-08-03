<?php
/**
 * Antiriciclaggio / Adeguata Verifica (D.lgs 231/2007) CRUD API.
 *
 * GET    /api/aml.php                 — list (status, risk_level, search, expiring)
 * GET    /api/aml.php?id={id}         — single record
 * POST   /api/aml.php                 — create
 * PUT    /api/aml.php?id={id}         — update
 * DELETE /api/aml.php?id={id}         — delete
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
apiHandleOptions();

const AML_SUBJECT_TYPES = ['persona_fisica', 'persona_giuridica'];
const AML_VERIFICATION  = ['ordinaria', 'semplificata', 'rafforzata'];
const AML_RISK          = ['basso', 'medio', 'alto'];
const AML_OPERATIONS    = ['vendita', 'locazione', 'mediazione', 'altro'];
const AML_STATUSES      = ['da_completare', 'completata', 'sospesa'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            $id ? getAml($db, $id) : listAml($db);
            break;
        case 'POST':
            createAml($db);
            break;
        case 'PUT':
            if (!$id) apiError('ID pratica mancante.');
            updateAml($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID pratica mancante.');
            deleteAml($db, $id);
            break;
        default:
            apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------

function listAml(PDO $db): void
{
    $pagination = apiGetPagination();
    $status     = trim($_GET['status'] ?? '');
    $risk       = trim($_GET['risk_level'] ?? '');
    $search     = trim($_GET['search'] ?? '');
    $expiring   = !empty($_GET['expiring']);

    $where  = 'WHERE 1=1';
    $params = [];

    if ($status !== '' && in_array($status, AML_STATUSES, true)) {
        $where .= ' AND a.status = :status';
        $params['status'] = $status;
    }
    if ($risk !== '' && in_array($risk, AML_RISK, true)) {
        $where .= ' AND a.risk_level = :risk';
        $params['risk'] = $risk;
    }
    if ($expiring) {
        $where .= ' AND a.retention_until IS NOT NULL
                    AND a.retention_until BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 180 DAY)';
    }
    if ($search !== '') {
        $sfrag = apiWordSearch($search, ['a.subject_name', 'a.codice_fiscale', 'a.partita_iva', 'a.beneficial_owner'], $params);
        if ($sfrag !== '') $where .= ' AND (' . $sfrag . ')';
    }

    $countSql = "SELECT COUNT(*) FROM aml_records a $where";
    $dataSql  = "SELECT a.*,
                    TRIM(CONCAT(COALESCE(c.name,''),' ',COALESCE(c.surname,''))) AS client_name,
                    p.address AS property_address
                 FROM aml_records a
                 LEFT JOIN clients c ON c.id = a.client_id
                 LEFT JOIN properties p ON p.id = a.property_id
                 $where
                 ORDER BY (a.status = 'da_completare') DESC, a.verification_date DESC, a.id DESC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);

    $statsRow = $db->query(
        "SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'da_completare' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN risk_level = 'alto' THEN 1 ELSE 0 END) AS high_risk,
            SUM(CASE WHEN retention_until BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 180 DAY) THEN 1 ELSE 0 END) AS expiring
         FROM aml_records"
    )->fetch();

    $pages = $total > 0 ? (int) ceil($total / $pagination['limit']) : 0;
    apiSuccess([
        'items' => $items,
        'total' => $total,
        'page'  => $pagination['page'],
        'limit' => $pagination['limit'],
        'pages' => $pages,
        'stats' => [
            'total'     => (int) $statsRow['total'],
            'pending'   => (int) $statsRow['pending'],
            'high_risk' => (int) $statsRow['high_risk'],
            'expiring'  => (int) $statsRow['expiring'],
        ],
    ]);
}

function getAml(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT a.*,
                TRIM(CONCAT(COALESCE(c.name,''),' ',COALESCE(c.surname,''))) AS client_name,
                p.address AS property_address
         FROM aml_records a
         LEFT JOIN clients c ON c.id = a.client_id
         LEFT JOIN properties p ON p.id = a.property_id
         WHERE a.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    if (!$row) apiError('Pratica non trovata.', 404);
    apiSuccess($row);
}

function createAml(PDO $db): void
{
    $v = validateAmlInput(apiGetJsonBody());

    $stmt = $db->prepare(
        "INSERT INTO aml_records
            (subject_name, subject_type, codice_fiscale, partita_iva, client_id, lead_id, property_id,
             verification_type, risk_level, operation_type, operation_value,
             id_document_type, id_document_number, id_document_expiry, beneficial_owner, is_pep,
             purpose, verification_date, retention_until, status, notes, created_by)
         VALUES
            (:subject_name, :subject_type, :codice_fiscale, :partita_iva, :client_id, :lead_id, :property_id,
             :verification_type, :risk_level, :operation_type, :operation_value,
             :id_document_type, :id_document_number, :id_document_expiry, :beneficial_owner, :is_pep,
             :purpose, :verification_date, :retention_until, :status, :notes, :created_by)"
    );
    $stmt->execute(array_merge($v, ['created_by' => getCurrentAdminId()]));

    $newId = (int) $db->lastInsertId();
    logActivity('create', 'aml', $newId, 'Pratica antiriciclaggio: ' . $v['subject_name']);
    getAml($db, $newId);
}

function updateAml(PDO $db, int $id): void
{
    if (!amlExists($db, $id)) apiError('Pratica non trovata.', 404);
    $v = validateAmlInput(apiGetJsonBody());

    $stmt = $db->prepare(
        "UPDATE aml_records SET
            subject_name = :subject_name, subject_type = :subject_type,
            codice_fiscale = :codice_fiscale, partita_iva = :partita_iva,
            client_id = :client_id, lead_id = :lead_id, property_id = :property_id,
            verification_type = :verification_type, risk_level = :risk_level,
            operation_type = :operation_type, operation_value = :operation_value,
            id_document_type = :id_document_type, id_document_number = :id_document_number,
            id_document_expiry = :id_document_expiry, beneficial_owner = :beneficial_owner, is_pep = :is_pep,
            purpose = :purpose, verification_date = :verification_date, retention_until = :retention_until,
            status = :status, notes = :notes
         WHERE id = :id"
    );
    $stmt->execute(array_merge($v, ['id' => $id]));

    logActivity('update', 'aml', $id, 'Pratica antiriciclaggio aggiornata #' . $id);
    getAml($db, $id);
}

function deleteAml(PDO $db, int $id): void
{
    if (!amlExists($db, $id)) apiError('Pratica non trovata.', 404);
    $db->prepare('DELETE FROM aml_records WHERE id = :id')->execute(['id' => $id]);
    logActivity('delete', 'aml', $id, 'Pratica antiriciclaggio eliminata #' . $id);
    apiSuccess(['id' => $id, 'message' => 'Pratica eliminata.']);
}

// ---------------------------------------------------------------------------

function validateAmlInput(array $data): array
{
    $dateOrNull = static function ($v) {
        $v = isset($v) ? trim((string) $v) : '';
        return $v !== '' && DateTime::createFromFormat('Y-m-d', $v) ? $v : null;
    };
    $strOrNull = static fn($v) => isset($v) && trim((string) $v) !== '' ? trim((string) $v) : null;
    $enum = static fn($v, array $allowed, string $def) => in_array($v = trim((string) ($v ?? '')), $allowed, true) ? $v : $def;

    $subjectName = trim($data['subject_name'] ?? '');
    if ($subjectName === '') apiError('Il nominativo del soggetto è obbligatorio.');

    $verificationDate = $dateOrNull($data['verification_date'] ?? null);
    $retentionUntil   = $dateOrNull($data['retention_until'] ?? null);
    // Conservazione 10 anni dall'operazione — auto-fill from verification date.
    if ($retentionUntil === null && $verificationDate !== null) {
        $retentionUntil = (new DateTime($verificationDate))->modify('+10 years')->format('Y-m-d');
    }

    return [
        'subject_name'       => $subjectName,
        'subject_type'       => $enum($data['subject_type'] ?? null, AML_SUBJECT_TYPES, 'persona_fisica'),
        'codice_fiscale'     => $strOrNull($data['codice_fiscale'] ?? null),
        'partita_iva'        => $strOrNull($data['partita_iva'] ?? null),
        'client_id'          => !empty($data['client_id']) ? (int) $data['client_id'] : null,
        'lead_id'            => !empty($data['lead_id']) ? (int) $data['lead_id'] : null,
        'property_id'        => !empty($data['property_id']) ? (int) $data['property_id'] : null,
        'verification_type'  => $enum($data['verification_type'] ?? null, AML_VERIFICATION, 'ordinaria'),
        'risk_level'         => $enum($data['risk_level'] ?? null, AML_RISK, 'basso'),
        'operation_type'     => $enum($data['operation_type'] ?? null, AML_OPERATIONS, 'mediazione'),
        'operation_value'    => isset($data['operation_value']) && $data['operation_value'] !== '' ? (float) $data['operation_value'] : null,
        'id_document_type'   => $strOrNull($data['id_document_type'] ?? null),
        'id_document_number' => $strOrNull($data['id_document_number'] ?? null),
        'id_document_expiry' => $dateOrNull($data['id_document_expiry'] ?? null),
        'beneficial_owner'   => $strOrNull($data['beneficial_owner'] ?? null),
        'is_pep'             => !empty($data['is_pep']) ? 1 : 0,
        'purpose'            => $strOrNull($data['purpose'] ?? null),
        'verification_date'  => $verificationDate,
        'retention_until'    => $retentionUntil,
        'status'             => $enum($data['status'] ?? null, AML_STATUSES, 'da_completare'),
        'notes'              => $strOrNull($data['notes'] ?? null),
    ];
}

function amlExists(PDO $db, int $id): bool
{
    $stmt = $db->prepare('SELECT id FROM aml_records WHERE id = :id');
    $stmt->execute(['id' => $id]);
    return (bool) $stmt->fetch();
}
