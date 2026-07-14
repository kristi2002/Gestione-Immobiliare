<?php
/**
 * Current session identity — bootstrap endpoint for the React SPA.
 *
 * GET /api/me.php
 *   200 → { success:true, data:{ user, role, permissions, csrf_token } }
 *   401 → { success:false, error:"Autenticazione richiesta." }  (via requireAuthApi)
 *
 * The SPA calls this on load: a 401 means "not logged in" (redirect to login),
 * a 200 hydrates the auth store and hands React the CSRF token to attach to
 * every mutating request as the X-CSRF-TOKEN header.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();
apiRequireMethod('GET');

$role    = getCurrentRole();
$allowed = ROLE_PERMISSIONS[$role] ?? [];

apiSuccess([
    'user' => [
        'id'       => getCurrentAdminId(),
        'username' => getCurrentUsername(),
        'role'     => $role,
    ],
    // '*' for super_admin, otherwise the explicit list of view keys the role may see.
    'permissions' => array_values($allowed),
    'csrf_token'  => getCsrfToken(),
]);
