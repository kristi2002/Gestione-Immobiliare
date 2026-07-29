<?php
/**
 * Hard stop for scripts that must never answer an HTTP request.
 *
 * The root .htaccess blocks scripts/, cron/ and database/ — but only inside
 * <IfModule mod_rewrite.c>, and only on a host that reads .htaccess at all. A
 * deploy onto nginx, or an Apache built without mod_rewrite, silently turns
 * every maintenance script into a public endpoint. scripts/db_check.php in that
 * state answers an anonymous GET with the DB host, the schema name, row counts
 * and the full list of admin usernames and roles.
 *
 * This file is deliberately self-contained: it must work before env/db config
 * has loaded, and it must not be able to fail open.
 *
 * Usage — first statement of the script:
 *   require_once __DIR__ . '/../config/cli_only.php';
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    exit("Not found\n");
}
