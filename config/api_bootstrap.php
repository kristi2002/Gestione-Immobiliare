<?php
/**
 * API bootstrap — env, session, authentication.
 */
require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/api_helpers.php';
requireAuthApi();

if (in_array($_SERVER['REQUEST_METHOD'], ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
    requireWriteAccess();
}
