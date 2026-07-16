<?php
/**
 * JSON 2FA verification endpoint for the React SPA — the second step after
 * POST /api/login.php returns { status: 'requires_2fa' }.
 *
 * POST /api/login_2fa.php  { code }
 *   200 → { success:true, data:{ status:'ok', user, permissions, csrf_token } }
 *   400 → no pending 2FA challenge on this session
 *   401 → { success:false, error:"Codice non valido." }
 *   423 → { success:false, error:"Troppi tentativi falliti..." }
 *
 * Deliberately does NOT use api_bootstrap.php — the caller isn't fully
 * authenticated yet, only a pending 2FA challenge exists in the session
 * (set by attemptLoginStep() in api/login.php). Mirrors login_2fa.php's
 * POST branch exactly, just as JSON instead of a redirect.
 */

require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/api_helpers.php';
require_once __DIR__ . '/../config/login_throttle.php';
require_once __DIR__ . '/../config/totp.php';

apiHandleOptions();
apiRequireMethod('POST');

$pendingId = (int) ($_SESSION['_2fa_pending'] ?? 0);
if ($pendingId <= 0) {
    apiError('Nessuna verifica in sospeso. Accedi di nuovo.', 400);
}

if (isLoginLocked()) {
    apiError(loginLockoutMessage(), 423);
}

$body = apiGetJsonBody();
$code = trim((string) ($body['code'] ?? ''));

if ($code === '') {
    apiError('Inserisci il codice.', 400);
}

$stmt = getDB()->prepare(
    'SELECT id, username, role, totp_secret, totp_backup_codes
     FROM admin_users WHERE id = :id AND is_active = 1 LIMIT 1'
);
$stmt->execute(['id' => $pendingId]);
$user = $stmt->fetch();

if (!$user) {
    unset($_SESSION['_2fa_pending']);
    apiError('Sessione scaduta. Accedi di nuovo.', 400);
}

$verified = verifyTotpCode($user['totp_secret'] ?? '', $code);

if (!$verified) {
    $codes = json_decode($user['totp_backup_codes'] ?? '[]', true);
    if (is_array($codes)) {
        $hash = hashBackupCode($code);
        $idx  = array_search($hash, $codes, true);
        if ($idx !== false) {
            unset($codes[$idx]);
            getDB()->prepare('UPDATE admin_users SET totp_backup_codes = :codes WHERE id = :id')
                ->execute(['codes' => json_encode(array_values($codes)), 'id' => $user['id']]);
            $verified = true;
        }
    }
}

if (!$verified) {
    recordLoginAttempt(false);
    apiError('Codice non valido.', 401);
}

recordLoginAttempt(true);
completeAdminLogin((int) $user['id'], $user['username'], $user['role'] ?? 'admin');

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
