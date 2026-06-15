<?php
/**
 * Meta Graph API helper — Phase 7.
 * Prepared for Facebook Page + Instagram Business publishing.
 * Set tokens in Social Media settings to enable live publishing.
 */

define('META_API_VERSION', 'v19.0');
define('META_GRAPH_BASE', 'https://graph.facebook.com/' . META_API_VERSION);

const SOCIAL_PLATFORMS = ['facebook', 'instagram', 'both'];
const SOCIAL_STATUSES  = ['draft', 'scheduled', 'published', 'failed'];

/**
 * Load social settings row (singleton id=1).
 */
function getSocialSettings(PDO $db): array
{
    $stmt = $db->query('SELECT * FROM social_settings WHERE id = 1');
    $row  = $stmt->fetch();

    if (!$row) {
        $db->exec('INSERT INTO social_settings (id) VALUES (1)');
        $stmt = $db->query('SELECT * FROM social_settings WHERE id = 1');
        $row  = $stmt->fetch();
    }

    return $row ?: [];
}

/**
 * Whether Meta credentials are sufficient for live API calls.
 */
function isMetaConfigured(array $settings): bool
{
    return !empty($settings['facebook_page_id'])
        && !empty($settings['facebook_page_token']);
}

/**
 * Mask a token for API responses.
 */
function maskToken(?string $token): ?string
{
    if (!$token || strlen($token) < 8) {
        return $token ? '••••••••' : null;
    }
    return '••••••••' . substr($token, -4);
}

/**
 * Public settings payload (tokens masked).
 */
function publicSocialSettings(array $settings): array
{
    return [
        'meta_app_id'          => $settings['meta_app_id'] ?? null,
        'facebook_page_id'     => $settings['facebook_page_id'] ?? null,
        'facebook_page_token'  => maskToken($settings['facebook_page_token'] ?? null),
        'instagram_account_id' => $settings['instagram_account_id'] ?? null,
        'token_expires_at'     => $settings['token_expires_at'] ?? null,
        'is_connected'         => isMetaConfigured($settings),
        'has_instagram'        => !empty($settings['instagram_account_id']),
        'updated_at'           => $settings['updated_at'] ?? null,
    ];
}

/**
 * Publish a social post to Meta platforms.
 *
 * @return array{success: bool, facebook_post_id: ?string, instagram_media_id: ?string, simulated: bool, error: ?string}
 */
function publishSocialPost(PDO $db, array $post): array
{
    $settings = getSocialSettings($db);
    $caption  = $post['caption'];
    $platform = $post['platform'];
    $imagePath = $post['image_path'] ?? null;

    if (!isMetaConfigured($settings)) {
        return [
            'success'             => true,
            'facebook_post_id'    => 'sim-fb-' . uniqid(),
            'instagram_media_id'  => in_array($platform, ['instagram', 'both'], true)
                ? 'sim-ig-' . uniqid() : null,
            'simulated'           => true,
            'error'               => null,
        ];
    }

    $token  = $settings['facebook_page_token'];
    $pageId = $settings['facebook_page_id'];
    $igId   = $settings['instagram_account_id'] ?? null;

    $fbPostId = null;
    $igMediaId = null;
    $errors   = [];

    if (in_array($platform, ['facebook', 'both'], true)) {
        $result = publishToFacebookPage($pageId, $token, $caption, $imagePath);
        if ($result['success']) {
            $fbPostId = $result['post_id'];
        } else {
            $errors[] = 'Facebook: ' . $result['error'];
        }
    }

    if (in_array($platform, ['instagram', 'both'], true)) {
        if (!$igId) {
            $errors[] = 'Instagram: account ID non configurato.';
        } else {
            $result = publishToInstagram($igId, $token, $caption, $imagePath);
            if ($result['success']) {
                $igMediaId = $result['media_id'];
            } else {
                $errors[] = 'Instagram: ' . $result['error'];
            }
        }
    }

    $success = empty($errors) || ($fbPostId || $igMediaId);

    return [
        'success'            => $success,
        'facebook_post_id'   => $fbPostId,
        'instagram_media_id' => $igMediaId,
        'simulated'          => false,
        'error'              => $success ? null : implode(' ', $errors),
    ];
}

/**
 * Publish text/photo post to a Facebook Page.
 */
function publishToFacebookPage(string $pageId, string $token, string $message, ?string $imagePath): array
{
    if ($imagePath && file_exists(__DIR__ . '/../' . $imagePath)) {
        return metaApiRequest('POST', "/{$pageId}/photos", [
            'message'      => $message,
            'access_token' => $token,
            'source'       => new CURLFile(realpath(__DIR__ . '/../' . $imagePath)),
        ], true);
    }

    $response = metaApiRequest('POST', "/{$pageId}/feed", [
        'message'      => $message,
        'access_token' => $token,
    ]);

    if ($response['success']) {
        return ['success' => true, 'post_id' => $response['id'] ?? null, 'error' => null];
    }

    return ['success' => false, 'post_id' => null, 'error' => $response['error'] ?? 'Errore Facebook'];
}

/**
 * Publish photo post to Instagram Business account (two-step container flow).
 */
function publishToInstagram(string $igAccountId, string $token, string $caption, ?string $imagePath): array
{
    if (!$imagePath) {
        return ['success' => false, 'media_id' => null, 'error' => 'Instagram richiede un\'immagine.'];
    }

    $fullPath = realpath(__DIR__ . '/../' . $imagePath);
    if (!$fullPath || !file_exists($fullPath)) {
        return ['success' => false, 'media_id' => null, 'error' => 'Immagine non trovata.'];
    }

    // Instagram Graph API requires a public image URL.
    // For local dev, use META_PUBLIC_BASE_URL if images are served publicly.
    $publicBase = getenv('META_PUBLIC_BASE_URL') ?: '';
    if ($publicBase === '') {
        return [
            'success'  => false,
            'media_id' => null,
            'error'    => 'Configura META_PUBLIC_BASE_URL per pubblicare su Instagram (URL pubblico dell\'immagine).',
        ];
    }

    $imageUrl = rtrim($publicBase, '/') . '/' . ltrim($imagePath, '/');

    $container = metaApiRequest('POST', "/{$igAccountId}/media", [
        'image_url'    => $imageUrl,
        'caption'      => $caption,
        'access_token' => $token,
    ]);

    if (!$container['success'] || empty($container['id'])) {
        return ['success' => false, 'media_id' => null, 'error' => $container['error'] ?? 'Creazione container IG fallita'];
    }

    $publish = metaApiRequest('POST', "/{$igAccountId}/media_publish", [
        'creation_id'  => $container['id'],
        'access_token' => $token,
    ]);

    if ($publish['success']) {
        return ['success' => true, 'media_id' => $publish['id'] ?? $container['id'], 'error' => null];
    }

    return ['success' => false, 'media_id' => null, 'error' => $publish['error'] ?? 'Pubblicazione IG fallita'];
}

/**
 * Low-level Meta Graph API request.
 */
function metaApiRequest(string $method, string $endpoint, array $params = [], bool $multipart = false): array
{
    $url = META_GRAPH_BASE . $endpoint;

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);

    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $params);
        if ($multipart) {
            curl_setopt($ch, CURLOPT_HTTPHEADER, []);
        }
    } else {
        $url .= '?' . http_build_query($params);
    }

    curl_setopt($ch, CURLOPT_URL, $url);

    $raw      = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($raw === false) {
        return ['success' => false, 'error' => 'Connessione Meta API fallita.'];
    }

    $data = json_decode($raw, true);

    if ($httpCode >= 400 || isset($data['error'])) {
        $msg = $data['error']['message'] ?? "HTTP {$httpCode}";
        return ['success' => false, 'error' => $msg];
    }

    $data['success'] = true;
    return $data;
}

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

    return [
        'id'     => $post['id'],
        'status' => 'failed',
        'error'  => $result['error'],
    ];
}
