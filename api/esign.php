<?php
/**
 * E-Signature Requests API.
 *
 * GET    /api/esign.php                       — admin: paginated list
 * GET    /api/esign.php?token=X               — public: signing request details (no auth)
 * POST   /api/esign.php                       — admin: create signing request
 * POST   /api/esign.php?token=X&action=sign   — public: sign (no auth, captures IP)
 * DELETE /api/esign.php?id={id}              — admin: cancel/delete
 */

require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/api_helpers.php';
require_once __DIR__ . '/../config/api_pagination.php';
require_once __DIR__ . '/../config/csrf.php';
require_once __DIR__ . '/../config/activity_log.php';
require_once __DIR__ . '/../config/auth.php';
require_once __DIR__ . '/../config/mail.php';
require_once __DIR__ . '/../config/mail_html.php';
require_once __DIR__ . '/../config/settings.php';
require_once __DIR__ . '/../config/rate_limit.php';

apiHandleOptions();

$method  = $_SERVER['REQUEST_METHOD'];
$token   = trim($_GET['token'] ?? '');
$action  = trim($_GET['action'] ?? '');

// Public endpoints: token GET and sign POST — skip auth
$isPublicGet  = $method === 'GET' && $token !== '';
$isPublicSign = $method === 'POST' && $token !== '' && $action === 'sign';

// Rate-limit the public sign endpoint to prevent token brute-force / spam
if ($isPublicSign) {
    checkRateLimit('esign_sign', 10, 60, false);
}

if (!$isPublicGet && !$isPublicSign) {
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
                getEsignByToken($db, $token);
            } else {
                listEsignRequests($db);
            }
            break;
        case 'POST':
            if ($isPublicSign) {
                signDocument($db, $token);
            } else {
                createEsignRequest($db);
            }
            break;
        case 'DELETE':
            if (!$id) apiError('ID richiesta mancante.');
            deleteEsignRequest($db, $id);
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

function listEsignRequests(PDO $db): void
{
    $pagination = apiGetPagination();
    $status     = trim($_GET['status'] ?? '');

    $where  = 'WHERE 1=1';
    $params = [];

    if ($status !== '' && in_array($status, ['pending', 'signed', 'expired'], true)) {
        $where .= ' AND er.status = :status';
        $params['status'] = $status;
    }

    $countSql = "SELECT COUNT(*) FROM esign_requests er $where";

    $dataSql = "SELECT er.*
            FROM esign_requests er
            $where
            ORDER BY er.created_at DESC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getEsignByToken(PDO $db, string $token): void
{
    $stmt = $db->prepare(
        "SELECT er.*
         FROM esign_requests er
         WHERE er.token = :token"
    );
    $stmt->execute(['token' => $token]);
    $row = $stmt->fetch();

    if (!$row) {
        apiError('Richiesta di firma non trovata.', 404);
    }

    // Auto-expire if past expires_at
    if ($row['status'] === 'pending' && $row['expires_at'] !== null) {
        if (strtotime($row['expires_at']) < time()) {
            $db->prepare("UPDATE esign_requests SET status = 'expired' WHERE token = :token")
               ->execute(['token' => $token]);
            $row['status'] = 'expired';
        }
    }

    apiSuccess($row);
}

function createEsignRequest(PDO $db): void
{
    $data        = apiGetJsonBody();
    $signerName  = trim($data['signer_name'] ?? '');
    $signerEmail = trim($data['signer_email'] ?? '');
    $documentId  = !empty($data['document_id']) ? (int) $data['document_id'] : null;
    $contractId  = !empty($data['contract_id']) ? (int) $data['contract_id'] : null;
    $expiresAt   = trim($data['expires_at'] ?? '') ?: date('Y-m-d H:i:s', strtotime('+30 days'));

    if ($signerName === '') apiError('Nome del firmatario obbligatorio.');
    if ($signerEmail === '' || !filter_var($signerEmail, FILTER_VALIDATE_EMAIL)) apiError('Email del firmatario non valida.');
    if ($documentId === null && $contractId === null) apiError('Specificare document_id o contract_id.');

    $token = bin2hex(random_bytes(32)); // 64-char hex token

    $stmt = $db->prepare(
        "INSERT INTO esign_requests
            (document_id, contract_id, signer_name, signer_email, token, status, expires_at)
         VALUES
            (:document_id, :contract_id, :signer_name, :signer_email, :token, 'pending', :expires_at)"
    );
    $stmt->execute([
        'document_id'  => $documentId,
        'contract_id'  => $contractId,
        'signer_name'  => $signerName,
        'signer_email' => $signerEmail,
        'token'        => $token,
        'expires_at'   => $expiresAt,
    ]);

    $newId = (int) $db->lastInsertId();
    logActivity('create', 'esign', $newId, 'Richiesta firma creata per ' . $signerEmail);

    $baseUrl = defined('APP_URL') ? rtrim(APP_URL, '/') : '';
    $link    = $baseUrl . '/sign.php?token=' . $token;

    // Send signing invitation email to the signer
    $agencyName = getSetting('agency_name', 'Gestionale Immobiliare');
    $emailSubject = $agencyName . ' — Richiesta di firma documento';
    $emailBody    = "Gentile {$signerName},\n\n"
        . "Le è stato inviato un documento da firmare elettronicamente.\n\n"
        . "Clicchi sul link seguente per visualizzare e firmare il documento:\n"
        . $link . "\n\n"
        . "Il link è valido fino al " . date('d/m/Y', strtotime($expiresAt)) . ".\n\n"
        . "Cordiali saluti,\n" . $agencyName;
    $emailResult = sendHtmlEmail($signerEmail, $emailSubject, $emailBody);
    $emailSent   = $emailResult['success'] ?? false;

    $stmt = $db->prepare("SELECT * FROM esign_requests WHERE id = :id");
    $stmt->execute(['id' => $newId]);
    $request = $stmt->fetch();
    $request['sign_link']   = $link;
    $request['email_sent']  = $emailSent;

    apiSuccess($request);
}

function signDocument(PDO $db, string $token): void
{
    $stmt = $db->prepare("SELECT * FROM esign_requests WHERE token = :token");
    $stmt->execute(['token' => $token]);
    $request = $stmt->fetch();

    if (!$request) {
        apiError('Richiesta di firma non trovata.', 404);
    }
    if ($request['status'] === 'signed') {
        apiError('Documento già firmato.');
    }
    if ($request['status'] === 'expired') {
        apiError('Il link di firma è scaduto.');
    }
    if ($request['expires_at'] !== null && strtotime($request['expires_at']) < time()) {
        $db->prepare("UPDATE esign_requests SET status = 'expired' WHERE token = :token")
           ->execute(['token' => $token]);
        apiError('Il link di firma è scaduto.');
    }

    $ip = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? null;
    if ($ip !== null) {
        $ip = trim(explode(',', $ip)[0]);
        if (!filter_var($ip, FILTER_VALIDATE_IP)) {
            $ip = null;
        }
    }

    $upd = $db->prepare(
        "UPDATE esign_requests
         SET status = 'signed', signed_at = NOW(), ip_address = :ip
         WHERE token = :token"
    );
    $upd->execute(['ip' => $ip, 'token' => $token]);

    logActivity('update', 'esign', (int) $request['id'], 'Documento firmato da ' . $request['signer_name'] . ' IP: ' . ($ip ?? 'unknown'));

    apiSuccess([
        'message'     => 'Documento firmato con successo.',
        'signer_name' => $request['signer_name'],
        'signed_at'   => date('Y-m-d H:i:s'),
    ]);
}

function deleteEsignRequest(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT id FROM esign_requests WHERE id = :id");
    $stmt->execute(['id' => $id]);
    if (!$stmt->fetch()) {
        apiError('Richiesta non trovata.', 404);
    }

    $db->prepare("DELETE FROM esign_requests WHERE id = :id")->execute(['id' => $id]);

    logActivity('delete', 'esign', $id, 'Richiesta firma eliminata #' . $id);
    apiSuccess(['id' => $id, 'message' => 'Richiesta eliminata.']);
}
