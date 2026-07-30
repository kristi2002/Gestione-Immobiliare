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
require_once __DIR__ . '/../config/payment_reminders.php';

if (PHP_SAPI !== 'cli') {
    // Allow HTTP calls secured with CRON_SECRET header
    $secret = $_SERVER['HTTP_X_CRON_SECRET'] ?? '';
    if (CRON_SECRET === '' || $secret !== CRON_SECRET) {
        http_response_code(403);
        exit('Forbidden');
    }
}

$db = getDB();

// Selezione, finestra dei 60 giorni, periodo di attesa e testo del messaggio
// vivono in config/payment_reminders.php, condivisi con la pagina "Solleciti
// pagamenti" (api/payment_reminder_log.php). Prima erano riscritti a mano qui
// e la' e i due insiemi non coincidevano: la pagina annunciava un numero di
// solleciti che questo job non avrebbe mai spedito.
$candidates = collectPaymentReminderCandidates($db);

$stats = [
    'total'     => count($candidates),
    'sent'      => 0,
    'skipped'   => 0,
    'failed'    => 0,
    // Accettati dal mailer ma mai spediti, perche' l'invio email e' spento.
    'simulated' => 0,
    'errors'    => [],
];

foreach ($candidates as $row) {
    $paymentId   = (int) $row['payment_id'];
    $daysOverdue = (int) $row['days_overdue'];
    $tenantId    = $row['tenant_id'] ? (int) $row['tenant_id'] : null;
    $clientId    = $row['client_id'] ? (int) $row['client_id'] : null;

    // Fuori finestra, gia' sollecitato di recente, senza inquilino o senza
    // email: il motivo lo ha gia' deciso il selettore condiviso.
    if (!$row['eligible']) {
        $stats['skipped']++;
        continue;
    }

    $recipientEmail = trim($row['tenant_email']);

    // ── Compose email ───────────────────────────────────────────────────────────
    $mail     = buildPaymentReminderEmail($row);
    $subject  = $mail['subject'];
    $textBody = $mail['text'];
    $htmlBody = $mail['html'];

    // ── Send ────────────────────────────────────────────────────────────────────
    $result = sendClientEmail($recipientEmail, $subject, $textBody, $htmlBody);

    // ── Log ────────────────────────────────────────────────────────────────────
    // Con l'invio email spento sendClientEmail() risponde success=true senza
    // spedire niente. Questo job gira ogni notte: registrandolo come 'sent'
    // riempiva da solo il registro di solleciti mai partiti, e ogni riga finta
    // bloccava per sette giorni (il periodo di attesa qui sotto, che conta solo
    // le righe 'sent') il sollecito vero che sarebbe partito a invio riacceso.
    $wasSimulated = !empty($result['simulated']);
    $logStatus = $wasSimulated ? 'simulated' : ($result['success'] ? 'sent' : 'failed');
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

    if ($wasSimulated) {
        $stats['simulated']++;
    } elseif ($result['success']) {
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

require_once __DIR__ . '/../config/heartbeat.php';
cronHeartbeat('payment_reminders');
echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
