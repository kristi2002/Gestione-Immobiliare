<?php
/**
 * Contract expiration processing — Phase 11.
 *
 * Scans signed contracts whose end_date falls within the next 90 days and
 * auto-creates a "scadenza contratto" reminder (30 days before expiry) plus
 * an admin email notification. Duplicate reminders within 90 days are skipped.
 *
 * The optional `contracts` table is not part of the base schema; when it is
 * absent the processor is a safe no-op so the cron never errors.
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/mail.php';
require_once __DIR__ . '/mail_html.php';
require_once __DIR__ . '/settings.php';

function contractsTableExists(PDO $db): bool
{
    try {
        $db->query("SELECT 1 FROM contracts LIMIT 1");
        return true;
    } catch (PDOException) {
        return false;
    }
}

/**
 * @return array{processed:int, created:int, skipped:int, results:array}
 */
function processContractExpirations(PDO $db): array
{
    if (!contractsTableExists($db)) {
        return ['processed' => 0, 'created' => 0, 'skipped' => 0, 'results' => [], 'note' => 'Tabella contracts non presente.'];
    }

    $stmt = $db->query(
        "SELECT c.id, c.title, c.client_id, c.property_id, c.end_date
         FROM contracts c
         WHERE c.status = 'signed'
           AND c.end_date IS NOT NULL
           AND c.end_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 90 DAY)"
    );
    $contracts = $stmt->fetchAll();

    $created = 0;
    $skipped = 0;
    $results = [];

    // Dedup: skip if a pending reminder with same title already exists within 90 days
    $dupStmt = $db->prepare(
        "SELECT id FROM reminders
         WHERE title = :title AND status = 'pending'
           AND created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
         LIMIT 1"
    );

    $insStmt = $db->prepare(
        "INSERT INTO reminders
            (title, description, reminder_date, frequency, status, client_id, property_id,
             notify_admin, notify_client)
         VALUES
            (:title, :description, :reminder_date, 'once', 'pending', :client_id, :property_id,
             1, 0)"
    );

    foreach ($contracts as $c) {
        $reminderDate = date('Y-m-d H:i:s', strtotime($c['end_date'] . ' -30 days'));
        $title        = 'Scadenza contratto: ' . $c['title'];

        $dupStmt->execute(['title' => $title]);
        if ($dupStmt->fetch()) {
            $skipped++;
            continue;
        }

        $insStmt->execute([
            'title'         => $title,
            'description'   => 'Il contratto scadrà il ' . date('d/m/Y', strtotime($c['end_date'])) . '. (contratto #' . $c['id'] . ')',
            'reminder_date' => $reminderDate,
            'client_id'     => $c['client_id'],
            'property_id'   => $c['property_id'],
        ]);
        $created++;

        $adminEmail = getSetting('agency_email', 'admin@agenzia.it');
        $subject    = '[Scadenza contratto] ' . $c['title'];
        $body       = "Il contratto \"{$c['title']}\" scadrà il "
            . date('d/m/Y', strtotime($c['end_date'])) . ".\n"
            . "È stato creato un promemoria per il " . date('d/m/Y', strtotime($reminderDate)) . ".";
        sendHtmlEmail($adminEmail, $subject, $body);

        $results[] = ['contract_id' => (int) $c['id'], 'title' => $c['title'], 'reminder_date' => $reminderDate];
    }

    return [
        'processed' => count($contracts),
        'created'   => $created,
        'skipped'   => $skipped,
        'results'   => $results,
    ];
}
