<?php
/**
 * Webhook WhatsApp — Meta Cloud API.
 * Da configurare nel pannello Meta: https://<dominio>/api/whatsapp_webhook.php
 *
 * Due metodi, due lavori diversi:
 *   GET  — la verifica con cui Meta attiva la sottoscrizione (hub.challenge).
 *   POST — i messaggi in arrivo E gli stati di consegna dei nostri, che qui
 *          arrivano insieme: con Twilio gli stati erano un endpoint separato.
 */

require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/settings.php';
require_once __DIR__ . '/../config/whatsapp.php';

// ── Verifica della sottoscrizione ────────────────────────────────────────────
// Meta chiama in GET una sola volta, quando si salva l'URL nel pannello: se non
// le si restituisce la challenge in chiaro, il webhook non viene mai attivato e
// non arrivera' nemmeno un messaggio, senza alcun errore visibile da questa parte.
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $challenge = metaWebhookChallenge([
        'hub_mode'         => $_GET['hub_mode']         ?? $_GET['hub.mode']         ?? '',
        'hub_verify_token' => $_GET['hub_verify_token'] ?? $_GET['hub.verify_token'] ?? '',
        'hub_challenge'    => $_GET['hub_challenge']    ?? $_GET['hub.challenge']    ?? '',
    ]);

    if ($challenge === null) {
        error_log('[whatsapp_webhook] verifica rifiutata: verify token assente o diverso.');
        http_response_code(403);
        exit;
    }

    header('Content-Type: text/plain; charset=utf-8');
    echo $challenge;
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit;
}

// ── Firma ────────────────────────────────────────────────────────────────────
// HMAC-SHA256 del corpo GREZZO con l'app secret. Va letto prima di toccarlo:
// ricostruirlo dal JSON decodificato cambierebbe la firma.
// FAIL CLOSED in produzione: senza app secret non possiamo verificare, quindi
// una richiesta non verificabile va rifiutata. Solo fuori produzione si salta.
$rawBody = file_get_contents('php://input') ?: '';
$verdict = verifyMetaWebhook($rawBody);

if ($verdict === 'unconfigured') {
    error_log('[whatsapp_webhook] RIFIUTATO: nessun meta_wa_app_secret in produzione — richiesta non verificabile.');
    http_response_code(503);
    exit;
}
if ($verdict === 'invalid') {
    http_response_code(403);
    exit;
}
if ($verdict === 'skipped') {
    error_log('[whatsapp_webhook] ATTENZIONE: nessun meta_wa_app_secret — firma non verificata (solo fuori produzione).');
}

$payload = json_decode($rawBody, true);
if (!is_array($payload)) {
    http_response_code(400);
    exit;
}

$parsed = parseMetaWebhook($payload);
$db     = getDB();

// ── Stati di consegna dei messaggi che abbiamo mandato noi ───────────────────
foreach ($parsed['statuses'] as $st) {
    if ($st['external_id'] === '' || $st['status'] === '') {
        continue;
    }

    $newStatus = metaStatusToCommStatus($st['status']);

    try {
        // Gli stati possono arrivare fuori sequenza (un 'sent' dopo un
        // 'delivered'): senza il confronto di rango, un ritardo di rete farebbe
        // tornare indietro le spunte gia' mostrate all'agente.
        $cur = $db->prepare('SELECT status FROM whatsapp_messages WHERE external_id = :sid LIMIT 1');
        $cur->execute(['sid' => $st['external_id']]);
        $old = (string) ($cur->fetchColumn() ?: '');

        if ($old === '' || commStatusRank($newStatus) >= commStatusRank($old)) {
            $db->prepare('UPDATE whatsapp_messages SET status = :status WHERE external_id = :sid')
               ->execute(['status' => $newStatus, 'sid' => $st['external_id']]);
            $db->prepare('UPDATE communications SET status = :status, status_updated_at = NOW() WHERE external_id = :sid')
               ->execute(['status' => $newStatus, 'sid' => $st['external_id']]);
        }
    } catch (PDOException $e) {
        error_log('[whatsapp_webhook] errore DB sullo stato: ' . $e->getMessage());
    }

    if ($st['error'] !== null) {
        error_log('[whatsapp_webhook] consegna fallita a ' . $st['recipient'] . ': ' . $st['error']);
    }
}

// ── Messaggi in arrivo ───────────────────────────────────────────────────────
foreach ($parsed['messages'] as $msg) {
    $from      = $msg['from'];
    $to        = $msg['to'];
    $body      = trim($msg['body']);
    $media     = $msg['media'];
    $waId      = $msg['external_id'];

    // Una foto senza didascalia arriva con il corpo vuoto: scartarla come
    // "messaggio vuoto" butterebbe via l'intero messaggio senza dire niente a
    // nessuno — il cliente vede la spunta di consegna e in agenzia non arriva nulla.
    if ($from === '+' || ($body === '' && !$media)) {
        continue;
    }

    $stored    = $media ? waStoreInboundMedia($media[0], $waId) : null;
    $mediaUrl  = $stored['path'] ?? null;
    $mediaMime = $stored['mime'] ?? null;
    $mediaName = $stored['name'] ?? null;

    // Risoluzione del mittente su proprietari / inquilini / lead. La logica è
    // condivisa con l'inbox (config/whatsapp.php) così un numero riconosciuto in
    // entrata è lo stesso che l'agente vede associato nella chat.
    // Anche qui l'aggancio manuale già presente sulla conversazione ha la
    // precedenza sulla ricerca per numero (vedi waExistingThreadContact).
    $contact  = waExistingThreadContact($db, $from) ?? resolveWhatsAppContact($db, $from);
    $clientId = $contact['client_id'];
    $tenantId = $contact['tenant_id'];
    $leadId   = $contact['lead_id'];

    $msgInsert = $db->prepare(
        "INSERT INTO whatsapp_messages
            (direction, from_number, to_number, body, media_url, media_mime, media_name, external_id, client_id, tenant_id, lead_id, is_read, received_at)
         VALUES
            ('inbound', :from_number, :to_number, :body, :media_url, :media_mime, :media_name, :external_id, :client_id, :tenant_id, :lead_id, 0, NOW())"
    );
    $msgInsert->execute([
        'from_number' => $from,
        'to_number'   => $to,
        'body'        => $body,
        'media_url'   => $mediaUrl,
        'media_mime'  => $mediaMime,
        'media_name'  => $mediaName,
        'external_id'  => $waId,
        'client_id'   => $clientId,
        'tenant_id'   => $tenantId,
        'lead_id'     => $leadId,
    ]);
    $messageId = (int) $db->lastInsertId();

    // Un messaggio di solo allegato ha il corpo vuoto: in archivio e nella
    // notifica deve comunque leggersi qualcosa, altrimenti l'agente vede una
    // riga bianca e non sa che c'e' un file da aprire.
    $mediaLabel = match (true) {
        $mediaMime === null                   => '',
        str_starts_with($mediaMime, 'image/') => '[Immagine]',
        str_starts_with($mediaMime, 'audio/') => '[Messaggio vocale]',
        str_starts_with($mediaMime, 'video/') => '[Video]',
        default                               => '[Allegato]',
    };
    if ($mediaLabel === '' && $media && $mediaUrl === null) {
        // Allegato annunciato da Meta ma non scaricato: dirlo, non tacerlo.
        $mediaLabel = '[Allegato non scaricato]';
    }
    $displayBody = trim($body === '' ? $mediaLabel : $body . ($mediaLabel !== '' ? ' ' . $mediaLabel : ''));

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
            'body'     => $displayBody,
            'to_email' => getSetting('agency_email'),
            'ext'      => $waId,
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
            'body'      => mb_substr($displayBody, 0, 200),
            'entity_id' => $messageId,
        ]);
    } catch (Throwable $e) {
        // Notifications table may not exist yet — don't break the webhook response
    }
}

// Meta rispedisce il webhook finche' non riceve un 200: qualunque cosa sia
// successa qui sopra, la presa in carico va confermata una volta sola.
http_response_code(200);
echo 'OK';
