<?php
/**
 * Meta OAuth callback — stores page token in social_settings.
 */
require_once __DIR__ . '/config/bootstrap.php';
requireAuthWeb();
require_once __DIR__ . '/config/settings.php';
require_once __DIR__ . '/config/meta.php';
require_once __DIR__ . '/config/db.php';

$code  = $_GET['code'] ?? '';
$state = $_GET['state'] ?? '';
$error = $_GET['error'] ?? '';

if ($error) {
    header('Location: index.php?meta_error=' . urlencode($error));
    exit;
}

if ($code === '' || $state === '' || empty($_SESSION['meta_oauth_state']) || !hash_equals($_SESSION['meta_oauth_state'], $state)) {
    header('Location: index.php?meta_error=invalid_state');
    exit;
}

unset($_SESSION['meta_oauth_state']);

$appId     = getSetting('meta_app_id');
$secret    = getSetting('meta_app_secret');
$redirect  = rtrim(APP_URL, '/') . '/meta_callback.php';

$tokenResp = metaApiRequest('GET', '/oauth/access_token', [
    'client_id'     => $appId,
    'client_secret' => $secret,
    'redirect_uri'  => $redirect,
    'code'          => $code,
]);

if (empty($tokenResp['access_token'])) {
    header('Location: index.php?meta_error=token_exchange_failed');
    exit;
}

$userToken = $tokenResp['access_token'];
$pages     = metaApiRequest('GET', '/me/accounts', ['access_token' => $userToken]);

$pageId    = null;
$pageToken = null;
$igId      = null;

if (!empty($pages['data'][0])) {
    $page      = $pages['data'][0];
    $pageId    = $page['id'] ?? null;
    $pageToken = $page['access_token'] ?? null;

    if ($pageId && $pageToken) {
        $ig = metaApiRequest('GET', "/{$pageId}", [
            'fields'       => 'instagram_business_account',
            'access_token' => $pageToken,
        ]);
        $igId = $ig['instagram_business_account']['id'] ?? null;
    }
}

$db = getDB();
$stmt = $db->prepare(
    "UPDATE social_settings SET
        meta_app_id = :app_id,
        meta_user_token = :user_token,
        facebook_page_id = :page_id,
        facebook_page_token = :page_token,
        instagram_account_id = :ig_id,
        oauth_connected_at = NOW(),
        token_expires_at = DATE_ADD(NOW(), INTERVAL 60 DAY)
     WHERE id = 1"
);
$stmt->execute([
    'app_id'     => $appId,
    'user_token' => $userToken,
    'page_id'    => $pageId,
    'page_token' => $pageToken,
    'ig_id'      => $igId,
]);

header('Location: index.php?view=social&meta_connected=1');
exit;
