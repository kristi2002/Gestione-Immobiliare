<?php
/**
 * Application bootstrap — env, errors, HTTPS, session.
 */

require_once __DIR__ . '/env.php';

loadEnv(dirname(__DIR__) . '/.env');

define('APP_ENV',        (string) env('APP_ENV', 'local'));
define('APP_DEBUG',      (bool) env('APP_DEBUG', APP_ENV === 'local'));
define('APP_URL',        rtrim((string) env('APP_URL', ''), '/'));
define('FORCE_HTTPS',    (bool) env('FORCE_HTTPS', false));
define('SESSION_NAME',   (string) env('SESSION_NAME', 'gestionale_session'));
define('CRON_SECRET',    (string) env('CRON_SECRET', ''));
define('SETUP_ENABLED',  (bool) env('SETUP_ENABLED', false));

if (!APP_DEBUG) {
    ini_set('display_errors', '0');
    ini_set('display_startup_errors', '0');
    error_reporting(E_ALL);
} else {
    ini_set('display_errors', '1');
    error_reporting(E_ALL);
}

if (FORCE_HTTPS && PHP_SAPI !== 'cli') {
    $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');

    if (!$isHttps) {
        $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
        $uri  = $_SERVER['REQUEST_URI'] ?? '/';
        header('Location: https://' . $host . $uri, true, 301);
        exit;
    }
}

require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/csrf.php';
initSession();
initCsrfToken();
