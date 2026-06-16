<?php
require dirname(__DIR__) . '/config/env.php';
require dirname(__DIR__) . '/config/geocode.php';
loadEnv(dirname(__DIR__) . '/.env');

$params = [
    'format' => 'json',
    'limit' => 5,
    'addressdetails' => 1,
    'countrycodes' => 'it',
    'country' => 'Italia',
    'street' => 'Via Galileo Galilei',
    'city' => 'Modena',
    'postalcode' => '41126',
];
$url = 'https://nominatim.openstreetmap.org/search?' . http_build_query($params);
$ctx = stream_context_create(['http' => ['header' => "User-Agent: GestionaleImmobiliare/1.0\r\nAccept-Language: it\r\n"]]);
sleep(1);
$body = file_get_contents($url, false, $ctx);
echo $body;
