<?php
/**
 * Cron job — send payment overdue reminders via email.
 *
 * Example crontab (daily at 08:00):
 * 0 8 * * * php /path/to/cron/send_payment_reminders.php
 *
 * Run manually:
 * php cron/send_payment_reminders.php
 */

require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../config/mail.php';

if (PHP_SAPI !== 'cli') {
    // Allow HTTP calls secured with CRON_SECRET header
    $secret = $_SERVER['HTTP_X_CRON_SECRET'] ?? '';
    if (CRON_SECRET === '' || $secret !== CRON_SECRET) {
        http_response_code(403);
        exit('Forbidden');
    }
}

$db = getDB();

// ── Fetch overdue payments (up to 60 days old) ─────────────────────────────────
$sql = <<<'SQL'
SELECT
    p.id                     AS payment_id,
    p.amount                 AS amount,
    p.due_date               AS due_date,
    p.notes                  AS payment_notes,
    DATEDIFF(CURDATE(), p.due_date) AS days_overdue,
    -- tenant info (payments.tenant_id is the direct, authoritative link —
    -- tenants no longer carry their own property_id)
    t.id                     AS tenant_id,
    t.name                   AS tenant_first,
    t.surname                AS tenant_last,
    t.email                  AS tenant_email,
    -- client (property owner) info
    cl.id                    AS client_id,
    cl.name                  AS client_name,
    cl.email                 AS client_email,
    -- property info
    pr.address               AS property_address
FROM payments p
LEFT JOIN tenants  t  ON t.id  = p.tenant_id
LEFT JOIN properties pr ON pr.id = p.property_id
LEFT JOIN clients  cl ON cl.id  = pr.client_id
WHERE p.status IN ('pending', 'late')
  AND p.due_date < CURDATE()
  AND p.due_date >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)
ORDER BY p.due_date ASC
SQL;

$payments = $db->query($sql)->fetchAll(PDO::FETCH_ASSOC);

$stats = [
    'total'   => count($payments),
    'sent'    => 0,
    'skipped' => 0,
    'failed'  => 0,
    'errors'  => [],
];

$cooldownDays = 7;

foreach ($payments as $row) {
    $paymentId   = (int) $row['payment_id'];
    $daysOverdue = (int) $row['days_overdue'];
    $tenantId    = $row['tenant_id']   ? (int) $row['tenant_id']   : null;
    $clientId    = $row['client_id']   ? (int) $row['client_id']   : null;

    // ── Cooldown check: skip if a reminder was already sent within last N days ──
    $checkStmt = $db->prepare(
        'SELECT COUNT(*) FROM payment_reminder_log
          WHERE payment_id = :pid
            AND sent_at > DATE_SUB(NOW(), INTERVAL :days DAY)
            AND status = \'sent\''
    );
    $checkStmt->execute([':pid' => $paymentId, ':days' => $cooldownDays]);
    if ((int) $checkStmt->fetchColumn() > 0) {
        $stats['skipped']++;
        continue;
    }

    // ── Determine recipient ─────────────────────────────────────────────────────
    $recipientEmail = $row['tenant_email'] ?? $row['client_email'] ?? null;
    $recipientName  = $row['tenant_first']
        ? trim($row['tenant_first'] . ' ' . $row['tenant_last'])
        : ($row['client_name'] ?? 'Inquilino/Proprietario');

    if (!$recipientEmail || !filter_var($recipientEmail, FILTER_VALIDATE_EMAIL)) {
        $stats['skipped']++;
        continue;
    }

    $propertyAddr = $row['property_address'] ?? '(immobile)';
    $dueDateFmt   = date('d/m/Y', strtotime($row['due_date']));
    $amount       = number_format((float) $row['amount'], 2, ',', '.');

    // ── Compose email ───────────────────────────────────────────────────────────
    $subject = "Sollecito pagamento — scaduto da {$daysOverdue} giorni";

    $textBody = <<<TXT
Gentile {$recipientName},

Le ricordiamo che risulta un pagamento in attesa relativo all'immobile {$propertyAddr}.

  Importo:  € {$amount}
  Scadenza: {$dueDateFmt}
  Giorni di ritardo: {$daysOverdue}

La preghiamo di provvedere al pagamento il prima possibile o di contattarci per chiarimenti.

Distinti saluti
TXT;

    $htmlBody = <<<HTML
<p>Gentile <strong>{$recipientName}</strong>,</p>
<p>Le ricordiamo che risulta un pagamento in attesa relativo all'immobile <strong>{$propertyAddr}</strong>.</p>
<table style="border-collapse:collapse;margin:12px 0">
  <tr><td style="padding:4px 12px 4px 0"><strong>Importo</strong></td><td>€ {$amount}</td></tr>
  <tr><td style="padding:4px 12px 4px 0"><strong>Scadenza</strong></td><td>{$dueDateFmt}</td></tr>
  <tr><td style="padding:4px 12px 4px 0"><strong>Giorni di ritardo</strong></td><td>{$daysOverdue}</td></tr>
</table>
<p>La preghiamo di provvedere al pagamento il prima possibile o di contattarci per chiarimenti.</p>
<p>Distinti saluti</p>
HTML;

    // ── Send ────────────────────────────────────────────────────────────────────
    $result = sendClientEmail($recipientEmail, $subject, $textBody, $htmlBody);

    // ── Log ────────────────────────────────────────────────────────────────────
    $logStatus = $result['success'] ? 'sent' : 'failed';
    $errorMsg  = $result['error'] ?? null;

    $logStmt = $db->prepare(
        'INSERT INTO payment_reminder_log
            (payment_id, tenant_id, client_id, channel, days_overdue, status, error_msg)
         VALUES
            (:pid, :tid, :cid, :channel, :days, :status, :err)'
    );
    $logStmt->execute([
        ':pid'     => $paymentId,
        ':tid'     => $tenantId,
        ':cid'     => $clientId,
        ':channel' => 'email',
        ':days'    => $daysOverdue,
        ':status'  => $logStatus,
        ':err'     => $errorMsg,
    ]);

    if ($result['success']) {
        $stats['sent']++;
    } else {
        $stats['failed']++;
        $stats['errors'][] = "Payment #{$paymentId}: {$errorMsg}";
    }
}

// ── Output summary ─────────────────────────────────────────────────────────────
$out = [
    'success' => true,
    'run_at'  => date('Y-m-d H:i:s'),
    'stats'   => $stats,
];

echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
