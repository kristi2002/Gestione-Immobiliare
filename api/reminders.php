<?php
/**
 * Reminders (Promemoria) CRUD API.
 *
 * GET    /api/reminders.php              — list (search, status, frequency, due_soon)
 * GET    /api/reminders.php?id={id}      — single reminder
 * GET    /api/reminders.php?action=contacts — rubrica unificata per il picker
 * GET    /api/reminders.php?action=agents   — agenti a cui assegnare
 * POST   /api/reminders.php              — create
 * PUT    /api/reminders.php?id={id}      — update
 * PATCH  /api/reminders.php?id={id}      — quick status update (?action=complete|cancel)
 * DELETE /api/reminders.php?id={id}      — cancel reminder
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/reminders.php';

apiHandleOptions();

const REMINDER_STATUSES = ['pending', 'completed', 'cancelled'];

/** Il contatto di un promemoria può essere un proprietario, un lead o un inquilino. */
const REMINDER_CONTACT_TYPES = ['client' => 'client_id', 'lead' => 'lead_id', 'tenant' => 'tenant_id'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;
    $action = trim($_GET['action'] ?? '');

    switch ($method) {
        case 'GET':
            if ($action === 'contacts') {
                listContacts($db);
            } elseif ($action === 'agents') {
                listAgents($db);
            } elseif ($id) {
                getReminder($db, $id);
            } else {
                listReminders($db);
            }
            break;
        case 'POST':
            createReminder($db);
            break;
        case 'PUT':
            if (!$id) apiError('ID promemoria mancante.');
            updateReminder($db, $id);
            break;
        case 'PATCH':
            if (!$id) apiError('ID promemoria mancante.');
            patchReminder($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID promemoria mancante.');
            cancelReminder($db, $id);
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

function listReminders(PDO $db): void
{
    $pagination = apiGetPagination();
    $search   = trim($_GET['search'] ?? '');
    $status   = trim($_GET['status'] ?? '');
    $frequency = trim($_GET['frequency'] ?? '');
    $dueSoon  = isset($_GET['due_soon']) ? (int) $_GET['due_soon'] : null;
    $from     = trim($_GET['from'] ?? '');
    $to       = trim($_GET['to'] ?? '');
    $filterClientId  = isset($_GET['client_id'])   ? (int) $_GET['client_id']   : null;
    $filterPropertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : null;
    $filterTenantId  = isset($_GET['tenant_id'])   ? (int) $_GET['tenant_id']   : null;
    $filterLeadId    = isset($_GET['lead_id'])     ? (int) $_GET['lead_id']     : null;
    $filterAgentId   = isset($_GET['assigned_agent_id']) ? (int) $_GET['assigned_agent_id'] : null;
    $notifyClient    = isset($_GET['notify_client']) ? (int) $_GET['notify_client'] : null;
    $maintenanceOnly = !empty($_GET['type']) && $_GET['type'] === 'maintenance';
    $filterPriority  = trim($_GET['priority'] ?? '');
    $filterMStatus   = trim($_GET['maintenance_status'] ?? '');
    // series=parents → solo le righe "madre": una serie ricorrente conta come
    // una voce sola. Serve alla pagina Automazioni, che mostra la regola e non
    // le sue 52 occorrenze.
    $seriesScope     = trim($_GET['series'] ?? '');

    $where = 'WHERE 1=1';
    $params = [];

    if ($search !== '') {
        $where .= " AND (r.title LIKE :search OR r.description LIKE :search
                      OR c.name LIKE :search OR c.surname LIKE :search
                      OR ld.name LIKE :search OR ld.surname LIKE :search
                      OR tn.name LIKE :search OR tn.surname LIKE :search
                      OR p.address LIKE :search)";
        $params['search'] = '%' . $search . '%';
    }

    if ($status !== '' && in_array($status, REMINDER_STATUSES, true)) {
        $where .= ' AND r.status = :status';
        $params['status'] = $status;
    }

    if ($frequency !== '' && in_array($frequency, REMINDER_FREQUENCIES, true)) {
        $where .= ' AND r.frequency = :frequency';
        $params['frequency'] = $frequency;
    }

    if ($dueSoon !== null && $dueSoon > 0) {
        $where .= " AND r.status = 'pending'
                  AND r.reminder_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL :days DAY)";
        $params['days'] = $dueSoon;
    }

    if ($from !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) {
        $where .= ' AND r.reminder_date >= :from';
        $params['from'] = $from . ' 00:00:00';
    }

    if ($to !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) {
        $where .= ' AND r.reminder_date <= :to';
        $params['to'] = $to . ' 23:59:59';
    }

    if ($filterClientId) {
        $where .= ' AND r.client_id = :filter_client_id';
        $params['filter_client_id'] = $filterClientId;
    }
    if ($filterPropertyId) {
        $where .= ' AND r.property_id = :filter_property_id';
        $params['filter_property_id'] = $filterPropertyId;
    }
    if ($filterTenantId) {
        $where .= ' AND r.tenant_id = :filter_tenant_id';
        $params['filter_tenant_id'] = $filterTenantId;
    }
    if ($filterLeadId) {
        $where .= ' AND r.lead_id = :filter_lead_id';
        $params['filter_lead_id'] = $filterLeadId;
    }
    if ($filterAgentId) {
        $where .= ' AND r.assigned_agent_id = :filter_agent_id';
        $params['filter_agent_id'] = $filterAgentId;
    }
    if ($seriesScope === 'parents') {
        $where .= ' AND r.series_id IS NULL';
    }
    if ($notifyClient !== null) {
        $where .= ' AND r.notify_client = :notify_client';
        $params['notify_client'] = $notifyClient;
    }
    // Maintenance board: show only genuine maintenance work-orders, not every
    // reminder. New tenant requests are tagged request_type='maintenance';
    // older untagged rows are matched by their "[Richiesta maintenance]" title.
    if ($maintenanceOnly) {
        $where .= " AND (r.request_type = 'maintenance'
                      OR (r.request_type IS NULL AND r.title LIKE :maint_marker))";
        $params['maint_marker'] = '[Richiesta maintenance]%';
    }
    if ($filterPriority !== '') {
        $where .= ' AND r.priority = :priority';
        $params['priority'] = $filterPriority;
    }
    if ($filterMStatus !== '') {
        $where .= ' AND r.maintenance_status = :m_status';
        $params['m_status'] = $filterMStatus;
    }

    $joins = "LEFT JOIN clients c ON c.id = r.client_id
              LEFT JOIN properties p ON p.id = r.property_id
              LEFT JOIN tenants tn ON tn.id = r.tenant_id
              LEFT JOIN leads ld ON ld.id = r.lead_id
              LEFT JOIN admin_users au ON au.id = r.assigned_agent_id";

    $countSql = "SELECT COUNT(*) FROM reminders r $joins $where";

    $dataSql = "SELECT r.*, c.name AS client_name, c.surname AS client_surname,
                   ld.name AS lead_name, ld.surname AS lead_surname,
                   tn.name AS tenant_contact_name, tn.surname AS tenant_contact_surname,
                   au.username AS agent_username,
                   p.address AS property_address, p.city AS property_city,
                   (SELECT COUNT(*) FROM reminders o WHERE o.series_id = r.id) AS occurrence_count,
                   CASE WHEN tn.id IS NOT NULL THEN CONCAT(tn.name, ' ', tn.surname) ELSE r.tenant_name END AS tenant_name
            FROM reminders r
            $joins
            $where
            ORDER BY r.reminder_date ASC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getReminder(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT r.*, c.name AS client_name, c.surname AS client_surname,
                ld.name AS lead_name, ld.surname AS lead_surname,
                tn.name AS tenant_contact_name, tn.surname AS tenant_contact_surname,
                au.username AS agent_username,
                p.address AS property_address, p.city AS property_city, p.client_id AS property_client_id,
                (SELECT COUNT(*) FROM reminders o WHERE o.series_id = r.id) AS occurrence_count
         FROM reminders r
         LEFT JOIN clients c ON c.id = r.client_id
         LEFT JOIN leads ld ON ld.id = r.lead_id
         LEFT JOIN tenants tn ON tn.id = r.tenant_id
         LEFT JOIN admin_users au ON au.id = r.assigned_agent_id
         LEFT JOIN properties p ON p.id = r.property_id
         WHERE r.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();

    if (!$row) {
        apiError('Promemoria non trovato.', 404);
    }

    apiSuccess($row);
}

/**
 * Rubrica unificata per il campo "Contatto".
 *
 * L'agente non ragiona per tabelle: vuole "chi devo richiamare". Proprietari,
 * lead e inquilini arrivano quindi in un solo elenco già etichettato, invece di
 * costringere il form a tre select separate (e l'agente a indovinare in quale
 * delle tre sta la persona).
 */
function listContacts(PDO $db): void
{
    $sql = "SELECT id, 'client' AS contact_type, name, surname, email, phone
            FROM clients WHERE status = 'active'
            UNION ALL
            SELECT id, 'lead' AS contact_type, name, surname, email, phone
            FROM leads WHERE status <> 'lost'
            UNION ALL
            SELECT id, 'tenant' AS contact_type, name, surname, email, phone
            FROM tenants WHERE status = 'active'
            ORDER BY surname, name
            LIMIT 2000";

    apiSuccess($db->query($sql)->fetchAll());
}

/** Agenti assegnabili — stessa whitelist di ruoli usata da api/leads.php. */
function listAgents(PDO $db): void
{
    $rows = $db->query(
        "SELECT id, username, email FROM admin_users
         WHERE is_active = 1 AND role IN ('agent', 'admin', 'super_admin')
         ORDER BY username"
    )->fetchAll();

    apiSuccess($rows);
}

function createReminder(PDO $db): void
{
    $data      = apiGetJsonBody();
    $validated = validateReminderInput($db, $data);

    $stmt = $db->prepare(
        "INSERT INTO reminders
            (title, description, reminder_date, end_date, frequency, status,
             client_id, lead_id, property_id, tenant_id, assigned_agent_id,
             notify_admin, notify_client, email_subject, email_body)
         VALUES
            (:title, :description, :reminder_date, :end_date, :frequency, :status,
             :client_id, :lead_id, :property_id, :tenant_id, :assigned_agent_id,
             :notify_admin, :notify_client, :email_subject, :email_body)"
    );
    $stmt->execute($validated);

    $newId = (int) $db->lastInsertId();
    syncReminderSeries($db, $newId);
    logActivity('create', 'reminder', $newId, 'Promemoria creato: ' . ($validated['title'] ?? ('#' . $newId)));
    getReminder($db, $newId);
}

function updateReminder(PDO $db, int $id): void
{
    if (!reminderExists($db, $id)) {
        apiError('Promemoria non trovato.', 404);
    }

    $data      = apiGetJsonBody();
    $validated = validateReminderInput($db, $data);

    $stmt = $db->prepare(
        "UPDATE reminders
         SET title = :title, description = :description, reminder_date = :reminder_date,
             end_date = :end_date, frequency = :frequency, status = :status,
             client_id = :client_id, lead_id = :lead_id, property_id = :property_id,
             tenant_id = :tenant_id, assigned_agent_id = :assigned_agent_id,
             notify_admin = :notify_admin, notify_client = :notify_client,
             email_subject = :email_subject, email_body = :email_body
         WHERE id = :id"
    );
    $stmt->execute(array_merge($validated, ['id' => $id]));

    // Rigenera le occorrenze future: la data, la frequenza o il testo possono
    // essere cambiati. È idempotente, quindi risalvare non duplica la serie.
    syncReminderSeries($db, $id);

    logActivity('update', 'reminder', $id, 'Promemoria aggiornato #' . $id);
    getReminder($db, $id);
}

function patchReminder(PDO $db, int $id): void
{
    if (!reminderExists($db, $id)) {
        apiError('Promemoria non trovato.', 404);
    }

    $action = trim($_GET['action'] ?? '');
    $map    = ['complete' => 'completed', 'cancel' => 'cancelled', 'reopen' => 'pending'];

    // Supplier assignment (maintenance workflow)
    if ($action === 'assign_supplier') {
        $data        = apiGetJsonBody();
        $supplierId  = !empty($data['supplier_id'])   ? (int) $data['supplier_id']        : null;
        $supplierName = trim($data['supplier_name'] ?? '') ?: null;
        $stmt = $db->prepare("UPDATE reminders SET supplier_id = :sid, supplier_name = :sname WHERE id = :id");
        $stmt->execute(['sid' => $supplierId, 'sname' => $supplierName, 'id' => $id]);
        getReminder($db, $id);
        return;
    }

    // Maintenance status (aperta / in_lavorazione / completata / chiusa)
    if ($action === 'maintenance_status') {
        $data      = apiGetJsonBody();
        $newStatus = trim($data['status'] ?? '');
        $allowed   = ['aperta', 'in_lavorazione', 'completata', 'chiusa'];
        if (!in_array($newStatus, $allowed, true)) {
            apiError('Stato manutenzione non valido.');
        }
        $stmt = $db->prepare("UPDATE reminders SET maintenance_status = :ms WHERE id = :id");
        $stmt->execute(['ms' => $newStatus, 'id' => $id]);
        getReminder($db, $id);
        return;
    }

    if (!isset($map[$action])) {
        apiError('Azione non valida. Usa: complete, cancel, reopen, assign_supplier, maintenance_status.');
    }

    $stmt = $db->prepare("UPDATE reminders SET status = :status WHERE id = :id");
    $stmt->execute(['id' => $id, 'status' => $map[$action]]);

    applySeriesStatusSideEffects($db, $id, $action);
    getReminder($db, $id);
}

/**
 * Propaga alla serie i cambi di stato che la riguardano davvero.
 *
 * "Completa" resta locale: chiudere l'appuntamento di martedì non deve
 * cancellare quelli dei martedì successivi — è esattamente il motivo per cui le
 * occorrenze sono righe separate. "Annulla" e "Riapri" invece agiscono sulla
 * regola: sono i verbi con cui la pagina Automazioni mette in pausa e riattiva.
 */
function applySeriesStatusSideEffects(PDO $db, int $id, string $action): void
{
    if ($action !== 'cancel' && $action !== 'reopen') {
        return;
    }

    $stmt = $db->prepare("SELECT id, series_id, frequency FROM reminders WHERE id = :id");
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();

    if (!$row || $row['series_id'] !== null || $row['frequency'] === 'once') {
        return; // occorrenza singola: nessuna serie da toccare
    }

    if ($action === 'cancel') {
        $db->prepare("DELETE FROM reminders WHERE series_id = :id AND status = 'pending'")
           ->execute(['id' => $id]);
        return;
    }

    syncReminderSeries($db, $id);
}

function cancelReminder(PDO $db, int $id): void
{
    if (!reminderExists($db, $id)) {
        apiError('Promemoria non trovato.', 404);
    }

    $stmt = $db->prepare("UPDATE reminders SET status = 'cancelled' WHERE id = :id");
    $stmt->execute(['id' => $id]);

    applySeriesStatusSideEffects($db, $id, 'cancel');
    logActivity('delete', 'reminder', $id, 'Promemoria annullato #' . $id);
    apiSuccess(['id' => $id, 'message' => 'Promemoria annullato.']);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateReminderInput(PDO $db, array $data): array
{
    $title        = trim($data['title'] ?? '');
    $description  = trim($data['description'] ?? '') ?: null;
    $reminderDate = trim($data['reminder_date'] ?? '');
    $frequency    = trim($data['frequency'] ?? 'once');
    $status       = trim($data['status'] ?? 'pending');
    $clientId     = !empty($data['client_id']) ? (int) $data['client_id'] : null;
    $leadId       = !empty($data['lead_id']) ? (int) $data['lead_id'] : null;
    $propertyId   = !empty($data['property_id']) ? (int) $data['property_id'] : null;
    $tenantId     = !empty($data['tenant_id']) ? (int) $data['tenant_id'] : null;
    $agentId      = !empty($data['assigned_agent_id']) ? (int) $data['assigned_agent_id'] : null;
    $notifyAdmin  = !empty($data['notify_admin']) ? 1 : 0;
    $notifyClient = !empty($data['notify_client']) ? 1 : 0;
    $emailSubject = trim($data['email_subject'] ?? '') ?: null;
    $emailBody    = trim($data['email_body'] ?? '') ?: null;
    $endDateRaw   = trim($data['end_date'] ?? '');
    $endDate      = ($endDateRaw !== '' && preg_match('/^\d{4}-\d{2}-\d{2}/', $endDateRaw))
                    ? substr($endDateRaw, 0, 10) : null;

    if ($title === '') {
        apiError('Il titolo è obbligatorio.');
    }
    if ($reminderDate === '') {
        apiError('La data del promemoria è obbligatoria.');
    }

    $parsed = DateTime::createFromFormat('Y-m-d\TH:i', $reminderDate)
        ?: DateTime::createFromFormat('Y-m-d H:i:s', $reminderDate)
        ?: DateTime::createFromFormat('Y-m-d', $reminderDate);

    if (!$parsed) {
        apiError('Formato data non valido.');
    }

    if (!in_array($frequency, REMINDER_FREQUENCIES, true)) {
        apiError('Frequenza non valida.');
    }
    if (!in_array($status, REMINDER_STATUSES, true)) {
        apiError('Stato non valido.');
    }

    // Il form invia un solo campo "Contatto" (tipo + id) invece di tre select.
    // Le chiamate storiche — scheda immobile, scheda inquilino, manutenzioni —
    // continuano a passare le FK esplicite, che restano valide.
    if (!empty($data['contact_type']) || !empty($data['contact_id'])) {
        $contactType = trim((string) ($data['contact_type'] ?? ''));
        $contactId   = (int) ($data['contact_id'] ?? 0);

        // Campo svuotato dall'agente: il contatto va rimosso, non conservato.
        $clientId = $leadId = $tenantId = null;

        if ($contactId > 0) {
            if (!isset(REMINDER_CONTACT_TYPES[$contactType])) {
                apiError('Tipo di contatto non valido.');
            }
            match ($contactType) {
                'client' => $clientId = $contactId,
                'lead'   => $leadId   = $contactId,
                'tenant' => $tenantId = $contactId,
            };
        }
    }

    // Auto-risoluzione: se il promemoria riguarda un immobile e nessuno ha
    // indicato un contatto, il proprietario è deducibile. Farlo digitare
    // all'agente è lavoro inutile e una fonte di incoerenze fra le due colonne.
    if ($propertyId && !$clientId && !$leadId && !$tenantId) {
        $owner = $db->prepare("SELECT client_id FROM properties WHERE id = :id");
        $owner->execute(['id' => $propertyId]);
        $ownerId = (int) ($owner->fetchColumn() ?: 0);
        if ($ownerId > 0) {
            $clientId = $ownerId;
        }
    }

    return [
        'title'             => $title,
        'description'       => $description,
        'reminder_date'     => $parsed->format('Y-m-d H:i:s'),
        'end_date'          => $endDate,
        'frequency'         => $frequency,
        'status'            => $status,
        'client_id'         => $clientId,
        'lead_id'           => $leadId,
        'property_id'       => $propertyId,
        'tenant_id'         => $tenantId,
        'assigned_agent_id' => $agentId,
        'notify_admin'      => $notifyAdmin,
        'notify_client'     => $notifyClient,
        'email_subject'     => $emailSubject,
        'email_body'        => $emailBody,
    ];
}

function reminderExists(PDO $db, int $id): bool
{
    $stmt = $db->prepare("SELECT id FROM reminders WHERE id = :id");
    $stmt->execute(['id' => $id]);
    return (bool) $stmt->fetch();
}
