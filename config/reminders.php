<?php
/**
 * Reminder processing engine — Phase 6.
 * Finds due reminders, sends notifications, reschedules recurring ones.
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/mail.php';
require_once __DIR__ . '/mail_html.php';
require_once __DIR__ . '/automation_templates.php';

const REMINDER_FREQUENCIES = ['once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];

/** Frequenze la cui data va riderivata da una regola del giorno a ogni passo. */
const REMINDER_MONTH_STEPS = ['monthly' => 1, 'quarterly' => 3, 'yearly' => 12];

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
    // Prima si drena la coda eventi: un'automazione a evento con ritardo 0 deve
    // partire nello stesso giro di cron in cui l'evento viene raccolto, non nel
    // successivo (fino a 15 minuti dopo).
    require_once __DIR__ . '/automation_events.php';
    $eventOutcome = processPendingAutomationEvents($db);

    // The recipient of a "notify client" reminder is not always a `clients`
    // row: an appointment reminder usually targets a LEAD, and maintenance
    // reminders target a TENANT. Resolve all three and let
    // reminderRecipient() pick, otherwise those reminders silently end up
    // as 'skipped_no_email'.
    //
    // trigger_type='scheduled' esclude le REGOLE a evento: hanno una
    // reminder_date solo perché la colonna è NOT NULL, non sono un invio da
    // fare. Le loro occorrenze, materializzate dal dispatcher, sono normali
    // righe 'scheduled' e passano di qui come tutte le altre.
    $stmt = $db->prepare(
        "SELECT r.*, c.name AS client_name, c.surname AS client_surname, c.email AS client_email,
                l.name AS lead_name, l.surname AS lead_surname, l.email AS lead_email,
                t.name AS tenant_first_name, t.surname AS tenant_surname, t.email AS tenant_email,
                p.address AS property_address, p.city AS property_city,
                p.price AS property_price, p.reference_code AS property_reference,
                au.username AS agent_username, au.email AS agent_email
         FROM reminders r
         LEFT JOIN clients c ON c.id = r.client_id
         LEFT JOIN leads l ON l.id = r.lead_id
         LEFT JOIN tenants t ON t.id = r.tenant_id
         LEFT JOIN properties p ON p.id = r.property_id
         LEFT JOIN admin_users au ON au.id = r.assigned_agent_id
         WHERE r.status = 'pending' AND r.reminder_date <= NOW()
           AND r.trigger_type = 'scheduled'
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
        'events'    => $eventOutcome,
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
        // I token si risolvono ORA, non al salvataggio: un'occorrenza generata
        // dieci mesi fa deve comunque riportare l'indirizzo e il prezzo di oggi.
        $ctx     = buildAutomationContext($reminder);
        $subject = renderAutomationTemplate($reminder['email_subject'] ?: $reminder['title'], $ctx);
        $body    = renderAutomationTemplate($reminder['email_body'] ?: buildDefaultClientEmailBody($reminder), $ctx);
        $result  = sendHtmlEmail($recipient['email'], $subject, $body);

        if ($result['success']) {
            $outcome = !empty($result['simulated']) ? 'simulated' : 'sent';
            logClientNotification($db, $reminder, $subject, $body, $recipient['email']);
            logReminderDispatch($db, $reminder, $outcome, $recipient, $subject, $body,
                $outcome === 'simulated' ? 'mail_enabled=false: email non spedita.' : null);
            $actions['client'] = $outcome;
        } else {
            // Prima l'esito negativo viveva solo in questa variabile e finiva
            // nello stdout del cron: in app un'automazione che non ha mai
            // consegnato nulla era indistinguibile da una che funziona.
            logReminderDispatch($db, $reminder, 'failed', $recipient, $subject, $body, $result['error'] ?? 'Invio non riuscito.');
            $actions['client'] = 'failed';
        }
    } elseif ($reminder['notify_client']) {
        logReminderDispatch(
            $db, $reminder, 'skipped', $recipient, null, null,
            'Il contatto collegato non ha un indirizzo email.'
        );
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
        $nextDate = calculateNextReminderDate(
            $reminder['reminder_date'],
            $frequency,
            effectiveReminderDayRule($reminder),
            effectiveReminderTime($reminder)
        );
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
 * @return array{email: string, name: string, type: string}
 */
function reminderRecipient(array $reminder): array
{
    $candidates = [
        ['client', $reminder['client_email'] ?? '', ($reminder['client_name'] ?? '') . ' ' . ($reminder['client_surname'] ?? '')],
        ['lead', $reminder['lead_email'] ?? '', ($reminder['lead_name'] ?? '') . ' ' . ($reminder['lead_surname'] ?? '')],
        ['tenant', $reminder['tenant_email'] ?? '', ($reminder['tenant_first_name'] ?? '') . ' ' . ($reminder['tenant_surname'] ?? '')],
    ];

    foreach ($candidates as [$type, $email, $name]) {
        if (!empty($email)) {
            return ['email' => trim($email), 'name' => trim($name), 'type' => $type];
        }
    }

    // Nessuna email: il tipo serve comunque al registro invii per distinguere
    // «contatto senza indirizzo» da «nessun contatto collegato».
    foreach ([['client', 'client_id'], ['lead', 'lead_id'], ['tenant', 'tenant_id']] as [$type, $fk]) {
        if (!empty($reminder[$fk])) {
            return ['email' => '', 'name' => '', 'type' => $type];
        }
    }

    return ['email' => '', 'name' => '', 'type' => 'none'];
}

/**
 * Registra l'esito reale di un invio.
 *
 * `communications` non basta e non può bastare: ha client_id NOT NULL, quindi
 * un'email a un lead o a un inquilino non aveva dove essere scritta, e i
 * fallimenti non ci finivano affatto. Qui viene registrato tutto — riuscito,
 * simulato, fallito, saltato — con il testo effettivamente spedito (token già
 * risolti), che è l'unica prova di cosa ha ricevuto il cliente.
 *
 * `automation_id` punta sempre alla regola, così la scheda automazione
 * interroga un solo indice invece di unire madre e occorrenze.
 */
function logReminderDispatch(
    PDO $db,
    array $reminder,
    string $status,
    array $recipient,
    ?string $subject,
    ?string $body,
    ?string $error = null
): void {
    $reminderId   = (int) $reminder['id'];
    $automationId = !empty($reminder['series_id']) ? (int) $reminder['series_id'] : $reminderId;

    try {
        $stmt = $db->prepare(
            "INSERT INTO reminder_dispatch_log
                (reminder_id, automation_id, dispatched_at, channel, recipient_type,
                 recipient_email, rendered_subject, rendered_body, status, error_details)
             VALUES
                (:reminder_id, :automation_id, NOW(), 'email', :recipient_type,
                 :recipient_email, :subject, :body, :status, :error)"
        );
        $stmt->execute([
            'reminder_id'     => $reminderId,
            'automation_id'   => $automationId,
            'recipient_type'  => $recipient['type'] ?? 'none',
            'recipient_email' => $recipient['email'] !== '' ? $recipient['email'] : null,
            'subject'         => $subject !== null ? mb_substr($subject, 0, 255) : null,
            'body'            => $body,
            'status'          => $status,
            'error'           => $error,
        ]);
    } catch (PDOException $e) {
        // Il registro è diagnostica: se la tabella non è ancora migrata il cron
        // deve continuare a spedire, non fermarsi per non poter prendere nota.
        error_log('[reminders] dispatch log non scritto: ' . $e->getMessage());
    }
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

    // Una regola a evento non ha una cadenza da materializzare, e le occorrenze
    // che possiede sono già scattate su fatti realmente accaduti: la DELETE qui
    // sotto le cancellerebbe solo perché l'agente ha ritoccato il testo.
    if (($parent['trigger_type'] ?? 'scheduled') === 'event') {
        return 0;
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

    $dayRule = effectiveReminderDayRule($parent);
    $time    = effectiveReminderTime($parent);

    $cursor  = $fromDate;
    $written = 0;
    $steps   = 0;
    // Il contatore delle scritture non basta come freno: se la riga madre è
    // vecchia il ciclo deve prima attraversare le date passate, che non
    // producono righe. Cap separato sui passi, largo ma finito.
    $maxSteps = REMINDER_SERIES_MAX_OCCURRENCES * 10;

    while ($written < REMINDER_SERIES_MAX_OCCURRENCES && $steps < $maxSteps) {
        $steps++;
        $cursor = calculateNextReminderDate($cursor, $frequency, $dayRule, $time);
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

// ---------------------------------------------------------------------------
// Calendario: quando cade la prossima occorrenza
// ---------------------------------------------------------------------------

/**
 * Prossima data della serie.
 *
 * Il vecchio `+1 month` di PHP derivava: da 31 gennaio dà 3 MARZO (febbraio ha
 * 28 giorni e l'eccedenza trabocca), poi 3 aprile, poi 3 maggio. Una mensile
 * avviata il 29-31 saltava un mese e cambiava giorno per sempre. Qui il salto
 * mensile è troncato all'ultimo giorno valido, e se c'è una regola del giorno
 * la data viene riderivata dalla regola: 31 gen → 28 feb → 31 mar, senza deriva.
 *
 * @param string|null $dayRule regola del giorno (dom:/nth:), ignorata sulle
 *                             cadenze a giorni fissi — snappare una quindicinale
 *                             al 15 del mese ne annullerebbe la cadenza.
 * @param string|null $time    'HH:MM[:SS]', l'ora di invio.
 */
function calculateNextReminderDate(
    string $currentDate,
    string $frequency,
    ?string $dayRule = null,
    ?string $time = null
): string {
    $dt = new DateTime($currentDate);

    if (isset(REMINDER_MONTH_STEPS[$frequency])) {
        $dt = addMonthsClamped($dt, REMINDER_MONTH_STEPS[$frequency]);
        if ($dayRule) {
            applyReminderDayRule($dt, $dayRule);
        }
    } elseif ($frequency === 'weekly') {
        $dt->modify('+1 week');
    } elseif ($frequency === 'biweekly') {
        $dt->modify('+15 days');
    }

    applyReminderTime($dt, $time);

    return $dt->format('Y-m-d H:i:s');
}

/**
 * Somma mesi mantenendo il giorno, troncato all'ultimo giorno del mese di
 * arrivo. Il calcolo passa dal primo del mese apposta: sommare i mesi partendo
 * dal 31 è precisamente ciò che fa traboccare PHP.
 */
function addMonthsClamped(DateTime $dt, int $months): DateTime
{
    $day  = (int) $dt->format('j');
    $hour = (int) $dt->format('G');
    $min  = (int) $dt->format('i');
    $sec  = (int) $dt->format('s');

    $target = (clone $dt)->modify('first day of this month')->modify("+{$months} months");
    $target->setDate(
        (int) $target->format('Y'),
        (int) $target->format('n'),
        min($day, (int) $target->format('t'))
    );
    $target->setTime($hour, $min, $sec);

    return $target;
}

/**
 * Applica una regola del giorno alla data, restando nello stesso mese/settimana.
 *
 *   dom:<1-31>      giorno fisso del mese (troncato a fine mese)
 *   dom:last        ultimo giorno del mese
 *   nth:<1-4>:<1-7> es. nth:1:1 = primo lunedì (1=lunedì, 7=domenica)
 *   nth:last:<1-7>  ultimo <giorno> del mese
 *   dow:<1-7>       giorno della settimana (settimanali)
 */
function applyReminderDayRule(DateTime $dt, string $rule): void
{
    $parts = explode(':', strtolower(trim($rule)));
    $kind  = $parts[0] ?? '';

    $year  = (int) $dt->format('Y');
    $month = (int) $dt->format('n');
    $last  = (int) $dt->format('t');

    if ($kind === 'dom' && isset($parts[1])) {
        $day = $parts[1] === 'last' ? $last : max(1, min((int) $parts[1], $last));
        $dt->setDate($year, $month, $day);
        return;
    }

    if ($kind === 'nth' && isset($parts[1], $parts[2])) {
        $weekday = max(1, min(7, (int) $parts[2]));

        if ($parts[1] === 'last') {
            $day = $last;
            while ((int) (new DateTime("{$year}-{$month}-{$day}"))->format('N') !== $weekday) {
                $day--;
            }
            $dt->setDate($year, $month, $day);
            return;
        }

        $nth       = max(1, min(4, (int) $parts[1]));
        $firstDow  = (int) (new DateTime("{$year}-{$month}-1"))->format('N');
        $day       = 1 + (($weekday - $firstDow + 7) % 7) + ($nth - 1) * 7;
        // Un "quarto martedì" può non esistere in un mese corto: si scala
        // all'ultimo che esiste invece di sconfinare nel mese dopo.
        while ($day > $last) {
            $day -= 7;
        }
        $dt->setDate($year, $month, $day);
        return;
    }

    if ($kind === 'dow' && isset($parts[1])) {
        $weekday = max(1, min(7, (int) $parts[1]));
        $delta   = $weekday - (int) $dt->format('N');
        if ($delta !== 0) {
            $dt->modify(sprintf('%+d days', $delta));
        }
    }
}

function applyReminderTime(DateTime $dt, ?string $time): void
{
    if ($time === null || $time === '') {
        return;
    }
    $parts = explode(':', $time);
    $dt->setTime((int) ($parts[0] ?? 0), (int) ($parts[1] ?? 0), 0);
}

/**
 * Regola del giorno effettiva di una serie.
 *
 * Senza regola esplicita ne viene dedotta una dalla data di partenza, così
 * anche il comportamento predefinito si auto-corregge: un mensile del 31
 * scende a 28 in febbraio e RISALE a 31 in marzo, invece di restare a 28 per
 * sempre come farebbe qualsiasi calcolo incrementale.
 */
function effectiveReminderDayRule(array $reminder): ?string
{
    if (!isset(REMINDER_MONTH_STEPS[$reminder['frequency'] ?? ''])) {
        return null; // settimanali/quindicinali: il passo conserva già il giorno
    }
    if (!empty($reminder['day_rule'])) {
        return $reminder['day_rule'];
    }
    return 'dom:' . (int) (new DateTime($reminder['reminder_date']))->format('j');
}

/** Ora di invio effettiva: colonna dedicata, o l'ora già presente nella data. */
function effectiveReminderTime(array $reminder): ?string
{
    return !empty($reminder['schedule_time']) ? substr((string) $reminder['schedule_time'], 0, 5) : null;
}

/**
 * Normalizza la data di partenza scelta nel form perché rispetti già regola del
 * giorno e ora di invio.
 *
 * Farlo una volta all'ancora invece che a ogni passo tiene il generatore
 * banale: da lì in poi ogni occorrenza eredita giorno e ora corretti. Se la
 * data scelta è già passata rispetto alla regola nel suo periodo (es. "il 1 del
 * mese" scelto il 26), si parte dal periodo successivo — mai all'indietro.
 */
function normalizeReminderAnchor(string $date, string $frequency, ?string $dayRule, ?string $time): string
{
    $dt = new DateTime($date);
    applyReminderTime($dt, $time);

    if ($frequency === 'once' || !$dayRule) {
        return $dt->format('Y-m-d H:i:s');
    }

    $candidate = clone $dt;
    applyReminderDayRule($candidate, $dayRule);
    applyReminderTime($candidate, $time);

    if ($candidate < $dt) {
        return calculateNextReminderDate($dt->format('Y-m-d H:i:s'), $frequency, $dayRule, $time);
    }

    return $candidate->format('Y-m-d H:i:s');
}
