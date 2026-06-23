<?php
/**
 * API rate limiting — simple DB-backed sliding-window counter.
 *
 * Uses the `api_rate_limits` table which is created on first use.
 * Identify callers by IP + optional user ID so admin users still get
 * a per-user bucket rather than sharing one IP bucket with colleagues.
 *
 * Usage:
 *   require_once __DIR__ . '/../config/rate_limit.php';
 *   checkRateLimit('whatsapp_send', 10, 60);  // 10 requests per 60 s
 */

/**
 * Check and record a rate-limit hit for the current caller.
 *
 * @param  string $endpoint     Logical name (e.g. 'whatsapp_send')
 * @param  int    $maxRequests  Allowed requests in the window
 * @param  int    $windowSecs   Window size in seconds
 * @param  bool   $adminBypass  When true, skip limit for admin/super_admin roles
 */
function checkRateLimit(
    string $endpoint,
    int    $maxRequests = 30,
    int    $windowSecs  = 60,
    bool   $adminBypass = true
): void {
    // Super-admins can be exempted
    if ($adminBypass && function_exists('getCurrentUser')) {
        $user = getCurrentUser();
        if (in_array($user['role'] ?? '', ['admin', 'super_admin'], true)) {
            return;
        }
    }

    $db  = getDB();
    $ip  = getRateLimitIp();
    $uid = getRateLimitUserId();

    initRateLimitTable($db);

    // Prune old rows for this bucket (keep table small)
    $db->prepare(
        "DELETE FROM api_rate_limits
         WHERE endpoint = :ep AND ip_address = :ip AND user_id <=> :uid
           AND requested_at < DATE_SUB(NOW(), INTERVAL :win SECOND)"
    )->execute([
        'ep'  => $endpoint,
        'ip'  => $ip,
        'uid' => $uid,
        'win' => $windowSecs,
    ]);

    // Count remaining hits in current window
    $countStmt = $db->prepare(
        "SELECT COUNT(*) FROM api_rate_limits
         WHERE endpoint = :ep AND ip_address = :ip AND user_id <=> :uid
           AND requested_at >= DATE_SUB(NOW(), INTERVAL :win SECOND)"
    );
    $countStmt->execute([
        'ep'  => $endpoint,
        'ip'  => $ip,
        'uid' => $uid,
        'win' => $windowSecs,
    ]);
    $count = (int) $countStmt->fetchColumn();

    if ($count >= $maxRequests) {
        if (function_exists('apiError')) {
            apiError(
                "Troppe richieste. Massimo {$maxRequests} per {$windowSecs}s. Riprova tra poco.",
                429
            );
        } else {
            http_response_code(429);
            header('Content-Type: application/json; charset=utf-8');
            header('Retry-After: ' . $windowSecs);
            echo json_encode([
                'success' => false,
                'error'   => "Troppe richieste. Massimo {$maxRequests} per {$windowSecs}s.",
            ]);
            exit;
        }
    }

    // Record this hit
    $db->prepare(
        "INSERT INTO api_rate_limits (endpoint, ip_address, user_id, requested_at)
         VALUES (:ep, :ip, :uid, NOW())"
    )->execute([
        'ep'  => $endpoint,
        'ip'  => $ip,
        'uid' => $uid,
    ]);
}

/**
 * Lazily create the api_rate_limits table if it does not exist yet.
 * This avoids a migration step — table is self-provisioned on first request.
 */
function initRateLimitTable(PDO $db): void
{
    static $initialised = false;
    if ($initialised) {
        return;
    }

    $db->exec("
        CREATE TABLE IF NOT EXISTS api_rate_limits (
            id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            endpoint     VARCHAR(100)    NOT NULL,
            ip_address   VARCHAR(45)     NOT NULL,
            user_id      INT UNSIGNED        NULL,
            requested_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_rl_lookup (endpoint, ip_address, user_id, requested_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $initialised = true;
}

/** Return caller IP, respecting Cloudflare / proxy headers. */
function getRateLimitIp(): string
{
    // Cloudflare sets CF-Connecting-IP; behind Traefik X-Forwarded-For works too.
    foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR'] as $key) {
        $val = $_SERVER[$key] ?? '';
        if ($val !== '') {
            return trim(explode(',', $val)[0]);
        }
    }
    return '0.0.0.0';
}

/** Return the logged-in user ID or NULL for unauthenticated callers. */
function getRateLimitUserId(): ?int
{
    if (function_exists('getCurrentUser')) {
        $u = getCurrentUser();
        return isset($u['id']) ? (int) $u['id'] : null;
    }
    return null;
}
