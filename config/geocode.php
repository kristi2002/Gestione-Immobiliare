<?php
/**
 * Italian address geocoding — Google (optional) + Nominatim + Photon cascade.
 *
 * Public entry point: geocodeResolve(array $property): array
 * Implementation is split into cohesive parts:
 *   - geocode/matching.php  text parsing, scoring, match acceptance
 *   - geocode/providers.php  HTTP transport + Nominatim/Google/Photon cascade
 */

require_once __DIR__ . '/geocode/matching.php';
require_once __DIR__ . '/geocode/providers.php';

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
