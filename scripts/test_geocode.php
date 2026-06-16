<?php
require dirname(__DIR__) . '/config/env.php';
require dirname(__DIR__) . '/config/geocode.php';
loadEnv(dirname(__DIR__) . '/.env');

$cases = [
    ['address' => 'Via Galileo Galilei 145', 'city' => 'Modena', 'cap' => '41126', 'province' => 'MO'],
    ['address' => 'Via Emilia Est 123', 'city' => 'Modena', 'cap' => '41121', 'province' => 'MO'],
];

foreach ($cases as $c) {
    echo "\n=== {$c['address']} ===\n";
    try {
        $parsed = geocodeParseStreet($c['address'], $c['city']);
        echo 'Parsed: ' . json_encode($parsed, JSON_UNESCAPED_UNICODE) . "\n";
        $photon = geocodeTryPhoton($c, $parsed);
        echo 'Photon: ' . json_encode($photon, JSON_UNESCAPED_UNICODE) . "\n";
        $r = geocodeResolve($c);
        echo json_encode($r, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
    } catch (Throwable $e) {
        echo 'ERROR: ' . $e->getMessage() . "\n";
    }
}
