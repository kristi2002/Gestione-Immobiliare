<?php
/**
 * Meta Graph API — platform publishers (Facebook/Instagram, single & multi/carousel)
 * and the low-level Graph transport. Included by config/meta.php.
 */

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
 * Publish a multi-photo post to a Facebook Page (all images in one post).
 * Uploads each photo unpublished, then creates a feed story with attached_media.
 */
function publishToFacebookPageMulti(string $pageId, string $token, string $message, array $imagePaths): array
{
    $mediaFbids = [];
    foreach ($imagePaths as $rel) {
        $full = realpath(__DIR__ . '/../' . $rel);
        if (!$full || !file_exists($full)) {
            continue;
        }
        $up = metaApiRequest('POST', "/{$pageId}/photos", [
            'published'    => 'false',
            'access_token' => $token,
            'source'       => new CURLFile($full),
        ], true);
        if (!empty($up['id'])) {
            $mediaFbids[] = $up['id'];
        }
    }

    if (empty($mediaFbids)) {
        return ['success' => false, 'post_id' => null, 'error' => 'Nessuna immagine valida da pubblicare.'];
    }

    $params = ['message' => $message, 'access_token' => $token];
    foreach ($mediaFbids as $i => $fbid) {
        $params["attached_media[$i]"] = json_encode(['media_fbid' => $fbid]);
    }

    $response = metaApiRequest('POST', "/{$pageId}/feed", $params);
    if ($response['success']) {
        return ['success' => true, 'post_id' => $response['id'] ?? null, 'error' => null];
    }
    return ['success' => false, 'post_id' => null, 'error' => $response['error'] ?? 'Errore Facebook (multi-foto)'];
}

/**
 * Publish an Instagram carousel (2–10 images) for a Business account.
 * Creates an item container per image, a CAROUSEL container, then publishes.
 */
function publishToInstagramCarousel(string $igAccountId, string $token, string $caption, array $imagePaths): array
{
    $publicBase = getenv('META_PUBLIC_BASE_URL') ?: '';
    if ($publicBase === '') {
        return ['success' => false, 'media_id' => null, 'error' => 'Configura META_PUBLIC_BASE_URL per pubblicare su Instagram.'];
    }

    $childIds = [];
    foreach (array_slice($imagePaths, 0, 10) as $rel) {
        $full = realpath(__DIR__ . '/../' . $rel);
        if (!$full || !file_exists($full)) {
            continue;
        }
        $imageUrl = rtrim($publicBase, '/') . '/' . ltrim($rel, '/');
        $c = metaApiRequest('POST', "/{$igAccountId}/media", [
            'image_url'        => $imageUrl,
            'is_carousel_item' => 'true',
            'access_token'     => $token,
        ]);
        if (!empty($c['id'])) {
            $childIds[] = $c['id'];
        }
    }

    if (count($childIds) < 2) {
        return ['success' => false, 'media_id' => null, 'error' => 'Carosello Instagram richiede almeno 2 immagini valide.'];
    }

    $carousel = metaApiRequest('POST', "/{$igAccountId}/media", [
        'media_type'   => 'CAROUSEL',
        'children'     => implode(',', $childIds),
        'caption'      => $caption,
        'access_token' => $token,
    ]);
    if (empty($carousel['id'])) {
        return ['success' => false, 'media_id' => null, 'error' => $carousel['error'] ?? 'Creazione carosello IG fallita'];
    }

    $publish = metaApiRequest('POST', "/{$igAccountId}/media_publish", [
        'creation_id'  => $carousel['id'],
        'access_token' => $token,
    ]);
    if ($publish['success']) {
        return ['success' => true, 'media_id' => $publish['id'] ?? $carousel['id'], 'error' => null];
    }
    return ['success' => false, 'media_id' => null, 'error' => $publish['error'] ?? 'Pubblicazione carosello IG fallita'];
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
        $errData = $data['error'] ?? [];
        $msg     = $errData['message'] ?? "HTTP {$httpCode}";
        // Include numeric error code so token-expiry detection can match on "error code 190"
        if (!empty($errData['code'])) {
            $msg = "Error code {$errData['code']}: {$msg}";
        }
        return ['success' => false, 'error' => $msg];
    }

    $data['success'] = true;
    return $data;
}
