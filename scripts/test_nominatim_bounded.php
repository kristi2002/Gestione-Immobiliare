<?php
require dirname(__DIR__) . '/config/env.php';
require dirname(__DIR__) . '/config/geocode.php';
loadEnv(dirname(__DIR__) . '/.env');

$property = ['address' => 'Via Galileo Galilei 145', 'city' => 'Modena', 'cap' => '41126', 'province' => 'MO'];
$area = geocodeGetAreaContext($property);
echo "Area context:\n" . json_encode($area, JSON_PRETTY_PRINT) . "\n\n";

$params = [
    'format' => 'json', 'limit' => 5, 'addressdetails' => 1,
    'countrycodes' => 'it', 'q' => 'Via Galileo Galilei 145, 41126 Modena MO, Italia',
    'viewbox' => implode(',', $area['viewbox']),
    'bounded' => 1,
];
$url = 'https://nominatim.openstreetmap.org/search?' . http_build_query($params);
$ctx = stream_context_create(['http' => ['header' => "User-Agent: GestionaleImmobiliare/1.0\r\n"]]);
sleep(1);
echo file_get_contents($url, false, $ctx);
