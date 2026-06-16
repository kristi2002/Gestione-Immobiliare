<?php
/**
 * Shared helpers for JSON API endpoints.
 */

function apiHeaders(): void
{
    header('Content-Type: application/json; charset=utf-8');

    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if (APP_URL !== '' && $origin !== '') {
        $appOrigin = parse_url(APP_URL, PHP_URL_SCHEME) . '://' . parse_url(APP_URL, PHP_URL_HOST);
        $appPort   = parse_url(APP_URL, PHP_URL_PORT);
        if ($appPort) {
            $appOrigin .= ':' . $appPort;
        }
        if ($origin === $appOrigin) {
            header('Access-Control-Allow-Origin: ' . $origin);
            header('Access-Control-Allow-Credentials: true');
        }
    }

    header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-Cron-Secret, X-CSRF-Token');
}

function apiHandleOptions(): void
{
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        apiHeaders();
        http_response_code(204);
        exit;
    }
}

function apiDiscardBufferedOutput(): void
{
    // Drop any stray output (PHP warnings/notices) captured before the JSON body.
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
}

function apiSuccess(mixed $data = null, int $code = 200): void
{
    apiDiscardBufferedOutput();
    apiHeaders();
    http_response_code($code);
    echo json_encode([
        'success' => true,
        'data'    => $data,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

function apiError(string $message, int $code = 400): void
{
    apiDiscardBufferedOutput();
    apiHeaders();
    http_response_code($code);
    echo json_encode([
        'success' => false,
        'error'   => $message,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

function apiGetJsonBody(): array
{
    static $cached = null;

    if ($cached !== null) {
        return $cached;
    }

    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        $cached = [];
        return $cached;
    }

    $data = json_decode($raw, true);
    $cached = is_array($data) ? $data : [];
    return $cached;
}

function apiRequireMethod(string ...$methods): void
{
    if (!in_array($_SERVER['REQUEST_METHOD'], $methods, true)) {
        apiError('Metodo non consentito.', 405);
    }
}
