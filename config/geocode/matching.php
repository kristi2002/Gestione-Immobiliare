<?php
/**
 * Geocoding — text normalization, address parsing, scoring & match acceptance.
 * Pure helpers (no network I/O). Included by config/geocode.php.
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
