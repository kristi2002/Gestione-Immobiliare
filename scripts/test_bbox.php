<?php
sleep(1);
$url = 'https://nominatim.openstreetmap.org/search?' . http_build_query([
    'format' => 'json', 'limit' => 1, 'addressdetails' => 1,
    'countrycodes' => 'it', 'city' => 'Modena', 'country' => 'Italia',
]);
$ctx = stream_context_create(['http' => ['header' => "User-Agent: GestionaleImmobiliare/1.0\r\n"]]);
$hit = json_decode(file_get_contents($url, false, $ctx), true)[0] ?? null;
echo "City-only bbox: " . json_encode($hit['boundingbox'] ?? null) . "\n";
echo "Display: " . ($hit['display_name'] ?? '') . "\n\n";

sleep(1);
$url2 = 'https://nominatim.openstreetmap.org/search?' . http_build_query([
    'format' => 'json', 'limit' => 1, 'addressdetails' => 1,
    'countrycodes' => 'it', 'postalcode' => '41126', 'city' => 'Modena', 'country' => 'Italia',
]);
$hit2 = json_decode(file_get_contents($url2, false, $ctx), true)[0] ?? null;
echo "CAP+city bbox: " . json_encode($hit2['boundingbox'] ?? null) . "\n";
echo "Display: " . ($hit2['display_name'] ?? '') . "\n";
