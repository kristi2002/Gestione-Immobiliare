<?php
/**
 * Reminder processing engine — Phase 6.
 * Finds due reminders, sends notifications, reschedules recurring ones.
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/mail.php';
require_once __DIR__ . '/mail_html.php';

const REMINDER_FREQUENCIES = ['once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];

/**
 * Process all due pending reminders.
 *
 * @return array{processed: int, results: array}
 */
function processDueReminders(PDO $db): array
{
    // The recipient of a "notify client" reminder is not always a `clients`
    // row: an appointment reminder usually targets a LEAD, and maintenance
    // reminders target a TENANT. Resolve all three and let
    // reminderRecipient() pick, otherwise those reminders silently end up
    // as 'skipped_no_email'.
    $stmt = $db->prepare(
        "SELECT r.*, c.name AS client_name, c.surname AS client_surname, c.email AS client_email,
                l.name AS lead_name, l.surname AS lead_surname, l.email AS lead_email,
                t.name AS tenant_first_name, t.surname AS tenant_surname, t.email AS tenant_email,
                p.address AS property_address, p.city AS property_city
         FROM reminders r
         LEFT JOIN clients c ON c.id = r.client_id
         LEFT JOIN leads l ON l.id = r.lead_id
         LEFT JOIN tenants t ON t.id = r.tenant_id
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
        $result  = sendAdminEmail($subject, $body, wrapHtmlEmail($subject, $body));
        $actions['admin'] = $result['success'] ? 'sent' : 'failed';
    }

    $recipient = reminderRecipient($reminder);

    if ($reminder['notify_client'] && $recipient['email'] !== '') {
        $subject = $reminder['email_subject'] ?: $reminder['title'];
        $body    = $reminder['email_body'] ?: buildDefaultClientEmailBody($reminder);
        $result  = sendHtmlEmail($recipient['email'], $subject, $body);

        if ($result['success']) {
            logClientNotification($db, $reminder, $subject, $body, $recipient['email']);
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
        // Stop automation if end_date is set and next occurrence would be past it
        if (!empty($reminder['end_date']) && $nextDate > $reminder['end_date']) {
            $update = $db->prepare(
                "UPDATE reminders SET status = 'completed', last_notified_at = NOW() WHERE id = :id"
            );
            $update->execute(['id' => $id]);
            $actions['status'] = 'completed';
        } else {
            $update = $db->prepare(
                "UPDATE reminders SET reminder_date = :next_date, last_notified_at = NOW() WHERE id = :id"
            );
            $update->execute(['id' => $id, 'next_date' => $nextDate]);
            $actions['status']    = 'rescheduled';
            $actions['next_date'] = $nextDate;
        }
    }

    return [
        'id'      => $id,
        'title'   => $reminder['title'],
        'actions' => $actions,
    ];
}

/**
 * Resolve who a "notify client" reminder is actually addressed to.
 *
 * A reminder can hang off a client, a lead or a tenant. Only one of the three
 * is set in practice; when more than one is, the client wins because that is
 * the historical behaviour this function replaced.
 *
 * @return array{email: string, name: string}
 */
function reminderRecipient(array $reminder): array
{
    $candidates = [
        [$reminder['client_email'] ?? '', ($reminder['client_name'] ?? '') . ' ' . ($reminder['client_surname'] ?? '')],
        [$reminder['lead_email'] ?? '', ($reminder['lead_name'] ?? '') . ' ' . ($reminder['lead_surname'] ?? '')],
        [$reminder['tenant_email'] ?? '', ($reminder['tenant_first_name'] ?? '') . ' ' . ($reminder['tenant_surname'] ?? '')],
    ];

    foreach ($candidates as [$email, $name]) {
        if (!empty($email)) {
            return ['email' => trim($email), 'name' => trim($name)];
        }
    }

    return ['email' => '', 'name' => ''];
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
    $name = reminderRecipient($reminder)['name'];

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

function logClientNotification(PDO $db, array $reminder, string $subject, string $body, ?string $toEmail = null): void
{
    // communications.client_id is NOT NULL, so a lead/tenant-addressed
    // reminder has nowhere to log — skip rather than blow up the cron run.
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
        'to_email'   => $toEmail ?: $reminder['client_email'],
    ]);
}

function calculateNextReminderDate(string $currentDate, string $frequency): string
{
    $dt = new DateTime($currentDate);

    switch ($frequency) {
        case 'weekly':
            $dt->modify('+1 week');
            break;
        case 'biweekly':
            $dt->modify('+15 days');
            break;
        case 'monthly':
            $dt->modify('+1 month');
            break;
        case 'quarterly':
            $dt->modify('+3 months');
            break;
        case 'yearly':
            $dt->modify('+1 year');
            break;
    }

    return $dt->format('Y-m-d H:i:s');
}
