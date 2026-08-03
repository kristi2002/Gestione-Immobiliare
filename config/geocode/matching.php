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

/**
 * Nome provincia (come lo restituiscono Nominatim/Photon) -> sigla di 2 lettere.
 *
 * La colonna `province` contiene ovunque la sigla ("MC", "MO", "RE"). Il
 * percorso di autocompletamento la convertiva già; quello di geocodifica
 * puntuale (geocode_resolve) restituiva invece il nome esteso, e il form lo
 * scriveva tale e quale: due indirizzi identici finivano in DB come "MC" o
 * "Macerata" a seconda del campo da cui l'agente era partito, rompendo filtri
 * e ricerche per provincia. La mappa sta qui perché serve a entrambi.
 *
 * Un valore non mappato torna stringa vuota: meglio nessun suggerimento che
 * sporcare la colonna con un formato diverso da tutti gli altri.
 */
function geocodeProvinceCode(string $county): string
{
    $c = trim($county);
    if ($c === '') return '';
    // Già una sigla ("MC", "RM"): lasciala com'è.
    if (preg_match('/^[A-Z]{2}$/', $c)) return $c;

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
