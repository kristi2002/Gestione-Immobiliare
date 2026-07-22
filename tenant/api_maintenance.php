<?php
/**
 * Tenant maintenance/assistance request endpoint.
 */
require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/csrf.php';
initTenantSession();

header('Content-Type: application/json; charset=utf-8');

if (!isTenantLoggedIn()) {
    http_response_code(401);
    exit(json_encode(['success' => false, 'error' => 'Non autorizzato.']));
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit(json_encode(['success' => false, 'error' => 'Metodo non consentito.']));
}

// CSRF defense-in-depth (beyond SameSite=Lax). The token is issued into the
// tenant session when tenant/index.php renders and sent back as X-CSRF-Token.
$rawBody   = file_get_contents('php://input');
$parsed    = json_decode($rawBody, true) ?: [];
$csrfSent  = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($parsed['csrf_token'] ?? '');
if ($csrfSent === '' || !hash_equals(getCsrfToken(), (string) $csrfSent)) {
    http_response_code(403);
    exit(json_encode(['success' => false, 'error' => 'Token CSRF non valido.']));
}

$tenantId = getCurrentTenantId();
$db = getDB();

$tenant = $db->prepare('SELECT * FROM tenants WHERE id = :id');
$tenant->execute(['id' => $tenantId]);
$tenant = $tenant->fetch(PDO::FETCH_ASSOC);

if (!$tenant) {
    http_response_code(403);
    exit(json_encode(['success' => false, 'error' => 'Inquilino non trovato.']));
}

$input   = $parsed; // already decoded above (php://input is a one-shot stream)
$subject = trim($input['subject'] ?? '');
$message = trim($input['message'] ?? '');
$type    = in_array($input['type'] ?? '', ['maintenance', 'document', 'info', 'other'])
           ? $input['type']
           : 'other';

if ($subject === '' || $message === '') {
    http_response_code(400);
    exit(json_encode(['success' => false, 'error' => 'Oggetto e messaggio sono obbligatori.']));
}

$tenantName = ($_SESSION['tenant_name'] ?? 'Inquilino');
$fullTitle  = "[Richiesta $type] $subject";
$fullDesc   = $message . "\n\n— Inviato da: $tenantName (inquilino ID $tenantId)";

// Resolve property/client via the tenant's current contract (tenants no
// longer carry a fixed property_id — see getTenantCurrentContract in config/db.php).
$contract = getTenantCurrentContract($db, $tenantId);
$propertyId = $contract['property_id'] ?? null;
$clientId   = $contract['property_client_id'] ?? null;

$db->prepare(
    'INSERT INTO reminders (client_id, property_id, tenant_id, title, description, request_type, tenant_name, reminder_date, frequency, status, created_at)
     VALUES (:cid, :pid, :tid, :title, :desc, :rtype, :tname, CURDATE(), :freq, :status, NOW())'
)->execute([
    'cid'    => $clientId,
    'pid'    => $propertyId,
    'tid'    => $tenantId,
    'title'  => $fullTitle,
    'desc'   => $fullDesc,
    // Tag the request subtype so the admin maintenance board can filter to
    // genuine maintenance work-orders (and tenant_name populates its display).
    'rtype'  => $type,
    'tname'  => $tenantName,
    'freq'   => 'once',
    'status' => 'pending',
]);

exit(json_encode(['success' => true, 'data' => ['message' => 'Richiesta inviata con successo. L\'agenzia ti contatterà a breve.']]));
