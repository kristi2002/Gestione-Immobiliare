<?php
/**
 * Twilio WhatsApp inbound webhook.
 * Configure in Twilio: POST https://your-domain/gestionale/api/whatsapp_webhook.php
 */

require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/settings.php';
require_once __DIR__ . '/../config/whatsapp.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit;
}

$data = parseTwilioWebhook($_POST);
$from = preg_replace('/^whatsapp:/', '', $data['from'] ?? '');
$body = trim($data['body'] ?? '');

if ($from === '' || $body === '') {
    http_response_code(200);
    echo '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
    exit;
}

$db = getDB();
$phone = '%' . substr(preg_replace('/\D/', '', $from), -9);

$stmt = $db->prepare(
    "SELECT id, email FROM clients WHERE phone LIKE :phone AND status = 'active' LIMIT 1"
);
$stmt->execute(['phone' => $phone]);
$client = $stmt->fetch();

if ($client) {
    $insert = $db->prepare(
        "INSERT INTO communications (client_id, direction, channel, subject, body, from_email, to_email, status, external_id)
         VALUES (:cid, 'received', 'whatsapp', NULL, :body, NULL, :to, 'received', :ext)"
    );
    $insert->execute([
        'cid'  => $client['id'],
        'body' => $body,
        'to'   => getSetting('agency_email'),
        'ext'  => $data['external_id'],
    ]);
}

header('Content-Type: text/xml');
echo '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
