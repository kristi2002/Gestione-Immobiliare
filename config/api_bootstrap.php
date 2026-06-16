<?php
/**
 * API bootstrap — env, session, authentication.
 */
require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/api_helpers.php';
require_once __DIR__ . '/api_pagination.php';
require_once __DIR__ . '/csrf.php';
require_once __DIR__ . '/activity_log.php';
requireAuthApi();

if (in_array($_SERVER['REQUEST_METHOD'], ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
    requireWriteAccess();
    validateCsrfToken();
}
