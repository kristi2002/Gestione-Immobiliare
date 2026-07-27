<?php
/**
 * Reminder processing engine — Phase 6.
 * Finds due reminders, sends notifications, reschedules recurring ones.
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/mail.php';
require_once __DIR__ . '/mail_html.php';

const REMINDER_FREQUENCIES = ['once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];

/** Quanto avanti nel tempo viene materializzata una serie senza data di fine. */
const REMINDER_SERIES_HORIZON_MONTHS = 12;

/** Tetto duro: una serie settimanale su 12 mesi sta in ~52 righe, mai 5.000. */
const REMINDER_SERIES_MAX_OCCURRENCES = 200;

/** Sotto questa soglia la serie viene ri-estesa dal cron (vedi topUpReminderSeries). */
const REMINDER_SERIES_TOPUP_MONTHS = 3;

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
                p.address AS property_address, p.city AS property_city,
                au.username AS agent_username, au.email AS agent_email
         FROM reminders r
         LEFT JOIN clients c ON c.id = r.client_id
         LEFT JOIN leads l ON l.id = r.lead_id
         LEFT JOIN tenants t ON t.id = r.tenant_id
         LEFT JOIN properties p ON p.id = r.property_id
         LEFT JOIN admin_users au ON au.id = r.assigned_agent_id
         WHERE r.status = 'pending' AND r.reminder_date <= NOW()
         ORDER BY r.reminder_date ASC"
    );
    $stmt->execute();
    $due = $stmt->fetchAll();

    $results = [];

    foreach ($due as $reminder) {
        $results[] = processSingleReminder($db, $reminder);
    }

    // Le serie materializzate si esauriscono all'orizzonte: senza questo
    // rabbocco un promemoria "mensile" morirebbe silenziosamente dopo un anno.
    $extended = topUpReminderSeries($db);

    return [
        'processed' => count($results),
        'extended'  => $extended,
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
        // La notifica interna deve raggiungere chi esegue il compito. Con un
        // agente incaricato l'indirizzo generico dell'agenzia è rumore: scrive
        // a tutti e non responsabilizza nessuno.
        $agentEmail = trim($reminder['agent_email'] ?? '');
        $result  = $agentEmail !== ''
            ? sendClientEmail($agentEmail, $subject, $body, wrapHtmlEmail($subject, $body))
            : sendAdminEmail($subject, $body, wrapHtmlEmail($subject, $body));
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

    // Una serie già materializzata (phase65) vive nelle proprie occorrenze: la
    // riga madre è soltanto la prima. Riprogrammarla in avanti produrrebbe un
    // doppione della seconda occorrenza, che esiste già come riga a sé.
    if ($frequency !== 'once' && reminderHasOccurrences($db, $id)) {
        $frequency = 'once';
    }

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

    if (!empty($reminder['agent_username'])) {
        $lines[] = 'Assegnato a: ' . $reminder['agent_username'];
    }

    // Il contatto non è più per forza un proprietario: può essere un lead
    // (richiamo a un acquirente) o un inquilino.
    if (!empty($reminder['client_id'])) {
        $lines[] = 'Proprietario: ' . $reminder['client_surname'] . ' ' . $reminder['client_name'];
    } elseif (!empty($reminder['lead_id'])) {
        $lines[] = 'Lead: ' . ($reminder['lead_surname'] ?? '') . ' ' . ($reminder['lead_name'] ?? '');
    } elseif (!empty($reminder['tenant_id'])) {
        $lines[] = 'Inquilino: ' . ($reminder['tenant_surname'] ?? '') . ' ' . ($reminder['tenant_first_name'] ?? '');
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

// ---------------------------------------------------------------------------
// Serie ricorrenti — istanziazione (phase65)
// ---------------------------------------------------------------------------
//
// Un promemoria ricorrente non è più una regola che si sposta in avanti: le sue
// occorrenze vengono scritte come righe vere (series_id -> riga madre). Così
// l'agente può completare o annullare "martedì prossimo" senza toccare il
// resto della serie, e il calendario mostra tutte le date, non solo la prima.
//
// La riga madre È la prima occorrenza: conserva la frequenza (serve ai filtri e
// alla rigenerazione), le figlie sono 'once' e vengono chiuse dal motore.

/** Ha già occorrenze materializzate? Se sì il motore non la riprogramma. */
function reminderHasOccurrences(PDO $db, int $parentId): bool
{
    $stmt = $db->prepare("SELECT 1 FROM reminders WHERE series_id = :id LIMIT 1");
    $stmt->execute(['id' => $parentId]);
    return (bool) $stmt->fetchColumn();
}

/**
 * (Ri)genera le occorrenze future di una serie.
 *
 * Idempotente: cancella prima le occorrenze ancora `pending` e le riscrive, così
 * salvare due volte lo stesso promemoria non raddoppia la serie. Le occorrenze
 * già completate o annullate non vengono toccate — sono storia.
 *
 * Materializza soltanto date future: le occorrenze passate non sono mai
 * esistite, e inventarle farebbe partire al primo giro di cron una raffica di
 * email retroattive.
 *
 * @return int numero di occorrenze scritte
 */
function syncReminderSeries(PDO $db, int $parentId): int
{
    $stmt = $db->prepare("SELECT * FROM reminders WHERE id = :id");
    $stmt->execute(['id' => $parentId]);
    $parent = $stmt->fetch();

    if (!$parent || $parent['series_id'] !== null) {
        return 0; // inesistente, oppure è essa stessa un'occorrenza
    }

    $db->prepare("DELETE FROM reminders WHERE series_id = :id AND status = 'pending'")
       ->execute(['id' => $parentId]);

    // 'cancelled' sulla riga madre significa "serie in pausa" (è il verbo che
    // usa la pagina Automazioni): niente occorrenze future finché non riparte.
    // 'completed' invece vuol dire solo che la PRIMA occorrenza è passata — la
    // serie è viva, e cancellarla qui svuoterebbe l'agenda a ogni modifica.
    if ($parent['frequency'] === 'once' || $parent['status'] === 'cancelled') {
        return 0;
    }

    return generateReminderOccurrences($db, $parent, $parent['reminder_date']);
}

/**
 * Scrive le occorrenze di `$parent` a partire dalla data `$fromDate` esclusa,
 * fino alla data di fine della serie o all'orizzonte di 12 mesi.
 */
function generateReminderOccurrences(PDO $db, array $parent, string $fromDate): int
{
    $frequency = $parent['frequency'];
    if (!in_array($frequency, REMINDER_FREQUENCIES, true) || $frequency === 'once') {
        return 0;
    }

    $now     = new DateTime();
    $horizon = (new DateTime())->modify('+' . REMINDER_SERIES_HORIZON_MONTHS . ' months');

    if (!empty($parent['end_date'])) {
        $end = new DateTime($parent['end_date'] . ' 23:59:59');
        if ($end < $horizon) {
            $horizon = $end;
        }
    }

    $insert = $db->prepare(
        "INSERT INTO reminders
            (title, description, reminder_date, frequency, status,
             client_id, lead_id, tenant_id, property_id, assigned_agent_id,
             notify_admin, notify_client, email_subject, email_body, series_id)
         VALUES
            (:title, :description, :reminder_date, 'once', 'pending',
             :client_id, :lead_id, :tenant_id, :property_id, :assigned_agent_id,
             :notify_admin, :notify_client, :email_subject, :email_body, :series_id)"
    );

    $cursor  = $fromDate;
    $written = 0;
    $steps   = 0;
    // Il contatore delle scritture non basta come freno: se la riga madre è
    // vecchia il ciclo deve prima attraversare le date passate, che non
    // producono righe. Cap separato sui passi, largo ma finito.
    $maxSteps = REMINDER_SERIES_MAX_OCCURRENCES * 10;

    while ($written < REMINDER_SERIES_MAX_OCCURRENCES && $steps < $maxSteps) {
        $steps++;
        $cursor = calculateNextReminderDate($cursor, $frequency);
        $at     = new DateTime($cursor);

        if ($at > $horizon) {
            break;
        }
        if ($at <= $now) {
            continue; // il passato non si materializza
        }

        $insert->execute([
            'title'             => $parent['title'],
            'description'       => $parent['description'],
            'reminder_date'     => $cursor,
            'client_id'         => $parent['client_id'],
            'lead_id'           => $parent['lead_id'],
            'tenant_id'         => $parent['tenant_id'],
            'property_id'       => $parent['property_id'],
            'assigned_agent_id' => $parent['assigned_agent_id'],
            'notify_admin'      => $parent['notify_admin'],
            'notify_client'     => $parent['notify_client'],
            'email_subject'     => $parent['email_subject'],
            'email_body'        => $parent['email_body'],
            'series_id'         => $parent['id'],
        ]);
        $written++;
    }

    return $written;
}

/**
 * Riempie di nuovo le serie che si stanno esaurendo.
 *
 * È il prezzo dell'istanziazione: le occorrenze sono finite, quindi qualcuno
 * deve estenderle. Gira insieme al processing dei promemoria scaduti, quindi
 * ogni passaggio del cron mantiene almeno 3 mesi di margine su ogni serie
 * ancora viva.
 *
 * @return int numero di occorrenze aggiunte
 */
function topUpReminderSeries(PDO $db): int
{
    $threshold = (new DateTime())->modify('+' . REMINDER_SERIES_TOPUP_MONTHS . ' months')->format('Y-m-d H:i:s');

    // Serie vive = riga madre ricorrente non annullata, con almeno
    // un'occorrenza già generata (le altre le gestisce ancora il vecchio
    // riscadenzamento) e nessuna occorrenza oltre la soglia.
    $stmt = $db->prepare(
        "SELECT p.*, MAX(o.reminder_date) AS last_occurrence
         FROM reminders p
         JOIN reminders o ON o.series_id = p.id
         WHERE p.series_id IS NULL
           AND p.frequency <> 'once'
           AND p.status <> 'cancelled'
           AND (p.end_date IS NULL OR p.end_date > CURDATE())
         GROUP BY p.id
         HAVING last_occurrence < :threshold"
    );
    $stmt->execute(['threshold' => $threshold]);

    $added = 0;
    foreach ($stmt->fetchAll() as $parent) {
        $added += generateReminderOccurrences($db, $parent, $parent['last_occurrence']);
    }

    return $added;
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
