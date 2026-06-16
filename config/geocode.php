<?php
/**
 * Italian address geocoding — Google (optional) + Nominatim + Photon cascade.
 */

function geocodeNormalizeText(string $s): string
{
    $s = mb_strtolower(trim($s), 'UTF-8');
    if (class_exists('Normalizer')) {
        $normalized = Normalizer::normalize($s, Normalizer::FORM_D);
        if (is_string($normalized)) {
            $s = $normalized;
        }
    }

    return preg_replace('/\p{M}/u', '', $s);
}

function geocodeGetResultCity(array $addr): string
{
    return trim($addr['city'] ?? $addr['town'] ?? $addr['village'] ?? $addr['municipality'] ?? '');
}

function geocodeParseStreet(string $address, string $city): array
{
    $s = trim($address);
    $cityNorm = geocodeNormalizeText($city);

    if ($cityNorm && str_ends_with(geocodeNormalizeText($s), $cityNorm)) {
        $s = preg_replace('/,?\s*' . preg_quote($city, '/') . '\s*$/iu', '', $s);
        $s = trim($s);
    }

    if ($s && !preg_match('/^(via|viale|piazza|piazzale|corso|strada|largo|vicolo|contrada)\b/iu', $s)) {
        $s = 'Via ' . $s;
    }

    $housenumber = null;
    $streetName  = $s;

    if (preg_match('/^(.+?)[,\s]+(\d+\s*[A-Za-z\/]?\d*)\s*$/u', $s, $m)) {
        $streetName  = trim($m[1]);
        $housenumber = trim($m[2]);
    } elseif (preg_match('/^(.+?)\s+(\d+\s*[A-Za-z\/]?\d*)\s*$/u', $s, $m)) {
        $streetName  = trim($m[1]);
        $housenumber = trim($m[2]);
    }

    return [
        'street'      => $streetName,
        'housenumber' => $housenumber,
        'full'        => $s,
    ];
}

function geocodeCapCompatible(string $wanted, string $got): bool
{
    if ($wanted === '' || $got === '') {
        return true;
    }
    if ($wanted === $got) {
        return true;
    }
    return strlen($wanted) >= 4 && strlen($got) >= 4 && substr($wanted, 0, 4) === substr($got, 0, 4);
}

function geocodeScoreResult(array $result, array $property): int
{
    $addr       = $result['address'] ?? [];
    $cityWanted = geocodeNormalizeText($property['city'] ?? '');
    $capWanted  = trim($property['cap'] ?? '');
    $resultCity = geocodeNormalizeText(geocodeGetResultCity($addr));
    $postcode   = trim((string) ($addr['postcode'] ?? ''));

    $score = 0;
    if ($capWanted && $postcode === $capWanted) {
        $score += 40;
    } elseif ($capWanted && geocodeCapCompatible($capWanted, $postcode)) {
        $score += 20;
    }
    if ($cityWanted && $resultCity === $cityWanted) {
        $score += 35;
    }
    if ($capWanted && $postcode && !geocodeCapCompatible($capWanted, $postcode)) {
        $score -= 60;
    }
    if ($cityWanted && $resultCity && $resultCity !== $cityWanted) {
        $score -= 60;
    }

    if (!empty($result['housenumber']) || in_array($result['class'] ?? '', ['building', 'amenity', 'shop'], true)) {
        $score += 15;
    }

    return $score;
}

function geocodeIsAcceptable(array $result, array $property, bool $allowCapArea = false): bool
{
    $addr       = $result['address'] ?? [];
    $cityWanted = geocodeNormalizeText($property['city'] ?? '');
    $capWanted  = trim($property['cap'] ?? '');
    $resultCity = geocodeNormalizeText(geocodeGetResultCity($addr));
    $postcode   = trim((string) ($addr['postcode'] ?? ''));

    if ($cityWanted && (!$resultCity || $resultCity !== $cityWanted)) {
        return false;
    }
    if ($capWanted && $postcode && !geocodeCapCompatible($capWanted, $postcode)) {
        return false;
    }
    if ($allowCapArea) {
        return $cityWanted && $resultCity === $cityWanted;
    }

    return geocodeScoreResult($result, $property) >= 15;
}

function geocodePickBest(array $results, array $property, bool $allowCapArea = false): ?array
{
    $scored = [];
    foreach ($results as $r) {
        if (!geocodeIsAcceptable($r, $property, $allowCapArea)) {
            continue;
        }
        $scored[] = ['r' => $r, 'score' => geocodeScoreResult($r, $property)];
    }
    if (!$scored) {
        return null;
    }
    usort($scored, fn($a, $b) => $b['score'] <=> $a['score']);

    return $scored[0]['r'];
}

function geocodePrecisionFromNominatim(array $hit): string
{
    $class = $hit['class'] ?? '';
    $type  = $hit['type'] ?? '';

    if (in_array($class, ['building', 'amenity', 'shop', 'office'], true)) {
        return 'exact';
    }
    if ($class === 'place' && in_array($type, ['house', 'building', 'address'], true)) {
        return 'exact';
    }
    if ($class === 'highway' || in_array($type, ['residential', 'tertiary', 'secondary', 'primary', 'living_street'], true)) {
        return 'street';
    }

    return 'cap_area';
}

function geocodePrecisionFromGoogle(string $locationType): string
{
    return match ($locationType) {
        'ROOFTOP', 'RANGE_INTERPOLATED' => 'exact',
        'GEOMETRIC_CENTER'               => 'street',
        default                          => 'cap_area',
    };
}

function geocodeFormatQuery(array $property, array $parsed): string
{
    $parts = [$parsed['full']];
    $cap   = trim($property['cap'] ?? '');
    $city  = trim($property['city'] ?? '');
    $prov  = trim($property['province'] ?? '');

    if ($cap || $city) {
        $parts[] = trim($cap . ' ' . $city . ($prov ? ' ' . $prov : ''));
    }
    $parts[] = 'Italia';

    return implode(', ', array_filter($parts));
}

function geocodeStreetSimilar(string $wanted, string $got): bool
{
    $norm = static function (string $s): string {
        $s = geocodeNormalizeText($s);
        $s = preg_replace('/^(via|viale|piazza|piazzale|corso|strada|largo|vicolo)\s+/u', '', $s);

        return trim($s);
    };

    $a = $norm($wanted);
    $b = $norm($got);
    if ($a === '' || $b === '') {
        return false;
    }

    return $a === $b || str_contains($a, $b) || str_contains($b, $a);
}

function geocodeCountyFromProvince(string $province): ?string
{
    $p = trim($province);
    if ($p === '') {
        return null;
    }
    if (strlen($p) <= 3 && strtoupper($p) === $p) {
        return null;
    }
    if (stripos($p, 'provincia') !== false) {
        return $p;
    }

    return 'Provincia di ' . $p;
}

function geocodeHttpGet(string $url, array $headers = [], int $timeout = 15): ?string
{
    $headerLines = array_merge(['Accept: application/json'], $headers);
    $ctx = stream_context_create([
        'http' => [
            'method'        => 'GET',
            'header'        => implode("\r\n", $headerLines) . "\r\n",
            'timeout'       => $timeout,
            'ignore_errors' => true,
        ],
    ]);

    $body = @file_get_contents($url, false, $ctx);

    return $body === false ? null : $body;
}

function geocodeRankResult(array $hit, array $property, array $parsed): int
{
    $order = ['exact' => 30, 'street' => 20, 'cap_area' => 10];
    $score = $order[$hit['confidence'] ?? ''] ?? 0;

    if (($hit['source'] ?? '') === 'google') {
        $score += 5;
    }

    $resultStreet = $hit['street'] ?? '';
    if ($resultStreet && geocodeStreetSimilar($parsed['street'], $resultStreet)) {
        $score += 100;
    } elseif (!empty($parsed['housenumber']) && ($hit['confidence'] ?? '') === 'exact' && $resultStreet) {
        $score -= 80;
    }

    return $score;
}

function geocodePickBestResult(array $cascade, array $property, array $parsed): ?array
{
    $best = null;
    $bestScore = -999;

    foreach ($cascade as $hit) {
        if (!$hit) {
            continue;
        }
        $score = geocodeRankResult($hit, $property, $parsed);
        if ($score > $bestScore) {
            $bestScore = $score;
            $best = $hit;
        }
    }

    return $best;
}

function geocodeNominatimSearch(array $params): array
{
    static $lastAt = 0;
    $wait = 1100000 - (int) ((microtime(true) - $lastAt) * 1000000);
    if ($wait > 0) {
        usleep($wait);
    }
    $lastAt = microtime(true);

    $params['format'] = 'json';
    $url = 'https://nominatim.openstreetmap.org/search?' . http_build_query($params);
    $body = geocodeHttpGet($url, [
        'User-Agent: GestionaleImmobiliare/1.0 (contact@agenzia.local)',
        'Accept-Language: it',
    ]);

    if (!$body) {
        return [];
    }
    $data = json_decode($body, true);

    return is_array($data) ? $data : [];
}

function geocodeViewboxFromBoundingbox(?array $bb): ?array
{
    if (!$bb || count($bb) < 4) {
        return null;
    }
    $south = (float) $bb[0];
    $north = (float) $bb[1];
    $west  = (float) $bb[2];
    $east  = (float) $bb[3];
    if (in_array(null, [$south, $north, $west, $east], true)) {
        return null;
    }

    return [$west, $north, $east, $south];
}

function geocodeGetAreaContext(array $property): array
{
    $city = trim($property['city'] ?? '');
    $cap  = trim($property['cap'] ?? '');

    $capData = geocodeNominatimSearch([
        'limit'          => 1,
        'addressdetails' => 1,
        'countrycodes'   => 'it',
        'postalcode'     => $cap,
        'country'        => 'Italia',
    ]);
    $capHit  = $capData[0] ?? null;
    $capAddr = $capHit['address'] ?? [];

    $cityNorm     = geocodeNormalizeText($city);
    $resultCity   = geocodeNormalizeText(geocodeGetResultCity($capAddr));
    $displayNorm  = geocodeNormalizeText($capHit['display_name'] ?? '');
    $postcode     = trim((string) ($capAddr['postcode'] ?? ''));

    $validated = $capHit
        && geocodeCapCompatible($cap, $postcode ?: $cap)
        && ($resultCity === $cityNorm || ($cityNorm && str_contains($displayNorm, $cityNorm)));

    $county = trim($capAddr['county'] ?? '');

    return [
        'viewbox'            => $capHit ? geocodeViewboxFromBoundingbox($capHit['boundingbox'] ?? null) : null,
        'validated'          => $validated,
        'suggested_province' => $county,
        'cap_centroid'       => $capHit ? [
            'lat' => (float) $capHit['lat'],
            'lng' => (float) $capHit['lon'],
        ] : null,
    ];
}

function geocodeApplyViewbox(array &$params, ?array $viewbox): void
{
    if (!$viewbox) {
        return;
    }
    $params['viewbox'] = implode(',', $viewbox);
    $params['bounded'] = '1';
}

function geocodeNominatimPick(array $property, array $params, bool $allowCapArea = false): ?array
{
    $hit = geocodePickBest(geocodeNominatimSearch($params), $property, $allowCapArea);
    if (!$hit) {
        return null;
    }

    return [
        'lat'        => (float) $hit['lat'],
        'lng'        => (float) $hit['lon'],
        'label'      => $hit['display_name'] ?? '',
        'confidence' => geocodePrecisionFromNominatim($hit),
        'source'     => 'nominatim',
        'street'     => $hit['address']['road'] ?? '',
    ];
}

function geocodeTryGoogle(array $property, array $parsed): ?array
{
    $key = env('GOOGLE_GEOCODING_API_KEY', '');
    if (!$key) {
        return null;
    }

    $q = geocodeFormatQuery($property, $parsed);
    $url = 'https://maps.googleapis.com/maps/api/geocode/json?' . http_build_query([
        'address'    => $q,
        'key'        => $key,
        'language'   => 'it',
        'region'     => 'it',
        'components' => 'country:IT|postal_code:' . trim($property['cap'] ?? '') . '|locality:' . trim($property['city'] ?? ''),
    ]);

    $body = geocodeHttpGet($url);
    if (!$body) {
        return null;
    }
    $json = json_decode($body, true);
    if (($json['status'] ?? '') !== 'OK' || empty($json['results'])) {
        return null;
    }

    $cityWanted = geocodeNormalizeText($property['city'] ?? '');
    $capWanted  = trim($property['cap'] ?? '');

    foreach ($json['results'] as $result) {
        $locality = '';
        $postcode = '';
        foreach ($result['address_components'] ?? [] as $comp) {
            $types = $comp['types'] ?? [];
            if (in_array('locality', $types, true) || in_array('administrative_area_level_3', $types, true)) {
                $locality = $comp['long_name'] ?? '';
            }
            if (in_array('postal_code', $types, true)) {
                $postcode = $comp['long_name'] ?? '';
            }
        }

        if ($cityWanted && geocodeNormalizeText($locality) !== $cityWanted) {
            continue;
        }
        if ($capWanted && $postcode && !geocodeCapCompatible($capWanted, $postcode)) {
            continue;
        }

        $loc = $result['geometry']['location'] ?? null;
        if (!$loc) {
            continue;
        }

        return [
            'lat'        => (float) $loc['lat'],
            'lng'        => (float) $loc['lng'],
            'label'      => $result['formatted_address'] ?? $q,
            'confidence' => geocodePrecisionFromGoogle($result['geometry']['location_type'] ?? 'APPROXIMATE'),
            'source'     => 'google',
            'street'     => $parsed['street'],
        ];
    }

    return null;
}

function geocodeTryPhoton(array $property, array $parsed): ?array
{
    $q = geocodeFormatQuery($property, $parsed);
    $url = 'https://photon.komoot.io/api/?' . http_build_query([
        'q'     => $q,
        'limit' => 8,
    ]);

    $body = geocodeHttpGet($url, ['User-Agent: GestionaleImmobiliare/1.0']);
    if (!$body) {
        return null;
    }
    $json = json_decode($body, true);
    if (empty($json['features']) || !is_array($json['features'])) {
        return null;
    }

    $cityWanted = geocodeNormalizeText($property['city'] ?? '');
    $capWanted  = trim($property['cap'] ?? '');
    $best       = null;
    $bestScore  = -999;

    foreach ($json['features'] as $feature) {
        $props = $feature['properties'] ?? [];
        $city  = geocodeNormalizeText($props['city'] ?? $props['locality'] ?? '');
        $cap   = trim((string) ($props['postcode'] ?? ''));

        if ($cityWanted && $city !== $cityWanted) {
            continue;
        }
        if ($capWanted && $cap && !geocodeCapCompatible($capWanted, $cap)) {
            continue;
        }

        $coords = $feature['geometry']['coordinates'] ?? null;
        if (!$coords || count($coords) < 2) {
            continue;
        }

        $resultStreet = trim((string) ($props['street'] ?? $props['name'] ?? ''));
        if ($resultStreet && !geocodeStreetSimilar($parsed['street'], $resultStreet)) {
            continue;
        }

        $score = 0;
        if ($capWanted && $cap === $capWanted) {
            $score += 40;
        }
        if ($cityWanted && $city === $cityWanted) {
            $score += 35;
        }
        if (!empty($props['housenumber'])) {
            $score += 25;
        } elseif (!empty($props['street'])) {
            $score += 10;
        }

        if ($score > $bestScore) {
            $bestScore = $score;
            $confidence = !empty($props['housenumber']) ? 'exact' : (!empty($props['street']) ? 'street' : 'cap_area');
            $best = [
                'lat'        => (float) $coords[1],
                'lng'        => (float) $coords[0],
                'label'      => trim(implode(' ', array_filter([
                    $resultStreet,
                    $props['housenumber'] ?? '',
                    $props['postcode'] ?? '',
                    $props['city'] ?? '',
                ]))),
                'confidence' => $confidence,
                'source'     => 'photon',
                'street'     => $resultStreet,
            ];
        }
    }

    return $best;
}

/**
 * @return array{result:?array,suggested_province:?string}
 */
function geocodeResolve(array $property): array
{
    $address = trim($property['address'] ?? '');
    $city    = trim($property['city'] ?? '');
    $cap     = trim($property['cap'] ?? '');

    if ($address === '' || $city === '') {
        throw new InvalidArgumentException('Indirizzo e Città sono obbligatori.');
    }
    if ($cap === '') {
        throw new InvalidArgumentException('Il CAP è obbligatorio per geocodificare in tutta Italia.');
    }

    $parsed = geocodeParseStreet($address, $city);
    $area   = geocodeGetAreaContext($property);

    if (!$area['validated']) {
        throw new InvalidArgumentException("CAP {$cap} non corrisponde al comune \"{$city}\". Verifica Città e CAP.");
    }

    $viewbox = $area['viewbox'];
    $provInput = trim($property['province'] ?? '');
    $county = geocodeCountyFromProvince($provInput) ?: ($area['suggested_province'] ?? null);

    $base = [
        'addressdetails' => 1,
        'countrycodes'   => 'it',
        'country'        => 'Italia',
        'city'           => $city,
        'postalcode'     => $cap,
    ];
    if ($county) {
        $base['county'] = $county;
    }

    $cascade = [];

    $google = geocodeTryGoogle($property, $parsed);
    if ($google) {
        $cascade[] = $google;
    }

    $structured = $base;
    $structured['street'] = $parsed['street'];
    if ($parsed['housenumber']) {
        $structured['housenumber'] = $parsed['housenumber'];
    }
    $structured['limit'] = 10;
    geocodeApplyViewbox($structured, $viewbox);
    $cascade[] = geocodeNominatimPick($property, $structured);

    $free = $base;
    $free['q']     = geocodeFormatQuery($property, $parsed);
    $free['limit'] = 10;
    geocodeApplyViewbox($free, $viewbox);
    $cascade[] = geocodeNominatimPick($property, $free);

    $cascade[] = geocodeTryPhoton($property, $parsed);

    $streetOnly = $base;
    $streetOnly['street'] = preg_replace('/\s+\d+\s*[A-Za-z\/]?\d*$/u', '', $parsed['street']);
    $streetOnly['limit']  = 8;
    geocodeApplyViewbox($streetOnly, $viewbox);
    $streetHit = geocodeNominatimPick($property, $streetOnly);
    if ($streetHit) {
        $streetHit['confidence'] = 'street';
        $cascade[] = $streetHit;
    }

    $capArea = $base;
    $capArea['limit'] = 5;
    geocodeApplyViewbox($capArea, $viewbox);
    $capHit = geocodeNominatimPick($property, $capArea, true);
    if ($capHit) {
        $capHit['confidence'] = 'cap_area';
        $cascade[] = $capHit;
    } elseif (!empty($area['cap_centroid'])) {
        $cascade[] = [
            'lat'        => $area['cap_centroid']['lat'],
            'lng'        => $area['cap_centroid']['lng'],
            'label'      => trim($cap . ' ' . $city),
            'confidence' => 'cap_area',
            'source'     => 'cap_centroid',
        ];
    }

    $best = geocodePickBestResult($cascade, $property, $parsed);

    return [
        'result'             => $best,
        'suggested_province' => $area['suggested_province'] ?: null,
    ];
}
