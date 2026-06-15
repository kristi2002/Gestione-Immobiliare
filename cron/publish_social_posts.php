<?php
/**
 * Cron — publish scheduled social posts.
 *
 * Example crontab (every 10 minutes):
 * */10 * * * * php /path/to/cron/publish_social_posts.php
 */

require_once __DIR__ . '/../config/env.php';
loadEnv(dirname(__DIR__) . '/.env');
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/meta.php';

$result = processDueSocialPosts(getDB());
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
