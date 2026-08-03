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
require_once __DIR__ . '/../config/client_ip.php';

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
            } elseif ($action === 'link') {
                if (!$id) apiError('ID richiesta mancante.');
                getEsignLink($db, $id);
            } else {
                listEsignRequests($db);
            }
            break;
        case 'POST':
            if ($isPublicSign) {
                signDocument($db, $token);
            } elseif ($action === 'resend') {
                if (!$id) apiError('ID richiesta mancante.');
                resendEsignRequest($db, $id);
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
    // A pending row whose expires_at has passed is not pending, it is dead —
    // but nothing rewrote it until the signer opened the link (getEsignByToken),
    // which for an abandoned request never happens. The list would show
    // "In attesa" forever and the agency would keep chasing a link that can no
    // longer be signed. Settle the status before reading, so what is displayed,
    // what is counted, and what ?status= filters on all agree.
    $db->exec("UPDATE esign_requests
                  SET status = 'expired'
                WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW()");

    $pagination = apiGetPagination();
    $status     = trim($_GET['status'] ?? '');
    $search     = trim($_GET['search'] ?? '');

    $where  = 'WHERE 1=1';
    $params = [];

    if ($status !== '' && in_array($status, ['pending', 'signed', 'expired'], true)) {
        $where .= ' AND er.status = :status';
        $params['status'] = $status;
    }
    if ($search !== '') {
        $where .= ' AND (er.signer_name LIKE :q OR er.signer_email LIKE :q2)';
        $params['q']  = '%' . $search . '%';
        $params['q2'] = '%' . $search . '%';
    }

    $countSql = "SELECT COUNT(*) FROM esign_requests er $where";

    // Without these joins the list could say who was asked to sign but not what
    // they were asked to sign — the one thing you need before chasing or
    // revoking. The token is deliberately NOT selected: see below.
    $dataSql = "SELECT er.id, er.document_id, er.contract_id,
                       er.signer_name, er.signer_email, er.status,
                       er.signed_at, er.ip_address, er.created_at, er.expires_at,
                       d.title      AS document_title,
                       d.doc_type   AS document_type,
                       c.title      AS contract_title,
                       c.contract_type,
                       p.address    AS property_address,
                       p.city       AS property_city
            FROM esign_requests er
            LEFT JOIN documents  d ON d.id = er.document_id
            LEFT JOIN contracts  c ON c.id = er.contract_id
            LEFT JOIN properties p ON p.id = c.property_id
            $where
            ORDER BY er.created_at DESC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

/**
 * Re-send the invitation for a request that is still pending — the "chase".
 *
 * Deliberately reuses the existing token instead of issuing a new one: the
 * agency chases the same request, and any copy of the link already in the
 * signer's inbox keeps working. Re-issuing would silently invalidate a link
 * the signer may be about to use.
 */
function resendEsignRequest(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT * FROM esign_requests WHERE id = :id");
    $stmt->execute(['id' => $id]);
    $request = $stmt->fetch();

    if (!$request) {
        apiError('Richiesta non trovata.', 404);
    }
    if ($request['status'] === 'signed') {
        apiError('Il documento è già stato firmato: non c\'è nulla da sollecitare.');
    }
    if ($request['status'] === 'expired'
        || ($request['expires_at'] !== null && strtotime($request['expires_at']) < time())) {
        apiError('Il link è scaduto. Crea una nuova richiesta di firma.');
    }

    $baseUrl = appBaseUrl();
    $link    = $baseUrl . '/sign.php?token=' . $request['token'];

    $agencyName = getSetting('agency_name', 'Gestionale Immobiliare');
    $subject    = $agencyName . ' — Sollecito: documento da firmare';
    $body       = "Gentile {$request['signer_name']},\n\n"
        . "Le ricordiamo che è in attesa della sua firma un documento inviato in precedenza.\n\n"
        . "Può firmarlo da qui:\n" . $link . "\n\n"
        . "Il link è valido fino al " . date('d/m/Y', strtotime($request['expires_at'])) . ".\n\n"
        . "Cordiali saluti,\n" . $agencyName;

    $result = sendHtmlEmail($request['signer_email'], $subject, $body);

    // `simulated` means the mailer is switched off and accepted the message
    // without sending it. Reporting that as a successful chase would tell the
    // agency someone had been reminded when nobody was.
    $simulated = !empty($result['simulated']);
    $sent      = !empty($result['success']) && !$simulated;

    if ($sent) {
        logActivity('update', 'esign', $id, 'Sollecito firma inviato a ' . $request['signer_email']);
    }

    apiSuccess([
        'id'        => $id,
        'sent'      => $sent,
        'simulated' => $simulated,
        'error'     => $result['error'] ?? null,
        'sign_link' => $link,
        'message'   => $sent
            ? 'Sollecito inviato a ' . $request['signer_email'] . '.'
            : ($simulated
                ? 'Invio email disattivato: il sollecito NON è stato inviato. Copia il link e invialo a mano.'
                : 'Invio non riuscito: ' . ($result['error'] ?? 'errore sconosciuto')),
    ]);
}

/**
 * The signing link for a pending request, on explicit demand.
 *
 * The token is not part of the list payload: it is the bearer credential that
 * signs the document, and every list render would have put a working signature
 * link into the browser of every user who can open the page, plus into any
 * response log along the way. Handing it over one request at a time, on a
 * deliberate click, keeps that blast radius to the row the user asked for —
 * and it is the only way to send a signature request while email is down.
 */
function getEsignLink(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT id, token, status, signer_name, expires_at FROM esign_requests WHERE id = :id");
    $stmt->execute(['id' => $id]);
    $request = $stmt->fetch();

    if (!$request) {
        apiError('Richiesta non trovata.', 404);
    }
    if ($request['status'] !== 'pending') {
        apiError('Il link è utilizzabile solo per una richiesta ancora in attesa di firma.');
    }

    $baseUrl = appBaseUrl();
    apiSuccess([
        'id'          => (int) $request['id'],
        'signer_name' => $request['signer_name'],
        'expires_at'  => $request['expires_at'],
        'sign_link'   => $baseUrl . '/sign.php?token=' . $request['token'],
    ]);
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

    $baseUrl = appBaseUrl();
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
    // With the mailer off, sendHtmlEmail() reports success for a message it
    // never sent. Passing that through as email_sent told the agency the
    // signer had been invited, while the only working copy of the link sat in
    // this response and nowhere else.
    $emailSimulated = !empty($emailResult['simulated']);
    $emailSent      = !empty($emailResult['success']) && !$emailSimulated;

    $stmt = $db->prepare("SELECT * FROM esign_requests WHERE id = :id");
    $stmt->execute(['id' => $newId]);
    $request = $stmt->fetch();
    $request['sign_link']       = $link;
    $request['email_sent']      = $emailSent;
    $request['email_simulated'] = $emailSimulated;
    $request['email_error']     = $emailResult['error'] ?? null;

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

    // This IP is the only technical evidence of who signed, so it must not be
    // whatever the signer's browser claims. X-Forwarded-For is a request header
    // like any other: anyone could have sent `X-Forwarded-For: 1.2.3.4` and
    // written that straight into the signature record, which is worse than
    // recording no IP at all — a false address that looks like proof.
    // clientIpAddress() honours forwarded headers only when the request
    // actually arrived through a proxy we trust, and falls back to REMOTE_ADDR.
    $ip = clientIpAddress();
    if (!filter_var($ip, FILTER_VALIDATE_IP)) {
        $ip = null;
    }

    $upd = $db->prepare(
        "UPDATE esign_requests
         SET status = 'signed', signed_at = NOW(), ip_address = :ip
         WHERE token = :token"
    );
    $upd->execute(['ip' => $ip, 'token' => $token]);

    logActivity('update', 'esign', (int) $request['id'], 'Documento firmato da ' . $request['signer_name'] . ' IP: ' . ($ip ?? 'unknown'));

    // La firma raccolta deve muovere il contratto: senza questo il cliente
    // aveva firmato ma nel gestionale restava "Inviato", senza scadenzario,
    // con l'immobile ancora disponibile e l'annuncio ancora pubblicato.
    require_once __DIR__ . '/../lib/contract_lifecycle.php';
    $advance = contractAdvanceAfterSignature($db, (int) ($request['contract_id'] ?? 0));

    apiSuccess([
        'message'     => 'Documento firmato con successo.',
        'signer_name' => $request['signer_name'],
        'signed_at'   => date('Y-m-d H:i:s'),
        'contract'    => [
            'advanced'         => $advance['advanced'],
            'reason'           => $advance['reason'],
            'payments_created' => $advance['payments_created'],
            'property_rented'  => (bool) ($advance['occupancy']['changed'] ?? false),
        ],
    ]);
}

function deleteEsignRequest(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT id, status, signer_name, signed_at FROM esign_requests WHERE id = :id");
    $stmt->execute(['id' => $id]);
    $request = $stmt->fetch();

    if (!$request) {
        apiError('Richiesta non trovata.', 404);
    }

    // A signed row is not a to-do item, it is the evidence that a named person
    // signed at a given time from a given IP. Once the row is gone there is
    // nothing left to show that the signature ever happened, and the deletion
    // is exactly what someone disputing it would want. Revoking is for requests
    // still waiting; a signed one stays.
    if ($request['status'] === 'signed') {
        apiError(
            'Questa richiesta è già stata firmata da ' . $request['signer_name']
            . ' il ' . date('d/m/Y H:i', strtotime($request['signed_at']))
            . ': è la prova della firma e non può essere eliminata.',
            409
        );
    }

    $db->prepare("DELETE FROM esign_requests WHERE id = :id")->execute(['id' => $id]);

    logActivity('delete', 'esign', $id, 'Richiesta firma revocata #' . $id . ' (' . $request['signer_name'] . ')');
    apiSuccess(['id' => $id, 'message' => 'Richiesta revocata: il link non è più valido.']);
}
