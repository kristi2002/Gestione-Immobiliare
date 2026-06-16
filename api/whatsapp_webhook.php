<?php
/**
 * Twilio WhatsApp inbound webhook.
 * Configure in Twilio: POST https://your-domain/gestionale/api/whatsapp_webhook.php
 *
 * Enhanced: saves inbound messages to whatsapp_messages table and creates a notification.
 */

require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/settings.php';
require_once __DIR__ . '/../config/whatsapp.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit;
}

$data      = parseTwilioWebhook($_POST);
$from      = preg_replace('/^whatsapp:/', '', $data['from'] ?? '');
$to        = preg_replace('/^whatsapp:/', '', $data['to'] ?? '');
$body      = trim($data['body'] ?? '');
$mediaUrl  = trim($data['media_url'] ?? '') ?: null;
$twilioSid = trim($data['external_id'] ?? '') ?: null;

if ($from === '' || $body === '') {
    http_response_code(200);
    echo '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
    exit;
}

$db    = getDB();
$phone = '%' . substr(preg_replace('/\D/', '', $from), -9);

// Look up client by phone number
$clientStmt = $db->prepare(
    "SELECT id, email FROM clients WHERE phone LIKE :phone AND status = 'active' LIMIT 1"
);
$clientStmt->execute(['phone' => $phone]);
$client = $clientStmt->fetch();

// Look up tenant by phone number
$tenantStmt = $db->prepare(
    "SELECT id FROM tenants WHERE phone LIKE :phone AND status = 'active' LIMIT 1"
);
$tenantStmt->execute(['phone' => $phone]);
$tenant = $tenantStmt->fetch();

$clientId = $client ? (int) $client['id'] : null;
$tenantId = $tenant ? (int) $tenant['id'] : null;

// Save to whatsapp_messages table
$msgInsert = $db->prepare(
    "INSERT INTO whatsapp_messages
        (direction, from_number, to_number, body, media_url, twilio_sid, client_id, tenant_id, is_read, received_at)
     VALUES
        ('inbound', :from_number, :to_number, :body, :media_url, :twilio_sid, :client_id, :tenant_id, 0, NOW())"
);
$msgInsert->execute([
    'from_number' => $from,
    'to_number'   => $to,
    'body'        => $body,
    'media_url'   => $mediaUrl,
    'twilio_sid'  => $twilioSid,
    'client_id'   => $clientId,
    'tenant_id'   => $tenantId,
]);
$messageId = (int) $db->lastInsertId();

// Also log to legacy communications table if a client is identified
if ($clientId !== null) {
    $commInsert = $db->prepare(
        "INSERT INTO communications
            (client_id, direction, channel, subject, body, from_email, to_email, status, external_id)
         VALUES
            (:cid, 'received', 'whatsapp', NULL, :body, NULL, :to_email, 'received', :ext)"
    );
    $commInsert->execute([
        'cid'      => $clientId,
        'body'     => $body,
        'to_email' => getSetting('agency_email'),
        'ext'      => $twilioSid,
    ]);
}

// Create a notification for admin users about the new inbound message
$senderLabel = 'Sconosciuto (' . $from . ')';
if ($clientId !== null) {
    $senderLabel = trim(($client['name'] ?? '') . ' ' . ($client['surname'] ?? '')) ?: $from;
} elseif ($tenantId !== null && $tenant) {
    $senderLabel = $from;
}

try {
    $notifInsert = $db->prepare(
        "INSERT INTO notifications
            (type, title, body, entity_type, entity_id, is_read, created_at)
         VALUES
            ('whatsapp_inbound', :title, :body, 'whatsapp_message', :entity_id, 0, NOW())"
    );
    $notifInsert->execute([
        'title'     => 'Messaggio WhatsApp da ' . $senderLabel,
        'body'      => mb_substr($body, 0, 200),
        'entity_id' => $messageId,
    ]);
} catch (Throwable $e) {
    // Notifications table may not exist yet — don't break the webhook response
}

header('Content-Type: text/xml');
echo '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
