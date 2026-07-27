<?php
/**
 * WhatsApp via Twilio API.
 */

require_once __DIR__ . '/settings.php';

function sendWhatsAppMessage(string $toPhone, string $body): array
{
    $cfg = getWhatsAppConfig();

    if (!$cfg['enabled']) {
        // WhatsApp DISABLED — nothing is actually sent. Return success so flows
        // aren't blocked, but flag it as a simulation (parity with mail.php / meta)
        // so callers/UI can be honest rather than claiming delivery.
        error_log('[whatsapp] SIMULATED send (whatsapp disabled) to ' . $toPhone);
        return ['success' => true, 'status' => 'sent', 'external_id' => 'wa-sim-' . uniqid(), 'simulated' => true, 'error' => null];
    }

    if ($cfg['account_sid'] === '' || $cfg['auth_token'] === '' || $cfg['from'] === '') {
        return ['success' => false, 'status' => 'failed', 'external_id' => null, 'error' => 'WhatsApp/Twilio non configurato.'];
    }

    $to   = normalizeWhatsAppNumber($toPhone);
    $from = $cfg['from'];
    if (!str_starts_with($from, 'whatsapp:')) {
        $from = 'whatsapp:' . $from;
    }

    $url    = 'https://api.twilio.com/2010-04-01/Accounts/' . $cfg['account_sid'] . '/Messages.json';
    $fields = ['From' => $from, 'To' => 'whatsapp:' . $to, 'Body' => $body];

    // Senza StatusCallback Twilio non ci dice mai se il messaggio è stato
    // consegnato o letto: la riga in communications resterebbe 'sent' per sempre.
    $callback = twilioStatusCallbackUrl();
    if ($callback !== null) {
        $fields['StatusCallback'] = $callback;
    }

    $post = http_build_query($fields);

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
        'status'      => twilioStatusToCommStatus($data['status'] ?? 'sent'),
        'external_id' => $data['sid'] ?? ('wa-' . uniqid()),
        'error'       => null,
    ];
}

/**
 * URL pubblico dello status callback, o null se APP_URL non è configurato
 * (in locale Twilio non potrebbe comunque raggiungerci).
 */
function twilioStatusCallbackUrl(): ?string
{
    $appUrl = defined('APP_URL') ? rtrim((string) APP_URL, '/') : '';
    if ($appUrl === '' || !str_starts_with($appUrl, 'http')) {
        return null;
    }
    return $appUrl . '/api/twilio_status_callback.php';
}

/**
 * Mappa il MessageStatus di Twilio sull'enum communications.status.
 * Twilio: accepted|queued|sending|sent|delivered|read|undelivered|failed|received
 */
function twilioStatusToCommStatus(string $twilioStatus): string
{
    return match (strtolower(trim($twilioStatus))) {
        'accepted', 'queued', 'sending' => 'queued',
        'delivered'                     => 'delivered',
        'read'                          => 'read',
        'undelivered', 'failed'         => 'failed',
        'received'                      => 'received',
        default                         => 'sent',
    };
}

/**
 * Ordine di avanzamento degli stati. I callback Twilio possono arrivare fuori
 * sequenza (il 'sent' dopo il 'delivered'): senza questo confronto un ritardo
 * di rete farebbe tornare indietro le spunte già mostrate all'agente.
 */
function commStatusRank(string $status): int
{
    return match ($status) {
        'draft'     => 0,
        'queued'    => 1,
        'sent'      => 2,
        'delivered' => 3,
        'read'      => 4,
        'failed'    => 5, // terminale: vince sempre, va mostrato all'agente
        default     => 2, // 'received' e simili: nessun avanzamento previsto
    };
}

/**
 * Verifica la firma HMAC-SHA1 con cui Twilio firma ogni webhook.
 *
 * Ritorna:
 *   'ok'           — firma valida
 *   'invalid'      — firma assente o non corrispondente
 *   'unconfigured' — nessun auth token in produzione: non possiamo verificare,
 *                    quindi la richiesta va RIFIUTATA (fail closed)
 *   'skipped'      — nessun auth token fuori produzione: check saltato (dev)
 *
 * @param string $endpointPath percorso dell'endpoint come lo vede Twilio,
 *                             es. '/api/twilio_status_callback.php'
 */
function verifyTwilioRequest(string $endpointPath, array $post): string
{
    $authToken = getSetting('twilio_auth_token') ?: (getenv('TWILIO_AUTH_TOKEN') ?: '');

    if ($authToken === '') {
        $isProd = strtolower((string) env('APP_ENV', 'production')) === 'production';
        return $isProd ? 'unconfigured' : 'skipped';
    }

    $signature = $_SERVER['HTTP_X_TWILIO_SIGNATURE'] ?? '';
    if ($signature === '') {
        return 'invalid';
    }

    // Algoritmo Twilio: URL canonico + parametri POST ordinati per chiave,
    // concatenati chiave+valore, poi HMAC-SHA1 con l'auth token.
    $appUrl = defined('APP_URL') ? rtrim((string) APP_URL, '/') : '';
    $sigBase = $appUrl . $endpointPath;

    ksort($post);
    foreach ($post as $key => $value) {
        $sigBase .= $key . $value;
    }

    $expected = base64_encode(hash_hmac('sha1', $sigBase, $authToken, true));

    return hash_equals($expected, $signature) ? 'ok' : 'invalid';
}

/**
 * Suffisso LIKE per confrontare due numeri scritti in modo diverso.
 *
 * In anagrafica lo stesso numero compare come "+39 333 1234567", "3331234567",
 * "0039 333 1234567"; Twilio lo consegna sempre come "+393331234567". Le ultime
 * 9 cifre sono la parte che non cambia mai (prefisso internazionale e zero
 * iniziale a parte), quindi sono la chiave di riconoscimento.
 *
 * Ritorna null se il numero non ha abbastanza cifre per essere confrontato:
 * un LIKE '%' senza suffisso aggancerebbe il primo contatto qualsiasi.
 */
function whatsAppPhoneSuffix(string $phone): ?string
{
    $digits = preg_replace('/\D+/', '', $phone);
    if (strlen($digits) < 6) {
        return null;
    }
    return '%' . substr($digits, -9);
}

/**
 * Associazione già decisa per questa conversazione, se esiste.
 *
 * Va interrogata PRIMA di risolvere il numero sull'anagrafica: se un agente ha
 * agganciato a mano la chat a un contatto, quella è una decisione umana e deve
 * valere anche per i messaggi successivi. Risolvere di nuovo dal numero
 * spaccherebbe la conversazione in due contatti diversi — metà a chi ha quel
 * numero in scheda, metà a chi l'agente ha scelto.
 *
 * Stessa forma di resolveWhatsAppContact() così i due sono intercambiabili con
 * un `??`.
 *
 * @return array{client_id:?int, tenant_id:?int, lead_id:?int, name:?string}|null
 */
function waExistingThreadContact(PDO $db, string $phone): ?array
{
    $stmt = $db->prepare(
        "SELECT wm.client_id, wm.tenant_id, wm.lead_id,
                COALESCE(CONCAT(c.name, ' ', c.surname),
                         CONCAT(t.name, ' ', t.surname),
                         CONCAT(l.name, ' ', l.surname)) AS contact_name
           FROM whatsapp_messages wm
           LEFT JOIN clients c ON c.id = wm.client_id
           LEFT JOIN tenants t ON t.id = wm.tenant_id
           LEFT JOIN leads   l ON l.id = wm.lead_id
          WHERE IF(wm.direction = 'inbound', wm.from_number, wm.to_number) = :phone
            AND (wm.client_id IS NOT NULL OR wm.tenant_id IS NOT NULL OR wm.lead_id IS NOT NULL)
          ORDER BY wm.received_at DESC, wm.id DESC
          LIMIT 1"
    );
    $stmt->execute(['phone' => $phone]);
    $row = $stmt->fetch();

    if (!$row) {
        return null;
    }

    return [
        'client_id' => $row['client_id'] !== null ? (int) $row['client_id'] : null,
        'tenant_id' => $row['tenant_id'] !== null ? (int) $row['tenant_id'] : null,
        'lead_id'   => $row['lead_id']   !== null ? (int) $row['lead_id']   : null,
        'name'      => trim((string) $row['contact_name']) ?: null,
    ];
}

/**
 * Risolve un numero sull'anagrafica: proprietario, inquilino o lead.
 *
 * Un numero può in teoria comparire in più tabelle (un inquilino che diventa
 * acquirente): l'ordine di precedenza è clients → tenants → leads, cioè dal
 * rapporto più formale al più provvisorio.
 *
 * @return array{client_id:?int, tenant_id:?int, lead_id:?int, name:?string}
 */
function resolveWhatsAppContact(PDO $db, string $phone): array
{
    $out = ['client_id' => null, 'tenant_id' => null, 'lead_id' => null, 'name' => null];

    $suffix = whatsAppPhoneSuffix($phone);
    if ($suffix === null) {
        return $out;
    }

    $lookups = [
        'client_id' => "SELECT id, name, surname FROM clients WHERE phone LIKE :p AND status = 'active' LIMIT 1",
        'tenant_id' => "SELECT id, name, surname FROM tenants WHERE phone LIKE :p AND status = 'active' LIMIT 1",
        'lead_id'   => "SELECT id, name, surname FROM leads   WHERE phone LIKE :p AND status <> 'lost'  LIMIT 1",
    ];

    foreach ($lookups as $key => $sql) {
        $stmt = $db->prepare($sql);
        $stmt->execute(['p' => $suffix]);
        $row = $stmt->fetch();
        if ($row) {
            $out[$key] = (int) $row['id'];
            if ($out['name'] === null) {
                $out['name'] = trim(($row['name'] ?? '') . ' ' . ($row['surname'] ?? '')) ?: null;
            }
        }
    }

    return $out;
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
