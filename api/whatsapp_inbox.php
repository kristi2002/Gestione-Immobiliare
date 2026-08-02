<?php
/**
 * WhatsApp Inbox API — two-way message store.
 *
 * GET  /api/whatsapp_inbox.php                    — paginated inbox (direction, from_number, unread=1)
 * GET  /api/whatsapp_inbox.php?threads=1          — una riga per conversazione, con contesto anagrafico
 * GET  /api/whatsapp_inbox.php?thread=+39X        — conversation thread with a specific number
 * GET  /api/whatsapp_inbox.php?action=search_contacts&q= — ricerca proprietari/inquilini/lead
 * PUT  /api/whatsapp_inbox.php?id={id}            — mark as read: {is_read: true}
 * POST /api/whatsapp_inbox.php                    — save outbound message
 * POST /api/whatsapp_inbox.php?action=link        — associa un numero a un contatto esistente
 * POST /api/whatsapp_inbox.php?action=create_lead — crea un lead dal numero e lo associa
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/whatsapp.php';
require_once __DIR__ . '/../config/automation_events.php';
apiHandleOptions();

// Il numero della controparte: per un messaggio in arrivo è il mittente, per uno
// in uscita è il destinatario. Raggruppare su from_number (com'era) faceva
// finire ogni conversazione iniziata da noi sotto il NOSTRO stesso numero.
const WA_COUNTERPARTY = "IF(wm.direction = 'inbound', wm.from_number, wm.to_number)";

/**
 * Quante conversazioni mostra la colonna di sinistra. La ricerca in colonna
 * filtra cio' che e' stato caricato, quindi oltre questo numero non sparivano
 * solo le righe in fondo: sparivano anche dai risultati della ricerca. Il tetto
 * resta (e' una barra laterale, non un elenco), ma ora la risposta dice quante
 * conversazioni esistono davvero e la colonna lo scrive.
 */
const WA_THREADS_LIMIT = 200;

/**
 * Colonna di whatsapp_messages corrispondente al tipo di contatto.
 * Whitelist esplicita: il valore finisce in un nome di colonna, mai concatenare
 * quello che arriva dal client.
 *
 * Dichiarata QUI e non accanto alle funzioni che la usano: a differenza delle
 * funzioni, una const top-level non è "hoisted" — esiste solo dopo che
 * l'esecuzione ha superato la riga, e il dispatcher gira prima.
 */
const WA_LINK_COLUMNS = [
    'client' => ['column' => 'client_id', 'table' => 'clients', 'label' => 'proprietario'],
    'tenant' => ['column' => 'tenant_id', 'table' => 'tenants', 'label' => 'inquilino'],
    'lead'   => ['column' => 'lead_id',   'table' => 'leads',   'label' => 'lead'],
];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $action = trim($_GET['action'] ?? '');
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;
    $thread = trim($_GET['thread'] ?? '');

    $phone = trim($_GET['phone'] ?? '');

    switch ($method) {
        case 'GET':
            if ($action === 'search_contacts') {
                searchContacts($db, trim($_GET['q'] ?? ''));
            } elseif (!empty($_GET['threads'])) {
                listThreads($db);
            } elseif ($thread !== '') {
                getThread($db, $thread);
            } else {
                listInbox($db);
            }
            break;
        case 'PATCH':
            // Mark all messages from a phone number as read
            if ($phone !== '') {
                markPhoneRead($db, $phone);
            } elseif ($id) {
                markAsRead($db, $id);
            } else {
                apiError('phone o id obbligatorio.');
            }
            break;
        case 'PUT':
            if (!$id) apiError('ID messaggio mancante.');
            markAsRead($db, $id);
            break;
        case 'POST':
            if ($action === 'link') {
                linkThreadToContact($db);
            } elseif ($action === 'create_lead') {
                createLeadFromThread($db);
            } else {
                saveOutboundMessage($db);
            }
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

/**
 * Immobile locato a un inquilino, come sotto-query correlata.
 *
 * Il legame inquilino↔immobile NON è una colonna di `tenants` (lo era in
 * phase9, non lo è più): passa dai contratti, e un inquilino può averne più
 * d'uno. Con una JOIN le righe si moltiplicherebbero dentro il GROUP BY e la
 * SUM() dei non letti conterebbe ogni messaggio una volta per contratto.
 *
 * Precedenza: contratto firmato, poi il più recente.
 */
function waTenantPropertySubquery(string $tenantExpr): string
{
    return "(SELECT CONCAT_WS(', ', wp.address, wp.city)
               FROM contracts wct
               JOIN properties wp ON wp.id = wct.property_id
              WHERE wct.tenant_id = {$tenantExpr}
                AND wct.status <> 'cancelled'
              ORDER BY (wct.status = 'signed') DESC, wct.start_date DESC
              LIMIT 1)";
}

function listThreads(PDO $db): void
{
    // Una riga per conversazione, raggruppata sul numero della CONTROPARTE.
    $cp = WA_COUNTERPARTY;

    $total = (int) $db->query(
        // L'alias `wm` serve: WA_COUNTERPARTY lo nomina.
        "SELECT COUNT(*) FROM (SELECT {$cp} AS phone FROM whatsapp_messages wm GROUP BY phone) t"
    )->fetchColumn();

    // contact_key = "tipo:id" del messaggio associato PIÙ RECENTE.
    //
    // Non si può usare MAX(contact_type) + MAX(contact_id) separati: MAX() su
    // stringhe ordina in alfabetico ('lead' > 'client'), quindi sceglierebbe il
    // tipo per ragioni tipografiche, e i due MAX possono per giunta arrivare da
    // due righe diverse — nome di uno e id dell'altro. GROUP_CONCAT scarta i
    // NULL da solo, così una riga non associata non "spegne" il contatto.
    $stmt = $db->query(
        "SELECT
            {$cp} AS phone,
            MAX(wm.received_at) AS last_at,
            SUBSTRING_INDEX(GROUP_CONCAT(wm.body ORDER BY wm.received_at DESC SEPARATOR '|||'), '|||', 1) AS last_message,
            SUM(wm.is_read = 0 AND wm.direction = 'inbound') AS unread_count,
            SUBSTRING_INDEX(GROUP_CONCAT(
                CASE WHEN wm.client_id IS NOT NULL THEN CONCAT('client:', wm.client_id)
                     WHEN wm.tenant_id IS NOT NULL THEN CONCAT('tenant:', wm.tenant_id)
                     WHEN wm.lead_id   IS NOT NULL THEN CONCAT('lead:',   wm.lead_id)
                END
                ORDER BY wm.received_at DESC, wm.id DESC SEPARATOR '|'), '|', 1) AS contact_key
         FROM whatsapp_messages wm
         GROUP BY phone
         ORDER BY last_at DESC
         LIMIT " . WA_THREADS_LIMIT
    );

    $rows = $stmt->fetchAll();
    apiSuccess([
        'items' => waAttachContacts($db, $rows),
        'total' => $total,
        'limit' => WA_THREADS_LIMIT,
    ]);
}

/**
 * Riempie nome/ruolo/contesto a partire da contact_key.
 *
 * Una query per tipo di anagrafica invece di JOIN nella GROUP BY: le JOIN
 * moltiplicano le righe (un inquilino con due contratti) e falsano la SUM()
 * dei non letti, che è il numero su cui l'agente decide cosa aprire.
 */
function waAttachContacts(PDO $db, array $rows): array
{
    $idsByType = ['client' => [], 'tenant' => [], 'lead' => []];

    foreach ($rows as $r) {
        [$type, $id] = array_pad(explode(':', (string) ($r['contact_key'] ?? ''), 2), 2, null);
        if (isset($idsByType[$type]) && (int) $id > 0) {
            $idsByType[$type][(int) $id] = true;
        }
    }

    $lookup = ['client' => [], 'tenant' => [], 'lead' => []];

    foreach ($idsByType as $type => $ids) {
        if (!$ids) continue;
        $ids = array_keys($ids);
        $in  = implode(',', array_fill(0, count($ids), '?'));

        $sql = match ($type) {
            'client' => "SELECT id, CONCAT(name, ' ', surname) AS nome, NULL AS detail FROM clients WHERE id IN ({$in})",
            'tenant' => "SELECT id, CONCAT(name, ' ', surname) AS nome, " . waTenantPropertySubquery('tenants.id') . " AS detail FROM tenants WHERE id IN ({$in})",
            'lead'   => "SELECT id, CONCAT(name, ' ', surname) AS nome, CONCAT('interesse ', interest_type) AS detail FROM leads WHERE id IN ({$in})",
        };

        $stmt = $db->prepare($sql);
        $stmt->execute($ids);
        foreach ($stmt->fetchAll() as $row) {
            $lookup[$type][(int) $row['id']] = $row;
        }
    }

    return array_map(static function (array $r) use ($lookup): array {
        [$type, $id] = array_pad(explode(':', (string) ($r['contact_key'] ?? ''), 2), 2, null);
        $hit = $lookup[$type][(int) $id] ?? null;

        $r['contact_type'] = $hit ? $type : null;
        $r['contact_id']   = $hit ? (int) $id : null;
        $r['contact_name'] = $hit['nome'] ?? null;

        $r['contact_role'] = match ($r['contact_type']) {
            'client' => 'Proprietario',
            'tenant' => 'Inquilino',
            'lead'   => 'Lead',
            default  => null,
        };

        $detail = $hit['detail'] ?? null;
        $r['contact_context'] = $r['contact_role'] === null
            ? null
            : trim($r['contact_role'] . ($detail ? ' · ' . $detail : ''));

        // Il flag su cui la UI decide se mostrare il banner di triage.
        $r['is_unknown'] = $r['contact_type'] === null;

        unset($r['contact_key']);
        return $r;
    }, $rows);
}

/**
 * Ricerca contatti per il modale "Associa a contatto esistente".
 * Unisce le tre anagrafiche in un unico elenco tipizzato: l'agente sta cercando
 * "Mario Rossi", non sta scegliendo in quale tabella guardare.
 */
function searchContacts(PDO $db, string $q): void
{
    if (mb_strlen($q) < 2) {
        apiSuccess([]);
    }

    $like = '%' . $q . '%';

    $sql = "(SELECT 'client' AS type, id, name, surname, phone, email,
                    'Proprietario' AS role, NULL AS detail
               FROM clients
              WHERE status = 'active'
                AND (name LIKE :q1 OR surname LIKE :q2 OR phone LIKE :q3 OR email LIKE :q4)
              LIMIT 10)
            UNION ALL
            (SELECT 'tenant', t.id, t.name, t.surname, t.phone, t.email,
                    'Inquilino', " . waTenantPropertySubquery('t.id') . "
               FROM tenants t
              WHERE t.status = 'active'
                AND (t.name LIKE :q1 OR t.surname LIKE :q2 OR t.phone LIKE :q3 OR t.email LIKE :q4)
              LIMIT 10)
            UNION ALL
            (SELECT 'lead', id, name, surname, phone, email,
                    'Lead', interest_type
               FROM leads
              WHERE status <> 'lost'
                AND (name LIKE :q1 OR surname LIKE :q2 OR phone LIKE :q3 OR email LIKE :q4)
              LIMIT 10)";

    $stmt = $db->prepare($sql);
    $stmt->execute(['q1' => $like, 'q2' => $like, 'q3' => $like, 'q4' => $like]);
    apiSuccess($stmt->fetchAll());
}

function markPhoneRead(PDO $db, string $phone): void
{
    $stmt = $db->prepare(
        "UPDATE whatsapp_messages SET is_read = 1
         WHERE (from_number = :phone OR to_number = :phone2) AND direction = 'inbound' AND is_read = 0"
    );
    $stmt->execute(['phone' => $phone, 'phone2' => $phone]);
    apiSuccess(['phone' => $phone, 'marked_read' => $stmt->rowCount()]);
}

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
                 WHERE from_number = :num1 OR to_number = :num2";
    $dataSql  = "SELECT wm.*,
                    c.name AS client_name, c.surname AS client_surname,
                    t.name AS tenant_name, t.surname AS tenant_surname
                 FROM whatsapp_messages wm
                 LEFT JOIN clients c ON c.id = wm.client_id
                 LEFT JOIN tenants t ON t.id = wm.tenant_id
                 WHERE wm.from_number = :num1 OR wm.to_number = :num2
                 ORDER BY wm.received_at ASC";

    $params = ['num1' => $number, 'num2' => $number];

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

// ---------------------------------------------------------------------------
// Triage: agganciare un numero all'anagrafica senza uscire dalla chat
// ---------------------------------------------------------------------------

/**
 * Associa TUTTI i messaggi di una conversazione a un contatto esistente.
 *
 * Retroattivo di proposito: se il numero era anonimo da tre settimane, dopo
 * l'associazione lo storico completo deve comparire sotto quella persona —
 * altrimenti resterebbe metà conversazione orfana.
 */
function linkThreadToContact(PDO $db): void
{
    $data  = apiGetJsonBody();
    $phone = trim($data['phone'] ?? '');
    $type  = trim($data['type'] ?? '');
    $id    = (int) ($data['id'] ?? 0);

    if ($phone === '') apiError('Numero della conversazione mancante.');
    if (!isset(WA_LINK_COLUMNS[$type])) apiError('Tipo di contatto non valido.');
    if ($id <= 0) apiError('Contatto non valido.');

    $meta = WA_LINK_COLUMNS[$type];

    $check = $db->prepare("SELECT id, phone FROM {$meta['table']} WHERE id = :id");
    $check->execute(['id' => $id]);
    $contact = $check->fetch();
    if (!$contact) {
        apiError(ucfirst($meta['label']) . ' non trovato.', 404);
    }

    $affected = waApplyLink($db, $phone, $type, $id);

    // Se il contatto non aveva un numero, glielo scriviamo: è ciò che fa
    // riconoscere automaticamente il PROSSIMO messaggio senza rifare il lavoro.
    // Mai sovrascrivere un numero già presente — non sappiamo quale sia quello
    // buono e cancellarlo è una perdita di dato silenziosa.
    if (empty($contact['phone'])) {
        $db->prepare("UPDATE {$meta['table']} SET phone = :phone WHERE id = :id")
           ->execute(['phone' => $phone, 'id' => $id]);
    }

    // Registrato sul CONTATTO, non su 'whatsapp_message': $id e' l'id del
    // proprietario/inquilino/lead, e scriverlo come id di un messaggio faceva
    // puntare la voce del registro a un messaggio che non esiste. Chi cerca la
    // storia di un contatto trova la riga dove si aspetta di trovarla.
    logActivity('update', $type, $id,
        "Conversazione WhatsApp {$phone} associata a {$meta['label']} #{$id} ({$affected} messaggi)");

    apiSuccess(['phone' => $phone, 'type' => $type, 'id' => $id, 'messages_linked' => $affected]);
}

/**
 * Crea un lead partendo da un numero sconosciuto e gli aggancia la conversazione.
 * È il caso più frequente dell'inbox: annuncio → messaggio → nessuna anagrafica.
 */
function createLeadFromThread(PDO $db): void
{
    $data    = apiGetJsonBody();
    $phone   = trim($data['phone'] ?? '');
    $name    = trim($data['name'] ?? '');
    $surname = trim($data['surname'] ?? '');
    $notes   = trim($data['notes'] ?? '') ?: null;

    if ($phone === '')   apiError('Numero della conversazione mancante.');
    if ($name === '')    apiError('Il nome è obbligatorio.');
    if ($surname === '') apiError('Il cognome è obbligatorio.');

    $interest = trim($data['interest_type'] ?? 'affitto');
    if (!in_array($interest, ['affitto', 'acquisto', 'entrambi'], true)) {
        apiError('Tipo di interesse non valido.');
    }

    // Un numero già a sistema quasi sempre significa che l'agente non ha visto
    // il contatto esistente: meglio fermarsi che creare il doppione.
    $existing = resolveWhatsAppContact($db, $phone);
    if ($existing['client_id'] || $existing['tenant_id'] || $existing['lead_id']) {
        apiError('Questo numero è già in anagrafica come ' . ($existing['name'] ?? 'contatto esistente') . '. Usa "Associa a contatto".', 409);
    }

    // Transazione: creare il lead e agganciargli la conversazione sono un gesto
    // solo. Se il secondo passo fallisce, un lead senza messaggi è un contatto
    // fantasma che blocca anche il tentativo successivo (il guard sui duplicati
    // qui sopra lo riconoscerebbe come "già in anagrafica").
    $db->beginTransaction();
    try {
        $db->prepare(
            "INSERT INTO leads (name, surname, phone, interest_type, status, source, notes)
             VALUES (:name, :surname, :phone, :interest, 'new', 'whatsapp', :notes)"
        )->execute([
            'name'     => $name,
            'surname'  => $surname,
            'phone'    => $phone,
            'interest' => $interest,
            'notes'    => $notes,
        ]);

        $leadId   = (int) $db->lastInsertId();
        $affected = waApplyLink($db, $phone, 'lead', $leadId);

        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
    }

    emitAutomationEvent($db, 'lead.created', 'lead', $leadId, [
        'lead_id'     => $leadId,
        'property_id' => null,
    ]);

    logActivity('create', 'lead', $leadId,
        "Lead creato da WhatsApp Inbox ({$phone}) — {$affected} messaggi collegati");

    apiSuccess([
        'lead_id'         => $leadId,
        'phone'           => $phone,
        'name'            => trim($name . ' ' . $surname),
        'messages_linked' => $affected,
    ]);
}

/**
 * Scrive l'associazione su tutti i messaggi della conversazione, azzerando gli
 * altri due riferimenti: un messaggio appartiene a una persona sola, e lasciare
 * un client_id vecchio accanto a un lead_id nuovo farebbe vincere il primo nella
 * CASE di listThreads.
 */
function waApplyLink(PDO $db, string $phone, string $type, int $id): int
{
    $column = WA_LINK_COLUMNS[$type]['column'];
    $others = array_values(array_diff(
        array_column(WA_LINK_COLUMNS, 'column'),
        [$column]
    ));

    $set = "{$column} = :id, " . implode(' = NULL, ', $others) . ' = NULL';
    $cp  = WA_COUNTERPARTY;

    $stmt = $db->prepare("UPDATE whatsapp_messages wm SET {$set} WHERE {$cp} = :phone");
    $stmt->execute(['id' => $id, 'phone' => $phone]);

    return $stmt->rowCount();
}

function saveOutboundMessage(PDO $db): void
{
    $data      = apiGetJsonBody();
    $fromNumber = trim($data['from_number'] ?? '');
    $toNumber   = trim($data['to_number'] ?? '');
    $body       = trim($data['body'] ?? '');
    $mediaUrl   = trim($data['media_url'] ?? '') ?: null;
    $externalId = trim($data['external_id'] ?? '') ?: null;
    $clientId   = !empty($data['client_id']) ? (int) $data['client_id'] : null;
    $tenantId   = !empty($data['tenant_id']) ? (int) $data['tenant_id'] : null;
    $leadId     = !empty($data['lead_id'])   ? (int) $data['lead_id']   : null;

    if ($toNumber === '') apiError('to_number obbligatorio.');

    $stmt = $db->prepare(
        "INSERT INTO whatsapp_messages
            (direction, from_number, to_number, body, media_url, external_id, client_id, tenant_id, lead_id, is_read, received_at)
         VALUES
            ('outbound', :from_number, :to_number, :body, :media_url, :external_id, :client_id, :tenant_id, :lead_id, 1, NOW())"
    );
    $stmt->execute([
        'from_number' => $fromNumber,
        'to_number'   => $toNumber,
        'body'        => $body,
        'media_url'   => $mediaUrl,
        'external_id' => $externalId,
        'client_id'   => $clientId,
        'tenant_id'   => $tenantId,
        'lead_id'     => $leadId,
    ]);

    $newId = (int) $db->lastInsertId();

    $fetchStmt = $db->prepare("SELECT * FROM whatsapp_messages WHERE id = :id");
    $fetchStmt->execute(['id' => $newId]);
    apiSuccess($fetchStmt->fetch());
}
