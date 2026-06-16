<?php
/**
 * WhatsApp Inbox API — two-way message store.
 *
 * GET /api/whatsapp_inbox.php              — paginated inbox (direction, from_number, unread=1)
 * GET /api/whatsapp_inbox.php?thread=+39X  — conversation thread with a specific number
 * PUT /api/whatsapp_inbox.php?id={id}      — mark as read: {is_read: true}
 * POST /api/whatsapp_inbox.php             — save outbound message (called by whatsapp_send.php)
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
apiHandleOptions();

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;
    $thread = trim($_GET['thread'] ?? '');

    switch ($method) {
        case 'GET':
            if ($thread !== '') {
                getThread($db, $thread);
            } else {
                listInbox($db);
            }
            break;
        case 'PUT':
            if (!$id) apiError('ID messaggio mancante.');
            markAsRead($db, $id);
            break;
        case 'POST':
            saveOutboundMessage($db);
            break;
        default:
            apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function listInbox(PDO $db): void
{
    $pagination = apiGetPagination();
    $direction  = trim($_GET['direction'] ?? '');
    $fromNumber = trim($_GET['from_number'] ?? '');
    $unreadOnly = !empty($_GET['unread']);

    $where  = 'WHERE 1=1';
    $params = [];

    if ($direction !== '' && in_array($direction, ['inbound', 'outbound'], true)) {
        $where .= ' AND wm.direction = :direction';
        $params['direction'] = $direction;
    }
    if ($fromNumber !== '') {
        $where .= ' AND wm.from_number LIKE :from_number';
        $params['from_number'] = '%' . $fromNumber . '%';
    }
    if ($unreadOnly) {
        $where .= ' AND wm.is_read = 0';
    }

    $countSql = "SELECT COUNT(*) FROM whatsapp_messages wm $where";

    $dataSql = "SELECT wm.*,
                   c.name AS client_name, c.surname AS client_surname,
                   t.name AS tenant_name, t.surname AS tenant_surname
            FROM whatsapp_messages wm
            LEFT JOIN clients c ON c.id = wm.client_id
            LEFT JOIN tenants t ON t.id = wm.tenant_id
            $where
            ORDER BY wm.received_at DESC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getThread(PDO $db, string $number): void
{
    $pagination = apiGetPagination(50, 200);

    $countSql = "SELECT COUNT(*) FROM whatsapp_messages
                 WHERE from_number = :num OR to_number = :num2";
    $dataSql  = "SELECT wm.*,
                    c.name AS client_name, c.surname AS client_surname,
                    t.name AS tenant_name, t.surname AS tenant_surname
                 FROM whatsapp_messages wm
                 LEFT JOIN clients c ON c.id = wm.client_id
                 LEFT JOIN tenants t ON t.id = wm.tenant_id
                 WHERE wm.from_number = :num3 OR wm.to_number = :num4
                 ORDER BY wm.received_at ASC";

    $params = ['num' => $number, 'num2' => $number, 'num3' => $number, 'num4' => $number];

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function markAsRead(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT id FROM whatsapp_messages WHERE id = :id");
    $stmt->execute(['id' => $id]);
    if (!$stmt->fetch()) {
        apiError('Messaggio non trovato.', 404);
    }

    $db->prepare("UPDATE whatsapp_messages SET is_read = 1 WHERE id = :id")->execute(['id' => $id]);

    apiSuccess(['id' => $id, 'is_read' => true]);
}

function saveOutboundMessage(PDO $db): void
{
    $data      = apiGetJsonBody();
    $fromNumber = trim($data['from_number'] ?? '');
    $toNumber   = trim($data['to_number'] ?? '');
    $body       = trim($data['body'] ?? '');
    $mediaUrl   = trim($data['media_url'] ?? '') ?: null;
    $twilioSid  = trim($data['twilio_sid'] ?? '') ?: null;
    $clientId   = !empty($data['client_id']) ? (int) $data['client_id'] : null;
    $tenantId   = !empty($data['tenant_id']) ? (int) $data['tenant_id'] : null;

    if ($toNumber === '') apiError('to_number obbligatorio.');

    $stmt = $db->prepare(
        "INSERT INTO whatsapp_messages
            (direction, from_number, to_number, body, media_url, twilio_sid, client_id, tenant_id, is_read, received_at)
         VALUES
            ('outbound', :from_number, :to_number, :body, :media_url, :twilio_sid, :client_id, :tenant_id, 1, NOW())"
    );
    $stmt->execute([
        'from_number' => $fromNumber,
        'to_number'   => $toNumber,
        'body'        => $body,
        'media_url'   => $mediaUrl,
        'twilio_sid'  => $twilioSid,
        'client_id'   => $clientId,
        'tenant_id'   => $tenantId,
    ]);

    $newId = (int) $db->lastInsertId();

    $fetchStmt = $db->prepare("SELECT * FROM whatsapp_messages WHERE id = :id");
    $fetchStmt->execute(['id' => $newId]);
    apiSuccess($fetchStmt->fetch());
}
