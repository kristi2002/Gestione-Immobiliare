<?php
/**
 * Property keys (gestione chiavi) API.
 *
 * Due invarianti reggono questo file:
 *
 * 1) Il DETENTORE è polimorfo. holder_type dice quale FK è valorizzata
 *    (agente/fornitore/inquilino/proprietario/lead) e holder_name resta solo
 *    per il detentore occasionale ('altro'). Così una chiave consegnata a un
 *    idraulico risulta sulla scheda di QUEL fornitore, non in una stringa.
 *
 * 2) Ogni cambio di custodia scrive una riga in property_key_events. La tabella
 *    property_keys è lo STATO corrente; il registro è la STORIA, ed è
 *    append-only: qui non esiste alcun UPDATE o DELETE su property_key_events.
 *    Chi tocca questo file non ne aggiunga.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();

const KEY_STATUSES     = ['out', 'in_office', 'lost'];
const KEY_TYPES        = ['portone', 'appartamento', 'cantina', 'box', 'cancello', 'altro'];
const KEY_HOLDER_TYPES = ['agente', 'fornitore', 'inquilino', 'proprietario', 'lead', 'altro'];

/** holder_type → colonna FK che lo rappresenta ('altro' vive in holder_name). */
const KEY_HOLDER_COLUMNS = [
    'agente'       => 'holder_id',
    'fornitore'    => 'holder_supplier_id',
    'inquilino'    => 'holder_tenant_id',
    'proprietario' => 'holder_client_id',
    'lead'         => 'holder_lead_id',
];

/** Tutte le colonne detentore, azzerate in blocco prima di riscriverne una. */
const KEY_HOLDER_ALL_COLUMNS = [
    'holder_id', 'holder_supplier_id', 'holder_tenant_id', 'holder_client_id', 'holder_lead_id',
];

/**
 * Etichetta leggibile del detentore, calcolata in SQL.
 * Serve sia alla lista sia allo snapshot nel registro eventi.
 */
const KEY_HOLDER_LABEL_SQL = "COALESCE(
        au.username,
        sup.name,
        NULLIF(TRIM(CONCAT_WS(' ', ten.name, ten.surname)), ''),
        NULLIF(TRIM(CONCAT_WS(' ', cli.name, cli.surname)), ''),
        NULLIF(TRIM(CONCAT_WS(' ', led.name, led.surname)), ''),
        k.holder_name
    )";

const KEY_HOLDER_JOINS = "
    LEFT JOIN admin_users au  ON au.id  = k.holder_id
    LEFT JOIN suppliers   sup ON sup.id = k.holder_supplier_id
    LEFT JOIN tenants     ten ON ten.id = k.holder_tenant_id
    LEFT JOIN clients     cli ON cli.id = k.holder_client_id
    LEFT JOIN leads       led ON led.id = k.holder_lead_id";

/** Una chiave è in ritardo solo se è FUORI, non rientrata e la scadenza è passata. */
const KEY_OVERDUE_SQL = "(k.status = 'out' AND k.returned_at IS NULL
                          AND k.due_back_at IS NOT NULL AND k.due_back_at < CURDATE())";

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;
    $action = $_GET['action'] ?? '';

    switch ($method) {
        case 'GET':
            if ($action === 'holder_options') {
                holderOptions($db);
            } elseif ($action === 'context') {
                handoverContext($db);
            } elseif ($action === 'history') {
                if (!$id) apiError('ID chiavi mancante.');
                keyHistory($db, $id);
            } elseif ($id) {
                getKey($db, $id);
            } else {
                listKeys($db);
            }
            break;
        case 'POST':
            if ($action === 'return') {
                if (!$id) apiError('ID chiavi mancante.');
                returnKey($db, $id);
            } else {
                createKey($db);
            }
            break;
        case 'PUT':
            if (!$id) apiError('ID chiavi mancante.');
            updateKey($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID chiavi mancante.');
            deleteKey($db, $id);
            break;
        default:
            apiError('Metodo non consentito.', 405);
    }
} catch (PDOException) {
    apiError('Errore database.', 500);
}

function listKeys(PDO $db): void
{
    $pagination = apiGetPagination();
    $propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : null;
    $holderId   = isset($_GET['holder_id']) ? (int) $_GET['holder_id'] : null;
    $holderType = trim($_GET['holder_type'] ?? '');
    $status     = trim($_GET['status'] ?? '');
    $search     = trim($_GET['search'] ?? '');
    $overdue    = !empty($_GET['overdue']);

    $where  = ' WHERE 1=1';
    $params = [];

    if ($propertyId) {
        $where .= ' AND k.property_id = :property_id';
        $params['property_id'] = $propertyId;
    }
    if ($holderId) {
        $where .= ' AND k.holder_id = :holder_id';
        $params['holder_id'] = $holderId;
    }
    if ($holderType !== '' && in_array($holderType, KEY_HOLDER_TYPES, true)) {
        $where .= ' AND k.holder_type = :holder_type';
        $params['holder_type'] = $holderType;
    }
    // Le schede di fornitore/inquilino/proprietario/lead chiedono "quali chiavi
    // ha in mano questo soggetto": un filtro per FK tipizzata, non per testo.
    foreach (['supplier_id' => 'holder_supplier_id', 'tenant_id' => 'holder_tenant_id',
              'client_id'   => 'holder_client_id',   'lead_id'   => 'holder_lead_id'] as $param => $column) {
        if (!empty($_GET[$param])) {
            $where .= " AND k.$column = :$param";
            $params[$param] = (int) $_GET[$param];
        }
    }
    if ($status !== '' && in_array($status, KEY_STATUSES, true)) {
        $where .= ' AND k.status = :status';
        $params['status'] = $status;
    }
    if ($overdue) {
        $where .= ' AND ' . KEY_OVERDUE_SQL;
    }
    if ($search !== '') {
        // key_code va cercato qui: è il codice stampato sul portachiavi fisico,
        // ossia il primo dato che un addetto digita (o scansiona) al bancone.
        $where .= ' AND (p.address LIKE :search OR p.city LIKE :search OR k.key_code LIKE :search'
                . ' OR k.holder_name LIKE :search OR au.username LIKE :search OR sup.name LIKE :search'
                . " OR CONCAT_WS(' ', ten.name, ten.surname) LIKE :search"
                . " OR CONCAT_WS(' ', cli.name, cli.surname) LIKE :search"
                . " OR CONCAT_WS(' ', led.name, led.surname) LIKE :search)";
        $params['search'] = '%' . $search . '%';
    }

    $from = "FROM property_keys k
             INNER JOIN properties p ON p.id = k.property_id"
          . KEY_HOLDER_JOINS;

    $countSql = "SELECT COUNT(*) " . $from . $where;
    $dataSql  = "SELECT k.*, p.address, p.city,
                        au.username AS holder_username,
                        " . KEY_HOLDER_LABEL_SQL . " AS holder_display,
                        " . KEY_OVERDUE_SQL . " AS is_overdue,
                        CASE WHEN k.due_back_at IS NULL THEN NULL
                             ELSE DATEDIFF(CURDATE(), k.due_back_at) END AS days_overdue "
              . $from . $where
              . ' ORDER BY ' . KEY_OVERDUE_SQL . ' DESC, k.updated_at DESC';

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getKey(PDO $db, int $id): void
{
    apiSuccess(fetchKey($db, $id));
}

function fetchKey(PDO $db, int $id): array
{
    $stmt = $db->prepare(
        "SELECT k.*, p.address, p.city,
                au.username AS holder_username,
                " . KEY_HOLDER_LABEL_SQL . " AS holder_display,
                " . KEY_OVERDUE_SQL . " AS is_overdue,
                CASE WHEN k.due_back_at IS NULL THEN NULL
                     ELSE DATEDIFF(CURDATE(), k.due_back_at) END AS days_overdue
         FROM property_keys k
         INNER JOIN properties p ON p.id = k.property_id"
         . KEY_HOLDER_JOINS . "
         WHERE k.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    if (!$row) apiError('Registro chiavi non trovato.', 404);
    return $row;
}

/**
 * Timeline di custodia. È l'unica lettura del registro esposta al client.
 */
function keyHistory(PDO $db, int $id): void
{
    // Ordinamento per data DELL'EVENTO, non di registrazione: le chiavi si
    // registrano spesso il giorno dopo, e una timeline ordinata per created_at
    // mostrerebbe le date saltellare avanti e indietro. created_at resta il
    // criterio di spareggio e viene esposto a parte, perché è quello che rende
    // il registro verificabile.
    $stmt = $db->prepare(
        "SELECT e.*, a.appointment_date, a.appointment_type,
                r.title AS reminder_title, r.request_type AS reminder_request_type
           FROM property_key_events e
           LEFT JOIN appointments a ON a.id = e.appointment_id
           LEFT JOIN reminders    r ON r.id = e.reminder_id
          WHERE e.key_id = :id
          ORDER BY COALESCE(e.event_date, DATE(e.created_at)) DESC, e.created_at DESC, e.id DESC"
    );
    $stmt->execute(['id' => $id]);
    apiSuccess($stmt->fetchAll());
}

/**
 * Elenchi per il selettore di detentore, in una sola risposta: quattro fetch
 * separate dal browser per aprire una modale sarebbero uno spreco.
 */
function holderOptions(PDO $db): void
{
    $q = static fn(string $sql): array => $db->query($sql)->fetchAll();

    apiSuccess([
        'agente'       => $q("SELECT id, username AS label FROM admin_users WHERE is_active = 1 ORDER BY username"),
        'fornitore'    => $q("SELECT id, name AS label, category FROM suppliers WHERE is_active = 1 ORDER BY name"),
        'inquilino'    => $q("SELECT id, TRIM(CONCAT_WS(' ', name, surname)) AS label FROM tenants ORDER BY surname, name"),
        'proprietario' => $q("SELECT id, TRIM(CONCAT_WS(' ', name, surname)) AS label FROM clients ORDER BY surname, name"),
        'lead'         => $q("SELECT id, TRIM(CONCAT_WS(' ', name, surname)) AS label FROM leads ORDER BY surname, name"),
    ]);
}

/**
 * Perché quelle chiavi sono uscite: l'appuntamento o l'intervento che l'ha
 * motivata. Sono le due sole ragioni ricorrenti nella pratica dell'agenzia, e
 * senza questo aggancio la timeline dice "consegnate a Rossi" senza dire perché.
 *
 * Gli "interventi" qui sono righe `reminders`: in questa app la manutenzione
 * non ha una tabella propria. Il predicato è lo STESSO della bacheca
 * manutenzione (api/reminders.php, type=maintenance) — request_type, non
 * maintenance_status: quest'ultimo ha DEFAULT 'aperta' e quindi vale per ogni
 * promemoria, compresi gli avvisi di chiave in ritardo generati da qui.
 */
function handoverContext(PDO $db): void
{
    $propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : 0;
    if ($propertyId <= 0) apiError('Immobile mancante.');

    $appts = $db->prepare(
        "SELECT a.id, a.appointment_date, a.appointment_type,
                TRIM(CONCAT_WS(' ', COALESCE(l.name, c.name), COALESCE(l.surname, c.surname))) AS counterpart
           FROM appointments a
           LEFT JOIN leads   l ON l.id = a.lead_id
           LEFT JOIN clients c ON c.id = a.client_id
          WHERE a.property_id = :pid
            AND a.status IN ('scheduled', 'completed')
            AND a.appointment_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          ORDER BY a.appointment_date DESC
          LIMIT 50"
    );
    $appts->execute(['pid' => $propertyId]);

    $works = $db->prepare(
        "SELECT r.id, r.title, r.maintenance_status, r.reminder_date, s.name AS supplier_name
           FROM reminders r
           LEFT JOIN suppliers s ON s.id = r.supplier_id
          WHERE r.property_id = :pid
            AND (r.request_type = 'maintenance'
                 OR (r.request_type IS NULL AND r.title LIKE :marker))
            AND r.maintenance_status IN ('aperta', 'in_lavorazione')
          ORDER BY r.reminder_date DESC
          LIMIT 50"
    );
    $works->execute(['pid' => $propertyId, 'marker' => '[Richiesta maintenance]%']);

    apiSuccess([
        'appointments' => $appts->fetchAll(),
        'interventi'   => $works->fetchAll(),
    ]);
}

function createKey(PDO $db): void
{
    $data   = apiGetJsonBody();
    $params = validateKeyInput($db, $data);

    $db->beginTransaction();
    try {
        $columns = array_keys($params);
        $stmt = $db->prepare(
            'INSERT INTO property_keys (' . implode(', ', $columns) . ')
             VALUES (:' . implode(', :', $columns) . ')'
        );
        $stmt->execute($params);
        $id = (int) $db->lastInsertId();

        $row = fetchKeyRaw($db, $id);
        logKeyEvent($db, $id, $row['status'] === 'out' ? 'handover' : 'created', $row, null, $data);
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
    }

    logActivity('create', 'property_key', $id, 'Registrate chiavi immobile #' . $params['property_id']);
    getKey($db, $id);
}

function updateKey(PDO $db, int $id): void
{
    $data   = apiGetJsonBody();
    $params = validateKeyInput($db, $data);

    $db->beginTransaction();
    try {
        $before = fetchKeyRaw($db, $id);
        if (!$before) {
            $db->rollBack();
            apiError('Registro chiavi non trovato.', 404);
        }

        $assignments = implode(', ', array_map(static fn($c) => "$c = :$c", array_keys($params)));
        $stmt = $db->prepare("UPDATE property_keys SET $assignments WHERE id = :id");
        $stmt->execute($params + ['id' => $id]);

        $after = fetchKeyRaw($db, $id);
        logKeyEvent($db, $id, classifyKeyChange($before, $after), $after, $before, $data);
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
    }

    logActivity('update', 'property_key', $id, 'Aggiornate chiavi #' . $id);
    getKey($db, $id);
}

/**
 * Rientro rapido: il gesto più frequente al bancone è "le chiavi sono tornate",
 * e costringere a riaprire la modale per cambiare due campi è il motivo per cui
 * un registro chiavi smette di essere aggiornato.
 */
function returnKey(PDO $db, int $id): void
{
    $data = apiGetJsonBody();
    $date = normalizeKeyDate($data['returned_at'] ?? null, 'Data di rientro') ?? date('Y-m-d');

    $db->beginTransaction();
    try {
        $before = fetchKeyRaw($db, $id);
        if (!$before) {
            $db->rollBack();
            apiError('Registro chiavi non trovato.', 404);
        }

        $stmt = $db->prepare(
            "UPDATE property_keys
                SET status = 'in_office', returned_at = :returned_at, due_back_at = NULL,
                    overdue_notified_at = NULL, holder_type = NULL, holder_name = NULL,
                    holder_id = NULL, holder_supplier_id = NULL, holder_tenant_id = NULL,
                    holder_client_id = NULL, holder_lead_id = NULL,
                    location = COALESCE(:location, location)
              WHERE id = :id"
        );
        $stmt->execute([
            'returned_at' => $date,
            'location'    => trim((string) ($data['location'] ?? '')) ?: null,
            'id'          => $id,
        ]);

        $after = fetchKeyRaw($db, $id);
        logKeyEvent($db, $id, 'return', $after, $before, ['notes' => $data['notes'] ?? null] + $data);
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
    }

    logActivity('update', 'property_key', $id, 'Rientro chiavi #' . $id);
    getKey($db, $id);
}

/**
 * La scheda sparisce, il registro no: l'evento viene scritto PRIMA della
 * DELETE, così la FK ON DELETE SET NULL lo lascia orfano ma leggibile grazie
 * alle etichette snapshot.
 */
function deleteKey(PDO $db, int $id): void
{
    $db->beginTransaction();
    try {
        $before = fetchKeyRaw($db, $id);
        if (!$before) {
            $db->rollBack();
            apiError('Registro chiavi non trovato.', 404);
        }
        logKeyEvent($db, $id, 'deleted', $before, $before, []);
        $db->prepare('DELETE FROM property_keys WHERE id = :id')->execute(['id' => $id]);
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
    }

    logActivity('delete', 'property_key', $id, 'Eliminate chiavi #' . $id);
    apiSuccess(['id' => $id]);
}

// ---------------------------------------------------------------------------
// Registro eventi
// ---------------------------------------------------------------------------

/** Riga + etichette risolte, usata per gli snapshot del registro. */
function fetchKeyRaw(PDO $db, int $id): ?array
{
    $stmt = $db->prepare(
        "SELECT k.*, CONCAT_WS(', ', p.address, p.city) AS property_label,
                " . KEY_HOLDER_LABEL_SQL . " AS holder_display
           FROM property_keys k
           LEFT JOIN properties p ON p.id = k.property_id"
         . KEY_HOLDER_JOINS . "
          WHERE k.id = :id"
    );
    $stmt->execute(['id' => $id]);
    return $stmt->fetch() ?: null;
}

/**
 * Che cosa è successo davvero fra due stati. Un 'update' generico direbbe al
 * lettore della timeline molto meno di "consegnate a", "rientrate", "smarrite".
 */
function classifyKeyChange(array $before, array $after): string
{
    $holderChanged = keyHolderFingerprint($before) !== keyHolderFingerprint($after);

    if ($after['status'] === 'lost' && $before['status'] !== 'lost') return 'lost';
    if ($after['status'] === 'out'  && ($before['status'] !== 'out' || $holderChanged)) return 'handover';
    if ($before['status'] === 'out' && $after['status'] === 'in_office') return 'return';
    if ($before['status'] !== $after['status']) return 'status_change';
    return $holderChanged ? 'handover' : 'update';
}

function keyHolderFingerprint(array $row): string
{
    $parts = [$row['holder_type'] ?? '', $row['holder_name'] ?? ''];
    foreach (KEY_HOLDER_ALL_COLUMNS as $column) {
        $parts[] = (string) ($row[$column] ?? '');
    }
    return implode('|', $parts);
}

function logKeyEvent(PDO $db, int $keyId, string $eventType, array $after, ?array $before, array $data): void
{
    // Un 'update' che non tocca né custodia né stato (una nota, l'ubicazione)
    // non è un evento di custodia: sporcherebbe la timeline senza dire nulla.
    if ($eventType === 'update') return;

    // La data di riferimento è quella dichiarata dall'utente (consegna/rientro),
    // non l'istante in cui ha salvato il form: le chiavi vengono spesso
    // registrate il giorno dopo.
    $eventDate = match ($eventType) {
        'return'  => $after['returned_at'] ?? null,
        'handover' => $after['handed_at'] ?? null,
        default   => $after['handed_at'] ?? $after['returned_at'] ?? null,
    };

    $stmt = $db->prepare(
        "INSERT INTO property_key_events
            (key_id, property_id, property_label, event_type, status_before, status_after,
             holder_type, holder_label, prev_holder_label,
             holder_admin_id, holder_supplier_id, holder_tenant_id, holder_client_id, holder_lead_id,
             event_date, due_back_at, appointment_id, reminder_id, notes, admin_user_id, admin_username)
         VALUES
            (:key_id, :property_id, :property_label, :event_type, :status_before, :status_after,
             :holder_type, :holder_label, :prev_holder_label,
             :holder_admin_id, :holder_supplier_id, :holder_tenant_id, :holder_client_id, :holder_lead_id,
             :event_date, :due_back_at, :appointment_id, :reminder_id, :notes, :admin_user_id, :admin_username)"
    );
    $stmt->execute([
        'key_id'             => $keyId,
        'property_id'        => $after['property_id'] ?? null,
        'property_label'     => $after['property_label'] ?? null,
        'event_type'         => $eventType,
        'status_before'      => $before['status'] ?? null,
        'status_after'       => $after['status'] ?? null,
        'holder_type'        => $after['holder_type'] ?? null,
        'holder_label'       => $after['holder_display'] ?? null,
        'prev_holder_label'  => $before['holder_display'] ?? null,
        'holder_admin_id'    => $after['holder_id'] ?? null,
        'holder_supplier_id' => $after['holder_supplier_id'] ?? null,
        'holder_tenant_id'   => $after['holder_tenant_id'] ?? null,
        'holder_client_id'   => $after['holder_client_id'] ?? null,
        'holder_lead_id'     => $after['holder_lead_id'] ?? null,
        'event_date'         => $eventDate,
        'due_back_at'        => $after['due_back_at'] ?? null,
        'appointment_id'     => !empty($data['appointment_id']) ? (int) $data['appointment_id'] : null,
        'reminder_id'        => !empty($data['reminder_id']) ? (int) $data['reminder_id'] : null,
        'notes'              => mb_substr(trim((string) ($data['event_notes'] ?? $data['notes'] ?? '')), 0, 500) ?: null,
        'admin_user_id'      => isset($_SESSION['admin_id']) ? (int) $_SESSION['admin_id'] : null,
        'admin_username'     => $_SESSION['admin_username'] ?? null,
    ]);
}

// ---------------------------------------------------------------------------
// Validazione
// ---------------------------------------------------------------------------

function validateKeyInput(PDO $db, array $data): array
{
    $propertyId = (int) ($data['property_id'] ?? 0);
    if ($propertyId <= 0) apiError('Immobile obbligatorio.');

    $status = $data['status'] ?? 'in_office';
    if (!in_array($status, KEY_STATUSES, true)) apiError('Stato non valido.');

    $keyType = $data['key_type'] ?? 'altro';
    if (!in_array($keyType, KEY_TYPES, true)) apiError('Tipo chiave non valido.');

    $quantity = (int) ($data['quantity'] ?? 1);
    if ($quantity < 1) $quantity = 1;

    $handedAt  = normalizeKeyDate($data['handed_at'] ?? null, 'Data di consegna');
    $returnedAt = normalizeKeyDate($data['returned_at'] ?? null, 'Data di rientro');
    $dueBackAt = normalizeKeyDate($data['due_back_at'] ?? null, 'Rientro previsto');

    if ($handedAt && $returnedAt && $returnedAt < $handedAt) {
        apiError('La data di rientro non può precedere la consegna.');
    }
    if ($handedAt && $dueBackAt && $dueBackAt < $handedAt) {
        apiError('Il rientro previsto non può precedere la consegna.');
    }

    $holder = resolveKeyHolder($db, $data, $status);

    // Chiavi "in ufficio" senza detentore per definizione: lasciare il detentore
    // valorizzato produrrebbe la scheda contraddittoria "In ufficio — Mario".
    if ($status === 'in_office') {
        $holder = ['holder_type' => null, 'holder_name' => null]
                + array_fill_keys(KEY_HOLDER_ALL_COLUMNS, null);
        $dueBackAt = null;
    }

    return [
        'property_id'  => $propertyId,
        'key_type'     => $keyType,
        'quantity'     => $quantity,
        'key_code'     => trim($data['key_code'] ?? '') ?: null,
        'location'     => trim($data['location'] ?? '') ?: null,
        'notes'        => trim($data['notes'] ?? '') ?: null,
        'handed_at'    => $handedAt,
        'due_back_at'  => $dueBackAt,
        'returned_at'  => $returnedAt,
        // Un nuovo ciclo di consegna riapre la sorveglianza sul ritardo.
        'overdue_notified_at' => null,
        'status'       => $status,
    ] + $holder;
}

/**
 * Traduce (holder_type, holder_ref_id) nelle cinque colonne FK, verificando che
 * il soggetto esista davvero: senza il controllo un id sbagliato farebbe
 * fallire la FK con un 500 "Errore database" invece che con un messaggio.
 */
function resolveKeyHolder(PDO $db, array $data, string $status): array
{
    $columns = array_fill_keys(KEY_HOLDER_ALL_COLUMNS, null);
    $type    = $data['holder_type'] ?? null;
    $refId   = isset($data['holder_ref_id']) ? (int) $data['holder_ref_id'] : 0;
    $name    = trim($data['holder_name'] ?? '');

    // Retro-compatibilità: chiamate che passano ancora solo holder_id (agente).
    if (!$type && !empty($data['holder_id'])) {
        $type  = 'agente';
        $refId = (int) $data['holder_id'];
    }
    if (!$type && $name !== '') {
        $type = 'altro';
    }

    if ($type === null || $type === '') {
        if ($status === 'out') apiError('Una chiave consegnata deve avere un detentore.');
        return ['holder_type' => null, 'holder_name' => null] + $columns;
    }
    if (!in_array($type, KEY_HOLDER_TYPES, true)) apiError('Tipo detentore non valido.');

    if ($type === 'altro') {
        if ($name === '') apiError('Indicare il nome del detentore.');
        return ['holder_type' => 'altro', 'holder_name' => mb_substr($name, 0, 100)] + $columns;
    }

    if ($refId <= 0) apiError('Selezionare il detentore.');

    $table = match ($type) {
        'agente'       => 'admin_users',
        'fornitore'    => 'suppliers',
        'inquilino'    => 'tenants',
        'proprietario' => 'clients',
        'lead'         => 'leads',
    };
    $exists = $db->prepare("SELECT 1 FROM `$table` WHERE id = :id");
    $exists->execute(['id' => $refId]);
    if (!$exists->fetchColumn()) apiError('Detentore non trovato.');

    $columns[KEY_HOLDER_COLUMNS[$type]] = $refId;

    // holder_name resta NULL: per i detentori tipizzati l'etichetta si legge
    // dalla tabella collegata, così un rename si propaga da solo.
    return ['holder_type' => $type, 'holder_name' => null] + $columns;
}

/**
 * Una stringa vuota inviata a una colonna DATE fa fallire MySQL in strict mode
 * con un 500 generico; qui diventa NULL, e una data malformata un 400 parlante.
 */
function normalizeKeyDate(mixed $value, string $label): ?string
{
    if ($value === null || $value === '' || $value === false) return null;

    $value = trim((string) $value);
    $date  = DateTime::createFromFormat('!Y-m-d', $value);
    if (!$date || $date->format('Y-m-d') !== $value) {
        apiError("$label non valida (formato atteso AAAA-MM-GG).");
    }
    return $value;
}
