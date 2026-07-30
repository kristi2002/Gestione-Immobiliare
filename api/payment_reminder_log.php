<?php
/**
 * Payment Reminder Log API — manual trigger + log of sent reminders.
 *
 * GET  /api/payment_reminder_log.php                       — paginated log
 * POST /api/payment_reminder_log.php?action=send_reminders — trigger reminder run
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/mail.php';
require_once __DIR__ . '/../config/mail_html.php';
require_once __DIR__ . '/../config/settings.php';
apiHandleOptions();

requireRole('admin', 'super_admin');

// Quanti giorni devono passare prima di risollecitare lo stesso pagamento.
// Deve restare allineato a $cooldownDays in cron/send_payment_reminders.php:
// sono due implementazioni dello stesso lavoro (vedi nota in fondo al file).
// Le costanti stanno qui in cima e non accanto a chi le usa: uno `const` non e'
// hoistato come una funzione, e lo switch che smista la richiesta gira prima.
const REMINDER_COOLDOWN_DAYS = 7;

// Oltre questo silenzio il cron va considerato fermo, non solo "tranquillo".
// Il job e' giornaliero: 26 ore e' la stessa soglia usata da api/readiness.php.
const REMINDER_CRON_STALE_AFTER = 26 * 3600;

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $action = trim($_GET['action'] ?? '');

    switch ($method) {
        case 'GET':
            if ($action === 'overview') {
                previewReminders($db);
            } else {
                listReminderLog($db);
            }
            break;
        case 'POST':
            if ($action === 'send_reminders') {
                sendReminders($db);
            } else {
                apiError('Azione non valida. Usa: ?action=send_reminders');
            }
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

function listReminderLog(PDO $db): void
{
    $pagination = apiGetPagination();
    $paymentId  = isset($_GET['payment_id']) ? (int) $_GET['payment_id'] : null;
    $tenantId   = isset($_GET['tenant_id']) ? (int) $_GET['tenant_id'] : null;

    $where  = 'WHERE 1=1';
    $params = [];

    if ($paymentId) {
        $where .= ' AND rl.payment_id = :payment_id';
        $params['payment_id'] = $paymentId;
    }
    if ($tenantId) {
        $where .= ' AND rl.tenant_id = :tenant_id';
        $params['tenant_id'] = $tenantId;
    }

    $countSql = "SELECT COUNT(*) FROM payment_reminder_log rl $where";

    $dataSql = "SELECT rl.*,
                   t.name AS tenant_name, t.surname AS tenant_surname,
                   c.name AS client_name, c.surname AS client_surname
            FROM payment_reminder_log rl
            LEFT JOIN tenants t ON t.id = rl.tenant_id
            LEFT JOIN clients c ON c.id = rl.client_id
            $where
            ORDER BY rl.sent_at DESC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

/**
 * I pagamenti in ritardo, ciascuno gia' giudicato: si sollecita o no, e perche'.
 *
 * Esiste per una ragione precisa: l'anteprima e l'invio devono guardare la
 * STESSA lista. Se il conteggio mostrato prima di premere "Invia" lo calcolasse
 * per conto suo, prometterebbe un numero e ne spedirebbe un altro — e questo e'
 * un pulsante che scrive a decine di inquilini in una volta sola.
 *
 * Il controllo del periodo di attesa era anche una query per riga: qui diventa
 * una sottoquery sola, quindi l'anteprima resta immediata anche con
 * l'archivio pieno.
 */
function collectReminderCandidates(PDO $db): array
{
    $stmt = $db->query(
        "SELECT pay.id AS payment_id, pay.amount, pay.due_date, pay.tenant_id, pay.property_id,
                t.name AS tenant_name, t.surname AS tenant_surname, t.email AS tenant_email,
                p.address AS property_address, p.city AS property_city,
                p.client_id,
                DATEDIFF(CURDATE(), pay.due_date) AS days_overdue,
                (SELECT MAX(rl.sent_at) FROM payment_reminder_log rl
                  WHERE rl.payment_id = pay.id AND rl.status = 'sent') AS last_sent_at
         FROM payments pay
         INNER JOIN tenants t ON t.id = pay.tenant_id
         INNER JOIN properties p ON p.id = pay.property_id
         WHERE pay.status IN ('pending', 'late')
           AND pay.due_date < CURDATE()
         ORDER BY days_overdue DESC"
    );

    $rows = [];
    foreach ($stmt->fetchAll() as $row) {
        $email = trim($row['tenant_email'] ?? '');

        $skip = null;
        if ($row['last_sent_at'] !== null
            && strtotime($row['last_sent_at']) >= strtotime('-' . REMINDER_COOLDOWN_DAYS . ' days')) {
            $skip = 'Gia\' sollecitato il ' . date('d/m/Y', strtotime($row['last_sent_at']));
        } elseif ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $skip = 'Nessun indirizzo email valido';
        }

        $row['tenant_full_name'] = trim($row['tenant_name'] . ' ' . $row['tenant_surname']);
        $row['property_label']   = trim($row['property_address'] . ', ' . $row['property_city'], ', ');
        $row['eligible']         = $skip === null;
        $row['skip_reason']      = $skip;
        $rows[] = $row;
    }

    return $rows;
}

/**
 * Cosa succederebbe premendo "Invia", piu' lo stato del cron che fa lo stesso
 * lavoro ogni notte.
 *
 * Il cron viene mostrato perche' il modo tipico in cui questa funzione smette
 * di funzionare non e' un errore: e' il silenzio. In produzione il crontab ha
 * gia' filtrato i container sul nome sbagliato e ogni job e' fallito per mesi
 * senza che nessuno se ne accorgesse. Un "ultima esecuzione" in pagina e'
 * l'unico posto dove quel silenzio diventa visibile.
 */
function previewReminders(PDO $db): void
{
    $candidates = collectReminderCandidates($db);

    $eligible = array_values(array_filter($candidates, static fn ($r) => $r['eligible']));
    $skipped  = array_values(array_filter($candidates, static fn ($r) => !$r['eligible']));

    $lastRun    = getSetting('cron_last_payment_reminders', '');
    $lastRunTs  = $lastRun !== '' ? strtotime($lastRun) : null;

    apiSuccess([
        'candidates' => $candidates,
        'summary'    => [
            'overdue_total'  => count($candidates),
            'would_send'     => count($eligible),
            'would_skip'     => count($skipped),
            'amount_due'     => array_sum(array_map(static fn ($r) => (float) $r['amount'], $candidates)),
            'cooldown_days'  => REMINDER_COOLDOWN_DAYS,
        ],
        'cron' => [
            'last_run'   => $lastRun !== '' ? $lastRun : null,
            // `never` e `stale` sono cose diverse: mai partito significa che il
            // job non e' stato installato, fermo che ha smesso di girare.
            'never_run'  => $lastRunTs === null,
            'stale'      => $lastRunTs !== null && (time() - $lastRunTs) > REMINDER_CRON_STALE_AFTER,
        ],
        // Se l'invio email e' spento il pulsante non spedisce niente: meglio
        // dirlo prima che dopo.
        'mail_enabled' => (bool) getMailConfig()['mail_enabled'],
    ]);
}

function sendReminders(PDO $db): void
{
    $candidates = collectReminderCandidates($db);

    $sent      = 0;
    $failed    = 0;
    $skipped   = 0;
    $simulated = 0;
    $details   = [];

    foreach ($candidates as $payment) {
        $paymentId = (int) $payment['payment_id'];
        $tenantId  = (int) $payment['tenant_id'];

        if (!$payment['eligible']) {
            $skipped++;
            $details[] = [
                'payment_id' => $paymentId,
                'result'     => 'skipped',
                'reason'     => $payment['skip_reason'],
            ];
            continue;
        }

        $tenantEmail = trim($payment['tenant_email']);
        $daysOverdue = (int) $payment['days_overdue'];
        $tenantName  = $payment['tenant_full_name'];
        $amount      = number_format((float) $payment['amount'], 2, ',', '.');
        $dueDate     = $payment['due_date'];
        $property    = $payment['property_label'];

        $subject = "Sollecito pagamento — Scadenza {$dueDate}";
        $body    = "Gentile {$tenantName},\n\n"
            . "Le ricordiamo che il pagamento di € {$amount} relativo all'immobile\n"
            . "{$property} era in scadenza il {$dueDate} ({$daysOverdue} giorni fa) e risulta ancora non pagato.\n\n"
            . "La preghiamo di procedere al pagamento quanto prima.\n\n"
            . "Per qualsiasi informazione, non esiti a contattarci.\n\n"
            . "Cordiali saluti,\nGestione Immobiliare";

        $result = sendHtmlEmail($tenantEmail, $subject, $body);

        // Con l'invio spento sendHtmlEmail() risponde success=true per un
        // messaggio che non e' partito. Registrarlo come 'sent' riempiva il
        // registro di solleciti mai ricevuti — ed e' questo registro che
        // l'agenzia guarda prima di procedere contro un inquilino moroso.
        $wasSimulated = !empty($result['simulated']);
        $status   = $wasSimulated ? 'simulated' : ($result['success'] ? 'sent' : 'failed');
        $errorMsg = $result['error'] ?? null;

        // Log the attempt
        $logStmt = $db->prepare(
            "INSERT INTO payment_reminder_log
                (payment_id, tenant_id, client_id, channel, days_overdue, sent_at, status, error_msg)
             VALUES
                (:payment_id, :tenant_id, :client_id, 'email', :days_overdue, NOW(), :status, :error_msg)"
        );
        $logStmt->execute([
            'payment_id'  => $paymentId,
            'tenant_id'   => $tenantId,
            'client_id'   => $payment['client_id'] ?? null,
            'days_overdue' => $daysOverdue,
            'status'      => $status,
            'error_msg'   => $errorMsg ? mb_substr($errorMsg, 0, 255) : null,
        ]);

        if ($wasSimulated) {
            // Nessuna email e' uscita, quindi il pagamento non viene marcato
            // 'late': quel passaggio di stato significa "l'inquilino e' stato
            // avvisato", e qui non lo e' stato.
            $simulated++;
        } elseif ($result['success']) {
            // Update payment status to 'late' if it was just 'pending'
            $db->prepare(
                "UPDATE payments SET status = 'late' WHERE id = :id AND status = 'pending'"
            )->execute(['id' => $paymentId]);

            $sent++;
        } else {
            $failed++;
        }

        $details[] = [
            'payment_id'  => $paymentId,
            'tenant_name' => $tenantName,
            'amount'      => $payment['amount'],
            'days_overdue' => $daysOverdue,
            'result'      => $status,
            'error'       => $errorMsg,
        ];
    }

    logActivity('create', 'reminder_run', null,
        "Solleciti inviati: {$sent}, falliti: {$failed}, saltati: {$skipped}, simulati: {$simulated}");

    apiSuccess([
        'sent'      => $sent,
        'failed'    => $failed,
        'skipped'   => $skipped,
        'simulated' => $simulated,
        'details'   => $details,
        'message'   => $simulated > 0
            ? "Invio email disattivato: {$simulated} solleciti NON sono stati spediti."
            : "Solleciti inviati: {$sent}. Falliti: {$failed}. Saltati: {$skipped}.",
    ]);
}

/*
 * Nota per chi mette mano qui: questo stesso lavoro esiste due volte.
 * cron/send_payment_reminders.php lo rifa' per conto suo ogni notte, con le
 * stesse regole riscritte a mano — e con una differenza reale, perche' il cron
 * ripiega sull'email del proprietario quando l'inquilino non ne ha una, mentre
 * questa via no. Le due copie possono divergere ancora: chi tocca le regole di
 * selezione le tocchi in entrambi i file, o le unifichi.
 */
