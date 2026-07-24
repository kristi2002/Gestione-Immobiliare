<?php
/**
 * Leads (Potenziali clienti) CRUD API.
 *
 * GET    /api/leads.php                       — list (status, statuses, interest_type, assigned_to, search)
 * GET    /api/leads.php?id={id}               — single lead
 * GET    /api/leads.php?action=match&lead_id= — matching property IDs
 * POST   /api/leads.php                       — create
 * POST   /api/leads.php?action=convert&id=    — convert to client
 * POST   /api/leads.php?action=set_status&id= — status-only update (kanban)
 * PUT    /api/leads.php?id={id}               — update
 * DELETE /api/leads.php?id={id}               — archive (status = lost)
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();

const LEAD_STATUSES   = ['new', 'contacted', 'interested', 'negotiating', 'converted', 'lost'];
const LEAD_INTERESTS  = ['affitto', 'acquisto', 'entrambi'];
const LEAD_SOURCES    = ['telefono', 'email', 'web', 'passaparola', 'social', 'immobiliare', 'idealista', 'casa', 'subito', 'altro'];
const LEAD_PROP_TYPES = ['appartamento', 'villa', 'ufficio', 'negozio', 'box', 'terreno', 'altro'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $action = trim($_GET['action'] ?? '');
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            if ($action === 'match') {
                matchProperties($db, (int) ($_GET['lead_id'] ?? 0));
            } elseif ($action === 'agents') {
                $rows = $db->query("SELECT id, username FROM admin_users WHERE is_active = 1 AND role IN ('agent','admin','super_admin') ORDER BY username")->fetchAll();
                apiSuccess($rows);
            } elseif ($id) {
                getLead($db, $id);
            } else {
                listLeads($db);
            }
            break;
        case 'POST':
            $postBody = apiGetJsonBody();
            if ($action === 'convert') {
                if (!$id) apiError('ID lead mancante.');
                convertLead($db, $id);
            } elseif ($action === 'convert_tenant') {
                if (!$id) apiError('ID lead mancante.');
                convertLeadToTenant($db, $id);
            } elseif ($action === 'bulk' || ($postBody['action'] ?? '') === 'bulk') {
                bulkLeads($db);
            } elseif ($action === 'set_status') {
                if (!$id) apiError('ID lead mancante.');
                setLeadStatus($db, $id, (string) ($postBody['status'] ?? ''));
            } elseif ($action === 'import_email') {
                importLeadFromEmail($db, $postBody);
            } else {
                createLead($db);
            }
            break;
        case 'PUT':
            if (!$id) apiError('ID lead mancante.');
            updateLead($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID lead mancante.');
            archiveLead($db, $id);
            break;
        default:
            apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    if ($e->getCode() === '23000' && str_contains($e->getMessage(), 'uq_clients_cf')) {
        apiError('Esiste già un proprietario con questo codice fiscale.');
    }
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function listLeads(PDO $db): void
{
    // maxLimit 500: the kanban board loads every pipeline lead in one request.
    $pagination = apiGetPagination(25, 500);
    $search   = trim($_GET['search'] ?? '');
    $status   = trim($_GET['status'] ?? '');
    $statuses = trim($_GET['statuses'] ?? ''); // comma-separated whitelist (kanban columns)
    $interest = trim($_GET['interest_type'] ?? '');
    $assigned = isset($_GET['assigned_to']) ? (int) $_GET['assigned_to'] : null;

    $where = 'WHERE 1=1';
    $params = [];

    if ($search !== '') {
        $frag = apiWordSearch($search, ['l.name', 'l.surname', 'l.phone', 'l.email', 'l.codice_fiscale', 'l.notes'], $params);
        if ($frag) $where .= " AND $frag";
    }
    $statusList = $statuses !== ''
        ? array_values(array_intersect(array_map('trim', explode(',', $statuses)), LEAD_STATUSES))
        : [];
    if ($statusList) {
        $ph = [];
        foreach ($statusList as $i => $s) {
            $ph[] = ":st$i";
            $params["st$i"] = $s;
        }
        $where .= ' AND l.status IN (' . implode(',', $ph) . ')';
    } elseif ($status !== '' && in_array($status, LEAD_STATUSES, true)) {
        $where .= ' AND l.status = :status';
        $params['status'] = $status;
    } else if ($status === '') {
        // By default exclude converted and lost leads
        $where .= " AND l.status NOT IN ('converted', 'lost')";
    }
    if ($interest !== '' && in_array($interest, LEAD_INTERESTS, true)) {
        $where .= ' AND l.interest_type = :interest';
        $params['interest'] = $interest;
    }
    if ($assigned) {
        $where .= ' AND l.assigned_to = :assigned';
        $params['assigned'] = $assigned;
    }

    $countSql = "SELECT COUNT(*) FROM leads l $where";

    $dataSql = "SELECT l.*, u.username AS agent_name
            FROM leads l
            LEFT JOIN admin_users u ON u.id = l.assigned_to
            $where
            ORDER BY l.created_at DESC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getLead(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT l.*, u.username AS agent_name
         FROM leads l
         LEFT JOIN admin_users u ON u.id = l.assigned_to
         WHERE l.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    if (!$row) {
        apiError('Lead non trovato.', 404);
    }
    apiSuccess($row);
}

function createLead(PDO $db): void
{
    $validated = validateLeadInput(apiGetJsonBody());
    assertPropertyExists($db, $validated['preferred_property_id']);
    $stmt = $db->prepare(
        "INSERT INTO leads
            (name, surname, codice_fiscale, phone, email, interest_type, budget_min, budget_max,
             preferred_city, preferred_type, preferred_property_id, min_rooms, min_sqm, status, source,
             assigned_to, notes)
         VALUES
            (:name, :surname, :codice_fiscale, :phone, :email, :interest_type, :budget_min, :budget_max,
             :preferred_city, :preferred_type, :preferred_property_id, :min_rooms, :min_sqm, :status, :source,
             :assigned_to, :notes)"
    );
    $stmt->execute($validated);
    getLead($db, (int) $db->lastInsertId());
}

function updateLead(PDO $db, int $id): void
{
    if (!leadExists($db, $id)) {
        apiError('Lead non trovato.', 404);
    }
    $validated = validateLeadInput(apiGetJsonBody());
    assertPropertyExists($db, $validated['preferred_property_id']);
    $stmt = $db->prepare(
        "UPDATE leads SET
            name = :name, surname = :surname, codice_fiscale = :codice_fiscale,
            phone = :phone, email = :email,
            interest_type = :interest_type, budget_min = :budget_min, budget_max = :budget_max,
            preferred_city = :preferred_city, preferred_type = :preferred_type,
            preferred_property_id = :preferred_property_id,
            min_rooms = :min_rooms, min_sqm = :min_sqm, status = :status, source = :source,
            assigned_to = :assigned_to, notes = :notes
         WHERE id = :id"
    );
    $stmt->execute(array_merge($validated, ['id' => $id]));
    getLead($db, $id);
}

/** Status-only update — powers the kanban dropdown / drag&drop. */
function setLeadStatus(PDO $db, int $id, string $status): void
{
    if (!leadExists($db, $id)) {
        apiError('Lead non trovato.', 404);
    }
    if (!in_array($status, LEAD_STATUSES, true)) {
        apiError('Stato non valido.');
    }
    $stmt = $db->prepare("UPDATE leads SET status = :status WHERE id = :id");
    $stmt->execute(['status' => $status, 'id' => $id]);
    getLead($db, $id);
}

/**
 * Import a lead from a pasted portal notification email
 * (Immobiliare.it / Idealista / Casa.it / Subito — or any inquiry email).
 * POST /api/leads.php?action=import_email  { source_text }
 */
function importLeadFromEmail(PDO $db, array $body): void
{
    require_once __DIR__ . '/../lib/portal_leads.php';

    $text = trim((string) ($body['source_text'] ?? ''));
    if ($text === '') {
        apiError('Incolla il testo dell\'email ricevuta dal portale.');
    }
    if (mb_strlen($text) > 50000) {
        apiError('Testo troppo lungo (max 50.000 caratteri).');
    }

    // Optional forwarded headers in the paste ("Da:"/"From:", "Oggetto:"/"Subject:").
    $from = '';
    $subject = '';
    if (preg_match('/^[ \t]*(?:from|da)[ \t]*:[ \t]*(.+)$/mi', $text, $m)) {
        $from = trim($m[1]);
    }
    if (preg_match('/^[ \t]*(?:subject|oggetto)[ \t]*:[ \t]*(.+)$/mi', $text, $m)) {
        $subject = trim($m[1]);
    }

    $result = portalLeadImport($db, $from, $subject, $text);
    if (!$result || isset($result['error'])) {
        apiError('Impossibile estrarre un contatto (email o telefono) dal testo incollato. Crea il lead manualmente.');
    }

    logActivity(
        $result['created'] ? 'create' : 'update',
        'lead',
        $result['lead_id'],
        ($result['created'] ? 'Lead importato da ' : 'Richiesta aggiunta al lead da ') . $result['portal_label'] . ': ' . $result['lead_name']
    );
    apiSuccess($result);
}

function archiveLead(PDO $db, int $id): void
{
    if (!leadExists($db, $id)) {
        apiError('Lead non trovato.', 404);
    }
    $stmt = $db->prepare("UPDATE leads SET status = 'lost' WHERE id = :id");
    $stmt->execute(['id' => $id]);
    apiSuccess(['id' => $id, 'message' => 'Lead archiviato.']);
}

function bulkLeads(PDO $db): void
{
    $data = apiGetJsonBody();
    $operation = trim($data['action'] ?? '');
    if ($operation === 'bulk') {
        $operation = trim($data['operation'] ?? '');
    }
    $ids = normalizeLeadBulkIds($data['ids'] ?? []);

    if ($operation === 'archive') {
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $db->prepare("UPDATE leads SET status = 'lost' WHERE id IN ($placeholders)");
        $stmt->execute($ids);
        apiSuccess(['updated' => $stmt->rowCount(), 'action' => 'archive']);
    } elseif ($operation === 'assign') {
        $assignedTo = !empty($data['assigned_to']) ? (int) $data['assigned_to'] : 0;
        if ($assignedTo <= 0) {
            apiError('assigned_to obbligatorio per l\'assegnazione.');
        }
        $check = $db->prepare(
            "SELECT id FROM admin_users WHERE id = :id AND is_active = 1
             AND role IN ('agent','admin','super_admin')"
        );
        $check->execute(['id' => $assignedTo]);
        if (!$check->fetch()) {
            apiError('Agente non trovato o non attivo.');
        }
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $db->prepare("UPDATE leads SET assigned_to = ? WHERE id IN ($placeholders)");
        $stmt->execute(array_merge([$assignedTo], $ids));
        apiSuccess(['updated' => $stmt->rowCount(), 'action' => 'assign', 'assigned_to' => $assignedTo]);
    } else {
        apiError('Azione bulk non valida. Usa: archive, assign.');
    }
}

function normalizeLeadBulkIds(array $ids): array
{
    if (!is_array($ids) || empty($ids)) {
        apiError('Nessun ID selezionato.');
    }
    $ids = array_values(array_unique(array_filter(array_map('intval', $ids), fn($id) => $id > 0)));
    if (empty($ids)) {
        apiError('ID non validi.');
    }
    return $ids;
}

function convertLead(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT * FROM leads WHERE id = :id");
    $stmt->execute(['id' => $id]);
    $lead = $stmt->fetch();
    if (!$lead) {
        apiError('Lead non trovato.', 404);
    }
    if (empty($lead['codice_fiscale'])) {
        apiError('Il lead non ha un codice fiscale. Modifica il lead prima di convertirlo.');
    }

    $insert = $db->prepare(
        "INSERT INTO clients (name, surname, codice_fiscale, phone, email, internal_notes, status)
         VALUES (:name, :surname, :codice_fiscale, :phone, :email, :notes, 'active')"
    );
    $insert->execute([
        'name'           => $lead['name'],
        'surname'        => $lead['surname'],
        'codice_fiscale' => $lead['codice_fiscale'],
        'phone'          => $lead['phone'],
        'email'          => $lead['email'],
        'notes'          => 'Convertito da lead #' . $id . ($lead['notes'] ? "\n" . $lead['notes'] : ''),
    ]);
    $clientId = (int) $db->lastInsertId();

    $db->prepare("UPDATE leads SET status = 'converted' WHERE id = :id")->execute(['id' => $id]);

    apiSuccess(['lead_id' => $id, 'client_id' => $clientId, 'message' => 'Lead convertito in proprietario.']);
}

function convertLeadToTenant(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT * FROM leads WHERE id = :id");
    $stmt->execute(['id' => $id]);
    $lead = $stmt->fetch();
    if (!$lead) {
        apiError('Lead non trovato.', 404);
    }

    $data        = apiGetJsonBody();
    $propertyId  = !empty($data['property_id'])  ? (int) $data['property_id']  : 0;
    $leaseStart  = trim($data['lease_start']  ?? '') ?: null;
    $leaseEnd    = trim($data['lease_end']    ?? '') ?: null;
    $monthlyRent = isset($data['monthly_rent']) && $data['monthly_rent'] !== '' ? (float) $data['monthly_rent'] : null;
    $email       = trim($data['email'] ?? '') ?: trim($lead['email'] ?? '');

    if ($propertyId <= 0)  apiError('Seleziona un immobile.');
    if (!$leaseStart)      apiError('La data di inizio locazione è obbligatoria.');
    if ($email === '')     apiError('L\'email è obbligatoria per creare un inquilino (campo univoco).');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) apiError('Email non valida.');

    $propStmt = $db->prepare("SELECT id FROM properties WHERE id = :id AND status != 'archived'");
    $propStmt->execute(['id' => $propertyId]);
    if (!$propStmt->fetch()) {
        apiError('Immobile non trovato o archiviato.');
    }

    $dupStmt = $db->prepare("SELECT id FROM tenants WHERE email = :email AND status != 'archived'");
    $dupStmt->execute(['email' => $email]);
    if ($dupStmt->fetch()) {
        apiError('Esiste già un inquilino attivo con questa email.');
    }

    $insert = $db->prepare(
        "INSERT INTO tenants (property_id, name, surname, email, phone, lease_start, lease_end, monthly_rent, notes, status)
         VALUES (:property_id, :name, :surname, :email, :phone, :lease_start, :lease_end, :monthly_rent, :notes, 'active')"
    );
    $insert->execute([
        'property_id'  => $propertyId,
        'name'         => $lead['name'],
        'surname'      => $lead['surname'],
        'email'        => $email,
        'phone'        => $lead['phone'],
        'lease_start'  => $leaseStart,
        'lease_end'    => $leaseEnd,
        'monthly_rent' => $monthlyRent,
        'notes'        => 'Convertito da lead #' . $id . ($lead['notes'] ? "\n" . $lead['notes'] : ''),
    ]);
    $tenantId = (int) $db->lastInsertId();

    $db->prepare("UPDATE leads SET status = 'converted' WHERE id = :id")->execute(['id' => $id]);
    logActivity('create', 'tenant', $tenantId, 'Inquilino creato da lead #' . $id);

    apiSuccess(['lead_id' => $id, 'tenant_id' => $tenantId, 'message' => 'Lead convertito in inquilino.']);
}

function matchProperties(PDO $db, int $leadId): void
{
    if ($leadId <= 0) {
        apiError('lead_id mancante.');
    }
    $stmt = $db->prepare("SELECT * FROM leads WHERE id = :id");
    $stmt->execute(['id' => $leadId]);
    $lead = $stmt->fetch();
    if (!$lead) {
        apiError('Lead non trovato.', 404);
    }

    $sql = "SELECT p.id, p.address, p.city, p.price, p.price_type, p.rooms, p.sqm, p.status
            FROM properties p
            WHERE p.status NOT IN ('archived', 'sold')";
    $params = [];

    // interest_type -> price_type
    if ($lead['interest_type'] === 'affitto') {
        $sql .= " AND p.price_type = 'affitto'";
    } elseif ($lead['interest_type'] === 'acquisto') {
        $sql .= " AND p.price_type = 'vendita'";
    }

    if ($lead['budget_min'] !== null) {
        $sql .= " AND (p.price IS NULL OR p.price >= :bmin)";
        $params['bmin'] = $lead['budget_min'];
    }
    if ($lead['budget_max'] !== null) {
        $sql .= " AND (p.price IS NULL OR p.price <= :bmax)";
        $params['bmax'] = $lead['budget_max'];
    }
    if ($lead['preferred_city']) {
        $sql .= " AND p.city LIKE :city";
        $params['city'] = '%' . $lead['preferred_city'] . '%';
    }
    if (!empty($lead['preferred_type'])) {
        $sql .= " AND p.property_type = :ptype";
        $params['ptype'] = $lead['preferred_type'];
    }
    if ($lead['min_rooms'] !== null) {
        $sql .= " AND (p.rooms IS NULL OR p.rooms >= :mrooms)";
        $params['mrooms'] = $lead['min_rooms'];
    }
    if ($lead['min_sqm'] !== null) {
        $sql .= " AND (p.sqm IS NULL OR p.sqm >= :msqm)";
        $params['msqm'] = $lead['min_sqm'];
    }

    $sql .= " ORDER BY p.city ASC, p.address ASC";
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $matches = $stmt->fetchAll();

    // Persist matches for reference.
    $db->prepare("DELETE FROM lead_property_matches WHERE lead_id = :id")->execute(['id' => $leadId]);
    if ($matches) {
        $ins = $db->prepare("INSERT IGNORE INTO lead_property_matches (lead_id, property_id) VALUES (:lid, :pid)");
        foreach ($matches as $m) {
            $ins->execute(['lid' => $leadId, 'pid' => $m['id']]);
        }
    }

    apiSuccess([
        'lead_id'      => $leadId,
        'property_ids' => array_map(fn($m) => (int) $m['id'], $matches),
        'properties'   => $matches,
    ]);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateLeadInput(array $data): array
{
    $name     = trim($data['name'] ?? '');
    $surname  = trim($data['surname'] ?? '');
    $cf       = strtoupper(trim($data['codice_fiscale'] ?? '')) ?: null;
    $phone    = trim($data['phone'] ?? '') ?: null;
    $email    = trim($data['email'] ?? '') ?: null;
    $interest = trim($data['interest_type'] ?? 'affitto');
    $bmin     = isset($data['budget_min']) && $data['budget_min'] !== '' ? (float) $data['budget_min'] : null;
    $bmax     = isset($data['budget_max']) && $data['budget_max'] !== '' ? (float) $data['budget_max'] : null;
    $city     = trim($data['preferred_city'] ?? '') ?: null;
    $ptype    = trim($data['preferred_type'] ?? '') ?: null;
    $prefProp = !empty($data['preferred_property_id']) ? (int) $data['preferred_property_id'] : null;
    $minRooms = isset($data['min_rooms']) && $data['min_rooms'] !== '' ? (int) $data['min_rooms'] : null;
    $minSqm   = isset($data['min_sqm']) && $data['min_sqm'] !== '' ? (float) $data['min_sqm'] : null;
    $status   = trim($data['status'] ?? 'new');
    $source   = trim($data['source'] ?? 'altro');
    $assigned = !empty($data['assigned_to']) ? (int) $data['assigned_to'] : null;
    $notes    = trim($data['notes'] ?? '') ?: null;

    if ($name === '')    apiError('Il nome è obbligatorio.');
    if ($surname === '') apiError('Il cognome è obbligatorio.');
    if ($cf !== null && !preg_match('/^[A-Z0-9]{11,16}$/', $cf)) apiError('Codice fiscale non valido (11-16 caratteri alfanumerici).');
    if ($email !== null && !filter_var($email, FILTER_VALIDATE_EMAIL)) apiError('Email non valida.');
    if (!in_array($interest, LEAD_INTERESTS, true)) apiError('Tipo interesse non valido.');
    if (!in_array($status, LEAD_STATUSES, true)) apiError('Stato non valido.');
    if (!in_array($source, LEAD_SOURCES, true)) apiError('Fonte non valida.');
    if ($ptype !== null && !in_array($ptype, LEAD_PROP_TYPES, true)) apiError('Tipo immobile non valido.');

    return [
        'name'           => $name,
        'surname'        => $surname,
        'codice_fiscale' => $cf,
        'phone'          => $phone,
        'email'          => $email,
        'interest_type'  => $interest,
        'budget_min'     => $bmin,
        'budget_max'     => $bmax,
        'preferred_city' => $city,
        'preferred_type' => $ptype,
        'preferred_property_id' => $prefProp,
        'min_rooms'      => $minRooms,
        'min_sqm'        => $minSqm,
        'status'         => $status,
        'source'         => $source,
        'assigned_to'    => $assigned,
        'notes'          => $notes,
    ];
}

function leadExists(PDO $db, int $id): bool
{
    $stmt = $db->prepare("SELECT id FROM leads WHERE id = :id");
    $stmt->execute(['id' => $id]);
    return (bool) $stmt->fetch();
}

/** "Immobile richiesto": if set, the linked property must exist and not be archived. */
function assertPropertyExists(PDO $db, ?int $propertyId): void
{
    if ($propertyId === null) {
        return;
    }
    $stmt = $db->prepare("SELECT id FROM properties WHERE id = :id AND status != 'archived'");
    $stmt->execute(['id' => $propertyId]);
    if (!$stmt->fetch()) {
        apiError('Immobile richiesto non trovato o archiviato.');
    }
}
