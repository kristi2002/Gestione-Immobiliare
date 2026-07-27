<?php
/**
 * Twilio delivery-status callback.
 * Configurare in Twilio (o passato come StatusCallback a ogni invio):
 *   POST https://<dominio>/api/twilio_status_callback.php
 *
 * Perché esiste: l'enum communications.status prevedeva già delivered/failed,
 * ma nessuno lo aggiornava mai — una volta scritta 'sent', la riga restava
 * 'sent' anche se il messaggio non era mai arrivato. Questo endpoint è l'unico
 * punto in cui lo stato avanza dopo l'invio.
 *
 * FAIL CLOSED come gli altri webhook: senza auth token in produzione la
 * richiesta viene rifiutata, perché una POST non firmata potrebbe marcare come
 * "consegnato" un messaggio mai partito.
 */

require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/settings.php';
require_once __DIR__ . '/../config/whatsapp.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit;
}

$verdict = verifyTwilioRequest('/api/twilio_status_callback.php', $_POST);

if ($verdict === 'unconfigured') {
    error_log('[twilio_status] REJECTED: nessun twilio_auth_token in produzione — richiesta non verificabile.');
    http_response_code(503);
    exit;
}
if ($verdict === 'invalid') {
    http_response_code(403);
    exit;
}
if ($verdict === 'skipped') {
    error_log('[twilio_status] WARNING: nessun twilio_auth_token — firma non verificata (solo fuori produzione).');
}

$sid       = trim($_POST['MessageSid'] ?? $_POST['SmsSid'] ?? '');
$rawStatus = trim($_POST['MessageStatus'] ?? $_POST['SmsStatus'] ?? '');
$errorCode = trim($_POST['ErrorCode'] ?? '');

if ($sid === '' || $rawStatus === '') {
    http_response_code(200);
    exit;
}

$newStatus = twilioStatusToCommStatus($rawStatus);
$detail    = $errorCode !== '' ? "Twilio {$rawStatus} (errore {$errorCode})" : "Twilio {$rawStatus}";

try {
    $db = getDB();

    $stmt = $db->prepare("SELECT id, status FROM communications WHERE external_id = :sid");
    $stmt->execute(['sid' => $sid]);
    $rows = $stmt->fetchAll();

    $update = $db->prepare(
        "UPDATE communications
            SET status = :status, status_updated_at = NOW(), status_detail = :detail
          WHERE id = :id"
    );

    foreach ($rows as $row) {
        // Non si torna indietro: un 'sent' che arriva dopo un 'delivered' è un
        // callback in ritardo, non un peggioramento reale dello stato.
        if (commStatusRank($newStatus) <= commStatusRank((string) $row['status'])
            && $newStatus !== 'failed') {
            continue;
        }
        $update->execute([
            'status' => $newStatus,
            'detail' => $detail,
            'id'     => $row['id'],
        ]);
    }

    // Stesso aggiornamento sulla tabella dedicata WhatsApp, se la riga esiste.
    try {
        $db->prepare(
            "UPDATE whatsapp_messages SET status = :status WHERE twilio_sid = :sid"
        )->execute(['status' => $rawStatus, 'sid' => $sid]);
    } catch (PDOException) {
        // La colonna status potrebbe non esistere su installazioni vecchie.
    }
} catch (PDOException $e) {
    error_log('[twilio_status] errore DB: ' . $e->getMessage());
    http_response_code(500);
    exit;
}

http_response_code(200);
header('Content-Type: text/xml');
echo '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
