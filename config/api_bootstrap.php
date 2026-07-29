<?php
/**
 * API bootstrap — env, session, authentication.
 */

// API responses must always be valid JSON. Never let PHP warnings/notices leak
// into the body (they break JSON.parse on the client). Errors still go to the log.
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
if (!ob_get_level()) {
    ob_start();
}

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/api_helpers.php';
require_once __DIR__ . '/api_pagination.php';
require_once __DIR__ . '/csrf.php';
require_once __DIR__ . '/activity_log.php';
requireAuthApi();

if (in_array($_SERVER['REQUEST_METHOD'], ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
    // Il blocco in sola lettura protegge i DATI dell'agenzia. Un endpoint che
    // agisce solo sull'account di chi è collegato (attivare la 2FA, cambiare la
    // propria password) lo dichiara prima di includere questo file: negarlo
    // significherebbe impedire a un utente readonly di mettere in sicurezza il
    // proprio accesso. Il controllo CSRF resta comunque obbligatorio.
    if (!defined('API_SELF_SERVICE') || API_SELF_SERVICE !== true) {
        requireWriteAccess();
    }
    validateCsrfToken();
}
