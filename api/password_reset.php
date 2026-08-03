<?php
/**
 * Invio del link di reset password per i portali (lato admin).
 *
 * POST /api/password_reset.php  { subject_type: 'tenant'|'owner', subject_id: N }
 *
 * Genera un link a uso singolo e lo manda all'email dell'interessato. Il token
 * non viene MAI restituito al chiamante: se tornasse nella risposta comparirebbe
 * nella console del browser dell'agente, e l'agenzia sarebbe di nuovo in mezzo —
 * che e' esattamente cio' che questo flusso serve a evitare. L'unico caso in cui
 * il link viene mostrato e' l'invio simulato in sviluppo (MAIL_ENABLED=false),
 * dove non esiste nessuna email da aprire.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/mail.php';
require_once __DIR__ . '/../config/settings.php';
require_once __DIR__ . '/../config/rate_limit.php';
require_once __DIR__ . '/../lib/password_reset.php';

apiHandleOptions();
apiRequireMethod('POST');

// Un link di reset e' un'email verso un terzo: senza tetto, un account admin
// compromesso (o una funzione richiamata in loop) diventa un generatore di spam
// a spese del dominio dell'agenzia. Nessun bypass per gli admin: sono loro gli
// unici a poter chiamare questo endpoint.
checkRateLimit('password_reset_send', 20, 3600);

try {
    $db   = getDB();
    $data = apiGetJsonBody();

    $subjectType = trim($data['subject_type'] ?? 'tenant');
    $subjectId   = (int) ($data['subject_id'] ?? 0);

    if (!in_array($subjectType, PASSWORD_RESET_SUBJECTS, true)) {
        apiError('Tipo soggetto non valido.');
    }
    if ($subjectId <= 0) {
        apiError('Soggetto non valido.');
    }

    // Il destinatario si legge dall'archivio, non dalla richiesta: accettare
    // un'email dal body vorrebbe dire che chiunque possa chiamare l'endpoint
    // possa anche dirottare il link su una casella a sua scelta.
    if ($subjectType === 'tenant') {
        $stmt = $db->prepare("SELECT name, surname, email, status FROM tenants WHERE id = :id");
        $stmt->execute(['id' => $subjectId]);
        $subject = $stmt->fetch();
        if (!$subject)                        apiError('Inquilino non trovato.', 404);
        if (($subject['status'] ?? '') === 'archived') {
            apiError('Inquilino archiviato: riattivalo prima di dargli accesso al portale.');
        }
        $email = trim((string) $subject['email']);
    } else {
        // Per il proprietario l'accesso viaggia su portal_email, che puo' essere
        // diversa dall'email di contatto; se non e' impostata si ripiega su quella.
        $stmt = $db->prepare("SELECT name, surname, email, portal_email, status FROM clients WHERE id = :id");
        $stmt->execute(['id' => $subjectId]);
        $subject = $stmt->fetch();
        if (!$subject)                        apiError('Proprietario non trovato.', 404);
        if (($subject['status'] ?? '') === 'archived') {
            apiError('Proprietario archiviato.');
        }
        $email = trim((string) ($subject['portal_email'] ?: $subject['email']));
    }

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        apiError('Manca un indirizzo email valido: senza non c\'e\' dove mandare il link.');
    }

    $baseUrl = appBaseUrl();
    if ($baseUrl === '') {
        // Un link relativo in un'email non e' cliccabile. Meglio dirlo che
        // spedire un messaggio inservibile.
        apiError('APP_URL non configurato sul server: il link nell\'email sarebbe incompleto.', 500);
    }

    $issued = passwordResetIssue($db, $subjectType, $subjectId, $email, getCurrentAdminId());
    $link   = $baseUrl . '/reset_password.php?token=' . $issued['token'];

    $agencyName = (string) getSetting('agency_name', 'Gestionale Immobiliare');
    $recipient  = trim(($subject['name'] ?? '') . ' ' . ($subject['surname'] ?? ''));
    $mail       = passwordResetEmail($recipient, $link, $issued['expires_at'], $agencyName);

    $sent = sendClientEmail($email, $mail['subject'], $mail['body']);

    if (empty($sent['success'])) {
        // Il link esiste ma non e' arrivato a nessuno: va chiuso subito, altrimenti
        // resta un accesso valido di cui non sa nulla neanche il destinatario.
        passwordResetInvalidate($db, $issued['id']);
        apiError('Link non inviato (' . ($sent['error'] ?? 'errore SMTP') . '). Nessun accesso e\' stato aperto.');
    }

    $simulated = !empty($sent['simulated']);

    logActivity(
        'update',
        $subjectType === 'tenant' ? 'tenant' : 'client',
        $subjectId,
        'Link di reset password inviato a ' . $email . ($simulated ? ' (invio simulato)' : '')
    );

    apiSuccess([
        'email'      => $email,
        'expires_at' => $issued['expires_at'],
        // Non "inviata": in sviluppo l'email non parte davvero e dire il contrario
        // farebbe cercare per mezz'ora un messaggio che non esiste.
        'simulated'  => $simulated,
        'link'       => $simulated ? $link : null,
    ]);
} catch (PDOException $e) {
    error_log('password_reset failed: ' . $e->getMessage());
    apiError('Errore database.', 500);
}
