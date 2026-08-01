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
    // Bind the id to the owner cookie so switching away from a previously-active
    // session (the admin session opened by bootstrap) still loads the owner
    // session rather than reusing the prior session id.
    if (!empty($_COOKIE[OWNER_SESSION_NAME])) {
        session_id($_COOKIE[OWNER_SESSION_NAME]);
    }
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => FORCE_HTTPS || (function_exists('requestIsHttps') && requestIsHttps()),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

/**
 * Come per gli altri due portali (config/auth.php): la sessione va riverificata
 * contro la riga vera, altrimenti togliere l'accesso a un proprietario —
 * archiviarlo, o azzerargli la password del portale — non ha effetto finche' non
 * esce da solo. Errore di banca dati: la sessione resta, non c'e' niente da
 * proteggere se non si legge nulla.
 */
function ownerSessionIsCurrent(): bool
{
    static $current = null;
    if ($current !== null) {
        return $current;
    }

    try {
        $stmt = getDB()->prepare(
            "SELECT name, surname FROM clients
             WHERE id = :id AND status != 'archived' AND portal_password_hash IS NOT NULL
             LIMIT 1"
        );
        $stmt->execute(['id' => (int) $_SESSION['owner_client_id']]);
        $row = $stmt->fetch();
    } catch (Throwable $e) {
        return $current = true;
    }

    if (!$row) {
        clearSession();
        return $current = false;
    }

    $_SESSION['owner_name'] = $row['name'] . ' ' . $row['surname'];

    return $current = true;
}

function isOwnerLoggedIn(): bool
{
    return !empty($_SESSION['owner_client_id']) && ownerSessionIsCurrent();
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

    appPasswordUpgrade(
        $password,
        $row['portal_password_hash'],
        fn(string $hash) => getDB()
            ->prepare('UPDATE clients SET portal_password_hash = :hash WHERE id = :id')
            ->execute(['hash' => $hash, 'id' => (int) $row['id']])
    );

    session_regenerate_id(true);
    $_SESSION['owner_client_id'] = (int) $row['id'];
    $_SESSION['owner_name']      = $row['name'] . ' ' . $row['surname'];
    $_SESSION['owner_email']     = $email;

    return true;
}

function logoutOwner(): void
{
    clearSession();
}
