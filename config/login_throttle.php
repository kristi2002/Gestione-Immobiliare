<?php
/**
 * Login brute-force protection — tracks attempts per IP in DB.
 */

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MINUTES = 15;

function getClientIp(): string
{
    $forwarded = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
    if ($forwarded !== '') {
        return trim(explode(',', $forwarded)[0]);
    }

    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}

function isLoginLocked(?string $ip = null): bool
{
    require_once __DIR__ . '/db.php';
    $ip = $ip ?? getClientIp();

    $stmt = getDB()->prepare(
        'SELECT COUNT(*) FROM login_attempts
         WHERE ip_address = :ip AND success = 0
           AND attempted_at > DATE_SUB(NOW(), INTERVAL :mins MINUTE)'
    );
    $stmt->execute(['ip' => $ip, 'mins' => LOGIN_LOCKOUT_MINUTES]);

    return (int) $stmt->fetchColumn() >= LOGIN_MAX_ATTEMPTS;
}

function recordLoginAttempt(bool $success, ?string $ip = null): void
{
    require_once __DIR__ . '/db.php';
    $ip = $ip ?? getClientIp();

    getDB()->prepare(
        'INSERT INTO login_attempts (ip_address, success) VALUES (:ip, :success)'
    )->execute(['ip' => $ip, 'success' => $success ? 1 : 0]);

    if ($success) {
        getDB()->prepare('DELETE FROM login_attempts WHERE ip_address = :ip')
            ->execute(['ip' => $ip]);
    }
}

function loginLockoutMessage(): string
{
    return 'Troppi tentativi falliti. Riprova tra ' . LOGIN_LOCKOUT_MINUTES . ' minuti.';
}
