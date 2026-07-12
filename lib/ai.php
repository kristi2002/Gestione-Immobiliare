<?php
/**
 * Minimal, pluggable AI provider layer.
 *
 * One integration point for every AI feature (listing copy, future call
 * summaries, photo descriptions). Selected by env:
 *
 *   AI_PROVIDER   anthropic | openai        (default: anthropic)
 *   AI_API_KEY    the secret key            (required — no key => not configured)
 *   AI_MODEL      model id                  (default per provider)
 *   AI_BASE_URL   override base URL          (optional; for OpenAI-compatible gateways)
 *
 * Returns plain text. Throws RuntimeException with a human message on failure so
 * callers can surface it. Never echoes — safe inside JSON endpoints.
 */

require_once __DIR__ . '/../config/env.php';

function aiIsConfigured(): bool
{
    return (string) env('AI_API_KEY', '') !== '';
}

function aiProvider(): string
{
    $p = strtolower((string) env('AI_PROVIDER', 'anthropic'));
    return in_array($p, ['anthropic', 'openai'], true) ? $p : 'anthropic';
}

/**
 * Send a single-turn chat completion.
 *
 * @param string $system   System / role instruction.
 * @param string $user     User message.
 * @param int    $maxTokens
 * @return string          Model text output.
 * @throws RuntimeException
 */
function aiComplete(string $system, string $user, int $maxTokens = 700): string
{
    if (!aiIsConfigured()) {
        throw new RuntimeException('AI non configurata. Imposta AI_API_KEY nel file .env.');
    }
    if (!function_exists('curl_init')) {
        throw new RuntimeException('Estensione cURL non disponibile sul server.');
    }

    return aiProvider() === 'openai'
        ? aiCompleteOpenAI($system, $user, $maxTokens)
        : aiCompleteAnthropic($system, $user, $maxTokens);
}

function aiCompleteAnthropic(string $system, string $user, int $maxTokens): string
{
    $key   = (string) env('AI_API_KEY', '');
    $model = (string) env('AI_MODEL', 'claude-sonnet-5');
    $base  = rtrim((string) env('AI_BASE_URL', 'https://api.anthropic.com'), '/');

    $payload = [
        'model'      => $model,
        'max_tokens' => $maxTokens,
        'system'     => $system,
        'messages'   => [['role' => 'user', 'content' => $user]],
    ];

    $resp = aiHttpPost($base . '/v1/messages', $payload, [
        'x-api-key: ' . $key,
        'anthropic-version: 2023-06-01',
        'content-type: application/json',
    ]);

    $text = $resp['content'][0]['text'] ?? null;
    if (!is_string($text) || $text === '') {
        throw new RuntimeException('Risposta AI vuota o non valida.');
    }
    return trim($text);
}

function aiCompleteOpenAI(string $system, string $user, int $maxTokens): string
{
    $key   = (string) env('AI_API_KEY', '');
    $model = (string) env('AI_MODEL', 'gpt-4o-mini');
    $base  = rtrim((string) env('AI_BASE_URL', 'https://api.openai.com'), '/');

    $payload = [
        'model'      => $model,
        'max_tokens' => $maxTokens,
        'messages'   => [
            ['role' => 'system', 'content' => $system],
            ['role' => 'user',   'content' => $user],
        ],
    ];

    $resp = aiHttpPost($base . '/v1/chat/completions', $payload, [
        'authorization: Bearer ' . $key,
        'content-type: application/json',
    ]);

    $text = $resp['choices'][0]['message']['content'] ?? null;
    if (!is_string($text) || $text === '') {
        throw new RuntimeException('Risposta AI vuota o non valida.');
    }
    return trim($text);
}

/**
 * @param array<string,mixed> $payload
 * @param string[]            $headers
 * @return array<mixed>       Decoded JSON.
 * @throws RuntimeException
 */
function aiHttpPost(string $url, array $payload, array $headers): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_TIMEOUT        => 45,
        CURLOPT_CONNECTTIMEOUT => 10,
    ]);

    $body   = curl_exec($ch);
    $errno  = curl_errno($ch);
    $err    = curl_error($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($errno) {
        throw new RuntimeException('Errore di rete verso il servizio AI: ' . $err);
    }
    if ($status < 200 || $status >= 300) {
        $decoded = json_decode((string) $body, true);
        $msg = $decoded['error']['message'] ?? ('HTTP ' . $status);
        throw new RuntimeException('Il servizio AI ha risposto con un errore: ' . $msg);
    }

    $decoded = json_decode((string) $body, true);
    if (!is_array($decoded)) {
        throw new RuntimeException('Risposta AI non interpretabile.');
    }
    return $decoded;
}
