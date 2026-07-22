<?php
/**
 * Mail helper — reads SMTP config from app_settings with .env fallback.
 */

require_once __DIR__ . '/settings.php';

function sendClientEmail(string $to, string $subject, string $body, ?string $htmlBody = null, array $attachments = []): array
{
    $cfg = getMailConfig();

    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
        return ['success' => false, 'status' => 'failed', 'external_id' => null, 'error' => 'Email destinatario non valida.'];
    }

    // Gli allegati devono esistere PRIMA di aprire la connessione: un'email
    // spedita con meno allegati di quelli promessi è peggio di un errore chiaro.
    foreach ($attachments as $att) {
        if (empty($att['path']) || !is_readable($att['path'])) {
            $name = $att['name'] ?? basename((string) ($att['path'] ?? ''));
            return ['success' => false, 'status' => 'failed', 'external_id' => null, 'error' => "Allegato non trovato sul server: {$name}."];
        }
    }

    if (!$cfg['mail_enabled']) {
        // Mail is DISABLED — nothing is actually sent. We return success so dev
        // flows aren't blocked, but flag it as a simulation and stamp the id so the
        // caller/UI can be honest instead of claiming the message was delivered.
        error_log('[mail] SIMULATED send (mail_enabled=false) to ' . $to . ' — subject: ' . $subject
            . ($attachments ? ' — allegati: ' . count($attachments) : ''));
        return ['success' => true, 'status' => 'sent', 'external_id' => 'SIMULATED-' . uniqid(), 'simulated' => true, 'error' => null];
    }

    if ($cfg['smtp_host'] !== '') {
        return sendViaSmtp($to, $subject, $body, $cfg, $htmlBody, $attachments);
    }

    $from = $cfg['agency_name'] . ' <' . $cfg['agency_email'] . '>';
    $headers = ['From: ' . $from, 'Reply-To: ' . $cfg['agency_email'], 'MIME-Version: 1.0'];

    if ($attachments) {
        [$contentType, $message] = buildMixedMimeBody($body, $htmlBody, $attachments);
        $headers[] = 'Content-Type: ' . $contentType;
    } elseif ($htmlBody !== null) {
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

/**
 * Corpo MIME multipart/mixed: testo (o alternative testo+HTML) + allegati base64.
 * Restituisce [valore header Content-Type, corpo del messaggio].
 * I path degli allegati sono già stati verificati dal chiamante.
 */
function buildMixedMimeBody(string $body, ?string $htmlBody, array $attachments): array
{
    $mixed = 'mix_' . uniqid();
    $out   = '';

    if ($htmlBody !== null) {
        $alt  = 'alt_' . uniqid();
        $out .= "--{$mixed}\r\nContent-Type: multipart/alternative; boundary=\"{$alt}\"\r\n\r\n";
        $out .= "--{$alt}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n{$body}\r\n";
        $out .= "--{$alt}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n{$htmlBody}\r\n";
        $out .= "--{$alt}--\r\n";
    } else {
        $out .= "--{$mixed}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n{$body}\r\n";
    }

    foreach ($attachments as $att) {
        $content = (string) @file_get_contents($att['path']);
        $name    = str_replace(['"', "\r", "\n"], '', $att['name'] ?? basename($att['path']));
        $mime    = !empty($att['mime']) ? $att['mime'] : 'application/octet-stream';
        $out .= "--{$mixed}\r\n";
        $out .= "Content-Type: {$mime}; name=\"{$name}\"\r\n";
        $out .= "Content-Transfer-Encoding: base64\r\n";
        $out .= "Content-Disposition: attachment; filename=\"{$name}\"; filename*=UTF-8''" . rawurlencode($name) . "\r\n\r\n";
        $out .= chunk_split(base64_encode($content), 76, "\r\n");
    }
    $out .= "--{$mixed}--";

    return ['multipart/mixed; boundary="' . $mixed . '"', $out];
}

function sendViaSmtp(string $to, string $subject, string $body, ?array $cfg = null, ?string $htmlBody = null, array $attachments = []): array
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
        stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT);
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
    if (!$cmd('MAIL FROM:<' . $agencyEmail . '>', [250])) {
        fclose($socket);
        return ['success' => false, 'status' => 'failed', 'external_id' => null, 'error' => 'SMTP MAIL FROM fallito (mittente non autorizzato: ' . $agencyEmail . ').'];
    }
    if (!$cmd('RCPT TO:<' . $to . '>', [250, 251])) {
        fclose($socket);
        return ['success' => false, 'status' => 'failed', 'external_id' => null, 'error' => 'SMTP RCPT TO fallito (destinatario rifiutato: ' . $to . ').'];
    }
    fwrite($socket, "DATA\r\n");
    $dataResp = $read();
    $dataCode = (int) substr($dataResp, 0, 3);
    if ($dataCode !== 354) {
        fclose($socket);
        $dataText = trim(substr($dataResp, 4));
        return ['success' => false, 'status' => 'failed', 'external_id' => null, 'error' => "SMTP DATA fallito ({$dataCode}: {$dataText})."];
    }

    $message  = "From: " . $cfg['agency_name'] . " <{$agencyEmail}>\r\n";
    $message .= "To: <{$to}>\r\n";
    $message .= "Subject: {$subject}\r\n";
    $message .= "MIME-Version: 1.0\r\n";

    if ($attachments) {
        [$contentType, $mimeBody] = buildMixedMimeBody($body, $htmlBody, $attachments);
        $message .= "Content-Type: {$contentType}\r\n\r\n";
        // Dot-stuffing sull'intero corpo (le righe base64 non iniziano mai con '.').
        $message .= str_replace(["\r\n.", "\n."], ["\r\n..", "\n.."], $mimeBody) . "\r\n.\r\n";
    } elseif ($htmlBody !== null) {
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
    $cfg     = getMailConfig();
    $subject = 'Test email — ' . ($cfg['agency_name'] ?: 'Gestionale');
    $body    = "Questa è un'email di test dal gestionale immobiliare.\n\nSe la ricevi, la configurazione SMTP funziona correttamente.";
    $html    = wrapHtmlEmail($subject, $body);
    return sendClientEmail($to, $subject, $body, $html);
}
