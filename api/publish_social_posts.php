<?php
/**
 * Process due scheduled social posts.
 * POST /api/publish_social_posts.php
 */

require_once __DIR__ . '/../config/cron_bootstrap.php';
require_once __DIR__ . '/../config/meta.php';

apiHandleOptions();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    apiError('Metodo non consentito. Usa POST.', 405);
}

try {
    $result = processDueSocialPosts(getDB());
    apiSuccess($result);
} catch (PDOException $e) {
    apiError('Errore durante la pubblicazione.', 500);
}
