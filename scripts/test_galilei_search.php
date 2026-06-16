<?php
sleep(1);
$url = 'https://nominatim.openstreetmap.org/search?' . http_build_query([
    'format' => 'json', 'limit' => 10, 'addressdetails' => 1,
    'countrycodes' => 'it',
    'q' => 'Via Galileo Galilei 145, Modena, 41126, Italia',
]);
$ctx = stream_context_create(['http' => ['header' => "User-Agent: GestionaleImmobiliare/1.0\r\n"]]);
$data = json_decode(file_get_contents($url, false, $ctx), true);
foreach ($data as $hit) {
    $a = $hit['address'] ?? [];
    $city = $a['city'] ?? $a['town'] ?? $a['village'] ?? '';
    echo "{$hit['lat']},{$hit['lon']} | city/town={$city} | {$hit['display_name']}\n";
}
