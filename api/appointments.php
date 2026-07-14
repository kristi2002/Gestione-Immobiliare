<?php
/**
 * Appointments (Visite) CRUD API.
 *
 * GET    /api/appointments.php          — list (property_id, agent_id, status, from, to)
 * GET    /api/appointments.php?id={id}  — single
 * POST   /api/appointments.php          — create
 * PUT    /api/appointments.php?id={id}  — update
 * DELETE /api/appointments.php?id={id}  — delete
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();

const APPOINTMENT_STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            if (($_GET['action'] ?? '') === 'stats') {
                apiSuccess([
                    'today'      => (int) $db->query("SELECT COUNT(*) FROM appointments WHERE DATE(appointment_date) = CURDATE() AND status != 'cancelled'")->fetchColumn(),
                    'week'       => (int) $db->query("SELECT COUNT(*) FROM appointments WHERE YEARWEEK(appointment_date, 1) = YEARWEEK(CURDATE(), 1) AND status != 'cancelled'")->fetchColumn(),
                    'scheduled'  => (int) $db->query("SELECT COUNT(*) FROM appointments WHERE status = 'scheduled' AND appointment_date >= NOW()")->fetchColumn(),
                    'done_month' => (int) $db->query("SELECT COUNT(*) FROM appointments WHERE status = 'completed' AND appointment_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')")->fetchColumn(),
                ]);
            }
            $id ? getAppointment($db, $id) : listAppointments($db);
            break;
        case 'POST':
            createAppointment($db);
            break;
        case 'PUT':
            if (!$id) apiError('ID appuntamento mancante.');
            updateAppointment($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID appuntamento mancante.');
            deleteAppointment($db, $id);
            break;
        default:
            apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

function listAppointments(PDO $db): void
{
    $pagination = apiGetPagination();
    $propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : null;
    $agentId    = isset($_GET['agent_id']) ? (int) $_GET['agent_id'] : null;
    $status     = trim($_GET['status'] ?? '');
    $from       = trim($_GET['from'] ?? '');
    $to         = trim($_GET['to'] ?? '');

    $where = 'WHERE 1=1';
    $params = [];

    if ($propertyId) { $where .= ' AND a.property_id = :pid'; $params['pid'] = $propertyId; }
    if ($agentId)    { $where .= ' AND a.agent_id = :aid'; $params['aid'] = $agentId; }
    if ($status !== '' && in_array($status, APPOINTMENT_STATUSES, true)) {
        $where .= ' AND a.status = :status'; $params['status'] = $status;
    }
    if ($from !== '') { $where .= ' AND a.appointment_date >= :from'; $params['from'] = $from . ' 00:00:00'; }
    if ($to !== '')   { $where .= ' AND a.appointment_date <= :to'; $params['to'] = $to . ' 23:59:59'; }

    $countSql = "SELECT COUNT(*) FROM appointments a $where";

    $dataSql = "SELECT a.*, p.address AS property_address, p.city AS property_city,
                   l.name AS lead_name, l.surname AS lead_surname,
                   c.name AS client_name, c.surname AS client_surname,
                   u.username AS agent_name
            FROM appointments a
            INNER JOIN properties p ON p.id = a.property_id
            LEFT JOIN leads l ON l.id = a.lead_id
            LEFT JOIN clients c ON c.id = a.client_id
            LEFT JOIN admin_users u ON u.id = a.agent_id
            $where
            ORDER BY a.appointment_date ASC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getAppointment(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT a.*, p.address AS property_address, p.city AS property_city,
                l.name AS lead_name, l.surname AS lead_surname,
                c.name AS client_name, c.surname AS client_surname,
                u.username AS agent_name
         FROM appointments a
         INNER JOIN properties p ON p.id = a.property_id
         LEFT JOIN leads l ON l.id = a.lead_id
         LEFT JOIN clients c ON c.id = a.client_id
         LEFT JOIN admin_users u ON u.id = a.agent_id
         WHERE a.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    if (!$row) apiError('Appuntamento non trovato.', 404);
    apiSuccess($row);
}

function createAppointment(PDO $db): void
{
    $validated = validateAppointmentInput($db, apiGetJsonBody());
    $stmt = $db->prepare(
        "INSERT INTO appointments
            (property_id, lead_id, client_id, agent_id, appointment_date,
             duration_minutes, status, notes)
         VALUES
            (:property_id, :lead_id, :client_id, :agent_id, :appointment_date,
             :duration_minutes, :status, :notes)"
    );
    $stmt->execute($validated);
    getAppointment($db, (int) $db->lastInsertId());
}

function updateAppointment(PDO $db, int $id): void
{
    if (!appointmentExists($db, $id)) apiError('Appuntamento non trovato.', 404);
    $validated = validateAppointmentInput($db, apiGetJsonBody());
    $stmt = $db->prepare(
        "UPDATE appointments SET
            property_id = :property_id, lead_id = :lead_id, client_id = :client_id,
            agent_id = :agent_id, appointment_date = :appointment_date,
            duration_minutes = :duration_minutes, status = :status, notes = :notes
         WHERE id = :id"
    );
    $stmt->execute(array_merge($validated, ['id' => $id]));
    getAppointment($db, $id);
}

function deleteAppointment(PDO $db, int $id): void
{
    if (!appointmentExists($db, $id)) apiError('Appuntamento non trovato.', 404);
    $db->prepare("DELETE FROM appointments WHERE id = :id")->execute(['id' => $id]);
    apiSuccess(['id' => $id, 'message' => 'Appuntamento eliminato.']);
}

function validateAppointmentInput(PDO $db, array $data): array
{
    $propertyId = (int) ($data['property_id'] ?? 0);
    $leadId     = !empty($data['lead_id']) ? (int) $data['lead_id'] : null;
    $clientId   = !empty($data['client_id']) ? (int) $data['client_id'] : null;
    $agentId    = !empty($data['agent_id']) ? (int) $data['agent_id'] : null;
    $date       = trim($data['appointment_date'] ?? '');
    $duration   = isset($data['duration_minutes']) && $data['duration_minutes'] !== '' ? (int) $data['duration_minutes'] : 60;
    $status     = trim($data['status'] ?? 'scheduled');
    $notes      = trim($data['notes'] ?? '') ?: null;

    if ($propertyId <= 0) apiError('Seleziona un immobile.');
    if ($date === '') apiError('La data è obbligatoria.');

    $parsed = DateTime::createFromFormat('Y-m-d\TH:i', $date)
        ?: DateTime::createFromFormat('Y-m-d H:i:s', $date);
    if (!$parsed) apiError('Formato data non valido.');

    if (!in_array($status, APPOINTMENT_STATUSES, true)) apiError('Stato non valido.');
    if ($duration <= 0) apiError('Durata non valida.');

    $check = $db->prepare("SELECT id FROM properties WHERE id = :id");
    $check->execute(['id' => $propertyId]);
    if (!$check->fetch()) apiError('Immobile non trovato.');

    return [
        'property_id'      => $propertyId,
        'lead_id'          => $leadId,
        'client_id'        => $clientId,
        'agent_id'         => $agentId,
        'appointment_date' => $parsed->format('Y-m-d H:i:s'),
        'duration_minutes' => $duration,
        'status'           => $status,
        'notes'            => $notes,
    ];
}

function appointmentExists(PDO $db, int $id): bool
{
    $stmt = $db->prepare("SELECT id FROM appointments WHERE id = :id");
    $stmt->execute(['id' => $id]);
    return (bool) $stmt->fetch();
}
