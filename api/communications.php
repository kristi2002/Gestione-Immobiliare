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

    $fromEmail = getMailConfig()['agency_email'];
    $toEmail   = $client['email'];
    $status    = $direction === 'received' ? 'received' : 'sent';
    $externalId = null;

    if ($direction === 'sent') {
        if ($channel === 'email') {
            if (empty($client['email'])) {
                apiError('Il proprietario non ha un indirizzo email configurato.');
            }

            $result = sendHtmlEmail($client['email'], $subject ?? '(nessun oggetto)', $body);

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
            (client_id, direction, channel, subject, body,
             from_email, to_email, status, external_id)
         VALUES
            (:client_id, :direction, :channel, :subject, :body,
             :from_email, :to_email, :status, :external_id)"
    );
    $stmt->execute([
        'client_id'   => $clientId,
        'direction'   => $direction,
        'channel'     => $channel,
        'subject'     => $subject,
        'body'        => $body,
        'from_email'  => $fromEmail,
        'to_email'    => $toEmail,
        'status'      => $status,
        'external_id' => $externalId,
    ]);

    $newId = (int) $db->lastInsertId();
    getMessage($db, $newId);
}

function clientExists(PDO $db, int $id): bool
{
    $stmt = $db->prepare("SELECT id FROM clients WHERE id = :id");
    $stmt->execute(['id' => $id]);
    return (bool) $stmt->fetch();
}
