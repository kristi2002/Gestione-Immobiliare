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

/**
 * Locked when EITHER the source IP OR the targeted username has reached the
 * failed-attempt ceiling in the window. The per-username axis stops an attacker
 * who rotates IPs against one account; the per-IP axis stops broad spraying.
 */
function isLoginLocked(?string $ip = null, ?string $username = null): bool
{
    require_once __DIR__ . '/db.php';
    $ip = $ip ?? getClientIp();
    $db = getDB();

    $ipStmt = $db->prepare(
        'SELECT COUNT(*) FROM login_attempts
         WHERE ip_address = :ip AND success = 0
           AND attempted_at > DATE_SUB(NOW(), INTERVAL :mins MINUTE)'
    );
    $ipStmt->execute(['ip' => $ip, 'mins' => LOGIN_LOCKOUT_MINUTES]);
    if ((int) $ipStmt->fetchColumn() >= LOGIN_MAX_ATTEMPTS) {
        return true;
    }

    if ($username !== null && $username !== '') {
        $uStmt = $db->prepare(
            'SELECT COUNT(*) FROM login_attempts
             WHERE username = :u AND success = 0
               AND attempted_at > DATE_SUB(NOW(), INTERVAL :mins MINUTE)'
        );
        $uStmt->execute(['u' => $username, 'mins' => LOGIN_LOCKOUT_MINUTES]);
        if ((int) $uStmt->fetchColumn() >= LOGIN_MAX_ATTEMPTS) {
            return true;
        }
    }

    return false;
}

/**
 * Record a login attempt. IMPORTANT: pass $success = true ONLY when the login is
 * FULLY authenticated (password AND, where enabled, 2FA). The intermediate
 * "password ok, 2FA pending" step must NOT be recorded as success — doing so would
 * clear the failure counter and hand an attacker who knows the password an
 * unlimited number of TOTP guesses.
 */
function recordLoginAttempt(bool $success, ?string $ip = null, ?string $username = null): void
{
    require_once __DIR__ . '/db.php';
    $ip = $ip ?? getClientIp();
    $u  = ($username !== null && $username !== '') ? $username : null;

    getDB()->prepare(
        'INSERT INTO login_attempts (ip_address, username, success) VALUES (:ip, :u, :success)'
    )->execute(['ip' => $ip, 'u' => $u, 'success' => $success ? 1 : 0]);

    if ($success) {
        // Clear the counter on both axes so neither retains stale failures.
        if ($u !== null) {
            getDB()->prepare('DELETE FROM login_attempts WHERE ip_address = :ip OR username = :u')
                ->execute(['ip' => $ip, 'u' => $u]);
        } else {
            getDB()->prepare('DELETE FROM login_attempts WHERE ip_address = :ip')
                ->execute(['ip' => $ip]);
        }
    }
}

function loginLockoutMessage(): string
{
    return 'Troppi tentativi falliti. Riprova tra ' . LOGIN_LOCKOUT_MINUTES . ' minuti.';
}
