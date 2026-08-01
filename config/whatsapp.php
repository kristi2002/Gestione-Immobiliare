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
 * Verifica che il numero mittente configurato sia DAVVERO un mittente WhatsApp
 * registrato su questo account Twilio, senza spedire alcun messaggio.
 *
 * Serve perché un numero Twilio qualsiasi ha `sms`/`voice` ma non il canale
 * WhatsApp: configurarlo come mittente non dà nessun errore in fase di
 * salvataggio, e ogni invio muore poi con l'errore 63007 ("nessun canale per
 * questo mittente") dentro i log di Twilio, dove nessuno guarda. È esattamente
 * così che questa integrazione è rimasta rotta per settimane sembrando attiva.
 *
 * Distingue anche i due casi che *sembrano* funzionanti ma non sono utilizzabili
 * da un cliente reale: la sandbox (nessun WABA: scrive solo a chi ha mandato
 * "join <codice>") e l'account Trial (tetto giornaliero, destinatari verificati).
 *
 * @return array{ok: bool, usable: bool, error: ?string, detail: ?string}
 */
function whatsappSenderProbe(?array $cfg = null, int $timeout = 10): array
{
    $cfg ??= getWhatsAppConfig();

    if ($cfg['account_sid'] === '' || $cfg['auth_token'] === '') {
        return ['ok' => false, 'usable' => false, 'error' => 'Credenziali Twilio mancanti.', 'detail' => null];
    }
    if ($cfg['from'] === '') {
        return ['ok' => false, 'usable' => false, 'error' => 'Nessun numero mittente WhatsApp configurato.', 'detail' => null];
    }

    $get = static function (string $url) use ($cfg, $timeout): array {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_USERPWD        => $cfg['account_sid'] . ':' . $cfg['auth_token'],
            CURLOPT_TIMEOUT        => $timeout,
        ]);
        $raw  = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);
        return [$code, json_decode((string) $raw, true), ($raw === false || $code === 0) ? ($err ?: 'connessione fallita') : null];
    };

    // Una connessione fallita NON è una risposta: senza questo controllo un
    // errore di rete o di certificato lasciava la lista dei mittenti vuota e la
    // sonda concludeva "il numero non è un mittente WhatsApp" — una diagnosi
    // sbagliata e credibile, il modo peggiore di sbagliare.
    [$code, $data, $transport] = $get('https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp&PageSize=50');
    if ($transport !== null) {
        return ['ok' => false, 'usable' => false, 'error' => "Impossibile interrogare Twilio: {$transport}.", 'detail' => 'Stato del mittente WhatsApp non verificato.'];
    }
    if ($code >= 400) {
        $msg = $data['message'] ?? "HTTP {$code}";
        return ['ok' => false, 'usable' => false, 'error' => "Twilio non raggiungibile o credenziali rifiutate: {$msg}", 'detail' => null];
    }

    $from   = str_starts_with($cfg['from'], 'whatsapp:') ? $cfg['from'] : 'whatsapp:' . $cfg['from'];
    $sender = null;
    foreach (($data['senders'] ?? []) as $s) {
        if (($s['sender_id'] ?? '') === $from) {
            $sender = $s;
            break;
        }
    }

    if ($sender === null) {
        $known = array_filter(array_map(static fn(array $s): string => (string) ($s['sender_id'] ?? ''), $data['senders'] ?? []));
        return [
            'ok'     => false,
            'usable' => false,
            'error'  => "Il numero {$cfg['from']} non è un mittente WhatsApp su questo account Twilio: ogni invio fallirà con l'errore 63007.",
            'detail' => $known ? 'Mittenti WhatsApp disponibili: ' . implode(', ', $known) . '.' : 'Nessun mittente WhatsApp registrato sull\'account.',
        ];
    }

    $status  = strtoupper((string) ($sender['status'] ?? 'UNKNOWN'));
    $isSandbox = ((string) ($sender['configuration']['waba_id'] ?? '')) === '';

    [, $acct, $acctErr] = $get('https://api.twilio.com/2010-04-01/Accounts/' . $cfg['account_sid'] . '.json');
    $isTrial = $acctErr === null && strtolower((string) ($acct['type'] ?? '')) === 'trial';

    $blockers = [];
    if ($status !== 'ONLINE')  $blockers[] = "mittente in stato {$status}";
    if ($isSandbox)            $blockers[] = 'è la sandbox (scrive solo a chi ha inviato "join <codice>")';
    if ($isTrial)              $blockers[] = 'account Twilio in prova (tetto giornaliero, solo destinatari verificati)';

    if ($blockers) {
        return [
            'ok'     => true,
            'usable' => false,
            'error'  => 'Mittente WhatsApp registrato ma non utilizzabile con clienti reali: ' . implode('; ', $blockers) . '.',
            'detail' => 'Serve un numero WhatsApp Business (WABA) e un account Twilio a pagamento.',
        ];
    }

    return ['ok' => true, 'usable' => true, 'error' => null, 'detail' => "Mittente {$cfg['from']} attivo."];
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
    // Lo zero iniziale va tolto o tenuto a seconda di cosa segue, perché in
    // Italia i cellulari iniziano per 3 e i prefissi dei fissi per 0:
    //   "0333 1234567" → zero di troppo scritto per abitudine, si toglie
    //   "0733 123456"  → prefisso di Civitanova, in formato internazionale RESTA
    // Toglierlo sempre (com'era prima) trasformava i fissi in +39733123456,
    // un numero che non esiste.
    if (str_starts_with($digits, '0')) {
        $digits = str_starts_with($digits, '03')
            ? '39' . substr($digits, 1)
            : '39' . $digits;
    }
    // Un cellulare italiano scritto in formato nazionale e' 3xx xxx xxxx: nove o
    // dieci cifre che iniziano per 3. Va riconosciuto PRIMA della regola
    // generale, perche' i prefissi 391/392/393 (Wind Tre, Very Mobile) iniziano
    // per "39" e sembravano numeri che il prefisso internazionale ce l'avevano
    // gia': "393 1234567" diventava +3931234567, dieci cifre che non esistono.
    // Twilio rifiutava l'invio, e la risposta dell'agente finiva sotto un numero
    // diverso da quello del cliente — la stessa persona in due conversazioni.
    $len = strlen($digits);
    if (str_starts_with($digits, '3') && ($len === 9 || $len === 10)) {
        return '+39' . $digits;
    }

    if (!str_starts_with($digits, '39') && $len <= 10) {
        $digits = '39' . $digits;
    }
    return '+' . $digits;
}

function parseTwilioWebhook(array $post): array
{
    // Gli allegati arrivano come MediaUrl0/MediaContentType0 (NumMedia dice
    // quanti). Qui non c'erano affatto, e il webhook leggeva una chiave
    // 'media_url' che questa funzione non ha mai restituito: la colonna restava
    // NULL e ogni foto inviata dai clienti spariva senza lasciare traccia.
    $media = [];
    for ($i = 0, $n = (int) ($post['NumMedia'] ?? 0); $i < $n; $i++) {
        $url = trim((string) ($post['MediaUrl' . $i] ?? ''));
        if ($url === '') {
            continue;
        }
        $media[] = ['url' => $url, 'mime' => trim((string) ($post['MediaContentType' . $i] ?? ''))];
    }

    return [
        'from'        => $post['From'] ?? '',
        'to'          => $post['To'] ?? '',
        'body'        => $post['Body'] ?? '',
        'external_id' => $post['MessageSid'] ?? null,
        'media'       => $media,
    ];
}

/**
 * Estensioni ammesse per un allegato in arrivo, per tipo dichiarato da Twilio.
 *
 * Whitelist e non mappa aperta: il nome del file finisce su disco, e prendere
 * l'estensione da quello che dice la controparte significa lasciarle scegliere
 * come il server tratta il file. Un tipo sconosciuto diventa .bin.
 */
const WA_MEDIA_EXTENSIONS = [
    'image/jpeg'      => 'jpg',
    'image/png'       => 'png',
    'image/webp'      => 'webp',
    'image/gif'       => 'gif',
    'application/pdf' => 'pdf',
    'audio/ogg'       => 'ogg',
    'audio/mpeg'      => 'mp3',
    'audio/amr'       => 'amr',
    'video/mp4'       => 'mp4',
    'video/3gpp'      => '3gp',
    'text/vcard'      => 'vcf',
];

/** Tetto di 16 MB: e' il limite di WhatsApp, oltre non puo' arrivare nulla di legittimo. */
const WA_MEDIA_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Scarica un allegato da Twilio e lo salva nell'albero protetto.
 *
 * Le URL dei media Twilio richiedono le credenziali dell'account e non vivono
 * per sempre: salvare il link invece del file avrebbe dato una foto che si
 * apre oggi e non fra sei mesi, quando serve davvero (una perdita d'acqua
 * documentata, lo stato di un immobile alla riconsegna).
 *
 * Ritorna null se il download fallisce: il messaggio va salvato comunque, un
 * allegato mancante e' meno grave di un messaggio perso.
 *
 * @param array{url:string, mime:string} $media
 * @return array{path:string, mime:string, name:string}|null
 */
function waStoreInboundMedia(array $media, ?string $sid = null): ?array
{
    $cfg = getWhatsAppConfig();
    if ($cfg['account_sid'] === '' || $cfg['auth_token'] === '') {
        error_log('[whatsapp] allegato non scaricato: credenziali Twilio assenti.');
        return null;
    }

    $ch = curl_init($media['url']);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 3,
        CURLOPT_USERPWD        => $cfg['account_sid'] . ':' . $cfg['auth_token'],
        // Twilio chiude il webhook dopo 15 secondi: se il download non sta in
        // piedi entro 10 si rinuncia all'allegato, non alla risposta.
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_BUFFERSIZE     => 65536,
        CURLOPT_NOPROGRESS     => false,
        CURLOPT_PROGRESSFUNCTION => static fn($res, $dlTotal, $dlNow) => $dlNow > WA_MEDIA_MAX_BYTES ? 1 : 0,
    ]);

    $bytes = curl_exec($ch);
    $code  = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err   = curl_error($ch);
    // Niente curl_close(): dal PHP 8.0 non fa nulla e dal 8.5 e' deprecata,
    // cioe' una riga di avviso nel log a ogni allegato ricevuto.

    if ($bytes === false || $code >= 400 || $bytes === '') {
        error_log('[whatsapp] allegato non scaricato (HTTP ' . $code . ') ' . $err);
        return null;
    }
    if (strlen($bytes) > WA_MEDIA_MAX_BYTES) {
        error_log('[whatsapp] allegato oltre il limite consentito, scartato.');
        return null;
    }

    $mime = strtolower(trim(explode(';', $media['mime'])[0]));
    $ext  = WA_MEDIA_EXTENSIONS[$mime] ?? 'bin';

    $relDir = 'uploads/documents/whatsapp/' . date('Y/m');
    $absDir = dirname(__DIR__) . '/' . $relDir;
    if (!is_dir($absDir) && !mkdir($absDir, 0775, true) && !is_dir($absDir)) {
        error_log('[whatsapp] impossibile creare ' . $absDir);
        return null;
    }

    // Nome generato da noi: quello di Twilio non esiste, e il SID da solo
    // renderebbe indovinabile il percorso di un allegato altrui.
    $name = 'wa_' . date('Ymd_His') . '_' . bin2hex(random_bytes(6)) . '.' . $ext;
    if (file_put_contents($absDir . '/' . $name, $bytes) === false) {
        error_log('[whatsapp] scrittura fallita: ' . $absDir . '/' . $name);
        return null;
    }

    return [
        'path' => $relDir . '/' . $name,
        'mime' => $mime !== '' ? $mime : 'application/octet-stream',
        'name' => ($sid !== null && $sid !== '' ? $sid : 'allegato') . '.' . $ext,
    ];
}
