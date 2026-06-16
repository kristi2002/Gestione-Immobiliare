<?php
/**
 * Send a WhatsApp message via Twilio.
 * POST { phone, message, [tenant_id], [reminder_id] }
 */
require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/whatsapp.php';

apiHandleOptions();
apiRequireMethod('POST');
requireRole('admin', 'agent', 'super_admin');

$data    = apiGetJsonBody();
$phone   = trim($data['phone'] ?? '');
$message = trim($data['message'] ?? '');

if ($phone === '' || $message === '') {
    apiError('Numero di telefono e messaggio sono obbligatori.');
}

$result = sendWhatsAppMessage($phone, $message);

if (!$result['success']) {
    apiError($result['error'] ?? 'Errore invio WhatsApp.', 422);
}

// Log the communication if a tenant_id or client context is provided
$tenantId = isset($data['tenant_id']) ? (int)$data['tenant_id'] : null;
$clientId = isset($data['client_id']) ? (int)$data['client_id'] : null;

if ($tenantId || $clientId) {
    try {
        $db = getDB();
        $db->prepare(
            'INSERT INTO communications (client_id, direction, channel, subject, body, status, created_at)
             VALUES (:cid, "sent", "whatsapp", :subj, :body, "sent", NOW())'
        )->execute([
            'cid'  => $clientId,
            'subj' => 'WhatsApp: ' . mb_substr($message, 0, 80),
            'body' => $message,
        ]);
    } catch (PDOException) {
        // Non-fatal — message already sent
    }
}

apiSuccess([
    'status'      => $result['status'],
    'external_id' => $result['external_id'],
    'message'     => 'Messaggio WhatsApp inviato.',
]);
