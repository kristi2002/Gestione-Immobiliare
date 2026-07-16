<?php
/**
 * Geocoding — HTTP transport and provider cascade (Nominatim, Google, Photon)
 * plus provider-result ranking. Included by config/geocode.php.
 */

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
