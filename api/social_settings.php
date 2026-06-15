<?php
/**
 * Social settings API — Meta connection configuration.
 *
 * GET  /api/social_settings.php  — get settings (tokens masked)
 * PUT  /api/social_settings.php  — update settings
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/meta.php';

apiHandleOptions();

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];

    if ($method === 'GET') {
        apiSuccess(publicSocialSettings(getSocialSettings($db)));
    } elseif ($method === 'PUT') {
        updateSettings($db);
    } else {
        apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

function updateSettings(PDO $db): void
{
    $data     = apiGetJsonBody();
    $existing = getSocialSettings($db);

    $appId     = trim($data['meta_app_id'] ?? '') ?: null;
    $pageId    = trim($data['facebook_page_id'] ?? '') ?: null;
    $token     = trim($data['facebook_page_token'] ?? '');
    $igId      = trim($data['instagram_account_id'] ?? '') ?: null;
    $expiresAt = trim($data['token_expires_at'] ?? '') ?: null;

    // Keep existing token if masked placeholder sent back
    if ($token === '' || strncmp($token, '••••', 4) === 0) {
        $token = $existing['facebook_page_token'] ?? null;
    }

    $stmt = $db->prepare(
        "UPDATE social_settings SET
            meta_app_id = :meta_app_id,
            facebook_page_id = :facebook_page_id,
            facebook_page_token = :facebook_page_token,
            instagram_account_id = :instagram_account_id,
            token_expires_at = :token_expires_at
         WHERE id = 1"
    );
    $stmt->execute([
        'meta_app_id'          => $appId,
        'facebook_page_id'     => $pageId,
        'facebook_page_token'  => $token,
        'instagram_account_id' => $igId,
        'token_expires_at'     => $expiresAt,
    ]);

    apiSuccess(publicSocialSettings(getSocialSettings($db)));
}
