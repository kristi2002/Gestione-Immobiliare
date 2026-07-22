<?php
/**
 * Lightweight in-process cache backed by APCu, with a graceful no-op fallback.
 *
 * When the APCu extension is not installed/enabled (e.g. CLI, or an image built
 * without it), every function becomes a no-op and callers behave exactly as if
 * there were no cache — so wiring this in is always safe, on any environment.
 *
 * Intended for small, hot, non-personal payloads (e.g. the global dashboard
 * stats) with short TTLs. Do NOT cache per-user or personal data here.
 */

if (!function_exists('cacheAvailable')) {
    function cacheAvailable(): bool
    {
        static $ok = null;
        if ($ok === null) {
            $ok = function_exists('apcu_enabled') && apcu_enabled();
        }
        return $ok;
    }
}

if (!function_exists('cacheGet')) {
    /**
     * @return mixed|null  The cached value, or null on miss / when unavailable.
     */
    function cacheGet(string $key)
    {
        if (!cacheAvailable()) {
            return null;
        }
        $found = false;
        $value = apcu_fetch($key, $found);
        return $found ? $value : null;
    }
}

if (!function_exists('cacheSet')) {
    function cacheSet(string $key, $value, int $ttlSeconds = 30): void
    {
        if (!cacheAvailable()) {
            return;
        }
        apcu_store($key, $value, $ttlSeconds);
    }
}

if (!function_exists('cacheDelete')) {
    function cacheDelete(string $key): void
    {
        if (!cacheAvailable()) {
            return;
        }
        apcu_delete($key);
    }
}
