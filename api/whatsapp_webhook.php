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

// ── Twilio signature validation ───────────────────────────────────────────────
// Twilio signs every webhook with HMAC-SHA1. We reject requests that lack a
// valid signature to prevent fake messages being injected into the database.
// FAIL CLOSED in production: if no auth token is configured we cannot verify the
// signature, so an unsigned/forged request must be rejected. Only non-production
// skips the check (to ease local dev/testing).
// Logica condivisa con api/twilio_status_callback.php: verifyTwilioRequest()
// in config/whatsapp.php. Il comportamento è identico a prima — 503 se in
// produzione manca l'auth token, 403 se la firma non torna.
$verdict = verifyTwilioRequest('/api/whatsapp_webhook.php', $_POST);

if ($verdict === 'unconfigured') {
    error_log('[whatsapp_webhook] REJECTED: no twilio_auth_token configured in production — refusing unverified request.');
    http_response_code(503);
    echo '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
    exit;
}
if ($verdict === 'invalid') {
    http_response_code(403);
    echo '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
    exit;
}
if ($verdict === 'skipped') {
    error_log('[whatsapp_webhook] WARNING: no twilio_auth_token — skipping signature check (non-production only).');
}
// ─────────────────────────────────────────────────────────────────────────────

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

$db = getDB();

// Risoluzione del mittente su proprietari / inquilini / lead. La logica è
// condivisa con l'inbox (config/whatsapp.php) così un numero riconosciuto in
// entrata è lo stesso che l'agente vede associato nella chat.
// Anche qui l'aggancio manuale già presente sulla conversazione ha la
// precedenza sulla ricerca per numero (vedi waExistingThreadContact).
$contact  = waExistingThreadContact($db, $from) ?? resolveWhatsAppContact($db, $from);
$clientId = $contact['client_id'];
$tenantId = $contact['tenant_id'];
$leadId   = $contact['lead_id'];

// Save to whatsapp_messages table
$msgInsert = $db->prepare(
    "INSERT INTO whatsapp_messages
        (direction, from_number, to_number, body, media_url, twilio_sid, client_id, tenant_id, lead_id, is_read, received_at)
     VALUES
        ('inbound', :from_number, :to_number, :body, :media_url, :twilio_sid, :client_id, :tenant_id, :lead_id, 0, NOW())"
);
$msgInsert->execute([
    'from_number' => $from,
    'to_number'   => $to,
    'body'        => $body,
    'media_url'   => $mediaUrl,
    'twilio_sid'  => $twilioSid,
    'client_id'   => $clientId,
    'tenant_id'   => $tenantId,
    'lead_id'     => $leadId,
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

// Create a notification for admin users about the new inbound message.
// Il nome arriva dal resolver: la query di lookup precedente selezionava solo
// id/email, quindi il nominativo era sempre vuoto e ogni notifica mostrava il
// numero grezzo anche per un proprietario perfettamente riconosciuto.
$senderLabel = $contact['name'] ?? ('Sconosciuto (' . $from . ')');

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
