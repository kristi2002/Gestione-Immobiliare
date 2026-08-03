<?php
/**
 * Communications API — email chat threads.
 *
 * GET  /api/communications.php?summary=1       — client list with last message preview
 * GET  /api/communications.php?client_id={id} — full thread for a client
 * GET  /api/communications.php?id={id}        — single message
 * POST /api/communications.php                — send or log a message
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/mail.php';
require_once __DIR__ . '/../config/mail_html.php';

apiHandleOptions();

// Canali. I primi due vengono realmente spediti; sms/chiamata/nota sono
// registrazioni manuali di qualcosa avvenuto fuori dal gestionale.
// ATTENZIONE: questa lista deve restare allineata all'enum communications.channel
// (migrazione phase67) — un canale presente qui ma non nell'enum viene rifiutato
// dal DB, uno presente nell'enum ma non qui viene rifiutato dall'API.
const COMM_CHANNELS   = ['email', 'whatsapp', 'sms', 'chiamata', 'nota'];
const COMM_DISPATCHED = ['email', 'whatsapp'];
const COMM_DIRECTIONS = ['sent', 'received'];

// Limite complessivo degli allegati per singola email.
const COMM_MAX_ATTACH_BYTES = 20 * 1024 * 1024; // 20 MB
const COMM_MAX_ATTACH_COUNT = 20;

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    if ($method === 'GET') {
        if ($id) {
            getMessage($db, $id);
        } elseif (($_GET['action'] ?? '') === 'statuses' && isset($_GET['client_id'])) {
            listStatuses($db, (int) $_GET['client_id']);
        } elseif (isset($_GET['summary'])) {
            listSummary($db);
        } elseif (isset($_GET['client_id'])) {
            listThread($db, (int) $_GET['client_id']);
        } else {
            apiError('Parametro mancante: summary, client_id o id.');
        }
    } elseif ($method === 'POST') {
        createMessage($db);
    } else {
        apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function listSummary(PDO $db): void
{
    $pagination = apiGetPagination();
    $search = trim($_GET['search'] ?? '');

    $where = "WHERE c.status = 'active'";
    $params = [];

    if ($search !== '') {
        $where .= ' AND (c.name LIKE :search OR c.surname LIKE :search OR c.email LIKE :search)';
        $params['search'] = '%' . $search . '%';
    }

    $countSql = "SELECT COUNT(*) FROM clients c $where";

    $dataSql = "SELECT c.id, c.name, c.surname, c.email, c.phone,
                   COUNT(cm.id) AS message_count,
                   MAX(cm.created_at) AS last_message_at,
                   (SELECT cm2.body FROM communications cm2
                    WHERE cm2.client_id = c.id
                    ORDER BY cm2.created_at DESC LIMIT 1) AS last_message_preview,
                   (SELECT cm2.direction FROM communications cm2
                    WHERE cm2.client_id = c.id
                    ORDER BY cm2.created_at DESC LIMIT 1) AS last_message_direction,
                   (SELECT cm2.channel FROM communications cm2
                    WHERE cm2.client_id = c.id
                    ORDER BY cm2.created_at DESC LIMIT 1) AS last_message_channel
            FROM clients c
            LEFT JOIN communications cm ON cm.client_id = c.id
            $where
            GROUP BY c.id
            ORDER BY last_message_at DESC, c.surname ASC, c.name ASC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function listThread(PDO $db, int $clientId): void
{
    if (!clientExists($db, $clientId)) {
        apiError('Proprietario non trovato.', 404);
    }

    $stmt = $db->prepare(
        "SELECT cm.*, c.name AS client_name, c.surname AS client_surname, c.email AS client_email,
                p.address AS property_address, p.city AS property_city
         FROM communications cm
         INNER JOIN clients c ON c.id = cm.client_id
         LEFT JOIN properties p ON p.id = cm.property_id
         WHERE cm.client_id = :client_id
         ORDER BY cm.created_at ASC"
    );
    $stmt->execute(['client_id' => $clientId]);

    $clientStmt = $db->prepare(
        "SELECT id, name, surname, email, phone FROM clients WHERE id = :id"
    );
    $clientStmt->execute(['id' => $clientId]);
    $client = $clientStmt->fetch();

    // Immobili collegabili a un messaggio: serve al select "Collega a immobile"
    // del compose, e evita un secondo round-trip all'apertura del thread.
    $propStmt = $db->prepare(
        "SELECT id, address, city FROM properties
          WHERE client_id = :id AND status != 'archived'
          ORDER BY address ASC"
    );
    $propStmt->execute(['id' => $clientId]);

    apiSuccess([
        'client'     => $client,
        'properties' => $propStmt->fetchAll(),
        'messages'   => $stmt->fetchAll(),
    ]);
}

/**
 * Solo id + stato del thread aperto: è ciò che il client ricarica a intervalli
 * per far avanzare le spunte senza riscaricare tutti i corpi dei messaggi.
 */
function listStatuses(PDO $db, int $clientId): void
{
    $stmt = $db->prepare(
        "SELECT id, status, status_detail, status_updated_at
           FROM communications
          WHERE client_id = :client_id AND direction = 'sent'"
    );
    $stmt->execute(['client_id' => $clientId]);
    apiSuccess(['statuses' => $stmt->fetchAll()]);
}

function getMessage(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT cm.*, c.name AS client_name, c.surname AS client_surname,
                p.address AS property_address, p.city AS property_city
         FROM communications cm
         INNER JOIN clients c ON c.id = cm.client_id
         LEFT JOIN properties p ON p.id = cm.property_id
         WHERE cm.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $msg = $stmt->fetch();

    if (!$msg) {
        apiError('Messaggio non trovato.', 404);
    }

    apiSuccess($msg);
}

function createMessage(PDO $db): void
{
    $data      = apiGetJsonBody();
    $clientId  = (int) ($data['client_id'] ?? 0);
    $direction = trim($data['direction'] ?? 'sent');
    $channel   = trim($data['channel'] ?? 'email');
    $subject   = trim($data['subject'] ?? '') ?: null;
    $body      = trim($data['body'] ?? '');

    if ($clientId <= 0) {
        apiError('client_id obbligatorio.');
    }
    if ($body === '') {
        apiError('Il messaggio non può essere vuoto.');
    }
    if (!in_array($direction, COMM_DIRECTIONS, true)) {
        apiError('Direzione non valida.');
    }
    if (!in_array($channel, COMM_CHANNELS, true)) {
        apiError('Canale non valido.');
    }

    // Una nota interna è scritta dall'agenzia per l'agenzia: normalizziamo la
    // direzione così non finisce a sinistra come se l'avesse mandata il cliente.
    if ($channel === 'nota') {
        $direction = 'sent';
    }

    $clientStmt = $db->prepare(
        "SELECT id, name, surname, email, phone FROM clients WHERE id = :id AND status != 'archived'"
    );
    $clientStmt->execute(['id' => $clientId]);
    $client = $clientStmt->fetch();

    if (!$client) {
        apiError('Proprietario non trovato o archiviato.');
    }

    // ── Immobile di contesto ────────────────────────────────────────────────
    // Rivalidato server-side: l'immobile deve appartenere al proprietario del
    // thread, altrimenti il collegamento diventa un modo per far comparire un
    // immobile altrui nella conversazione.
    $propertyId = (int) ($data['property_id'] ?? 0) ?: null;
    if ($propertyId !== null) {
        $propStmt = $db->prepare(
            "SELECT id FROM properties WHERE id = :pid AND client_id = :cid"
        );
        $propStmt->execute(['pid' => $propertyId, 'cid' => $clientId]);
        if (!$propStmt->fetchColumn()) {
            apiError('L\'immobile selezionato non appartiene a questo proprietario.', 403);
        }
    }

    // ── Allegati (documenti già caricati nel gestionale) ─────────────────────
    // Il frontend manda solo gli id: qui si rivalida TUTTO — ownership del
    // documento rispetto al proprietario destinatario, esistenza del file su
    // disco (path-containment guard) e peso complessivo.
    $attachmentIds = array_values(array_filter(
        array_unique(array_map('intval', (array) ($data['attachments'] ?? []))),
        static fn ($v) => $v > 0
    ));
    $mailAttachments = []; // per il mailer: [{path, name, mime}]
    $attachmentMeta  = null; // JSON storicizzato in communications.attachments

    if ($attachmentIds) {
        if ($direction !== 'sent' || $channel !== 'email') {
            apiError('Gli allegati sono supportati solo per le email in uscita.');
        }
        if (count($attachmentIds) > COMM_MAX_ATTACH_COUNT) {
            apiError('Massimo ' . COMM_MAX_ATTACH_COUNT . ' allegati per messaggio.');
        }

        require_once __DIR__ . '/../config/upload_guard.php';

        // Un documento è allegabile se appartiene al proprietario: collegato a
        // lui direttamente, oppure a un suo immobile, oppure a un suo contratto.
        $in   = implode(',', array_fill(0, count($attachmentIds), '?'));
        $stmt = $db->prepare(
            "SELECT d.id, d.title, d.original_name, d.file_path, d.mime_type, d.file_size
               FROM documents d
               LEFT JOIN properties p  ON p.id  = d.property_id
               LEFT JOIN contracts  ct ON ct.id = d.contract_id
              WHERE d.id IN ({$in})
                AND ( (d.client_id  IS NOT NULL AND d.client_id  = ?)
                   OR (p.client_id  IS NOT NULL AND p.client_id  = ?)
                   OR (ct.client_id IS NOT NULL AND ct.client_id = ?) )"
        );
        $stmt->execute(array_merge($attachmentIds, [$clientId, $clientId, $clientId]));

        $byId = [];
        foreach ($stmt->fetchAll() as $doc) {
            $byId[(int) $doc['id']] = $doc;
        }

        $totalSize = 0;
        $meta      = [];
        foreach ($attachmentIds as $docId) {
            $doc = $byId[$docId] ?? null;
            if (!$doc) {
                apiError("Documento #{$docId} non trovato o non collegato a questo proprietario.", 403);
            }
            $fullPath = safeUploadRealPath((string) $doc['file_path']);
            if ($fullPath === null) {
                $label = $doc['title'] ?: $doc['original_name'];
                apiError("Il file \"{$label}\" non esiste più sul server: rimuovilo dagli allegati e riprova.", 410);
            }
            $size       = filesize($fullPath) ?: (int) $doc['file_size'];
            $totalSize += $size;
            $mailAttachments[] = ['path' => $fullPath, 'name' => $doc['original_name'], 'mime' => $doc['mime_type']];
            $meta[]            = ['id' => $docId, 'name' => $doc['original_name'], 'size' => $size];
        }

        if ($totalSize > COMM_MAX_ATTACH_BYTES) {
            $mb = number_format($totalSize / 1048576, 1, ',', '');
            apiError("Allegati troppo pesanti: totale {$mb} MB, il massimo consentito è 20 MB. Rimuovi qualche documento.", 413);
        }

        $attachmentMeta = json_encode($meta, JSON_UNESCAPED_UNICODE);
    }

    // Mittente/destinatario dipendono dalla DIREZIONE, non dal fatto che il
    // messaggio venga spedito davvero: anche una chiamata registrata a mano ha
    // un verso, e invertirlo falsa lo storico.
    if ($direction === 'received') {
        $fromEmail = $client['email'] ?: null;
        $toEmail   = getMailConfig()['agency_email'];
    } else {
        $fromEmail = getMailConfig()['agency_email'];
        $toEmail   = $client['email'];
    }
    $dispatched = $direction === 'sent' && in_array($channel, COMM_DISPATCHED, true);

    // Il destinatario mancante non e' un invio fallito: e' un'anagrafica
    // incompleta. Si blocca prima di scrivere, perche' non c'e' niente da
    // ritentare finche' l'indirizzo non esiste.
    if ($dispatched && $channel === 'email' && empty($client['email'])) {
        apiError('Il proprietario non ha un indirizzo email configurato.');
    }
    if ($dispatched && $channel === 'whatsapp' && empty($client['phone'])) {
        apiError('Il proprietario non ha un numero di telefono configurato.');
    }

    // ── Prima si scrive, poi si spedisce ────────────────────────────────────
    // Prima era il contrario: si spediva e, solo se l'invio riusciva, si
    // inseriva la riga. Un SMTP che non risponde cancellava quindi ogni traccia
    // del tentativo — e l'archivio e' esattamente il posto in cui l'agente
    // guarda per dire al proprietario "le ho scritto il 14". Senza riga non si
    // distingue "non gli ho mai scritto" da "gli ho scritto e non e' partita",
    // e non c'e' niente da ritentare: il messaggio, gli allegati gia'
    // validati e l'immobile di contesto vanno riscritti da capo.
    //
    // Ora la riga nasce 'queued' e viene aggiornata con l'esito. Un invio
    // fallito resta in archivio come 'failed' col motivo, visibile e
    // rispedibile. Le note interne e i messaggi registrati a mano non passano
    // di qui: per loro lo stato definitivo e' gia' quello giusto.
    $status     = $dispatched ? 'queued' : ($direction === 'received' ? 'received' : 'sent');
    $externalId = null;

    $stmt = $db->prepare(
        "INSERT INTO communications
            (client_id, property_id, direction, channel, subject, body, attachments,
             from_email, to_email, status, status_updated_at, external_id)
         VALUES
            (:client_id, :property_id, :direction, :channel, :subject, :body, :attachments,
             :from_email, :to_email, :status, NOW(), :external_id)"
    );
    $stmt->execute([
        'client_id'   => $clientId,
        'property_id' => $propertyId,
        'direction'   => $direction,
        'channel'     => $channel,
        'subject'     => $subject,
        'body'        => $body,
        'attachments' => $attachmentMeta,
        'from_email'  => $fromEmail,
        'to_email'    => $toEmail,
        'status'      => $status,
        'external_id' => $externalId,
    ]);

    $newId    = (int) $db->lastInsertId();
    $attInfo  = $mailAttachments ? ' — ' . count($mailAttachments) . ' allegati' : '';
    logActivity('create', 'communication', $newId, "Comunicazione {$channel} ({$direction}) — proprietario #{$clientId}{$attInfo}");

    if ($dispatched) {
        $result = dispatchMessage($channel, $client, $subject, $body, $mailAttachments);

        // Con MAIL_ENABLED=false (o WhatsApp spento) i config rispondono
        // success=true ma marcano simulated=true. Leggere solo `status`
        // scriveva "inviata" in archivio per un messaggio che nessuno ha
        // ricevuto.
        if ($result['success']) {
            $status     = !empty($result['simulated']) ? 'simulated' : $result['status'];
            $externalId = $result['external_id'] ?? null;
            $detail     = null;
        } else {
            $status = 'failed';
            $detail = mb_substr((string) ($result['error'] ?? 'Invio fallito.'), 0, 255);
        }

        $upd = $db->prepare(
            "UPDATE communications
                SET status = :status, status_detail = :detail,
                    status_updated_at = NOW(), external_id = :external_id
              WHERE id = :id"
        );
        $upd->execute([
            'status'      => $status,
            'detail'      => $detail,
            'external_id' => $externalId,
            'id'          => $newId,
        ]);

        // L'errore arriva comunque all'agente — ma ora con l'id della riga
        // salvata, cosi' la schermata puo' ricaricare il thread e mostrargli
        // il messaggio in archivio invece di lasciarlo credere che sia sparito.
        if ($status === 'failed') {
            apiError($detail, 502, ['message_id' => $newId, 'status' => 'failed']);
        }
    }

    getMessage($db, $newId);
}

/**
 * Consegna vera e propria sul canale scelto. Isolata dal salvataggio perche'
 * il salvataggio non deve piu' dipendere dall'esito.
 *
 * @return array{success:bool, status?:string, external_id?:?string, simulated?:bool, error?:string}
 */
function dispatchMessage(string $channel, array $client, ?string $subject, string $body, array $attachments): array
{
    if ($channel === 'email') {
        return sendHtmlEmail($client['email'], $subject ?? '(nessun oggetto)', $body, $attachments);
    }

    if ($channel === 'whatsapp') {
        require_once __DIR__ . '/../config/whatsapp.php';
        return sendWhatsAppMessage($client['phone'], $body);
    }

    return ['success' => false, 'error' => 'Canale non spedibile.'];
}

function clientExists(PDO $db, int $id): bool
{
    $stmt = $db->prepare("SELECT id FROM clients WHERE id = :id");
    $stmt->execute(['id' => $id]);
    return (bool) $stmt->fetch();
}
