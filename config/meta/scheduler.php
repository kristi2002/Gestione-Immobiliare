<?php
/**
 * Meta Graph API — scheduled-post processing and token-expiry email alerts.
 * Included by config/meta.php.
 */

/**
 * Process all scheduled posts that are due.
 */
function processDueSocialPosts(PDO $db): array
{
    $stmt = $db->prepare(
        "SELECT * FROM social_posts
         WHERE status = 'scheduled' AND scheduled_at <= NOW()
         ORDER BY scheduled_at ASC"
    );
    $stmt->execute();
    $due = $stmt->fetchAll();

    $results = [];
    foreach ($due as $post) {
        $results[] = publishAndUpdatePost($db, $post);
    }

    return ['processed' => count($results), 'results' => $results];
}

function publishAndUpdatePost(PDO $db, array $post): array
{
    $result = publishSocialPost($db, $post);

    if ($result['success']) {
        $update = $db->prepare(
            "UPDATE social_posts
             SET status = 'published', published_at = NOW(),
                 facebook_post_id = :fb_id, instagram_media_id = :ig_id,
                 error_message = NULL
             WHERE id = :id"
        );
        $update->execute([
            'id'    => $post['id'],
            'fb_id' => $result['facebook_post_id'],
            'ig_id' => $result['instagram_media_id'],
        ]);

        return [
            'id'        => $post['id'],
            'status'    => 'published',
            'simulated' => $result['simulated'],
        ];
    }

    $update = $db->prepare(
        "UPDATE social_posts SET status = 'failed', error_message = :error WHERE id = :id"
    );
    $update->execute(['id' => $post['id'], 'error' => $result['error']]);

    // ── Token expiry alert ───────────────────────────────────────────────────
    if (!empty($result['error']) && isMetaTokenExpiredError($result['error'])) {
        sendMetaTokenExpiryAlert($db, $result['error']);
    }

    return [
        'id'     => $post['id'],
        'status' => 'failed',
        'error'  => $result['error'],
    ];
}

/**
 * Detect Meta token expiry / invalid-token errors from the API response.
 * Meta returns error.code = 190 for OAuth token problems.
 */
function isMetaTokenExpiredError(string $error): bool
{
    $tokenKeywords = [
        'error code 190',
        'invalid oauth',
        'session has expired',
        'token has expired',
        'access token',
        'oauth',
        'login',
        'relogin',
        'invalid_token',
        'token expired',
    ];
    $lower = strtolower($error);
    foreach ($tokenKeywords as $kw) {
        if (str_contains($lower, $kw)) {
            return true;
        }
    }
    return false;
}

/**
 * Email the admin once per 24 h when Meta token errors are detected.
 * Uses the settings table key `meta_token_alert_last_sent` to rate-limit.
 */
function sendMetaTokenExpiryAlert(PDO $db, string $errorDetail): void
{
    // Rate-limit: send at most once every 24 hours
    try {
        $row = $db->query(
            "SELECT value FROM settings WHERE key_name = 'meta_token_alert_last_sent' LIMIT 1"
        )->fetch();

        if ($row && !empty($row['value'])) {
            $lastSent = strtotime($row['value']);
            if ($lastSent !== false && (time() - $lastSent) < 86400) {
                return; // Already alerted within last 24 h
            }
        }
    } catch (Throwable) {
        // settings table check failed — proceed anyway
    }

    // Only send if mail is available
    if (!function_exists('sendHtmlEmail') || !function_exists('getSetting')) {
        error_log('[meta] Token expiry detected but mail not available. Error: ' . $errorDetail);
        return;
    }

    $agencyName   = getSetting('agency_name', 'Gestionale Immobiliare');
    $adminEmail   = getSetting('admin_email') ?: getSetting('agency_email', '');
    $appUrl       = defined('APP_URL') ? APP_URL : '';

    if (!$adminEmail) {
        error_log('[meta] Token expiry detected but no admin_email configured.');
        return;
    }

    $subject = "⚠️ {$agencyName} — Token Meta scaduto, ri-connessione necessaria";
    $body    = "Gentile amministratore,\n\n"
             . "La pubblicazione automatica sui social ({$agencyName}) ha rilevato un errore di autenticazione "
             . "con le API di Meta (Facebook / Instagram):\n\n"
             . "  {$errorDetail}\n\n"
             . "Questo accade quando il token Meta è scaduto o è stato revocato.\n\n"
             . "Cosa fare:\n"
             . "1. Accedi al gestionale: {$appUrl}\n"
             . "2. Vai su Social Media → Impostazioni\n"
             . "3. Clicca «Connetti con Facebook» per rinnovare il token\n\n"
             . "Fino alla ri-connessione i post programmati falliranno.\n\n"
             . "— Sistema automatico {$agencyName}";

    sendHtmlEmail($adminEmail, $subject, $body);

    // Record timestamp so we don't spam
    try {
        $db->prepare(
            "INSERT INTO settings (key_name, value) VALUES ('meta_token_alert_last_sent', NOW())
             ON DUPLICATE KEY UPDATE value = NOW()"
        )->execute();
    } catch (Throwable) {
        // Ignore — alert was still sent
    }
}
