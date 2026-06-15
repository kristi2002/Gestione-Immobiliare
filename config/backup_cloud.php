<?php
/**
 * S3-compatible cloud backup upload (Backblaze B2, AWS S3, MinIO).
 */

require_once __DIR__ . '/settings.php';

function uploadBackupToCloud(string $localPath, string $remoteName): array
{
    $cfg = getBackupCloudConfig();

    if (!$cfg['enabled']) {
        return ['success' => false, 'error' => 'Cloud backup disabilitato.'];
    }

    foreach (['endpoint', 'bucket', 'key', 'secret'] as $field) {
        if (empty($cfg[$field])) {
            return ['success' => false, 'error' => "Configurazione backup incompleta: {$field}"];
        }
    }

    if (!is_readable($localPath)) {
        return ['success' => false, 'error' => 'File backup non leggibile.'];
    }

    $key      = rtrim($cfg['prefix'], '/') . '/' . $remoteName;
    $content  = file_get_contents($localPath);
    $endpoint = rtrim($cfg['endpoint'], '/');
    $host     = parse_url($endpoint, PHP_URL_HOST) ?: $endpoint;
    $uri      = '/' . $cfg['bucket'] . '/' . $key;
    $url      = $endpoint . $uri;

    $date      = gmdate('Ymd\THis\Z');
    $dateShort = gmdate('Ymd');
    $payloadHash = hash('sha256', $content);
    $headers = [
        'host'                 => $host,
        'x-amz-content-sha256' => $payloadHash,
        'x-amz-date'           => $date,
        'content-type'         => 'application/sql',
    ];

    $canonicalHeaders = '';
    $signedHeaderKeys = array_keys($headers);
    sort($signedHeaderKeys);
    foreach ($signedHeaderKeys as $hk) {
        $canonicalHeaders .= $hk . ':' . trim($headers[$hk]) . "\n";
    }
    $signedHeaders = implode(';', $signedHeaderKeys);

    $canonicalRequest = implode("\n", [
        'PUT', $uri, '', $canonicalHeaders, $signedHeaders, $payloadHash,
    ]);

    $credentialScope = $dateShort . '/' . $cfg['region'] . '/s3/aws4_request';
    $stringToSign = implode("\n", [
        'AWS4-HMAC-SHA256', $date, $credentialScope, hash('sha256', $canonicalRequest),
    ]);

    $signingKey = getSignatureKey($cfg['secret'], $dateShort, $cfg['region'], 's3');
    $signature  = hash_hmac('sha256', $stringToSign, $signingKey);

    $authorization = 'AWS4-HMAC-SHA256 Credential=' . $cfg['key'] . '/' . $credentialScope
        . ', SignedHeaders=' . $signedHeaders . ', Signature=' . $signature;

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => 'PUT',
        CURLOPT_POSTFIELDS     => $content,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 120,
        CURLOPT_HTTPHEADER     => [
            'Host: ' . $host,
            'x-amz-content-sha256: ' . $payloadHash,
            'x-amz-date: ' . $date,
            'Content-Type: application/sql',
            'Authorization: ' . $authorization,
        ],
    ]);

    $response = curl_exec($ch);
    $code     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($code >= 200 && $code < 300) {
        return ['success' => true, 'remote_key' => $key, 'url' => $url];
    }

    return ['success' => false, 'error' => "Upload fallito HTTP {$code}: " . substr((string) $response, 0, 200)];
}

function getSignatureKey(string $secret, string $date, string $region, string $service): string
{
    $kDate    = hash_hmac('sha256', $date, 'AWS4' . $secret, true);
    $kRegion  = hash_hmac('sha256', $region, $kDate, true);
    $kService = hash_hmac('sha256', $service, $kRegion, true);
    return hash_hmac('sha256', 'aws4_request', $kService, true);
}
