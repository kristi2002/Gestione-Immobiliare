<?php
/**
 * Send a WhatsApp message via Twilio.
 * POST { phone, message, [tenant_id], [reminder_id] }
 */
require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/whatsapp.php';
require_once __DIR__ . '/../config/rate_limit.php';

apiHandleOptions();
apiRequireMethod('POST');
requireRole('admin', 'agent', 'super_admin');

// Rate limit: 20 outbound WhatsApp messages per user per minute (no admin bypass — Twilio costs money)
checkRateLimit('whatsapp_send', 20, 60, false);

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

// ── Traccia in whatsapp_messages ────────────────────────────────────────────
// Senza questa INSERT il messaggio partiva davvero ma non esisteva da nessuna
// parte: l'agente rispondeva dall'inbox, la chat si ricaricava e la sua stessa
// risposta non c'era. Il thread mostrava solo i messaggi in arrivo.
// Il numero viene normalizzato come lo scrive Twilio in entrata, altrimenti
// "333 1234567" e "+393331234567" diventerebbero due conversazioni distinte.
try {
    $db     = getDB();
    $toNorm = normalizeWhatsAppNumber($phone);

    // Se il chiamante non ha passato un contesto, lo si risolve dal numero:
    // così anche una risposta scritta dall'inbox resta agganciata alla persona.
    $leadId = null;
    if (!$tenantId && !$clientId) {
        // L'associazione già decisa per questa conversazione batte la ricerca
        // per numero: altrimenti una chat agganciata a mano si spaccherebbe fra
        // due contatti al primo messaggio in uscita.
        $contact  = waExistingThreadContact($db, $toNorm) ?? resolveWhatsAppContact($db, $toNorm);
        $clientId = $contact['client_id'];
        $tenantId = $contact['tenant_id'];
        $leadId   = $contact['lead_id'];
    }

    $db->prepare(
        "INSERT INTO whatsapp_messages
            (direction, from_number, to_number, body, twilio_sid, client_id, tenant_id, lead_id, status, is_read, received_at)
         VALUES
            ('outbound', :from_number, :to_number, :body, :sid, :client_id, :tenant_id, :lead_id, :status, 1, NOW())"
    )->execute([
        'from_number' => preg_replace('/^whatsapp:/', '', (string) (getWhatsAppConfig()['from'] ?? '')),
        'to_number'   => $toNorm,
        'body'        => $message,
        'sid'         => $result['external_id'],
        'client_id'   => $clientId ?: null,
        'tenant_id'   => $tenantId ?: null,
        'lead_id'     => $leadId,
        'status'      => $result['status'],
    ]);
} catch (PDOException) {
    // Non-fatal — il messaggio è già partito, non si può disfare.
}

// Il thread di Comunicazioni è indicizzato sul proprietario: senza client_id la
// riga non sarebbe raggiungibile da nessuna schermata (e con lo schema originale
// nemmeno inseribile). Un inquilino/lead resta tracciato in whatsapp_messages.
if ($clientId) {
    try {
        $db = getDB();
        // external_id: senza il SID Twilio lo status callback non ha modo di
        // ritrovare questa riga e lo stato resterebbe congelato all'invio.
        $db->prepare(
            'INSERT INTO communications (client_id, direction, channel, subject, body, status, status_updated_at, external_id, created_at)
             VALUES (:cid, "sent", "whatsapp", :subj, :body, :status, NOW(), :ext, NOW())'
        )->execute([
            'cid'    => $clientId,
            'subj'   => 'WhatsApp: ' . mb_substr($message, 0, 80),
            'body'   => $message,
            'status' => $result['status'],
            'ext'    => $result['external_id'],
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
