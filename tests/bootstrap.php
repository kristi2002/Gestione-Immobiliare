<?php
/**
 * PHPUnit bootstrap — load config helpers without triggering DB/session.
 *
 * We define stubs for functions that would normally require a live database
 * or environment, so unit tests can run in isolation.
 */

// Prevent any HTTP output / headers
if (!defined('STDIN')) define('STDIN', fopen('php://stdin', 'r'));

// ── Stub out functions the config files call that require live resources ────

if (!function_exists('loadEnv')) {
    function loadEnv(string $path): void { /* no-op in tests */ }
}

if (!function_exists('getDB')) {
    function getDB(): PDO {
        // Return an in-memory SQLite PDO for tests that need a DB
        static $pdo = null;
        if ($pdo === null) {
            $pdo = new PDO('sqlite::memory:');
            $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        }
        return $pdo;
    }
}

if (!function_exists('getSetting')) {
    function getSetting(string $key, mixed $default = null): mixed {
        // Tests can override via $_ENV
        return $_ENV['TEST_SETTING_' . strtoupper($key)] ?? $default;
    }
}

if (!function_exists('getMailConfig')) {
    function getMailConfig(): array {
        return [
            'mail_enabled'  => false,
            'smtp_host'     => $_ENV['TEST_SMTP_HOST'] ?? '',
            'smtp_port'     => (int) ($_ENV['TEST_SMTP_PORT'] ?? 587),
            'smtp_secure'   => $_ENV['TEST_SMTP_SECURE'] ?? 'tls',
            'smtp_user'     => $_ENV['TEST_SMTP_USER'] ?? '',
            'smtp_pass'     => $_ENV['TEST_SMTP_PASS'] ?? '',
            'agency_email'  => $_ENV['TEST_AGENCY_EMAIL'] ?? 'test@example.com',
            'agency_name'   => 'Test Agency',
        ];
    }
}

if (!function_exists('logActivity')) {
    function logActivity(string $action, string $entity, int $id, string $desc = ''): void { /* no-op */ }
}

if (!function_exists('APP_URL')) {
    define('APP_URL', 'https://testdemo.it');
}

// Load the config files we're testing (they only define functions, so safe to include)
require_once __DIR__ . '/../config/mail.php';
require_once __DIR__ . '/../config/whatsapp.php';
require_once __DIR__ . '/../config/meta.php';
