<?php
/**
 * Reminders (Promemoria) CRUD API.
 *
 * GET    /api/reminders.php              — list (search, status, frequency, due_soon)
 * GET    /api/reminders.php?id={id}      — single reminder
 * POST   /api/reminders.php              — create
 * PUT    /api/reminders.php?id={id}      — update
 * PATCH  /api/reminders.php?id={id}      — quick status update (?action=complete|cancel)
 * DELETE /api/reminders.php?id={id}      — cancel reminder
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/reminders.php';

apiHandleOptions();

const REMINDER_STATUSES = ['pending', 'completed', 'cancelled'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            $id ? getReminder($db, $id) : listReminders($db);
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
    $filterClientId = isset($_GET['client_id']) ? (int) $_GET['client_id'] : null;

    $where = 'WHERE 1=1';
    $params = [];

    if ($search !== '') {
        $where .= " AND (r.title LIKE :search OR r.description LIKE :search
                      OR c.name LIKE :search OR c.surname LIKE :search
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

    $countSql = "SELECT COUNT(*) FROM reminders r
            LEFT JOIN clients c ON c.id = r.client_id
            LEFT JOIN properties p ON p.id = r.property_id
            $where";

    $dataSql = "SELECT r.*, c.name AS client_name, c.surname AS client_surname,
                   p.address AS property_address, p.city AS property_city
            FROM reminders r
            LEFT JOIN clients c ON c.id = r.client_id
            LEFT JOIN properties p ON p.id = r.property_id
            $where
            ORDER BY r.reminder_date ASC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getReminder(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT r.*, c.name AS client_name, c.surname AS client_surname,
                p.address AS property_address, p.city AS property_city
         FROM reminders r
         LEFT JOIN clients c ON c.id = r.client_id
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

function createReminder(PDO $db): void
{
    $data      = apiGetJsonBody();
    $validated = validateReminderInput($data);

    $stmt = $db->prepare(
        "INSERT INTO reminders
            (title, description, reminder_date, end_date, frequency, status,
             client_id, property_id, notify_admin, notify_client,
             email_subject, email_body)
         VALUES
            (:title, :description, :reminder_date, :end_date, :frequency, :status,
             :client_id, :property_id, :notify_admin, :notify_client,
             :email_subject, :email_body)"
    );
    $stmt->execute($validated);

    getReminder($db, (int) $db->lastInsertId());
}

function updateReminder(PDO $db, int $id): void
{
    if (!reminderExists($db, $id)) {
        apiError('Promemoria non trovato.', 404);
    }

    $data      = apiGetJsonBody();
    $validated = validateReminderInput($data);

    $stmt = $db->prepare(
        "UPDATE reminders
         SET title = :title, description = :description, reminder_date = :reminder_date,
             end_date = :end_date, frequency = :frequency, status = :status,
             client_id = :client_id, property_id = :property_id,
             notify_admin = :notify_admin, notify_client = :notify_client,
             email_subject = :email_subject, email_body = :email_body
         WHERE id = :id"
    );
    $stmt->execute(array_merge($validated, ['id' => $id]));

    getReminder($db, $id);
}

function patchReminder(PDO $db, int $id): void
{
    if (!reminderExists($db, $id)) {
        apiError('Promemoria non trovato.', 404);
    }

    $action = trim($_GET['action'] ?? '');
    $map    = ['complete' => 'completed', 'cancel' => 'cancelled', 'reopen' => 'pending'];

    if (!isset($map[$action])) {
        apiError('Azione non valida. Usa: complete, cancel, reopen.');
    }

    $stmt = $db->prepare("UPDATE reminders SET status = :status WHERE id = :id");
    $stmt->execute(['id' => $id, 'status' => $map[$action]]);

    getReminder($db, $id);
}

function cancelReminder(PDO $db, int $id): void
{
    if (!reminderExists($db, $id)) {
        apiError('Promemoria non trovato.', 404);
    }

    $stmt = $db->prepare("UPDATE reminders SET status = 'cancelled' WHERE id = :id");
    $stmt->execute(['id' => $id]);

    apiSuccess(['id' => $id, 'message' => 'Promemoria annullato.']);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateReminderInput(array $data): array
{
    $title        = trim($data['title'] ?? '');
    $description  = trim($data['description'] ?? '') ?: null;
    $reminderDate = trim($data['reminder_date'] ?? '');
    $frequency    = trim($data['frequency'] ?? 'once');
    $status       = trim($data['status'] ?? 'pending');
    $clientId     = !empty($data['client_id']) ? (int) $data['client_id'] : null;
    $propertyId   = !empty($data['property_id']) ? (int) $data['property_id'] : null;
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

    return [
        'title'         => $title,
        'description'   => $description,
        'reminder_date' => $parsed->format('Y-m-d H:i:s'),
        'end_date'      => $endDate,
        'frequency'     => $frequency,
        'status'        => $status,
        'client_id'     => $clientId,
        'property_id'   => $propertyId,
        'notify_admin'  => $notifyAdmin,
        'notify_client' => $notifyClient,
        'email_subject' => $emailSubject,
        'email_body'    => $emailBody,
    ];
}

function reminderExists(PDO $db, int $id): bool
{
    $stmt = $db->prepare("SELECT id FROM reminders WHERE id = :id");
    $stmt->execute(['id' => $id]);
    return (bool) $stmt->fetch();
}
