<?php
/**
 * Public appointment-request endpoint for the marketing site (web-orlandi).
 *
 * POST /api/appointment_request.php — create an appointment request (no auth).
 *
 * Deliberately does NOT use api_bootstrap.php: that bootstrap enforces an
 * admin session + CSRF, while this endpoint must be reachable by anonymous
 * visitors. Abuse is limited by a honeypot field and a per-IP rate limit.
 */

ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
if (!ob_get_level()) {
    ob_start();
}

require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/api_helpers.php';

apiHandleOptions();

const APPT_TYPES = ['valutazione', 'visita_immobile', 'vendita', 'affitto', 'consulenza', 'altro'];
const APPT_TIMES = ['mattina', 'pomeriggio', 'sera'];
const APPT_MAX_PER_IP_PER_HOUR = 5;

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    apiError('Metodo non consentito.', 405);
}

try {
    $db   = getDB();
    $body = apiGetJsonBody();

    // Honeypot: bots fill every field; humans never see this one.
    if (trim((string) ($body['website'] ?? '')) !== '') {
        apiSuccess(['received' => true]); // pretend success, store nothing
    }

    $ip = $_SERVER['REMOTE_ADDR'] ?? null;
    if ($ip) {
        $stmt = $db->prepare('SELECT COUNT(*) FROM appointment_requests WHERE ip_address = ? AND created_at > NOW() - INTERVAL 1 HOUR');
        $stmt->execute([$ip]);
        if ((int) $stmt->fetchColumn() >= APPT_MAX_PER_IP_PER_HOUR) {
            apiError('Troppe richieste. Riprova più tardi.', 429);
        }
    }

    $name    = trim((string) ($body['name'] ?? ''));
    $surname = trim((string) ($body['surname'] ?? ''));
    $email   = trim((string) ($body['email'] ?? ''));
    $phone   = trim((string) ($body['phone'] ?? ''));
    $type    = trim((string) ($body['appointment_type'] ?? 'valutazione'));
    $date    = trim((string) ($body['preferred_date'] ?? ''));
    $time    = trim((string) ($body['preferred_time'] ?? ''));
    $message = trim((string) ($body['message'] ?? ''));

    if ($name === '' || mb_strlen($name) > 100)       apiError('Nome obbligatorio (max 100 caratteri).');
    if ($surname === '' || mb_strlen($surname) > 100) apiError('Cognome obbligatorio (max 100 caratteri).');
    if ($phone === '' || mb_strlen($phone) > 30 || !preg_match('/^[0-9+\s().\-]{6,}$/', $phone)) {
        apiError('Numero di telefono non valido.');
    }
    if ($email !== '' && (mb_strlen($email) > 255 || !filter_var($email, FILTER_VALIDATE_EMAIL))) {
        apiError('Indirizzo email non valido.');
    }
    if (!in_array($type, APPT_TYPES, true)) apiError('Tipo di appuntamento non valido.');

    $prefDate = null;
    if ($date !== '') {
        $dt = DateTime::createFromFormat('Y-m-d', $date);
        if (!$dt || $dt->format('Y-m-d') !== $date) apiError('Data preferita non valida.');
        if ($dt < new DateTime('today')) apiError('La data preferita deve essere futura.');
        $prefDate = $date;
    }
    $prefTime = in_array($time, APPT_TIMES, true) ? $time : null;
    if (mb_strlen($message) > 2000) apiError('Messaggio troppo lungo (max 2000 caratteri).');

    $db->beginTransaction();

    // Mirror the request as a lead so it appears in the admin CRM pipeline.
    $leadNotes = "Richiesta appuntamento dal sito web — tipo: {$type}"
        . ($prefDate ? ", data preferita: {$prefDate}" : '')
        . ($prefTime ? " ({$prefTime})" : '')
        . ($message !== '' ? "\n\n{$message}" : '');
    $stmt = $db->prepare(
        "INSERT INTO leads (name, surname, phone, email, interest_type, status, source, notes)
         VALUES (?, ?, ?, ?, 'entrambi', 'new', 'web', ?)"
    );
    $stmt->execute([$name, $surname, $phone, $email !== '' ? $email : null, $leadNotes]);
    $leadId = (int) $db->lastInsertId();

    $stmt = $db->prepare(
        'INSERT INTO appointment_requests
            (name, surname, email, phone, appointment_type, preferred_date, preferred_time, message, lead_id, ip_address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $name, $surname, $email !== '' ? $email : null, $phone,
        $type, $prefDate, $prefTime, $message !== '' ? $message : null,
        $leadId, $ip,
    ]);
    $requestId = (int) $db->lastInsertId();

    $db->commit();

    apiSuccess(['id' => $requestId, 'received' => true], 201);
} catch (PDOException $e) {
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    error_log('appointment_request: ' . $e->getMessage());
    apiError('Errore database.', 500);
}
