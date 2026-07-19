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
require_once __DIR__ . '/../config/gdpr.php';

apiHandleOptions();

const APPT_TYPES = ['valutazione', 'visita_immobile', 'vendita', 'affitto', 'consulenza', 'altro'];
const APPT_TIMES = ['mattina', 'pomeriggio', 'sera'];
const APPT_MAX_PER_IP_PER_HOUR = 5;
const APPT_SLOTS_PER_DAY = 6;       // daily capacity across all agents
const APPT_LOOKAHEAD_DAYS = 60;     // horizon exposed to the public site

/**
 * GET ?action=unavailable_dates — dates (next 60 days) the public form should block.
 * A date is unavailable when it is a Sunday (agency closed) or when confirmed
 * calendar appointments + pending web requests reach the daily slot capacity.
 * Returns bare date strings only: no personal data leaves this endpoint.
 */
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (($_GET['action'] ?? '') !== 'unavailable_dates') {
        apiError('Azione non valida.', 400);
    }
    try {
        $db    = getDB();
        $start = new DateTime('today');
        $end   = (clone $start)->modify('+' . APPT_LOOKAHEAD_DAYS . ' days');

        $counts = [];
        $stmt = $db->prepare(
            "SELECT DATE(appointment_date) d, COUNT(*) c FROM appointments
             WHERE status = 'scheduled' AND appointment_date >= ? AND appointment_date < ?
             GROUP BY DATE(appointment_date)"
        );
        $stmt->execute([$start->format('Y-m-d'), $end->format('Y-m-d')]);
        foreach ($stmt->fetchAll(PDO::FETCH_KEY_PAIR) as $d => $c) {
            $counts[$d] = ($counts[$d] ?? 0) + (int) $c;
        }
        $stmt = $db->prepare(
            "SELECT preferred_date d, COUNT(*) c FROM appointment_requests
             WHERE status IN ('new','confirmed') AND preferred_date >= ? AND preferred_date < ?
             GROUP BY preferred_date"
        );
        $stmt->execute([$start->format('Y-m-d'), $end->format('Y-m-d')]);
        foreach ($stmt->fetchAll(PDO::FETCH_KEY_PAIR) as $d => $c) {
            $counts[$d] = ($counts[$d] ?? 0) + (int) $c;
        }

        $unavailable = [];
        for ($day = clone $start; $day < $end; $day->modify('+1 day')) {
            $key = $day->format('Y-m-d');
            if ($day->format('N') === '7' || ($counts[$key] ?? 0) >= APPT_SLOTS_PER_DAY) {
                $unavailable[] = $key;
            }
        }
        apiSuccess(['unavailable_dates' => $unavailable, 'horizon_days' => APPT_LOOKAHEAD_DAYS]);
    } catch (PDOException $e) {
        error_log('appointment_request availability: ' . $e->getMessage());
        apiError('Errore database.', 500);
    }
}

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
        if ($dt->format('N') === '7') apiError('La domenica l\'agenzia è chiusa: scegli un altro giorno.');
        $stmt = $db->prepare(
            "SELECT
                (SELECT COUNT(*) FROM appointments
                 WHERE status = 'scheduled' AND DATE(appointment_date) = ?) +
                (SELECT COUNT(*) FROM appointment_requests
                 WHERE status IN ('new','confirmed') AND preferred_date = ?)"
        );
        $stmt->execute([$date, $date]);
        if ((int) $stmt->fetchColumn() >= APPT_SLOTS_PER_DAY) {
            apiError('La data scelta non è più disponibile: seleziona un altro giorno.');
        }
        $prefDate = $date;
    }
    $prefTime = in_array($time, APPT_TIMES, true) ? $time : null;
    if (mb_strlen($message) > 2000) apiError('Messaggio troppo lungo (max 2000 caratteri).');

    // GDPR — the visitor must affirmatively accept the privacy informativa before
    // we store any personal data. Server-side gate: proof of the acceptance is
    // persisted after the lead is created (logConsent below).
    $privacyConsent   = !empty($body['privacy_consent']);
    $marketingConsent = !empty($body['marketing_consent']);
    if (!$privacyConsent) {
        apiError('Per inviare la richiesta è necessario accettare l\'informativa sulla privacy.');
    }
    $consentText = trim((string) ($body['consent_text'] ?? ''))
        ?: 'Informativa privacy accettata tramite il modulo appuntamento del sito web.';

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

    // Persist proof of the consent enforced above (best-effort — the gate already
    // required acceptance). Attached to the lead created for this request.
    logConsent($db, 'lead', $leadId, 'privacy', true, 'consent', $consentText, 'public_form');
    if ($marketingConsent) {
        logConsent($db, 'lead', $leadId, 'marketing', true, 'consent', $consentText, 'public_form');
    }

    apiSuccess(['id' => $requestId, 'received' => true], 201);
} catch (PDOException $e) {
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    error_log('appointment_request: ' . $e->getMessage());
    apiError('Errore database.', 500);
}
