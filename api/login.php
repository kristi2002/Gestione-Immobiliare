<?php
/**
 * JSON login endpoint for the React SPA.
 *
 * POST /api/login.php  { username, password }
 *   200 → { success:true, data:{ status:'ok', user, permissions, csrf_token } }
 *   200 → { success:true, data:{ status:'requires_2fa' } }
 *   401 → { success:false, error:"Credenziali non valide." }
 *   423 → { success:false, error:"Troppi tentativi falliti..." }
 *
 * Deliberately does NOT use api_bootstrap.php: that enforces an existing
 * admin session before running, but the caller here has no session yet.
 * Reuses the same attemptLoginStep()/completeAdminLogin() the legacy
 * login.php form posts to, so behavior (rate limiting, 2FA branching,
 * session cookie) is identical — this is just a JSON wrapper.
 */

require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/api_helpers.php';
require_once __DIR__ . '/../config/login_throttle.php';

apiHandleOptions();
apiRequireMethod('POST');

if (isLoginLocked()) {
    apiError(loginLockoutMessage(), 423);
}

$body     = apiGetJsonBody();
$username = trim((string) ($body['username'] ?? ''));
$password = (string) ($body['password'] ?? '');

if ($username === '' || $password === '') {
    apiError('Inserisci username e password.', 400);
}

$step = attemptLoginStep($username, $password);

if ($step === 'ok') {
    recordLoginAttempt(true);
    $role    = getCurrentRole();
    $allowed = ROLE_PERMISSIONS[$role] ?? [];
    apiSuccess([
        'status' => 'ok',
        'user' => [
            'id'       => getCurrentAdminId(),
            'username' => getCurrentUsername(),
            'role'     => $role,
        ],
        'permissions' => array_values($allowed),
        'csrf_token'  => getCsrfToken(),
    ]);
}

if ($step === '2fa') {
    recordLoginAttempt(true);
    apiSuccess(['status' => 'requires_2fa']);
}

recordLoginAttempt(false);
apiError('Credenziali non valide.', 401);
