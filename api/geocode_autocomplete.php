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
    $prov = provinceCode((string) ($p['county'] ?? $p['state'] ?? ''));

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

/**
 * Map an Italian province/county name (as Photon returns it) to its 2-letter code.
 * Normalises the "(Città metropolitana|Provincia|Libero consorzio…) di X" wrappers.
 */
function provinceCode(string $county): string
{
    $c = trim($county);
    if ($c === '') return '';
    $c = preg_replace('/^(Citt[aà] metropolitana di|Provincia di|Libero consorzio comunale di|Provincia autonoma di)\s+/iu', '', $c);
    $c = preg_replace('/\s+Capitale$/iu', '', $c); // "Roma Capitale" → "Roma"
    $c = trim($c);

    static $map = [
        'Agrigento'=>'AG','Alessandria'=>'AL','Ancona'=>'AN','Aosta'=>'AO','Valle d\'Aosta'=>'AO','Arezzo'=>'AR',
        'Ascoli Piceno'=>'AP','Asti'=>'AT','Avellino'=>'AV','Bari'=>'BA','Barletta-Andria-Trani'=>'BT','Belluno'=>'BL',
        'Benevento'=>'BN','Bergamo'=>'BG','Biella'=>'BI','Bologna'=>'BO','Bolzano'=>'BZ','Brescia'=>'BS','Brindisi'=>'BR',
        'Cagliari'=>'CA','Caltanissetta'=>'CL','Campobasso'=>'CB','Caserta'=>'CE','Catania'=>'CT','Catanzaro'=>'CZ',
        'Chieti'=>'CH','Como'=>'CO','Cosenza'=>'CS','Cremona'=>'CR','Crotone'=>'KR','Cuneo'=>'CN','Enna'=>'EN',
        'Fermo'=>'FM','Ferrara'=>'FE','Firenze'=>'FI','Foggia'=>'FG','Forlì-Cesena'=>'FC','Forli-Cesena'=>'FC','Frosinone'=>'FR',
        'Genova'=>'GE','Gorizia'=>'GO','Grosseto'=>'GR','Imperia'=>'IM','Isernia'=>'IS','La Spezia'=>'SP','L\'Aquila'=>'AQ',
        'Latina'=>'LT','Lecce'=>'LE','Lecco'=>'LC','Livorno'=>'LI','Lodi'=>'LO','Lucca'=>'LU','Macerata'=>'MC',
        'Mantova'=>'MN','Massa-Carrara'=>'MS','Matera'=>'MT','Messina'=>'ME','Milano'=>'MI','Modena'=>'MO',
        'Monza e della Brianza'=>'MB','Napoli'=>'NA','Novara'=>'NO','Nuoro'=>'NU','Oristano'=>'OR','Padova'=>'PD',
        'Palermo'=>'PA','Parma'=>'PR','Pavia'=>'PV','Perugia'=>'PG','Pesaro e Urbino'=>'PU','Pescara'=>'PE','Piacenza'=>'PC',
        'Pisa'=>'PI','Pistoia'=>'PT','Pordenone'=>'PN','Potenza'=>'PZ','Prato'=>'PO','Ragusa'=>'RG','Ravenna'=>'RA',
        'Reggio Calabria'=>'RC','Reggio Emilia'=>'RE','Rieti'=>'RI','Rimini'=>'RN','Roma'=>'RM','Rovigo'=>'RO',
        'Salerno'=>'SA','Sassari'=>'SS','Savona'=>'SV','Siena'=>'SI','Siracusa'=>'SR','Sondrio'=>'SO','Sud Sardegna'=>'SU',
        'Taranto'=>'TA','Teramo'=>'TE','Terni'=>'TR','Torino'=>'TO','Trapani'=>'TP','Trento'=>'TN','Treviso'=>'TV',
        'Trieste'=>'TS','Udine'=>'UD','Varese'=>'VA','Venezia'=>'VE','Verbano-Cusio-Ossola'=>'VB','Vercelli'=>'VC',
        'Verona'=>'VR','Vibo Valentia'=>'VV','Vicenza'=>'VI','Viterbo'=>'VT',
    ];
    return $map[$c] ?? '';
}
