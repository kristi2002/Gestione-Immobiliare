<?php
/**
 * Portale Inquilino — modifiche al proprio account.
 *
 * POST { action: 'password', current, next, confirm }
 * POST { action: 'contact',  phone }
 *
 * L'EMAIL NON SI CAMBIA DA QUI, di proposito: e' l'identificativo con cui si
 * entra (attemptTenantLogin cerca su `tenants.email`, colonna UNIQUE). Lasciarla
 * modificare da una sessione vorrebbe dire che una sessione rubata puo'
 * spostare l'accesso su una casella dell'attaccante e chiudere fuori
 * l'inquilino vero. Si cambia dall'agenzia.
 */

require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/csrf.php';
require_once __DIR__ . '/../config/rate_limit.php';
require_once __DIR__ . '/../lib/password_reset.php';   // per PASSWORD_MIN_LENGTH

initTenantSession();

header('Content-Type: application/json; charset=utf-8');

function accOut(bool $ok, $payload, int $code = 200): never
{
    http_response_code($code);
    exit(json_encode($ok ? ['success' => true, 'data' => $payload]
                         : ['success' => false, 'error' => $payload]));
}

if (!isTenantLoggedIn()) {
    accOut(false, 'Non autorizzato.', 401);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    accOut(false, 'Metodo non consentito.', 405);
}

$raw    = file_get_contents('php://input');
$body   = json_decode($raw, true) ?: [];
$sent   = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($body['csrf_token'] ?? '');
if ($sent === '' || !hash_equals(getCsrfToken(), (string) $sent)) {
    accOut(false, 'Token CSRF non valido.', 403);
}

$tenantId = getCurrentTenantId();
$db       = getDB();
$action   = (string) ($body['action'] ?? '');

// ─────────────────────────────────────────────────────────────────────────────
if ($action === 'password') {
    // Provare password a raffica contro la propria sessione e' comunque un
    // modo per indovinare la vecchia password (per esempio su un computer
    // lasciato aperto). Il tetto vale per tutti: qui non ci sono admin.
    checkRateLimit('tenant_password_change', 10, 900);

    $current = (string) ($body['current'] ?? '');
    $next    = (string) ($body['next'] ?? '');
    $confirm = (string) ($body['confirm'] ?? '');

    if ($current === '' || $next === '') {
        accOut(false, 'Compila tutti i campi.', 400);
    }
    if ($next !== $confirm) {
        accOut(false, 'Le due nuove password non coincidono.', 400);
    }
    if (strlen($next) < PASSWORD_MIN_LENGTH) {
        accOut(false, 'La nuova password deve contenere almeno ' . PASSWORD_MIN_LENGTH . ' caratteri.', 400);
    }
    if ($next === $current) {
        accOut(false, 'La nuova password e\' uguale a quella attuale.', 400);
    }

    $stmt = $db->prepare('SELECT id, password_hash FROM tenant_users WHERE tenant_id = :t LIMIT 1');
    $stmt->execute(['t' => $tenantId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row || !password_verify($current, $row['password_hash'])) {
        accOut(false, 'La password attuale non e\' corretta.', 403);
    }

    $db->prepare('UPDATE tenant_users SET password_hash = :h WHERE id = :id')
       ->execute(['h' => password_hash($next, PASSWORD_DEFAULT), 'id' => $row['id']]);

    // Ogni link di reset ancora in giro va spento: se la password e' appena
    // cambiata, un vecchio link nella casella email e' una seconda chiave.
    $db->prepare(
        "UPDATE password_resets SET invalidated_at = NOW()
         WHERE tenant_id = :t AND used_at IS NULL AND invalidated_at IS NULL"
    )->execute(['t' => $tenantId]);

    accOut(true, ['message' => 'Password aggiornata.']);
}

// ─────────────────────────────────────────────────────────────────────────────
if ($action === 'contact') {
    checkRateLimit('tenant_contact_update', 20, 900);

    $phone = trim((string) ($body['phone'] ?? ''));

    // Vuoto e' legittimo: vuol dire "non ho un numero da darvi".
    if ($phone !== '') {
        $normalized = preg_replace('/[^\d+]/', '', $phone);
        if (strlen((string) $normalized) < 6 || strlen($phone) > 30) {
            accOut(false, 'Numero di telefono non valido.', 400);
        }
        $phone = $normalized;
    }

    $db->prepare('UPDATE tenants SET phone = :p WHERE id = :id')
       ->execute(['p' => $phone !== '' ? $phone : null, 'id' => $tenantId]);

    accOut(true, ['message' => 'Recapito aggiornato.', 'phone' => $phone]);
}

accOut(false, 'Azione non riconosciuta.', 400);
