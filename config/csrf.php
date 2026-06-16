<?php
/**
 * CSRF token — session-based, validated on mutating API requests.
 */

function initCsrfToken(): void
{
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
}

function getCsrfToken(): string
{
    initCsrfToken();
    return $_SESSION['csrf_token'];
}

function validateCsrfToken(): void
{
    if (PHP_SAPI === 'cli') {
        return;
    }

    $header = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    $body   = apiGetJsonBody();
    $token  = $header !== '' ? $header : (string) ($body['csrf_token'] ?? $_POST['csrf_token'] ?? '');

    if ($token === '' || !hash_equals(getCsrfToken(), $token)) {
        apiError('Token CSRF non valido.', 403);
    }
}
