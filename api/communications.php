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

const COMM_CHANNELS   = ['email', 'whatsapp'];
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
                    ORDER BY cm2.created_at DESC LIMIT 1) AS last_message_direction
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
        "SELECT cm.*, c.name AS client_name, c.surname AS client_surname, c.email AS client_email
         FROM communications cm
         INNER JOIN clients c ON c.id = cm.client_id
         WHERE cm.client_id = :client_id
         ORDER BY cm.created_at ASC"
    );
    $stmt->execute(['client_id' => $clientId]);

    $clientStmt = $db->prepare(
        "SELECT id, name, surname, email, phone FROM clients WHERE id = :id"
    );
    $clientStmt->execute(['id' => $clientId]);
    $client = $clientStmt->fetch();

    apiSuccess([
        'client'   => $client,
        'messages' => $stmt->fetchAll(),
    ]);
}

function getMessage(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT cm.*, c.name AS client_name, c.surname AS client_surname
         FROM communications cm
         INNER JOIN clients c ON c.id = cm.client_id
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

    $clientStmt = $db->prepare(
        "SELECT id, name, surname, email FROM clients WHERE id = :id AND status != 'archived'"
    );
    $clientStmt->execute(['id' => $clientId]);
    $client = $clientStmt->fetch();

    if (!$client) {
        apiError('Proprietario non trovato o archiviato.');
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

    $fromEmail = getMailConfig()['agency_email'];
    $toEmail   = $client['email'];
    $status    = $direction === 'received' ? 'received' : 'sent';
    $externalId = null;

    if ($direction === 'sent') {
        if ($channel === 'email') {
            if (empty($client['email'])) {
                apiError('Il proprietario non ha un indirizzo email configurato.');
            }

            $result = sendHtmlEmail($client['email'], $subject ?? '(nessun oggetto)', $body, $mailAttachments);

            if (!$result['success']) {
                apiError($result['error'] ?? 'Invio fallito.');
            }

            $status     = $result['status'];
            $externalId = $result['external_id'];
        } elseif ($channel === 'whatsapp') {
            if (empty($client['phone'])) {
                apiError('Il proprietario non ha un numero di telefono configurato.');
            }

            require_once __DIR__ . '/../config/whatsapp.php';
            $result = sendWhatsAppMessage($client['phone'], $body);

            if (!$result['success']) {
                apiError($result['error'] ?? 'Invio WhatsApp fallito.');
            }

            $status     = $result['status'];
            $externalId = $result['external_id'];
        }
    } else {
        $fromEmail = $client['email'] ?: null;
        $toEmail   = getMailConfig()['agency_email'];
    }

    $stmt = $db->prepare(
        "INSERT INTO communications
            (client_id, direction, channel, subject, body, attachments,
             from_email, to_email, status, external_id)
         VALUES
            (:client_id, :direction, :channel, :subject, :body, :attachments,
             :from_email, :to_email, :status, :external_id)"
    );
    $stmt->execute([
        'client_id'   => $clientId,
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
    getMessage($db, $newId);
}

function clientExists(PDO $db, int $id): bool
{
    $stmt = $db->prepare("SELECT id FROM clients WHERE id = :id");
    $stmt->execute(['id' => $id]);
    return (bool) $stmt->fetch();
}
