<?php
foreach (['41126', '41121'] as $cap) {
    sleep(1);
    $url = 'https://nominatim.openstreetmap.org/search?' . http_build_query([
        'format' => 'json', 'limit' => 1, 'addressdetails' => 1,
        'countrycodes' => 'it', 'postalcode' => $cap, 'country' => 'Italia',
    ]);
    $ctx = stream_context_create(['http' => ['header' => "User-Agent: GestionaleImmobiliare/1.0\r\n"]]);
    $hit = json_decode(file_get_contents($url, false, $ctx), true)[0] ?? null;
    echo "CAP $cap bbox: " . json_encode($hit['boundingbox'] ?? null) . "\n";
    echo "  " . ($hit['display_name'] ?? 'none') . "\n\n";
}
