<?php
/**
 * Cron — publish scheduled social posts.
 *
 * Example crontab (every 10 minutes):
 *   0,10,20,30,40,50 * * * * php /path/to/cron/publish_social_posts.php
 */

require_once __DIR__ . '/../config/env.php';
loadEnv(dirname(__DIR__) . '/.env');
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/meta.php';

$result = processDueSocialPosts(getDB());
require_once __DIR__ . '/../config/heartbeat.php';
cronHeartbeat('social_posts');
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
