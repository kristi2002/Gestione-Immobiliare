<?php
/**
 * Owner portal session helpers.
 *
 * Owners authenticate against the clients table (portal_email + portal_password_hash).
 * Uses a dedicated session cookie so it does not collide with the admin
 * or tenant sessions.
 */

require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../config/db.php';

define('OWNER_SESSION_NAME', 'gestionale_owner_session');

function initOwnerSession(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }

    session_name(OWNER_SESSION_NAME);
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => FORCE_HTTPS,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

function isOwnerLoggedIn(): bool
{
    return !empty($_SESSION['owner_client_id']);
}

function getCurrentOwnerId(): int
{
    return (int) ($_SESSION['owner_client_id'] ?? 0);
}

function getCurrentOwnerName(): string
{
    return $_SESSION['owner_name'] ?? 'Proprietario';
}

function requireOwnerAuth(): void
{
    if (!isOwnerLoggedIn()) {
        header('Location: login.php');
        exit;
    }
}

function attemptOwnerLogin(string $email, string $password): bool
{
    $stmt = getDB()->prepare(
        "SELECT id, name, surname, portal_password_hash
         FROM clients
         WHERE portal_email = :email AND status != 'archived'
           AND portal_password_hash IS NOT NULL
         LIMIT 1"
    );
    $stmt->execute(['email' => $email]);
    $row = $stmt->fetch();

    if (!$row || !password_verify($password, $row['portal_password_hash'])) {
        return false;
    }

    session_regenerate_id(true);
    $_SESSION['owner_client_id'] = (int) $row['id'];
    $_SESSION['owner_name']      = $row['name'] . ' ' . $row['surname'];
    $_SESSION['owner_email']     = $email;

    return true;
}

function logoutOwner(): void
{
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }
    session_destroy();
}
