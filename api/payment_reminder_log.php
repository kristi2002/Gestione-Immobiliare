<?php
/**
 * Payment Reminder Log API — manual trigger + log of sent reminders.
 *
 * GET  /api/payment_reminder_log.php                       — paginated log
 * POST /api/payment_reminder_log.php?action=send_reminders — trigger reminder run
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/mail.php';
apiHandleOptions();

requireRole('admin', 'super_admin');

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $action = trim($_GET['action'] ?? '');

    switch ($method) {
        case 'GET':
            listReminderLog($db);
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

function sendReminders(PDO $db): void
{
    // Fetch all overdue payments (pending or late, due_date < today)
    $stmt = $db->query(
        "SELECT pay.id AS payment_id, pay.amount, pay.due_date, pay.tenant_id, pay.property_id,
                t.name AS tenant_name, t.surname AS tenant_surname, t.email AS tenant_email,
                p.address AS property_address, p.city AS property_city,
                p.client_id,
                DATEDIFF(CURDATE(), pay.due_date) AS days_overdue
         FROM payments pay
         INNER JOIN tenants t ON t.id = pay.tenant_id
         INNER JOIN properties p ON p.id = pay.property_id
         WHERE pay.status IN ('pending', 'late')
           AND pay.due_date < CURDATE()
         ORDER BY days_overdue DESC"
    );
    $overduePayments = $stmt->fetchAll();

    $sent    = 0;
    $failed  = 0;
    $skipped = 0;
    $details = [];

    foreach ($overduePayments as $payment) {
        $paymentId = (int) $payment['payment_id'];
        $tenantId  = (int) $payment['tenant_id'];

        // Skip if reminder sent in last 7 days for this payment
        $recentCheck = $db->prepare(
            "SELECT id FROM payment_reminder_log
             WHERE payment_id = :pid
               AND sent_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
               AND status = 'sent'
             LIMIT 1"
        );
        $recentCheck->execute(['pid' => $paymentId]);
        if ($recentCheck->fetch()) {
            $skipped++;
            $details[] = [
                'payment_id' => $paymentId,
                'result'     => 'skipped',
                'reason'     => 'Reminder sent within last 7 days',
            ];
            continue;
        }

        // Skip if tenant has no email
        $tenantEmail = trim($payment['tenant_email'] ?? '');
        if ($tenantEmail === '' || !filter_var($tenantEmail, FILTER_VALIDATE_EMAIL)) {
            $skipped++;
            $details[] = [
                'payment_id' => $paymentId,
                'result'     => 'skipped',
                'reason'     => 'No valid tenant email',
            ];
            continue;
        }

        $daysOverdue = (int) $payment['days_overdue'];
        $tenantName  = trim($payment['tenant_name'] . ' ' . $payment['tenant_surname']);
        $amount      = number_format((float) $payment['amount'], 2, ',', '.');
        $dueDate     = $payment['due_date'];
        $property    = $payment['property_address'] . ', ' . $payment['property_city'];

        $subject = "Sollecito pagamento — Scadenza {$dueDate}";
        $body    = "Gentile {$tenantName},\n\n"
            . "Le ricordiamo che il pagamento di € {$amount} relativo all'immobile\n"
            . "{$property} era in scadenza il {$dueDate} ({$daysOverdue} giorni fa) e risulta ancora non pagato.\n\n"
            . "La preghiamo di procedere al pagamento quanto prima.\n\n"
            . "Per qualsiasi informazione, non esiti a contattarci.\n\n"
            . "Cordiali saluti,\nGestione Immobiliare";

        $result = sendClientEmail($tenantEmail, $subject, $body);

        $status   = $result['success'] ? 'sent' : 'failed';
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

        if ($result['success']) {
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

    logActivity('create', 'reminder_run', null, "Promemoria inviati: {$sent}, falliti: {$failed}, saltati: {$skipped}");

    apiSuccess([
        'sent'    => $sent,
        'failed'  => $failed,
        'skipped' => $skipped,
        'details' => $details,
    ]);
}
