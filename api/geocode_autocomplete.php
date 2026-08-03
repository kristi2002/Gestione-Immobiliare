<?php
/**
 * Address autocomplete (type-ahead) for the property form.
 *
 * GET /api/geocode_autocomplete.php?q=via galileo galilei 142
 *
 * Uses Photon (photon.komoot.io) — an OSM-based geocoder DESIGNED for
 * autocomplete (multiple structured candidates per keystroke, no API key,
 * unlike Nominatim which forbids per-keystroke use). Biased to Italy.
 * Each candidate carries the fields the form autofills: address, city (comune),
 * cap, province (2-letter), lat/lng — so selecting one fills everything and
 * drops the map pin, with no "sync" button.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
// La mappa provincia->sigla è condivisa con la geocodifica puntuale: se ne
// esistono due, i due percorsi di compilazione automatica scrivono formati
// diversi nella stessa colonna.
require_once __DIR__ . '/../config/geocode/matching.php';
apiHandleOptions();
apiRequireMethod('GET');

$q = trim($_GET['q'] ?? '');
if (mb_strlen($q) < 4) {
    apiSuccess(['candidates' => []]); // wait for a meaningful query
}

if (!function_exists('curl_init')) {
    apiError('Autocomplete non disponibile (cURL mancante).', 500);
}

// Photon, biased to the centre of Italy, limited to a few hits. NOTE: the public
// Photon instance does NOT support lang=it (returns 400) — omit it; OSM already
// stores Italian street/comune names.
$url = 'https://photon.komoot.io/api/?' . http_build_query([
    'q'     => $q,
    'limit' => 10,
    'lat'   => 42.5,   // location bias → Italy
    'lon'   => 12.5,
]);

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 8,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_USERAGENT      => 'GestionaleImmobiliare/1.0 (property address autocomplete)',
]);
$body  = curl_exec($ch);
$errno = curl_errno($ch);
curl_close($ch);

if ($errno || !$body) {
    apiSuccess(['candidates' => []]); // fail soft — the manual "Trova" button still works
}

$data = json_decode($body, true);
$features = is_array($data['features'] ?? null) ? $data['features'] : [];

$candidates = [];
$seen = [];
foreach ($features as $f) {
    $p = $f['properties'] ?? [];
    $coords = $f['geometry']['coordinates'] ?? null;
    if (!$coords || count($coords) < 2) continue;

    // Keep Italian results only.
    $cc = strtolower((string) ($p['countrycode'] ?? ''));
    if ($cc !== '' && $cc !== 'it') continue;

    $lng = (float) $coords[0];
    $lat = (float) $coords[1];

    $street = trim((string) ($p['street'] ?? ''));
    $house  = trim((string) ($p['housenumber'] ?? ''));
    $name   = trim((string) ($p['name'] ?? ''));

    // Street line: prefer "Via X 142"; fall back to the POI/place name.
    if ($street !== '') {
        $address = $street . ($house !== '' ? ' ' . $house : '');
    } else {
        $address = $name;
    }
    if ($address === '') continue;

    $city = trim((string) ($p['city'] ?? $p['town'] ?? $p['village'] ?? $p['locality'] ?? $p['district'] ?? ''));
    if ($city === '' && ($p['osm_key'] ?? '') === 'place') {
        $city = $name; // the result IS a comune
    }
    $cap  = trim((string) ($p['postcode'] ?? ''));
    $prov = geocodeProvinceCode((string) ($p['county'] ?? $p['state'] ?? ''));

    // A street-name hit (no civico) is still "street" precision, not just CAP area.
    $isStreet = $street !== '' || ($p['osm_key'] ?? '') === 'highway' || ($p['type'] ?? '') === 'street';
    $confidence = $house !== '' ? 'exact' : ($isStreet ? 'street' : 'cap_area');

    // De-dup identical street+city+cap.
    $key = mb_strtolower($address . '|' . $city . '|' . $cap);
    if (isset($seen[$key])) continue;
    $seen[$key] = true;

    // Human label for the dropdown (comune disambiguation front and centre).
    $labelBits = array_filter([$address, $city, trim($cap . ' ' . $prov)]);
    $candidates[] = [
        'label'      => implode(', ', $labelBits),
        'address'    => $address,
        'city'       => $city,
        'cap'        => $cap,
        'province'   => $prov,
        'lat'        => round($lat, 7),
        'lng'        => round($lng, 7),
        'confidence' => $confidence,
    ];
    if (count($candidates) >= 6) break;
}

apiSuccess(['candidates' => $candidates]);
