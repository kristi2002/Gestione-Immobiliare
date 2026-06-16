<?php
/**
 * Mail helper — reads SMTP config from app_settings with .env fallback.
 */

require_once __DIR__ . '/settings.php';

function sendClientEmail(string $to, string $subject, string $body, ?string $htmlBody = null): array
{
    $cfg = getMailConfig();

    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
        return ['success' => false, 'status' => 'failed', 'external_id' => null, 'error' => 'Email destinatario non valida.'];
    }

    if (!$cfg['mail_enabled']) {
        return ['success' => true, 'status' => 'sent', 'external_id' => 'local-' . uniqid(), 'error' => null];
    }

    if ($cfg['smtp_host'] !== '') {
        return sendViaSmtp($to, $subject, $body, $cfg, $htmlBody);
    }

    $from = $cfg['agency_name'] . ' <' . $cfg['agency_email'] . '>';
    $headers = ['From: ' . $from, 'Reply-To: ' . $cfg['agency_email'], 'MIME-Version: 1.0'];

    if ($htmlBody !== null) {
        $boundary = 'b_' . uniqid();
        $headers[] = 'Content-Type: multipart/alternative; boundary="' . $boundary . '"';
        $message = "--{$boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n{$body}\r\n"
            . "--{$boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n{$htmlBody}\r\n--{$boundary}--";
    } else {
        $headers[] = 'Content-Type: text/plain; charset=UTF-8';
        $message = $body;
    }

    $sent = @mail($to, $subject, $message, implode("\r\n", $headers));

    return $sent
        ? ['success' => true, 'status' => 'sent', 'external_id' => 'mail-' . uniqid(), 'error' => null]
        : ['success' => false, 'status' => 'failed', 'external_id' => null, 'error' => 'Invio email fallito.'];
}

function sendAdminEmail(string $subject, string $body, ?string $htmlBody = null): array
{
    $cfg = getMailConfig();
    return sendClientEmail($cfg['agency_email'], $subject, $body, $htmlBody);
}

function sendViaSmtp(string $to, string $subject, string $body, ?array $cfg = null, ?string $htmlBody = null): array
{
    $cfg ??= getMailConfig();

    $errno  = 0;
    $errstr = '';
    $host   = ($cfg['smtp_secure'] === 'ssl' ? 'ssl://' : '') . $cfg['smtp_host'];
    $socket = @fsockopen($host, $cfg['smtp_port'], $errno, $errstr, 15);

    if (!$socket) {
        return ['success' => false, 'status' => 'failed', 'external_id' => null, 'error' => "SMTP: {$errstr}"];
    }

    $read = function () use ($socket): string {
        $data = '';
        while ($line = fgets($socket, 515)) {
            $data .= $line;
            if (isset($line[3]) && $line[3] === ' ') break;
        }
        return $data;
    };

    $cmd = function (string $command, array $expectCodes) use ($socket, $read): bool {
        fwrite($socket, $command . "\r\n");
        $resp = $read();
        $code = (int) substr($resp, 0, 3);
        return in_array($code, $expectCodes, true);
    };

    $read();
    if (!$cmd('EHLO localhost', [250])) {
        fclose($socket);
        return ['success' => false, 'status' => 'failed', 'external_id' => null, 'error' => 'SMTP EHLO fallito.'];
    }

    if ($cfg['smtp_secure'] === 'tls') {
        if (!$cmd('STARTTLS', [220])) {
            fclose($socket);
            return ['success' => false, 'status' => 'failed', 'external_id' => null, 'error' => 'SMTP STARTTLS fallito.'];
        }
        stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
        if (!$cmd('EHLO localhost', [250])) {
            fclose($socket);
            return ['success' => false, 'status' => 'failed', 'external_id' => null, 'error' => 'SMTP EHLO post-TLS fallito.'];
        }
    }

    if ($cfg['smtp_user'] !== '') {
        if (!$cmd('AUTH LOGIN', [334]) || !$cmd(base64_encode($cfg['smtp_user']), [334]) || !$cmd(base64_encode($cfg['smtp_pass']), [235])) {
            fclose($socket);
            return ['success' => false, 'status' => 'failed', 'external_id' => null, 'error' => 'SMTP autenticazione fallita.'];
        }
    }

    $agencyEmail = $cfg['agency_email'];
    if (!$cmd('MAIL FROM:<' . $agencyEmail . '>', [250]) || !$cmd('RCPT TO:<' . $to . '>', [250, 251]) || !$cmd('DATA', [354])) {
        fclose($socket);
        return ['success' => false, 'status' => 'failed', 'external_id' => null, 'error' => 'SMTP envelope fallito.'];
    }

    $message  = "From: " . $cfg['agency_name'] . " <{$agencyEmail}>\r\n";
    $message .= "To: <{$to}>\r\n";
    $message .= "Subject: {$subject}\r\n";
    $message .= "MIME-Version: 1.0\r\n";

    if ($htmlBody !== null) {
        $boundary = 'b_' . uniqid();
        $message .= "Content-Type: multipart/alternative; boundary=\"{$boundary}\"\r\n\r\n";
        $message .= "--{$boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n";
        $message .= str_replace(["\r\n.", "\n."], ["\r\n..", "\n.."], $body) . "\r\n";
        $message .= "--{$boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n";
        $message .= $htmlBody . "\r\n";
        $message .= "--{$boundary}--\r\n.\r\n";
    } else {
        $message .= "Content-Type: text/plain; charset=UTF-8\r\n\r\n";
        $message .= str_replace(["\r\n.", "\n."], ["\r\n..", "\n.."], $body) . "\r\n.\r\n";
    }

    fwrite($socket, $message);
    $read();
    $cmd('QUIT', [221]);
    fclose($socket);

    return ['success' => true, 'status' => 'sent', 'external_id' => 'smtp-' . uniqid(), 'error' => null];
}

function sendTestEmail(string $to): array
{
    $cfg = getMailConfig();
    $subject = 'Test email — ' . ($cfg['agency_name'] ?: 'Gestionale');
    $body    = "Questa è un'email di test dal gestionale immobiliare.\n\nSe la ricevi, la configurazione SMTP funziona.";
    return sendClientEmail($to, $subject, $body);
}
