<?php
/**
 * Meta Graph API helper — Phase 7.
 * Facebook Page + Instagram Business publishing. Set tokens in Social settings.
 *
 * Public entry points: getSocialSettings(), publishSocialPost(), processDueSocialPosts().
 * Implementation split: meta/publishers.php (platform calls), meta/scheduler.php (cron+alerts).
 */

define('META_API_VERSION', 'v19.0');
define('META_GRAPH_BASE', 'https://graph.facebook.com/' . META_API_VERSION);

const SOCIAL_PLATFORMS = ['facebook', 'instagram', 'both'];
const SOCIAL_STATUSES  = ['draft', 'scheduled', 'published', 'failed'];

require_once __DIR__ . '/meta/publishers.php';
require_once __DIR__ . '/meta/scheduler.php';

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

    // Optional: post['image_paths'] = array of relative paths → multi-photo (FB) / carousel (IG).
    $imagePaths = $post['image_paths'] ?? null;
    $imagePaths = is_array($imagePaths) ? array_values(array_filter($imagePaths)) : null;
    $multi      = is_array($imagePaths) && count($imagePaths) > 1;
    $singlePath = $imagePath ?: ($imagePaths[0] ?? null);

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
        $result = $multi
            ? publishToFacebookPageMulti($pageId, $token, $caption, $imagePaths)
            : publishToFacebookPage($pageId, $token, $caption, $singlePath);
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
            $result = $multi
                ? publishToInstagramCarousel($igId, $token, $caption, $imagePaths)
                : publishToInstagram($igId, $token, $caption, $singlePath);
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
