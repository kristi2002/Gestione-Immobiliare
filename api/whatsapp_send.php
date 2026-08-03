<?php
/**
 * Send a WhatsApp message via Meta Cloud API.
 *
 * Due modi, decisi dalla finestra di 24 ore di Meta:
 *   POST { phone, message }                    — testo libero, solo a finestra aperta
 *   POST { phone, template_id, params:{...} }  — template approvato, sempre ammesso
 *
 * Opzionali su entrambi: tenant_id, client_id.
 */
require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/whatsapp.php';
require_once __DIR__ . '/../config/rate_limit.php';

apiHandleOptions();
apiRequireMethod('POST');
requireRole('admin', 'agent', 'super_admin');

// Rate limit: 20 outbound WhatsApp messages per user per minute (no admin bypass — ogni conversazione si paga)
checkRateLimit('whatsapp_send', 20, 60, false);

$data       = apiGetJsonBody();
$phone      = trim($data['phone'] ?? '');
$message    = trim($data['message'] ?? '');
$templateId = isset($data['template_id']) ? (int) $data['template_id'] : 0;
$params     = is_array($data['params'] ?? null) ? $data['params'] : [];

if ($phone === '') {
    apiError('Il numero di telefono è obbligatorio.');
}
if ($templateId <= 0 && $message === '') {
    apiError('Serve un messaggio o un template.');
}

$db     = getDB();
$window = waWindowState($db, $phone);

if ($templateId > 0) {
    // ── Template approvato ──────────────────────────────────────────────────
    $stmt = $db->prepare('SELECT * FROM whatsapp_templates WHERE id = :id');
    $stmt->execute(['id' => $templateId]);
    $tpl = $stmt->fetch();

    if (!$tpl) {
        apiError('Template non trovato.', 404);
    }

    $metaName = trim((string) ($tpl['meta_template_name'] ?? ''));
    if ($metaName === '') {
        apiError('Il template "' . $tpl['name'] . '" non è collegato a un template Meta: '
            . 'aggiungi il nome registrato nel Business Manager in Impostazioni → Template WhatsApp.', 422);
    }
    if (($tpl['meta_status'] ?? 'bozza') !== 'approvato') {
        apiError('Il template "' . $tpl['name'] . '" non risulta approvato da Meta: '
            . 'un invio con un template non approvato viene rifiutato.', 422);
    }

    // I valori arrivano per nome ({{nome}}), Meta li vuole per posizione: e'
    // l'ordine di `variables` a fare da traduttore, ed e' anche l'ordine con cui
    // il template e' stato registrato su Meta. Un buco qui non va riempito con
    // stringa vuota: Meta conta i parametri e rifiuta l'invio, quindi tanto vale
    // dirlo prima e per nome.
    $names   = waTemplateVariables($tpl);
    $values  = [];
    $missing = [];
    foreach ($names as $n) {
        $v = trim((string) ($params[$n] ?? ''));
        if ($v === '') {
            $missing[] = $n;
        }
        $values[$n] = $v;
    }
    if ($missing) {
        apiError('Valori mancanti per il template: ' . implode(', ', $missing) . '.', 422);
    }

    $message = waRenderTemplate((string) $tpl['body'], $values);
    $result  = sendWhatsAppTemplate(
        $phone,
        $metaName,
        array_values($values),
        (string) ($tpl['meta_language'] ?: 'it')
    );
} else {
    // ── Testo libero ────────────────────────────────────────────────────────
    // La guardia vale quando WhatsApp e' davvero acceso. A integrazione spenta
    // l'invio e' simulato e non tocca Meta: bloccarlo renderebbe impossibile
    // provare l'inbox prima di avere i template approvati. La risposta porta
    // comunque `window_closed`, cosi' la schermata dice la verita' invece di
    // mostrare un invio che in produzione non partirebbe.
    if (!$window['open'] && getWhatsAppConfig()['enabled']) {
        apiError(
            $window['last_inbound_at'] === null
                ? 'Questo numero non ci ha mai scritto: fuori dalla finestra di 24 ore WhatsApp accetta solo un template approvato.'
                : 'Sono passate più di 24 ore dall\'ultimo messaggio del cliente: ora WhatsApp accetta solo un template approvato.',
            422
        );
    }

    $result = sendWhatsAppMessage($phone, $message);
}

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
// Il numero viene normalizzato nella stessa forma che arriva dal webhook, altrimenti
// "333 1234567" e "+393331234567" diventerebbero due conversazioni distinte.
// Con WhatsApp spento config/whatsapp.php risponde success=true (per non
// bloccare i flussi) ma marca simulated=true. Scrivere 'sent' in archivio per un
// messaggio che nessuno ha ricevuto rende l'archivio inservibile proprio nel
// momento in cui serve: quando si deve dire a un inquilino cosa gli era stato
// comunicato e quando.
$simulated  = !empty($result['simulated']);
$savedStatus = $simulated ? 'simulated' : $result['status'];

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
            (direction, from_number, to_number, body, external_id, client_id, tenant_id, lead_id, status, is_read, received_at)
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
        // $savedStatus, non $result['status']: due righe piu' sotto la stessa
        // richiesta scrive 'simulated' in `communications` (riga 100), e qui
        // scriveva 'sent' per lo stesso identico messaggio. La Inbox WhatsApp
        // legge questa tabella, Comunicazioni legge l'altra: lo stesso messaggio
        // risultava spedito in una schermata e non spedito nell'altra.
        'status'      => $savedStatus,
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
        // external_id: senza il wamid di Meta lo stato di consegna non ha modo di
        // ritrovare questa riga e lo stato resterebbe congelato all'invio.
        $db->prepare(
            'INSERT INTO communications (client_id, direction, channel, subject, body, status, status_updated_at, external_id, created_at)
             VALUES (:cid, "sent", "whatsapp", :subj, :body, :status, NOW(), :ext, NOW())'
        )->execute([
            'cid'    => $clientId,
            'subj'   => 'WhatsApp: ' . mb_substr($message, 0, 80),
            'body'   => $message,
            'status' => $savedStatus,
            'ext'    => $result['external_id'],
        ]);
    } catch (PDOException) {
        // Non-fatal — message already sent
    }
}

// window_closed: vero solo per un testo libero passato perche' l'integrazione e'
// spenta. Con WhatsApp acceso quel caso non arriva fin qui (viene rifiutato
// sopra), quindi e' esattamente l'avviso "in produzione questo non partirebbe".
$windowBypassed = $templateId <= 0 && !$window['open'];

apiSuccess([
    'status'        => $savedStatus,
    'simulated'     => $simulated,
    'external_id'   => $result['external_id'],
    'window_closed' => $windowBypassed,
    'message'       => match (true) {
        $simulated && $windowBypassed => "Invio simulato. Attenzione: fuori dalla finestra di 24 ore — a WhatsApp attivo servirebbe un template approvato.",
        $simulated                    => "Invio simulato: l'integrazione WhatsApp non è attiva, il messaggio non è partito.",
        default                       => 'Messaggio WhatsApp inviato.',
    },
]);
