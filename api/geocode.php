<?php
/**
 * Geocoding proxy — Nominatim with proper User-Agent (browser calls are unreliable).
 * GET params passed through to Nominatim /search.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();
apiRequireMethod('GET');

$query = $_GET;
unset($query['PHP_SELF']);

$params = http_build_query($query);
$url    = 'https://nominatim.openstreetmap.org/search?' . $params;

$ctx = stream_context_create([
    'http' => [
        'method'        => 'GET',
        'header'        => "User-Agent: GestionaleImmobiliare/1.0 (contact@agenzia.local)\r\nAccept-Language: it\r\n",
        'timeout'       => 15,
        'ignore_errors' => true,
    ],
]);

$body = @file_get_contents($url, false, $ctx);

if ($body === false) {
    apiError('Servizio geocodifica non disponibile.', 502);
}

$data = json_decode($body, true);
if (!is_array($data)) {
    apiError('Risposta geocodifica non valida.', 502);
}

apiSuccess($data);
