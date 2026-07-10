<?php
/**
 * Mailgun Inbound Email Webhook
 *
 * Configure in Mailgun: Receiving → Routes → Forward to this URL.
 * Mailgun posts multipart form data. We verify the HMAC-SHA256 signature,
 * match the sender to a client, and save the email to the communications table.
 *
 * Webhook URL: https://yourdomain.com/api/email_inbound.php
 */

require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/settings.php';

// ── Signature verification ───────────────────────────────────────────────────

$signingKey = getSetting('mailgun_webhook_key', '');
$timestamp  = $_POST['timestamp'] ?? '';
$token      = $_POST['token']     ?? '';
$signature  = $_POST['signature'] ?? '';

if ($signingKey === '') {
    // FAIL CLOSED in production: without the signing key we cannot verify Mailgun's
    // signature, so a forged inbound email must be rejected. Non-production skips.
    $isProd = strtolower((string) env('APP_ENV', 'production')) === 'production';
    if ($isProd) {
        error_log('[email_inbound] REJECTED: no mailgun_webhook_key configured in production — refusing unverified request.');
        http_response_code(503);
        exit('Webhook not configured');
    }
    error_log('[email_inbound] WARNING: no mailgun_webhook_key — skipping signature check (non-production only).');
} else {
    $expectedSig = hash_hmac('sha256', $timestamp . $token, $signingKey);
    if (!hash_equals($expectedSig, $signature)) {
        http_response_code(403);
        exit('Invalid signature');
    }

    // Reject replayed requests older than 5 minutes
    if (abs(time() - (int) $timestamp) > 300) {
        http_response_code(403);
        exit('Timestamp expired');
    }
}

// ── Parse email fields ───────────────────────────────────────────────────────

$fromRaw = $_POST['from']           ?? '';
$to      = $_POST['recipient']      ?? ($_POST['To'] ?? '');
$subject = trim($_POST['subject']   ?? '(senza oggetto)');

// Prefer stripped-text (no quoted reply chains), fall back to body-plain
$body = trim($_POST['stripped-text'] ?? $_POST['body-plain'] ?? '');
if ($body === '') {
    $body = trim(strip_tags($_POST['body-html'] ?? ''));
}

// Extract plain email address from "Name <email@example.com>"
$senderEmail = '';
if (preg_match('/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/i', $fromRaw, $m)) {
    $senderEmail = strtolower(trim($m[0]));
}

// ── Database operations ──────────────────────────────────────────────────────

try {
    $db = getDB();

    // Find matching client by email
    $clientId   = null;
    $clientName = null;

    if ($senderEmail !== '') {
        $stmt = $db->prepare(
            "SELECT id, name, surname FROM clients WHERE LOWER(email) = :email LIMIT 1"
        );
        $stmt->execute(['email' => $senderEmail]);
        $client = $stmt->fetch();

        if ($client) {
            $clientId   = (int) $client['id'];
            $clientName = $client['name'] . ' ' . $client['surname'];
        }
    }

    // Save to communications table
    $commStmt = $db->prepare(
        "INSERT INTO communications
            (client_id, direction, channel, subject, body, from_email, to_email, status, created_at)
         VALUES
            (:client_id, 'received', 'email', :subject, :body, :from_email, :to_email, 'received', NOW())"
    );
    $commStmt->execute([
        'client_id'  => $clientId,
        'subject'    => mb_substr($subject, 0, 255),
        'body'       => $body,
        'from_email' => $senderEmail ?: $fromRaw,
        'to_email'   => $to,
    ]);

    $commId = (int) $db->lastInsertId();

    // Create in-app notification
    $senderLabel = $clientName ?: ($senderEmail ?: $fromRaw);
    $notifTitle  = 'Email ricevuta da ' . $senderLabel;
    $notifBody   = $subject !== '(senza oggetto)' ? $subject : mb_substr($body, 0, 100);

    $notifStmt = $db->prepare(
        "INSERT INTO notifications
            (type, title, body, entity_type, entity_id, is_read, created_at)
         VALUES
            ('email_inbound', :title, :body, 'communication', :entity_id, 0, NOW())"
    );
    $notifStmt->execute([
        'title'     => mb_substr($notifTitle, 0, 255),
        'body'      => mb_substr($notifBody, 0, 255),
        'entity_id' => $commId,
    ]);

} catch (Throwable $e) {
    // Return 200 to Mailgun so it doesn't retry — log the error
    error_log('email_inbound error: ' . $e->getMessage());
}

// Mailgun expects a 200 response to confirm delivery
http_response_code(200);
echo 'OK';
