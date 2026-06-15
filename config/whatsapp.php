<?php
/**
 * WhatsApp via Twilio API.
 */

require_once __DIR__ . '/settings.php';

function sendWhatsAppMessage(string $toPhone, string $body): array
{
    $cfg = getWhatsAppConfig();

    if (!$cfg['enabled']) {
        return ['success' => true, 'status' => 'sent', 'external_id' => 'wa-sim-' . uniqid(), 'error' => null];
    }

    if ($cfg['account_sid'] === '' || $cfg['auth_token'] === '' || $cfg['from'] === '') {
        return ['success' => false, 'status' => 'failed', 'external_id' => null, 'error' => 'WhatsApp/Twilio non configurato.'];
    }

    $to   = normalizeWhatsAppNumber($toPhone);
    $from = $cfg['from'];
    if (!str_starts_with($from, 'whatsapp:')) {
        $from = 'whatsapp:' . $from;
    }

    $url  = 'https://api.twilio.com/2010-04-01/Accounts/' . $cfg['account_sid'] . '/Messages.json';
    $post = http_build_query(['From' => $from, 'To' => 'whatsapp:' . $to, 'Body' => $body]);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $post,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_USERPWD        => $cfg['account_sid'] . ':' . $cfg['auth_token'],
        CURLOPT_TIMEOUT        => 30,
    ]);

    $raw  = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($raw === false || $code >= 400) {
        $data = json_decode((string) $raw, true);
        $msg  = $data['message'] ?? "HTTP {$code}";
        return ['success' => false, 'status' => 'failed', 'external_id' => null, 'error' => $msg];
    }

    $data = json_decode($raw, true);
    return [
        'success'     => true,
        'status'      => 'sent',
        'external_id' => $data['sid'] ?? ('wa-' . uniqid()),
        'error'       => null,
    ];
}

function normalizeWhatsAppNumber(string $phone): string
{
    $digits = preg_replace('/\D+/', '', $phone);
    if (str_starts_with($digits, '00')) {
        $digits = substr($digits, 2);
    }
    if (str_starts_with($digits, '0')) {
        $digits = '39' . substr($digits, 1);
    }
    if (!str_starts_with($digits, '39') && strlen($digits) <= 10) {
        $digits = '39' . $digits;
    }
    return '+' . $digits;
}

function parseTwilioWebhook(array $post): array
{
    return [
        'from'        => $post['From'] ?? '',
        'to'          => $post['To'] ?? '',
        'body'        => $post['Body'] ?? '',
        'external_id' => $post['MessageSid'] ?? null,
    ];
}
