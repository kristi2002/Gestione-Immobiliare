<?php
/**
 * WhatsApp Business Platform — Cloud API di Meta, senza intermediari.
 *
 * Si parlava con Twilio, che rivende l'accesso a questa stessa piattaforma
 * aggiungendo una tariffa per messaggio. Qui si chiama Meta direttamente: si
 * paga solo la conversazione, e non c'e' un secondo fornitore a cui chiedere
 * conto quando un messaggio non arriva.
 *
 * Le tre differenze che contano rispetto a prima:
 *   - l'invio e' JSON su graph.facebook.com, autenticato con un token Bearer;
 *   - il webhook arriva in JSON (non piu' form-encoded) e porta con se' ANCHE
 *     gli stati di consegna, che prima erano una chiamata separata;
 *   - un messaggio libero si puo' mandare solo entro 24 ore dall'ultimo
 *     messaggio del cliente. Fuori da quella finestra Meta accetta solo
 *     template approvati: vedi sendWhatsAppTemplate().
 */

require_once __DIR__ . '/settings.php';

const META_GRAPH_VERSION = 'v21.0';

/** Errori Meta che significano "finestra di 24 ore chiusa", non "guasto". */
const META_WINDOW_ERRORS = [131047, 131051, 131026];

/**
 * Chiamata a Graph. Ritorna [codice HTTP, corpo decodificato, errore di rete].
 */
function metaGraphRequest(string $url, ?array $json = null, int $timeout = 30): array
{
    $cfg = getWhatsAppConfig();

    $ch   = curl_init($url);
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . $cfg['access_token']],
    ];
    if ($json !== null) {
        $opts[CURLOPT_POST]         = true;
        $opts[CURLOPT_POSTFIELDS]   = json_encode($json, JSON_UNESCAPED_UNICODE);
        $opts[CURLOPT_HTTPHEADER][] = 'Content-Type: application/json';
    }
    curl_setopt_array($ch, $opts);

    $raw  = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);

    // Una connessione fallita non e' una risposta: distinguerla da un 200 evita
    // di leggere un corpo vuoto come "tutto a posto".
    $transport = ($raw === false || $code === 0) ? ($err ?: 'connessione fallita') : null;

    return [$code, json_decode((string) $raw, true), $transport];
}

/** L'errore di Meta tradotto in qualcosa su cui si puo' agire. */
function metaErrorMessage(?array $data, int $code): string
{
    $err     = $data['error'] ?? [];
    $subCode = (int) ($err['code'] ?? 0);
    $detail  = $err['error_user_msg'] ?? $err['message'] ?? "HTTP {$code}";

    if (in_array($subCode, META_WINDOW_ERRORS, true)) {
        return 'Sono passate piu di 24 ore dall\'ultimo messaggio del cliente: fuori da quella '
             . 'finestra WhatsApp accetta solo un template approvato da Meta. (' . $detail . ')';
    }
    if ($subCode === 190) {
        return 'Token di accesso Meta scaduto o revocato: va rigenerato in Impostazioni. (' . $detail . ')';
    }
    if ($subCode === 131030) {
        return 'Numero non fra i destinatari consentiti: finche l\'app Meta e in sviluppo si scrive '
             . 'solo ai numeri di prova. (' . $detail . ')';
    }

    return (string) $detail;
}

/**
 * La risposta di invio nella forma che i chiamanti gia' conoscono.
 *
 * @param array<string,mixed> $data
 */
function metaSendResult(array $data): array
{
    return [
        'success'     => true,
        // Meta prende in carico e mette in coda: la consegna vera arriva dopo,
        // come stato dentro il webhook. Scrivere 'sent' qui sarebbe una promessa.
        'status'      => 'queued',
        'external_id' => $data['messages'][0]['id'] ?? ('wa-' . uniqid()),
        'error'       => null,
    ];
}

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

    if ($cfg['phone_number_id'] === '' || $cfg['access_token'] === '') {
        return ['success' => false, 'status' => 'failed', 'external_id' => null, 'error' => 'WhatsApp (Meta Cloud API) non configurato.'];
    }

    [$code, $data, $transport] = metaGraphRequest(
        'https://graph.facebook.com/' . META_GRAPH_VERSION . '/' . $cfg['phone_number_id'] . '/messages',
        [
            'messaging_product' => 'whatsapp',
            // Meta vuole E.164 senza il "+".
            'to'                => ltrim(normalizeWhatsAppNumber($toPhone), '+'),
            'type'              => 'text',
            'text'              => ['preview_url' => false, 'body' => $body],
        ]
    );

    if ($transport !== null) {
        return ['success' => false, 'status' => 'failed', 'external_id' => null, 'error' => 'Meta non raggiungibile: ' . $transport];
    }
    if ($code >= 400) {
        return ['success' => false, 'status' => 'failed', 'external_id' => null, 'error' => metaErrorMessage($data, $code)];
    }

    return metaSendResult($data ?? []);
}

/**
 * Invio di un template approvato: l'unico modo di scrivere per primi.
 *
 * Ogni messaggio che parte da noi — un sollecito, una scadenza, un avviso — cade
 * fuori dalla finestra di 24 ore e ha bisogno di un template gia' approvato da
 * Meta. Nome e lingua sono quelli registrati nel Business Manager, NON i modelli
 * locali di whatsapp_templates, che restano testo pronto per l'agente.
 *
 * @param string[] $params valori del corpo, nell'ordine del template
 */
function sendWhatsAppTemplate(string $toPhone, string $templateName, array $params = [], string $lang = 'it'): array
{
    $cfg = getWhatsAppConfig();

    if (!$cfg['enabled']) {
        error_log('[whatsapp] SIMULATED template send (whatsapp disabled) to ' . $toPhone);
        return ['success' => true, 'status' => 'sent', 'external_id' => 'wa-sim-' . uniqid(), 'simulated' => true, 'error' => null];
    }
    if ($cfg['phone_number_id'] === '' || $cfg['access_token'] === '') {
        return ['success' => false, 'status' => 'failed', 'external_id' => null, 'error' => 'WhatsApp (Meta Cloud API) non configurato.'];
    }

    $template = ['name' => $templateName, 'language' => ['code' => $lang]];
    if ($params) {
        $template['components'] = [[
            'type'       => 'body',
            'parameters' => array_map(
                static fn($p): array => ['type' => 'text', 'text' => (string) $p],
                array_values($params)
            ),
        ]];
    }

    [$code, $data, $transport] = metaGraphRequest(
        'https://graph.facebook.com/' . META_GRAPH_VERSION . '/' . $cfg['phone_number_id'] . '/messages',
        [
            'messaging_product' => 'whatsapp',
            'to'                => ltrim(normalizeWhatsAppNumber($toPhone), '+'),
            'type'              => 'template',
            'template'          => $template,
        ]
    );

    if ($transport !== null) {
        return ['success' => false, 'status' => 'failed', 'external_id' => null, 'error' => 'Meta non raggiungibile: ' . $transport];
    }
    if ($code >= 400) {
        return ['success' => false, 'status' => 'failed', 'external_id' => null, 'error' => metaErrorMessage($data, $code)];
    }

    return metaSendResult($data ?? []);
}

/**
 * Verifica che il mittente configurato sia davvero utilizzabile, senza spedire
 * niente: si interroga il phone number id su Graph e si guarda cosa risponde.
 *
 * Serve perche' una configurazione sbagliata non da' alcun errore al salvataggio
 * e ogni invio muore poi dentro i log, dove nessuno guarda. E' esattamente cosi'
 * che questa integrazione e' rimasta rotta per settimane sembrando attiva.
 *
 * Distingue anche i casi che *sembrano* funzionanti ma non lo sono per un
 * cliente reale: numero non verificato, qualita' bassa o messaggistica limitata
 * da Meta.
 *
 * @return array{ok: bool, usable: bool, error: ?string, detail: ?string}
 */
function whatsappSenderProbe(?array $cfg = null, int $timeout = 10): array
{
    $cfg ??= getWhatsAppConfig();

    if ($cfg['access_token'] === '') {
        return ['ok' => false, 'usable' => false, 'error' => 'Token di accesso Meta mancante.', 'detail' => null];
    }
    if ($cfg['phone_number_id'] === '') {
        return ['ok' => false, 'usable' => false, 'error' => 'Phone number ID mancante: e\' l\'identificativo del mittente, non il numero.', 'detail' => null];
    }

    $fields = 'display_phone_number,verified_name,quality_rating,code_verification_status,throughput';
    [$code, $data, $transport] = metaGraphRequest(
        'https://graph.facebook.com/' . META_GRAPH_VERSION . '/' . $cfg['phone_number_id'] . '?fields=' . $fields,
        null,
        $timeout
    );

    // Una connessione fallita NON e' una risposta: senza questa distinzione un
    // errore di rete o di certificato diventerebbe "il mittente non esiste" —
    // una diagnosi sbagliata e credibile, il modo peggiore di sbagliare.
    if ($transport !== null) {
        return ['ok' => false, 'usable' => false, 'error' => "Impossibile interrogare Meta: {$transport}.", 'detail' => 'Stato del mittente WhatsApp non verificato.'];
    }
    if ($code >= 400) {
        return ['ok' => false, 'usable' => false, 'error' => 'Meta ha rifiutato la richiesta: ' . metaErrorMessage($data, $code), 'detail' => null];
    }

    $display  = (string) ($data['display_phone_number'] ?? '');
    $verified = strtoupper((string) ($data['code_verification_status'] ?? 'UNKNOWN'));
    $quality  = strtoupper((string) ($data['quality_rating'] ?? 'UNKNOWN'));

    $blockers = [];
    if ($verified !== 'VERIFIED') {
        $blockers[] = "numero non verificato (stato {$verified})";
    }
    if ($quality === 'RED') {
        $blockers[] = 'qualita\' del numero segnalata come bassa da Meta: la messaggistica puo\' essere limitata';
    }

    // Il numero scritto in Impostazioni compare in archivio come mittente: se non
    // e' quello vero, la chat attribuisce i messaggi a un numero che non esiste.
    $configured = preg_replace('/\D+/', '', (string) $cfg['from']);
    $real       = preg_replace('/\D+/', '', $display);
    if ($configured !== '' && $real !== '' && $configured !== $real) {
        $blockers[] = "il numero in Impostazioni ({$cfg['from']}) non e' quello del mittente ({$display})";
    }

    if ($blockers) {
        return [
            'ok'     => true,
            'usable' => false,
            'error'  => 'Mittente WhatsApp raggiungibile ma non utilizzabile con clienti reali: ' . implode('; ', $blockers) . '.',
            'detail' => 'Serve un numero verificato su un WhatsApp Business Account attivo.',
        ];
    }

    $name = (string) ($data['verified_name'] ?? '');
    return ['ok' => true, 'usable' => true, 'error' => null, 'detail' => trim("Mittente {$display} {$name}") . ' attivo.'];
}

/**
 * Mappa lo stato Meta sull'enum communications.status.
 * Meta: accepted|sent|delivered|read|failed (dentro statuses[] del webhook)
 */
function metaStatusToCommStatus(string $status): string
{
    return match (strtolower(trim($status))) {
        'accepted', 'queued' => 'queued',
        'delivered'          => 'delivered',
        'read'               => 'read',
        'failed', 'warning'  => 'failed',
        default              => 'sent',
    };
}

/**
 * Ordine di avanzamento degli stati. Gli stati di Meta possono arrivare fuori
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
 * Verifica la firma con cui Meta firma ogni webhook: HMAC-SHA256 del corpo
 * GREZZO, con l'app secret, nell'intestazione X-Hub-Signature-256.
 *
 * Il corpo va preso cosi' com'e' arrivato (php://input): ricostruirlo dal JSON
 * decodificato cambierebbe anche solo l'ordine di una chiave, e la firma non
 * tornerebbe mai piu'.
 *
 * Ritorna:
 *   'ok'           — firma valida
 *   'invalid'      — firma assente o non corrispondente
 *   'unconfigured' — nessun app secret in produzione: non possiamo verificare,
 *                    quindi la richiesta va RIFIUTATA (fail closed)
 *   'skipped'      — nessun app secret fuori produzione: check saltato (dev)
 */
function verifyMetaWebhook(string $rawBody): string
{
    $secret = getWhatsAppConfig()['app_secret'];

    if ($secret === '') {
        $isProd = strtolower((string) env('APP_ENV', 'production')) === 'production';
        return $isProd ? 'unconfigured' : 'skipped';
    }

    $header = $_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? '';
    if ($header === '' || !str_starts_with($header, 'sha256=')) {
        return 'invalid';
    }

    $expected = 'sha256=' . hash_hmac('sha256', $rawBody, $secret);

    return hash_equals($expected, $header) ? 'ok' : 'invalid';
}

/**
 * Risposta alla verifica del webhook (GET) con cui Meta attiva la sottoscrizione.
 * Ritorna la challenge da restituire, o null se il token non corrisponde.
 */
function metaWebhookChallenge(array $query): ?string
{
    $expected = getWhatsAppConfig()['verify_token'];
    if ($expected === '') {
        return null;
    }

    $mode      = (string) ($query['hub_mode'] ?? '');
    $token     = (string) ($query['hub_verify_token'] ?? '');
    $challenge = (string) ($query['hub_challenge'] ?? '');

    if ($mode !== 'subscribe' || !hash_equals($expected, $token)) {
        return null;
    }

    return $challenge;
}

/**
 * Suffisso LIKE per confrontare due numeri scritti in modo diverso.
 *
 * In anagrafica lo stesso numero compare come "+39 333 1234567", "3331234567",
 * "0039 333 1234567"; Meta lo consegna sempre come "393331234567". Le ultime
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
    // L'invio veniva rifiutato, e la risposta dell'agente finiva sotto un numero
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

/**
 * Legge il payload del webhook Meta.
 *
 * Forma: entry[].changes[].value, dove `messages[]` sono i messaggi in arrivo e
 * `statuses[]` gli avanzamenti di consegna dei nostri. Arrivano nello STESSO
 * webhook: con Twilio erano due endpoint distinti.
 *
 * Il testo sta in posti diversi a seconda del tipo: `text.body` per un
 * messaggio scritto, `caption` per una foto con didascalia. L'allegato non e'
 * una URL ma un id da riscattare con un secondo giro (vedi waStoreInboundMedia).
 *
 * @return array{messages: list<array>, statuses: list<array>}
 */
function parseMetaWebhook(array $payload): array
{
    $messages = [];
    $statuses = [];

    foreach (($payload['entry'] ?? []) as $entry) {
        foreach (($entry['changes'] ?? []) as $change) {
            $value = $change['value'] ?? [];
            $to    = (string) ($value['metadata']['display_phone_number'] ?? '');

            foreach (($value['messages'] ?? []) as $m) {
                $type  = (string) ($m['type'] ?? 'text');
                $part  = $m[$type] ?? [];
                $media = [];

                // image/document/audio/video/sticker portano un id e un mime;
                // il nome originale c'e' solo sui documenti.
                if (isset($part['id'])) {
                    $media[] = [
                        'id'       => (string) $part['id'],
                        'mime'     => (string) ($part['mime_type'] ?? ''),
                        'filename' => (string) ($part['filename'] ?? ''),
                    ];
                }

                $messages[] = [
                    // Meta consegna il numero senza "+": rimetterlo qui tiene una
                    // sola forma in tutta l'applicazione (+39...), che e' quella
                    // su cui le conversazioni vengono raggruppate.
                    'from'        => '+' . ltrim((string) ($m['from'] ?? ''), '+'),
                    'to'          => $to !== '' ? '+' . ltrim($to, '+') : '',
                    'body'        => (string) ($part['body'] ?? $part['caption'] ?? ''),
                    'external_id' => (string) ($m['id'] ?? '') ?: null,
                    'type'        => $type,
                    'media'       => $media,
                ];
            }

            foreach (($value['statuses'] ?? []) as $st) {
                $statuses[] = [
                    'external_id' => (string) ($st['id'] ?? ''),
                    'status'      => (string) ($st['status'] ?? ''),
                    'recipient'   => '+' . ltrim((string) ($st['recipient_id'] ?? ''), '+'),
                    'error'       => $st['errors'][0]['title'] ?? null,
                ];
            }
        }
    }

    return ['messages' => $messages, 'statuses' => $statuses];
}

/**
 * Estensioni ammesse per un allegato in arrivo, per tipo dichiarato da Meta.
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
    'audio/aac'       => 'aac',
    'video/mp4'       => 'mp4',
    'video/3gpp'      => '3gp',
    'text/vcard'      => 'vcf',
];

/** Tetto di 16 MB: e' il limite di WhatsApp, oltre non puo' arrivare nulla di legittimo. */
const WA_MEDIA_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Scarica un allegato da Meta e lo salva nell'albero protetto.
 *
 * Due passaggi, non uno: il webhook porta solo un id, da cui si ottiene una URL
 * temporanea su lookaside.fbsbx.com, che a sua volta va scaricata CON il token —
 * non e' un link pubblico e scade in fretta. Salvare il link invece del file
 * avrebbe dato una foto che si apre oggi e non fra sei mesi, quando serve
 * davvero (una perdita d'acqua documentata, lo stato di un immobile).
 *
 * Ritorna null se il download fallisce: il messaggio va salvato comunque, un
 * allegato mancante e' meno grave di un messaggio perso.
 *
 * @param array{id:string, mime:string, filename?:string} $media
 * @return array{path:string, mime:string, name:string}|null
 */
function waStoreInboundMedia(array $media, ?string $sid = null): ?array
{
    $cfg = getWhatsAppConfig();
    if ($cfg['access_token'] === '') {
        error_log('[whatsapp] allegato non scaricato: token di accesso Meta assente.');
        return null;
    }
    if (($media['id'] ?? '') === '') {
        return null;
    }

    // Passo 1 — dall'id alla URL temporanea.
    [$code, $info, $transport] = metaGraphRequest(
        'https://graph.facebook.com/' . META_GRAPH_VERSION . '/' . rawurlencode($media['id']),
        null,
        10
    );
    if ($transport !== null || $code >= 400 || empty($info['url'])) {
        error_log('[whatsapp] URL allegato non ottenuta (HTTP ' . $code . ') ' . ($transport ?? ''));
        return null;
    }

    if ((int) ($info['file_size'] ?? 0) > WA_MEDIA_MAX_BYTES) {
        error_log('[whatsapp] allegato oltre il limite consentito, scartato.');
        return null;
    }

    // Passo 2 — il file. La URL e' su un host di Meta ma vuole comunque il token.
    $ch = curl_init((string) $info['url']);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER   => true,
        CURLOPT_FOLLOWLOCATION   => true,
        CURLOPT_MAXREDIRS        => 3,
        CURLOPT_HTTPHEADER       => ['Authorization: Bearer ' . $cfg['access_token']],
        // Meta chiude il webhook in fretta: se il download non sta in piedi
        // entro 10 secondi si rinuncia all'allegato, non alla risposta.
        CURLOPT_TIMEOUT          => 10,
        CURLOPT_NOPROGRESS       => false,
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

    $mime = strtolower(trim(explode(';', (string) ($media['mime'] ?: ($info['mime_type'] ?? '')))[0]));
    $ext  = WA_MEDIA_EXTENSIONS[$mime] ?? 'bin';

    $relDir = 'uploads/documents/whatsapp/' . date('Y/m');
    $absDir = dirname(__DIR__) . '/' . $relDir;
    if (!is_dir($absDir) && !mkdir($absDir, 0775, true) && !is_dir($absDir)) {
        error_log('[whatsapp] impossibile creare ' . $absDir);
        return null;
    }

    // Nome generato da noi: quello del mittente non e' affidabile, e l'id da
    // solo renderebbe indovinabile il percorso di un allegato altrui.
    $name = 'wa_' . date('Ymd_His') . '_' . bin2hex(random_bytes(6)) . '.' . $ext;
    if (file_put_contents($absDir . '/' . $name, $bytes) === false) {
        error_log('[whatsapp] scrittura fallita: ' . $absDir . '/' . $name);
        return null;
    }

    // Il nome mostrato nella chat: quello vero se il mittente lo ha (documenti),
    // altrimenti l'id del messaggio, che almeno lo lega alla conversazione.
    $shown = trim((string) ($media['filename'] ?? ''));
    if ($shown === '') {
        $shown = ($sid !== null && $sid !== '' ? $sid : 'allegato') . '.' . $ext;
    }

    return [
        'path' => $relDir . '/' . $name,
        'mime' => $mime !== '' ? $mime : 'application/octet-stream',
        'name' => $shown,
    ];
}
