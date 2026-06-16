<?php
/**
 * Tenant maintenance/assistance request endpoint.
 */
require_once __DIR__ . '/../config/bootstrap.php';
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

$tenantId = getCurrentTenantId();
$db = getDB();

$tenant = $db->prepare('SELECT * FROM tenants WHERE id = :id');
$tenant->execute(['id' => $tenantId]);
$tenant = $tenant->fetch(PDO::FETCH_ASSOC);

if (!$tenant) {
    http_response_code(403);
    exit(json_encode(['success' => false, 'error' => 'Inquilino non trovato.']));
}

$input   = json_decode(file_get_contents('php://input'), true) ?: [];
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

// Resolve client_id via the tenant's property
$prop = $db->prepare('SELECT client_id FROM properties WHERE id = :pid');
$prop->execute(['pid' => $tenant['property_id']]);
$prop = $prop->fetch(PDO::FETCH_ASSOC);
$clientId = $prop ? $prop['client_id'] : null;

$db->prepare(
    'INSERT INTO reminders (client_id, property_id, title, description, reminder_date, frequency, status, created_at)
     VALUES (:cid, :pid, :title, :desc, CURDATE(), :freq, :status, NOW())'
)->execute([
    'cid'    => $clientId,
    'pid'    => $tenant['property_id'],
    'title'  => $fullTitle,
    'desc'   => $fullDesc,
    'freq'   => 'once',
    'status' => 'pending',
]);

exit(json_encode(['success' => true, 'data' => ['message' => 'Richiesta inviata con successo. L\'agenzia ti contatterà a breve.']]));
