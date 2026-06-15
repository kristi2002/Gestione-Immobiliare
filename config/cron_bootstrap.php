<?php
/**
 * Cron API bootstrap — env + secret token (CLI allowed without secret).
 */
require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/api_helpers.php';
requireJobAuth();
