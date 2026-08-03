<?php
/**
 * Start Meta OAuth flow for Facebook Page + Instagram.
 */
require_once __DIR__ . '/config/bootstrap.php';
requireAuthWeb();
require_once __DIR__ . '/config/settings.php';
require_once __DIR__ . '/config/meta.php';

if (!canAccessView('social')) {
    http_response_code(403);
    exit('Accesso negato.');
}

$appId  = getSetting('meta_app_id');
$secret = getSetting('meta_app_secret');

if (!$appId || !$secret) {
    header('Location: index.php?meta_error=missing_app_credentials');
    exit;
}

$redirectUri = rtrim(APP_URL, '/') . '/meta_callback.php';
$scope = implode(',', [
    'pages_show_list',
    'pages_manage_posts',
    'pages_read_engagement',
    'instagram_basic',
    'instagram_content_publish',
    'business_management',
]);

$state = bin2hex(random_bytes(16));
$_SESSION['meta_oauth_state'] = $state;

$url = 'https://www.facebook.com/' . META_API_VERSION . '/dialog/oauth?' . http_build_query([
    'client_id'     => $appId,
    'redirect_uri'  => $redirectUri,
    'state'         => $state,
    'scope'         => $scope,
    'response_type' => 'code',
]);

header('Location: ' . $url);
exit;
