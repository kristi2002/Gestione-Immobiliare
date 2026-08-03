<?php
/**
 * Load environment variables from .env file.
 */

// Guarded so tests/bootstrap.php can pre-define a no-op loadEnv() stub without
// a fatal redeclare when this file is transitively included.
if (!function_exists('loadEnv')) {
function loadEnv(string $path): void
{
    if (!is_readable($path)) {
        return;
    }

    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) {
        return;
    }

    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }

        if (!str_contains($line, '=')) {
            continue;
        }

        [$key, $value] = explode('=', $line, 2);
        $key   = trim($key);
        $value = trim($value);

        if (
            (str_starts_with($value, '"') && str_ends_with($value, '"')) ||
            (str_starts_with($value, "'") && str_ends_with($value, "'"))
        ) {
            $value = substr($value, 1, -1);
        }

        $_ENV[$key]    = $value;
        $_SERVER[$key] = $value;
        putenv("{$key}={$value}");
    }
}
} // if (!function_exists('loadEnv'))

function env(string $key, mixed $default = null): mixed
{
    // Distinguish "explicitly set (even to an empty string)" from "absent". Only
    // fall back to the default when the key is genuinely not present — so an
    // intentionally empty value (e.g. an empty local DB password) is respected
    // instead of being silently replaced by the default.
    if (array_key_exists($key, $_ENV)) {
        $value = $_ENV[$key];
    } elseif (array_key_exists($key, $_SERVER)) {
        $value = $_SERVER[$key];
    } else {
        $value = getenv($key);
        if ($value === false) {
            return $default;
        }
    }

    if ($value === null) {
        return $default;
    }

    return match (strtolower((string) $value)) {
        'true', '(true)'   => true,
        'false', '(false)' => false,
        'null', '(null)'   => null,
        default            => $value,
    };
}
