<?php
/**
 * Mail helper — reads SMTP config from app_settings with .env fallback.
 */

require_once __DIR__ . '/settings.php';

/**
 * Ripulisce gli header aggiuntivi.
 *
 * Un "\r\n" dentro il valore di un header chiude l'header e apre quello dopo:
 * è l'header injection classica, con cui una stringa che finisce in un
 * `List-Unsubscribe` potrebbe aggiungere un Bcc. Oggi questi valori li
 * costruiamo noi, ma la funzione è pubblica e domani potrebbe non essere così.
 *
 * @param string[] $headers
 * @return string[]
 */
function mailSanitizeHeaders(array $headers): array
{
    $clean = [];
    foreach ($headers as $header) {
        $header = trim(str_replace(["\r", "\n"], '', (string) $header));
        if ($header !== '' && str_contains($header, ':')) {
            $clean[] = $header;
        }
    }
    return $clean;
}

/**
 * $cfgOverride serve all'invio di prova dalle Impostazioni: prova la
 * configurazione che l'utente ha davanti, non quella già salvata. Tutti gli
 * altri chiamanti passano null e leggono da app_settings.
 */
function sendClientEmail(string $to, string $subject, string $body, ?string $htmlBody = null, array $attachments = [], ?array $cfgOverride = null, array $extraHeaders = []): array
{
    $cfg = $cfgOverride ?? getMailConfig();
    $extraHeaders = mailSanitizeHeaders($extraHeaders);

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
        return sendViaSmtp($to, $subject, $body, $cfg, $htmlBody, $attachments, $extraHeaders);
    }

    $from = $cfg['agency_name'] . ' <' . $cfg['agency_email'] . '>';
    $headers = array_merge(
        ['From: ' . $from, 'Reply-To: ' . $cfg['agency_email'], 'MIME-Version: 1.0'],
        $extraHeaders
    );

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

/** Legge una risposta SMTP completa (l'ultima riga ha uno spazio in 4ª posizione). */
function smtpRead($socket): string
{
    $data = '';
    while ($line = fgets($socket, 515)) {
        $data .= $line;
        if (isset($line[3]) && $line[3] === ' ') break;
    }
    return $data;
}

/** Manda un comando e dice se il codice di risposta è fra quelli attesi. */
function smtpCmd($socket, string $command, array $expectCodes): bool
{
    fwrite($socket, $command . "\r\n");
    $code = (int) substr(smtpRead($socket), 0, 3);
    return in_array($code, $expectCodes, true);
}

/**
 * Apre la connessione SMTP e arriva fino all'autenticazione compresa.
 *
 * Sta in una funzione sola perché la usano sia l'invio vero sia la sonda di
 * `readiness.php`: due implementazioni della stessa stretta di mano vorrebbero
 * dire una sonda che dice "ok" mentre l'invio fallisce, che è esattamente il
 * problema che la sonda dovrebbe scoprire.
 *
 * @return array{socket: resource|null, error: string|null}
 */
function smtpOpenAuthenticated(array $cfg, int $timeout = 15): array
{
    $fail = static function ($socket, string $error): array {
        if ($socket) {
            fclose($socket);
        }
        return ['socket' => null, 'error' => $error];
    };

    $errno  = 0;
    $errstr = '';
    $host   = ($cfg['smtp_secure'] === 'ssl' ? 'ssl://' : '') . $cfg['smtp_host'];
    $socket = @fsockopen($host, $cfg['smtp_port'], $errno, $errstr, $timeout);

    if (!$socket) {
        return ['socket' => null, 'error' => "SMTP: {$errstr}"];
    }
    stream_set_timeout($socket, $timeout);

    smtpRead($socket);
    if (!smtpCmd($socket, 'EHLO localhost', [250])) {
        return $fail($socket, 'SMTP EHLO fallito.');
    }

    if ($cfg['smtp_secure'] === 'tls') {
        if (!smtpCmd($socket, 'STARTTLS', [220])) {
            return $fail($socket, 'SMTP STARTTLS fallito.');
        }
        // Se il TLS non si stabilisce la connessione resta APERTA e in chiaro: senza
        // questo controllo si proseguiva lo stesso fino ad `AUTH LOGIN`, spedendo
        // utente e password SMTP in chiaro sulla rete. Meglio chiudere e fallire.
        if (!stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) {
            return $fail($socket, 'SMTP: negoziazione TLS fallita.');
        }
        if (!smtpCmd($socket, 'EHLO localhost', [250])) {
            return $fail($socket, 'SMTP EHLO post-TLS fallito.');
        }
    }

    if (($cfg['smtp_user'] ?? '') !== '') {
        if (!smtpCmd($socket, 'AUTH LOGIN', [334])
            || !smtpCmd($socket, base64_encode($cfg['smtp_user']), [334])
            || !smtpCmd($socket, base64_encode((string) $cfg['smtp_pass']), [235])) {
            return $fail($socket, 'SMTP autenticazione fallita.');
        }
    }

    return ['socket' => $socket, 'error' => null];
}

/**
 * Verifica host, porta, TLS e credenziali SMTP senza spedire alcun messaggio:
 * arriva fino al 235 di `AUTH LOGIN` e chiude con QUIT. Serve ai controlli di
 * stato, che devono poter dire "le credenziali non funzionano" senza recapitare
 * posta a nessuno.
 *
 * @return array{ok: bool, error: string|null}
 */
function smtpAuthProbe(?array $cfg = null, int $timeout = 8): array
{
    $cfg ??= getMailConfig();

    if (($cfg['smtp_host'] ?? '') === '') {
        return ['ok' => false, 'error' => 'Nessun host SMTP configurato.'];
    }

    $opened = smtpOpenAuthenticated($cfg, $timeout);
    if ($opened['socket'] === null) {
        return ['ok' => false, 'error' => $opened['error']];
    }

    smtpCmd($opened['socket'], 'QUIT', [221]);
    fclose($opened['socket']);

    return ['ok' => true, 'error' => null];
}

function sendViaSmtp(string $to, string $subject, string $body, ?array $cfg = null, ?string $htmlBody = null, array $attachments = [], array $extraHeaders = []): array
{
    $cfg ??= getMailConfig();
    $extraHeaders = mailSanitizeHeaders($extraHeaders);

    $opened = smtpOpenAuthenticated($cfg);
    if ($opened['socket'] === null) {
        return ['success' => false, 'status' => 'failed', 'external_id' => null, 'error' => $opened['error']];
    }
    $socket = $opened['socket'];

    $read = static fn(): string => smtpRead($socket);
    $cmd  = static fn(string $command, array $expectCodes): bool => smtpCmd($socket, $command, $expectCodes);

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
    foreach ($extraHeaders as $header) {
        $message .= $header . "\r\n";
    }

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

    // La risposta al punto finale è QUELLA che dice se il messaggio è stato
    // accettato: il server può rifiutarlo qui (mittente non verificato, quota,
    // dimensione, contenuto) dopo aver detto 250 a tutti i comandi precedenti.
    // Prima veniva letta e buttata via, quindi un rifiuto tornava come
    // `status: 'sent'` e il gestionale registrava come inviato un messaggio che
    // non è mai partito.
    fwrite($socket, $message);
    $finalResp = $read();
    $finalCode = (int) substr($finalResp, 0, 3);
    $cmd('QUIT', [221]);
    fclose($socket);

    if ($finalCode !== 250) {
        $finalText = trim(substr($finalResp, 4));
        return ['success' => false, 'status' => 'failed', 'external_id' => null, 'error' => "SMTP: messaggio rifiutato dal server ({$finalCode}: {$finalText})."];
    }

    return ['success' => true, 'status' => 'sent', 'external_id' => 'smtp-' . uniqid(), 'error' => null];
}

function sendTestEmail(string $to, ?array $cfgOverride = null): array
{
    $cfg     = $cfgOverride ?? getMailConfig();
    $subject = 'Test email — ' . ($cfg['agency_name'] ?: 'Gestionale');
    $body    = "Questa è un'email di test dal gestionale immobiliare.\n\nSe la ricevi, la configurazione SMTP funziona correttamente.";
    $html    = wrapHtmlEmail($subject, $body);
    return sendClientEmail($to, $subject, $body, $html, [], $cfgOverride);
}
