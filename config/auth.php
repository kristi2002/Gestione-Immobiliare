<?php
/**
 * Authentication — session-based admin + tenant login.
 */

require_once __DIR__ . '/roles.php';
require_once __DIR__ . '/password.php';

define('TENANT_SESSION_NAME', 'gestionale_tenant_session');

function initSession(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    session_name(SESSION_NAME);

    // Secure whenever HTTPS is forced OR the request actually arrived over HTTPS,
    // so the session cookie never rides plaintext on a real TLS connection even if
    // FORCE_HTTPS was left unset.
    $secure = FORCE_HTTPS || (function_exists('requestIsHttps') && requestIsHttps());
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);

    session_start();
}

function initTenantSession(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }

    session_name(TENANT_SESSION_NAME);
    // After switching from a previously-active session (e.g. the admin session
    // opened by bootstrap), PHP keeps the old session id; session_start() would
    // then reload the WRONG session. Bind the id to this portal's own cookie.
    if (!empty($_COOKIE[TENANT_SESSION_NAME])) {
        session_id($_COOKIE[TENANT_SESSION_NAME]);
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
 * La sessione porta con se' chi sei e cosa puoi fare dal momento del login. Senza
 * un ricontrollo, revocare un accesso non ha alcun effetto finche' quella persona
 * non esce da sola: un utente cancellato o disattivato continua a lavorare, e un
 * ruolo abbassato conserva i privilegi di prima. Qui la sessione viene
 * riverificata contro la riga vera, una volta per richiesta.
 *
 * Se la banca dati non risponde la sessione resta valida: senza database la
 * richiesta non puo' comunque leggere nulla, e sloggare tutti a ogni singhiozzo
 * sarebbe un danno senza guadagno.
 */
function adminSessionIsCurrent(): bool
{
    static $current = null;
    if ($current !== null) {
        return $current;
    }

    require_once __DIR__ . '/db.php';

    try {
        $stmt = getDB()->prepare(
            'SELECT username, role, is_active FROM admin_users WHERE id = :id LIMIT 1'
        );
        $stmt->execute(['id' => (int) $_SESSION['admin_id']]);
        $user = $stmt->fetch();
    } catch (Throwable $e) {
        return $current = true;
    }

    if (!$user || !(int) $user['is_active']) {
        clearSession();
        return $current = false;
    }

    // Ruolo e nome possono essere cambiati dopo il login.
    $_SESSION['admin_role']     = $user['role'];
    $_SESSION['admin_username'] = $user['username'];

    return $current = true;
}

/** Come sopra, per il portale inquilini: stessa condizione del login. */
function tenantSessionIsCurrent(): bool
{
    static $current = null;
    if ($current !== null) {
        return $current;
    }

    require_once __DIR__ . '/db.php';

    try {
        $stmt = getDB()->prepare(
            'SELECT 1 FROM tenant_users tu
             INNER JOIN tenants t ON t.id = tu.tenant_id
             WHERE tu.id = :id AND tu.tenant_id = :tenant_id AND t.status = \'active\'
             LIMIT 1'
        );
        $stmt->execute([
            'id'        => (int) $_SESSION['tenant_user_id'],
            'tenant_id' => (int) $_SESSION['tenant_id'],
        ]);
        $row = $stmt->fetch();
    } catch (Throwable $e) {
        return $current = true;
    }

    if (!$row) {
        clearSession();
        return $current = false;
    }

    return $current = true;
}

function isLoggedIn(): bool
{
    return !empty($_SESSION['admin_id']) && !empty($_SESSION['admin_username'])
        && adminSessionIsCurrent();
}

function isTenantLoggedIn(): bool
{
    return !empty($_SESSION['tenant_user_id']) && !empty($_SESSION['tenant_id'])
        && tenantSessionIsCurrent();
}

function getCurrentUsername(): string
{
    return $_SESSION['admin_username'] ?? 'Admin';
}

function getCurrentAdminId(): int
{
    return (int) ($_SESSION['admin_id'] ?? 0);
}

function getCurrentTenantId(): int
{
    return (int) ($_SESSION['tenant_id'] ?? 0);
}

function requireAuthWeb(): void
{
    if (!isLoggedIn()) {
        header('Location: login.php');
        exit;
    }
}

function requireTenantAuthWeb(): void
{
    if (!isTenantLoggedIn()) {
        // Relativa alla pagina che chiama, che sta dentro /tenant/: scrivere
        // 'tenant/login.php' mandava l'inquilino su /tenant/tenant/login.php,
        // cioe' un 404 al posto del modulo di accesso.
        header('Location: login.php');
        exit;
    }
}

function requireAuthApi(): void
{
    if (!isLoggedIn()) {
        http_response_code(401);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'success' => false,
            'error'   => 'Autenticazione richiesta.',
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

function requireTenantAuthApi(): void
{
    if (!isTenantLoggedIn()) {
        http_response_code(401);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['success' => false, 'error' => 'Autenticazione richiesta.'], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

/**
 * Verify credentials. Returns:
 *  - 'ok'    → session established
 *  - '2fa'   → credentials valid but 2FA required (pending session set)
 *  - 'fail'  → invalid credentials
 */
function attemptLoginStep(string $username, string $password): string
{
    require_once __DIR__ . '/db.php';

    $stmt = getDB()->prepare(
        'SELECT id, username, password_hash, role, is_active, totp_enabled
         FROM admin_users WHERE username = :username LIMIT 1'
    );
    $stmt->execute(['username' => $username]);
    $user = $stmt->fetch();

    if (!$user || !(int) $user['is_active'] || !password_verify($password, $user['password_hash'])) {
        return 'fail';
    }

    // Migrazione bcrypt → argon2id: qui, e solo qui, la password in chiaro esiste
    // ed e' appena stata verificata. Un fallimento non deve impedire l'accesso —
    // l'hash vecchio resta valido e si ritenta al login successivo.
    appPasswordUpgrade(
        $password,
        $user['password_hash'],
        fn(string $hash) => getDB()
            ->prepare('UPDATE admin_users SET password_hash = :hash WHERE id = :id')
            ->execute(['hash' => $hash, 'id' => (int) $user['id']])
    );

    if (!empty($user['totp_enabled'])) {
        $_SESSION['_2fa_pending'] = (int) $user['id'];
        return '2fa';
    }

    completeAdminLogin((int) $user['id'], $user['username'], $user['role'] ?? 'admin');
    return 'ok';
}

function attemptLogin(string $username, string $password): bool
{
    return attemptLoginStep($username, $password) === 'ok';
}

/**
 * Finalise the admin session (used after password and, where applicable, 2FA).
 */
function completeAdminLogin(int $id, string $username, string $role): void
{
    session_regenerate_id(true);
    unset($_SESSION['_2fa_pending']);
    $_SESSION['admin_id']       = $id;
    $_SESSION['admin_username'] = $username;
    $_SESSION['admin_role']     = $role;

    // Audit the auth event (both the direct-password and 2FA paths reach here).
    require_once __DIR__ . '/activity_log.php';
    logActivity('login', 'admin_user', $id, 'Accesso effettuato: ' . $username);
}

function attemptTenantLogin(string $email, string $password): bool
{
    require_once __DIR__ . '/db.php';

    $stmt = getDB()->prepare(
        'SELECT tu.id AS tenant_user_id, tu.password_hash, tu.tenant_id,
                t.name, t.surname, t.email, t.status
         FROM tenant_users tu
         INNER JOIN tenants t ON t.id = tu.tenant_id
         WHERE t.email = :email AND t.status = \'active\'
         LIMIT 1'
    );
    $stmt->execute(['email' => $email]);
    $row = $stmt->fetch();

    if (!$row || !password_verify($password, $row['password_hash'])) {
        return false;
    }

    appPasswordUpgrade(
        $password,
        $row['password_hash'],
        fn(string $hash) => getDB()
            ->prepare('UPDATE tenant_users SET password_hash = :hash WHERE id = :id')
            ->execute(['hash' => $hash, 'id' => (int) $row['tenant_user_id']])
    );

    session_regenerate_id(true);
    $_SESSION['tenant_user_id'] = (int) $row['tenant_user_id'];
    $_SESSION['tenant_id']      = (int) $row['tenant_id'];
    $_SESSION['tenant_name']    = $row['name'] . ' ' . $row['surname'];
    $_SESSION['tenant_email']   = $row['email'];

    getDB()->prepare('UPDATE tenant_users SET last_login_at = NOW() WHERE id = :id')
        ->execute(['id' => $row['tenant_user_id']]);

    return true;
}

/**
 * Butta via la sessione corrente e il suo cookie. Senza traccia sul registro
 * attivita': serve anche quando l'utente dietro la sessione non esiste piu', e
 * un "logout" attribuito a un id cancellato racconterebbe un'uscita mai avvenuta.
 */
function clearSession(): void
{
    $_SESSION = [];

    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }

    if (session_status() === PHP_SESSION_ACTIVE) {
        session_destroy();
    }
}

function logoutUser(): void
{
    // Audit before the session is torn down (logActivity reads the actor from it).
    if (!empty($_SESSION['admin_id'])) {
        require_once __DIR__ . '/activity_log.php';
        logActivity('logout', 'admin_user', (int) $_SESSION['admin_id'], 'Logout: ' . ($_SESSION['admin_username'] ?? ''));
    }

    clearSession();
}

function logoutTenant(): void
{
    clearSession();
}

function requireCronAuth(): void
{
    if (PHP_SAPI === 'cli') {
        return;
    }

    $secret = CRON_SECRET;
    if ($secret === '') {
        http_response_code(503);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['success' => false, 'error' => 'CRON_SECRET non configurato.']);
        exit;
    }

    $provided = $_SERVER['HTTP_X_CRON_SECRET'] ?? $_GET['secret'] ?? '';
    if (!hash_equals($secret, (string) $provided)) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['success' => false, 'error' => 'Accesso negato.']);
        exit;
    }
}

function requireJobAuth(): void
{
    if (PHP_SAPI === 'cli') {
        return;
    }

    if (isLoggedIn()) {
        if (isReadOnlyRole()) {
            http_response_code(403);
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode(['success' => false, 'error' => 'Account in sola lettura.'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        return;
    }

    requireCronAuth();
}

function createAdminUser(string $username, string $password, string $role = 'super_admin'): void
{
    require_once __DIR__ . '/db.php';

    $hash = appPasswordHash($password);
    $db   = getDB();

    $stmt = $db->prepare('SELECT id FROM admin_users WHERE username = :username');
    $stmt->execute(['username' => $username]);

    if ($stmt->fetch()) {
        $update = $db->prepare(
            'UPDATE admin_users SET password_hash = :hash, role = :role WHERE username = :username'
        );
        $update->execute(['hash' => $hash, 'role' => $role, 'username' => $username]);
        return;
    }

    $insert = $db->prepare(
        'INSERT INTO admin_users (username, password_hash, role) VALUES (:username, :hash, :role)'
    );
    $insert->execute(['username' => $username, 'hash' => $hash, 'role' => $role]);
}

function adminUserExists(): bool
{
    require_once __DIR__ . '/db.php';
    return (int) getDB()->query('SELECT COUNT(*) FROM admin_users')->fetchColumn() > 0;
}

function createTenantPortalUser(int $tenantId, string $password): void
{
    require_once __DIR__ . '/db.php';
    $hash = appPasswordHash($password);
    $db   = getDB();

    $stmt = $db->prepare('SELECT id FROM tenant_users WHERE tenant_id = :tenant_id');
    $stmt->execute(['tenant_id' => $tenantId]);

    if ($stmt->fetch()) {
        $db->prepare('UPDATE tenant_users SET password_hash = :hash WHERE tenant_id = :tenant_id')
            ->execute(['hash' => $hash, 'tenant_id' => $tenantId]);
        return;
    }

    $db->prepare('INSERT INTO tenant_users (tenant_id, password_hash) VALUES (:tenant_id, :hash)')
        ->execute(['tenant_id' => $tenantId, 'hash' => $hash]);
}
