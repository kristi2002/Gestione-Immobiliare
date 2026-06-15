<?php
/**
 * Reminder processing engine — Phase 6.
 * Finds due reminders, sends notifications, reschedules recurring ones.
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/mail.php';

const REMINDER_FREQUENCIES = ['once', 'weekly', 'monthly', 'yearly'];

/**
 * Process all due pending reminders.
 *
 * @return array{processed: int, results: array}
 */
function processDueReminders(PDO $db): array
{
    $stmt = $db->prepare(
        "SELECT r.*, c.name AS client_name, c.surname AS client_surname, c.email AS client_email,
                p.address AS property_address, p.city AS property_city
         FROM reminders r
         LEFT JOIN clients c ON c.id = r.client_id
         LEFT JOIN properties p ON p.id = r.property_id
         WHERE r.status = 'pending' AND r.reminder_date <= NOW()
         ORDER BY r.reminder_date ASC"
    );
    $stmt->execute();
    $due = $stmt->fetchAll();

    $results = [];

    foreach ($due as $reminder) {
        $results[] = processSingleReminder($db, $reminder);
    }

    return [
        'processed' => count($results),
        'results'   => $results,
    ];
}

function processSingleReminder(PDO $db, array $reminder): array
{
    $id      = (int) $reminder['id'];
    $actions = [];

    if ($reminder['notify_admin']) {
        $subject = '[Promemoria] ' . $reminder['title'];
        $body    = buildAdminNotificationBody($reminder);
        $result  = sendAdminEmail($subject, $body);
        $actions['admin'] = $result['success'] ? 'sent' : 'failed';
    }

    if ($reminder['notify_client'] && !empty($reminder['client_email'])) {
        $subject = $reminder['email_subject'] ?: $reminder['title'];
        $body    = $reminder['email_body'] ?: buildDefaultClientEmailBody($reminder);
        $result  = sendClientEmail($reminder['client_email'], $subject, $body);

        if ($result['success']) {
            logClientNotification($db, $reminder, $subject, $body);
            $actions['client'] = 'sent';
        } else {
            $actions['client'] = 'failed';
        }
    } elseif ($reminder['notify_client']) {
        $actions['client'] = 'skipped_no_email';
    }

    $frequency = $reminder['frequency'];

    if ($frequency === 'once') {
        $update = $db->prepare(
            "UPDATE reminders SET status = 'completed', last_notified_at = NOW() WHERE id = :id"
        );
        $update->execute(['id' => $id]);
        $actions['status'] = 'completed';
    } else {
        $nextDate = calculateNextReminderDate($reminder['reminder_date'], $frequency);
        $update   = $db->prepare(
            "UPDATE reminders SET reminder_date = :next_date, last_notified_at = NOW() WHERE id = :id"
        );
        $update->execute(['id' => $id, 'next_date' => $nextDate]);
        $actions['status']      = 'rescheduled';
        $actions['next_date']   = $nextDate;
    }

    return [
        'id'      => $id,
        'title'   => $reminder['title'],
        'actions' => $actions,
    ];
}

function buildAdminNotificationBody(array $reminder): string
{
    $lines = [
        'Promemoria: ' . $reminder['title'],
        '',
    ];

    if ($reminder['description']) {
        $lines[] = $reminder['description'];
        $lines[] = '';
    }

    if ($reminder['client_id']) {
        $lines[] = 'Proprietario: ' . $reminder['client_surname'] . ' ' . $reminder['client_name'];
    }

    if ($reminder['property_id']) {
        $lines[] = 'Immobile: ' . $reminder['property_address'] . ', ' . $reminder['property_city'];
    }

    $lines[] = '';
    $lines[] = 'Frequenza: ' . $reminder['frequency'];
    $lines[] = 'Data scadenza: ' . $reminder['reminder_date'];

    return implode("\n", $lines);
}

function buildDefaultClientEmailBody(array $reminder): string
{
    $name = trim(($reminder['client_name'] ?? '') . ' ' . ($reminder['client_surname'] ?? ''));

    $lines = [
        'Gentile ' . ($name ?: 'Cliente') . ',',
        '',
    ];

    if ($reminder['description']) {
        $lines[] = $reminder['description'];
    } else {
        $lines[] = 'Le ricordiamo: ' . $reminder['title'];
    }

    $lines[] = '';
    $lines[] = 'Cordiali saluti,';
    $lines[] = getSetting('agency_name', 'Gestionale Immobiliare');

    return implode("\n", $lines);
}

function logClientNotification(PDO $db, array $reminder, string $subject, string $body): void
{
    if (empty($reminder['client_id'])) {
        return;
    }

    $stmt = $db->prepare(
        "INSERT INTO communications
            (client_id, direction, channel, subject, body, from_email, to_email, status)
         VALUES
            (:client_id, 'sent', 'email', :subject, :body, :from_email, :to_email, 'sent')"
    );
    $stmt->execute([
        'client_id'  => $reminder['client_id'],
        'subject'    => $subject,
        'body'       => $body,
        'from_email' => getMailConfig()['agency_email'],
        'to_email'   => $reminder['client_email'],
    ]);
}

function calculateNextReminderDate(string $currentDate, string $frequency): string
{
    $dt = new DateTime($currentDate);

    switch ($frequency) {
        case 'weekly':
            $dt->modify('+1 week');
            break;
        case 'monthly':
            $dt->modify('+1 month');
            break;
        case 'yearly':
            $dt->modify('+1 year');
            break;
    }

    return $dt->format('Y-m-d H:i:s');
}
