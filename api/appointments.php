<?php
/**
 * Appointments (Appuntamenti) CRUD API.
 *
 * GET    /api/appointments.php          — list (property_id, agent_id, status, type, from, to)
 * GET    /api/appointments.php?id={id}  — single
 * POST   /api/appointments.php          — create
 * PUT    /api/appointments.php?id={id}  — update
 * DELETE /api/appointments.php?id={id}  — delete
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/automation_events.php';

apiHandleOptions();

// Keep these in lockstep with the ENUMs in phase64_appointment_context.sql —
// a widened column with a stale whitelist here silently rejects the form's own
// options.
const APPOINTMENT_STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'];
const APPOINTMENT_TYPES    = ['visita', 'acquisizione', 'atto', 'chiamata'];
const APPOINTMENT_LOCATION_TYPES = ['immobile', 'agenzia', 'virtuale'];

/** How long before the appointment the client reminder fires. */
const APPOINTMENT_REMINDER_LEAD_HOURS = 24;

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
    $type       = trim($_GET['type'] ?? '');
    $from       = trim($_GET['from'] ?? '');
    $to         = trim($_GET['to'] ?? '');

    $where = 'WHERE 1=1';
    $params = [];

    if ($propertyId) { $where .= ' AND a.property_id = :pid'; $params['pid'] = $propertyId; }
    if ($agentId)    { $where .= ' AND a.agent_id = :aid'; $params['aid'] = $agentId; }
    if ($status !== '' && in_array($status, APPOINTMENT_STATUSES, true)) {
        $where .= ' AND a.status = :status'; $params['status'] = $status;
    }
    if ($type !== '' && in_array($type, APPOINTMENT_TYPES, true)) {
        $where .= ' AND a.appointment_type = :type'; $params['type'] = $type;
    }
    if ($from !== '') { $where .= ' AND a.appointment_date >= :from'; $params['from'] = $from . ' 00:00:00'; }
    if ($to !== '')   { $where .= ' AND a.appointment_date <= :to'; $params['to'] = $to . ' 23:59:59'; }

    $countSql = "SELECT COUNT(*) FROM appointments a $where";

    $dataSql = "SELECT a.*, p.address AS property_address, p.city AS property_city,
                   p.latitude AS property_latitude, p.longitude AS property_longitude,
                   l.name AS lead_name, l.surname AS lead_surname,
                   c.name AS client_name, c.surname AS client_surname,
                   po.id AS owner_id, po.name AS owner_name, po.surname AS owner_surname,
                   u.username AS agent_name
            FROM appointments a
            LEFT JOIN properties p ON p.id = a.property_id
            LEFT JOIN leads l ON l.id = a.lead_id
            LEFT JOIN clients c ON c.id = a.client_id
            LEFT JOIN clients po ON po.id = p.client_id
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
                p.property_type, p.price AS property_price, p.price_type AS property_price_type,
                p.status AS property_status,
                l.name AS lead_name, l.surname AS lead_surname,
                l.email AS lead_email, l.phone AS lead_phone,
                c.name AS client_name, c.surname AS client_surname,
                c.email AS client_email, c.phone AS client_phone,
                po.id AS owner_id, po.name AS owner_name, po.surname AS owner_surname,
                po.email AS owner_email, po.phone AS owner_phone,
                u.username AS agent_name,
                r.reminder_date AS reminder_date, r.status AS reminder_status
         FROM appointments a
         LEFT JOIN properties p ON p.id = a.property_id
         LEFT JOIN leads l ON l.id = a.lead_id
         LEFT JOIN clients c ON c.id = a.client_id
         LEFT JOIN clients po ON po.id = p.client_id
         LEFT JOIN admin_users u ON u.id = a.agent_id
         LEFT JOIN reminders r ON r.id = a.reminder_id
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
    assertAgentIsFree($db, $validated);
    $notify    = (bool) $validated['notify_client'];

    $stmt = $db->prepare(
        "INSERT INTO appointments
            (property_id, lead_id, client_id, agent_id, appointment_type, appointment_date,
             duration_minutes, location_type, location_detail, notify_client, status, notes)
         VALUES
            (:property_id, :lead_id, :client_id, :agent_id, :appointment_type, :appointment_date,
             :duration_minutes, :location_type, :location_detail, :notify_client, :status, :notes)"
    );
    $stmt->execute($validated);
    $newId = (int) $db->lastInsertId();

    syncAppointmentReminder($db, $newId, $validated, $notify);

    logActivity('create', 'appointment', $newId, 'Appuntamento creato per il ' . ($validated['appointment_date'] ?? ''));
    getAppointment($db, $newId);
}

function updateAppointment(PDO $db, int $id): void
{
    // Serve la riga intera, non la sola esistenza: l'evento "visita conclusa"
    // è una TRANSIZIONE, e risalvare un appuntamento già completato non deve
    // rimandare la richiesta di riscontro al cliente.
    $stmt = $db->prepare("SELECT * FROM appointments WHERE id = :id");
    $stmt->execute(['id' => $id]);
    $existing = $stmt->fetch();
    if (!$existing) apiError('Appuntamento non trovato.', 404);

    $validated = validateAppointmentInput($db, apiGetJsonBody());
    assertAgentIsFree($db, $validated, $id);
    $notify    = (bool) $validated['notify_client'];

    $stmt = $db->prepare(
        "UPDATE appointments SET
            property_id = :property_id, lead_id = :lead_id, client_id = :client_id,
            agent_id = :agent_id, appointment_type = :appointment_type,
            appointment_date = :appointment_date, duration_minutes = :duration_minutes,
            location_type = :location_type, location_detail = :location_detail,
            notify_client = :notify_client, status = :status, notes = :notes
         WHERE id = :id"
    );
    $stmt->execute(array_merge($validated, ['id' => $id]));

    syncAppointmentReminder($db, $id, $validated, $notify);

    if ($existing['status'] !== 'completed' && $validated['status'] === 'completed') {
        emitAutomationEvent($db, 'appointment.completed', 'appointment', $id, [
            'property_id' => $validated['property_id'] ?? null,
            'lead_id'     => $validated['lead_id'] ?? null,
            'client_id'   => $validated['client_id'] ?? null,
        ]);
    }

    logActivity('update', 'appointment', $id, 'Appuntamento aggiornato #' . $id);
    getAppointment($db, $id);
}

function deleteAppointment(PDO $db, int $id): void
{
    if (!appointmentExists($db, $id)) apiError('Appuntamento non trovato.', 404);
    // Drop the generated reminder too, otherwise the client is emailed about
    // an appointment that no longer exists.
    deleteAppointmentReminder($db, $id);
    $db->prepare("DELETE FROM appointments WHERE id = :id")->execute(['id' => $id]);
    logActivity('delete', 'appointment', $id, 'Appuntamento eliminato #' . $id);
    apiSuccess(['id' => $id, 'message' => 'Appuntamento eliminato.']);
}

/**
 * Double-booking guard: an agent cannot be in two places at once.
 *
 * Mirrors assertNoOverlappingLease() in contracts.php. Only `scheduled`
 * appointments occupy the agent — cancelled / completed / no_show ones neither
 * block nor are blocked. Appointments with no agent assigned are not checked,
 * since there is nobody to double-book.
 *
 * Overlap is half-open ([start, start+duration)), so 10:00-11:00 and 11:00-12:00
 * are adjacent, not conflicting.
 */
function assertAgentIsFree(PDO $db, array $v, ?int $excludeId = null): void
{
    if (empty($v['agent_id']) || $v['status'] !== 'scheduled' || empty($v['appointment_date'])) {
        return;
    }

    // Duration is inlined as an int (validated 1..1440 above): the connection
    // runs with EMULATE_PREPARES, which would bind it as the string '60' and
    // leave INTERVAL depending on MySQL's string→number coercion.
    $duration = (int) $v['duration_minutes'];

    $sql = "SELECT a.id, a.appointment_date, a.duration_minutes,
                   p.address AS property_address
              FROM appointments a
              LEFT JOIN properties p ON p.id = a.property_id
             WHERE a.agent_id = :agent_id
               AND a.status = 'scheduled'
               AND a.appointment_date
                     < DATE_ADD(:new_start, INTERVAL {$duration} MINUTE)
               AND DATE_ADD(a.appointment_date, INTERVAL a.duration_minutes MINUTE)
                     > :new_start2";
    $params = [
        'agent_id'   => $v['agent_id'],
        'new_start'  => $v['appointment_date'],
        'new_start2' => $v['appointment_date'],
    ];
    if ($excludeId !== null) {
        $sql .= ' AND a.id <> :exclude_id';
        $params['exclude_id'] = $excludeId;
    }

    $stmt = $db->prepare($sql . ' LIMIT 1');
    $stmt->execute($params);
    $conflict = $stmt->fetch();

    if ($conflict) {
        $when  = date('d/m/Y H:i', strtotime($conflict['appointment_date']));
        $where = $conflict['property_address'] ? " presso {$conflict['property_address']}" : '';
        apiError(
            "Doppia prenotazione: l'agente ha già un appuntamento che si sovrappone "
            . "(#{$conflict['id']}, {$when}, {$conflict['duration_minutes']} min{$where}). "
            . "Scegli un altro orario, un altro agente, oppure annulla l'altro appuntamento.",
            409
        );
    }
}

/**
 * Create / refresh / remove the reminder backing the "invia promemoria al
 * cliente" toggle.
 *
 * The reminder is only kept alive while it can still be useful: the toggle is
 * on, the appointment is still scheduled, and there is a counterpart (lead or
 * client) to write to. Anything else removes it, so a cancelled appointment
 * never emails the client.
 */
function syncAppointmentReminder(PDO $db, int $appointmentId, array $appt, bool $notify): void
{
    $hasCounterpart = !empty($appt['lead_id']) || !empty($appt['client_id']);
    $keep = $notify && $appt['status'] === 'scheduled' && $hasCounterpart;

    if (!$keep) {
        deleteAppointmentReminder($db, $appointmentId);
        return;
    }

    // Fire APPOINTMENT_REMINDER_LEAD_HOURS before the appointment; if that
    // moment has already passed (booked same-day), fire on the next cron run.
    $when = (new DateTime($appt['appointment_date']))
        ->modify('-' . APPOINTMENT_REMINDER_LEAD_HOURS . ' hours');
    $now  = new DateTime();
    if ($when < $now) $when = $now;

    $title = 'Promemoria appuntamento — ' . appointmentTypeLabel($appt['appointment_type']);
    $body  = buildAppointmentReminderBody($db, $appt);

    $lookup = $db->prepare("SELECT reminder_id FROM appointments WHERE id = :id");
    $lookup->execute(['id' => $appointmentId]);
    $existingId = (int) ($lookup->fetchColumn() ?: 0);

    if ($existingId) {
        $db->prepare(
            "UPDATE reminders SET
                title = :title, description = :description, reminder_date = :reminder_date,
                client_id = :client_id, lead_id = :lead_id, property_id = :property_id,
                email_subject = :title2, email_body = :description2,
                status = 'pending', notify_client = 1, notify_admin = 0
             WHERE id = :id"
        )->execute([
            'title'         => $title,
            'title2'        => $title,
            'description'   => $body,
            'description2'  => $body,
            'reminder_date' => $when->format('Y-m-d H:i:s'),
            'client_id'     => $appt['client_id'],
            'lead_id'       => $appt['lead_id'],
            'property_id'   => $appt['property_id'],
            'id'            => $existingId,
        ]);
        return;
    }

    $db->prepare(
        "INSERT INTO reminders
            (title, description, reminder_date, frequency, status,
             client_id, lead_id, property_id, notify_admin, notify_client,
             email_subject, email_body)
         VALUES
            (:title, :description, :reminder_date, 'once', 'pending',
             :client_id, :lead_id, :property_id, 0, 1,
             :title2, :description2)"
    )->execute([
        'title'         => $title,
        'title2'        => $title,
        'description'   => $body,
        'description2'  => $body,
        'reminder_date' => $when->format('Y-m-d H:i:s'),
        'client_id'     => $appt['client_id'],
        'lead_id'       => $appt['lead_id'],
        'property_id'   => $appt['property_id'],
    ]);

    $db->prepare("UPDATE appointments SET reminder_id = :rid WHERE id = :id")
       ->execute(['rid' => (int) $db->lastInsertId(), 'id' => $appointmentId]);
}

function deleteAppointmentReminder(PDO $db, int $appointmentId): void
{
    $stmt = $db->prepare("SELECT reminder_id FROM appointments WHERE id = :id");
    $stmt->execute(['id' => $appointmentId]);
    $reminderId = (int) ($stmt->fetchColumn() ?: 0);
    if (!$reminderId) return;

    // The FK is ON DELETE SET NULL, so appointments.reminder_id clears itself.
    $db->prepare("DELETE FROM reminders WHERE id = :id")->execute(['id' => $reminderId]);
}

function buildAppointmentReminderBody(PDO $db, array $appt): string
{
    $stmt = $db->prepare("SELECT address, city FROM properties WHERE id = :id");
    $stmt->execute(['id' => $appt['property_id']]);
    $prop = $stmt->fetch() ?: ['address' => '', 'city' => ''];

    $when = (new DateTime($appt['appointment_date']))->format('d/m/Y \a\l\l\e H:i');

    $where = match ($appt['location_type']) {
        'agenzia'   => 'presso i nostri uffici' . ($appt['location_detail'] ? ' (' . $appt['location_detail'] . ')' : ''),
        'virtuale'  => 'in videochiamata' . ($appt['location_detail'] ? ' — ' . $appt['location_detail'] : ''),
        default     => 'presso l\'immobile in ' . trim($prop['address'] . ', ' . $prop['city'], ', '),
    };

    return 'Le ricordiamo il suo appuntamento del ' . $when . ', ' . $where . '.';
}

function appointmentTypeLabel(string $type): string
{
    return [
        'visita'       => 'Visita',
        'acquisizione' => 'Acquisizione',
        'atto'         => 'Atto',
        'chiamata'     => 'Chiamata',
    ][$type] ?? 'Appuntamento';
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
    $type       = trim($data['appointment_type'] ?? 'visita');
    $locType    = trim($data['location_type'] ?? 'immobile');
    $locDetail  = trim($data['location_detail'] ?? '') ?: null;
    $notify     = !empty($data['notify_client']) ? 1 : 0;
    $notes      = trim($data['notes'] ?? '') ?: null;

    if ($propertyId <= 0) apiError('Seleziona un immobile.');
    if ($date === '') apiError('La data è obbligatoria.');

    $parsed = DateTime::createFromFormat('Y-m-d\TH:i', $date)
        ?: DateTime::createFromFormat('Y-m-d H:i:s', $date);
    if (!$parsed) apiError('Formato data non valido.');

    if (!in_array($status, APPOINTMENT_STATUSES, true)) apiError('Stato non valido.');
    if (!in_array($type, APPOINTMENT_TYPES, true)) apiError('Tipo di appuntamento non valido.');
    if (!in_array($locType, APPOINTMENT_LOCATION_TYPES, true)) apiError('Luogo non valido.');
    if ($duration <= 0) apiError('Durata non valida.');
    if ($duration > 1440) apiError('La durata non può superare le 24 ore.');

    // The detail field only means something away from the property; keep the
    // column clean so the scheda never prints a stale address.
    if ($locType === 'immobile') $locDetail = null;

    $check = $db->prepare("SELECT id FROM properties WHERE id = :id");
    $check->execute(['id' => $propertyId]);
    if (!$check->fetch()) apiError('Immobile non trovato.');

    return [
        'property_id'      => $propertyId,
        'lead_id'          => $leadId,
        'client_id'        => $clientId,
        'agent_id'         => $agentId,
        'appointment_type' => $type,
        'appointment_date' => $parsed->format('Y-m-d H:i:s'),
        'duration_minutes' => $duration,
        'location_type'    => $locType,
        'location_detail'  => $locDetail,
        'notify_client'    => $notify,
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
