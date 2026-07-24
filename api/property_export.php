<?php
/**
 * Property Export API — portal-ready formats.
 *
 * GET /api/property_export.php?id=X&format=json  — single property, Immobiliare.it-compatible JSON
 * GET /api/property_export.php?format=xml         — all active properties as XML feed
 * GET /api/property_export.php?format=csv         — all properties as CSV
 *
 * Portal integration note: Immobiliare.it / Idealista / Casa.it ingest listings
 * from a feed URL that THEY are configured to pull, once the agency has a paid
 * account (there is no free/open API). This XML feed is that artifact — publish
 * it at a stable authenticated URL and give it to the portal during onboarding.
 * The exact tag mapping must be aligned to each portal's current spec (supplied
 * with the contract); the tags below are a superset of the common fields.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/rate_limit.php';
apiHandleOptions();
apiRequireMethod('GET');

// Full-dataset export is heavy — cap it so it can't be hammered for scraping/DoS.
checkRateLimit('property_export', 10, 60);

try {
    $db     = getDB();
    $format = trim($_GET['format'] ?? 'json');
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($format) {
        case 'json':
            exportJson($db, $id);
            break;
        case 'xml':
            exportXml($db);
            break;
        case 'csv':
            exportCsv($db);
            break;
        default:
            apiError('Formato non valido. Usa: json, xml, csv.');
    }
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

function fetchProperty(PDO $db, int $id): ?array
{
    $stmt = $db->prepare(
        "SELECT p.*, c.name AS client_name, c.surname AS client_surname, c.phone AS client_phone, c.email AS client_email
         FROM properties p
         LEFT JOIN clients c ON c.id = p.client_id
         WHERE p.id = :id"
    );
    $stmt->execute(['id' => $id]);
    return $stmt->fetch() ?: null;
}

function fetchActiveProperties(PDO $db): array
{
    $stmt = $db->query(
        "SELECT p.*, c.name AS client_name, c.surname AS client_surname, c.phone AS client_phone, c.email AS client_email
         FROM properties p
         LEFT JOIN clients c ON c.id = p.client_id
         WHERE p.status IN ('available', 'rented')
         ORDER BY p.city ASC, p.address ASC"
    );
    return $stmt->fetchAll();
}

// ---------------------------------------------------------------------------
// JSON export (Immobiliare.it-compatible structure)
// ---------------------------------------------------------------------------

function exportJson(PDO $db, ?int $id): void
{
    if ($id) {
        $prop = fetchProperty($db, $id);
        if (!$prop) {
            apiError('Immobile non trovato.', 404);
        }
        $pid = (int) $prop['id'];
        $descMap = fetchDescriptionsMap($db, [$pid]);
        $surfMap = fetchSurfacesMap($db, [$pid]);
        apiSuccess(['property' => buildImmobiliareJson($prop, $descMap[$pid] ?? [], $surfMap[$pid] ?? [])]);
    } else {
        $properties = fetchActiveProperties($db);
        $ids = array_map(static fn($p) => (int) $p['id'], $properties);
        $descMap = fetchDescriptionsMap($db, $ids);
        $surfMap = fetchSurfacesMap($db, $ids);
        apiSuccess([
            'properties' => array_map(
                static fn($p) => buildImmobiliareJson($p, $descMap[(int) $p['id']] ?? [], $surfMap[(int) $p['id']] ?? []),
                $properties
            ),
            'total'      => count($properties),
            'exported_at' => date('c'),
        ]);
    }
}

/** Traduzioni per property_id → [lang => {title, description}]. */
function fetchDescriptionsMap(PDO $db, array $ids): array
{
    if (!$ids) return [];
    $in = implode(',', array_fill(0, count($ids), '?'));
    $map = [];
    try {
        $stmt = $db->prepare("SELECT property_id, lang, title, description
                              FROM property_descriptions WHERE property_id IN ($in)");
        $stmt->execute($ids);
        foreach ($stmt->fetchAll() as $r) {
            $map[(int) $r['property_id']][$r['lang']] = [
                'title'       => $r['title'],
                'description' => $r['description'],
            ];
        }
    } catch (Throwable $e) { /* tabella opzionale (pre-migrazione) */ }
    return $map;
}

/** Righe superficie per property_id. */
function fetchSurfacesMap(PDO $db, array $ids): array
{
    if (!$ids) return [];
    $in = implode(',', array_fill(0, count($ids), '?'));
    $map = [];
    try {
        $stmt = $db->prepare("SELECT property_id, surface_type, floor_label, sqm, weight_percent, commercial_sqm, is_accessory
                              FROM property_surfaces WHERE property_id IN ($in)
                              ORDER BY property_id, sort_order");
        $stmt->execute($ids);
        foreach ($stmt->fetchAll() as $r) {
            $map[(int) $r['property_id']][] = [
                'type'           => $r['surface_type'],
                'floor'          => $r['floor_label'],
                'sqm'            => (float) $r['sqm'],
                'weight_percent' => (float) $r['weight_percent'],
                'commercial_sqm' => (float) $r['commercial_sqm'],
                'is_accessory'   => (bool) $r['is_accessory'],
            ];
        }
    } catch (Throwable $e) { /* tabella opzionale (pre-migrazione) */ }
    return $map;
}

function buildImmobiliareJson(array $p, array $descriptions = [], array $surfaces = []): array
{
    $features = [];
    if (!empty($p['additional_features'])) {
        $decoded = json_decode($p['additional_features'], true);
        $features = is_array($decoded) ? $decoded : [$p['additional_features']];
    }

    $contractType = $p['price_type'] === 'affitto' ? 'locazione' : 'vendita';
    $boolOrNull = static fn($v) => $v === null || $v === '' ? null : (bool) $v;

    return [
        'id'             => (int) $p['id'],
        'reference'      => ($p['reference_code'] ?? null) ?: ('IMM-' . str_pad((string) $p['id'], 6, '0', STR_PAD_LEFT)),
        'contract_type'  => $contractType,
        'category'       => $p['category'] ?? null,
        'property_type'  => $p['property_type'] ?? null,
        'typology'       => $p['typology'] ?? null,
        'status'         => $p['status'],
        'address'        => [
            'street'   => $p['address'],
            'city'     => $p['city'],
            'zip_code' => $p['cap'] ?? null,
            'province' => $p['province'] ?? null,
            'country'  => 'IT',
            'geo'      => ($p['latitude'] && $p['longitude']) ? [
                'lat' => (float) $p['latitude'],
                'lng' => (float) $p['longitude'],
            ] : null,
        ],
        'details'        => [
            'size_sqm'       => $p['sqm'] !== null ? (float) $p['sqm'] : null,
            'rooms'          => $p['rooms'] !== null ? (int) $p['rooms'] : null,
            'other_rooms'    => isset($p['other_rooms']) && $p['other_rooms'] !== null ? (int) $p['other_rooms'] : null,
            'total_rooms'    => $p['locali'] !== null ? (int) $p['locali'] : null,
            'bathrooms'      => $p['bathrooms'] !== null ? (int) $p['bathrooms'] : null,
            'kitchen'        => $p['kitchen_type'] ?? null,
            'floor'          => $p['floor'] ?? null,
            'multi_level'    => $boolOrNull($p['multi_level'] ?? null),
            'total_floors'   => $p['total_floors'] !== null ? (int) $p['total_floors'] : null,
            'year_built'     => $p['year_built'] ?? null,
            'condition'      => $p['condition_state'] ?? null,
            'property_class' => $p['property_class'] ?? null,
            'free_sides'     => isset($p['free_sides']) && $p['free_sides'] !== null ? (int) $p['free_sides'] : null,
            'overlooking'    => $p['overlooking'] ?? null,
            'exposure'       => $p['exposure'] ?? null,
            'furnished'      => $p['furnished'] ?? null,
            'garden'         => $p['garden'] ?? null,
            'garage'         => $p['garage_type'] ?? null,
            'parking_spaces' => $p['parking_spaces'] !== null ? (int) $p['parking_spaces'] : null,
            'balconies'      => $p['balconies'] !== null ? (int) $p['balconies'] : null,
            'terraces'       => $p['terraces'] !== null ? (int) $p['terraces'] : null,
        ],
        'amenities'      => [
            'elevator'        => $boolOrNull($p['elevator'] ?? null),
            'disabled_access' => $boolOrNull($p['disabled_access'] ?? null),
            'wardrobes'       => $boolOrNull($p['wardrobes'] ?? null),
            'cellar'          => $boolOrNull($p['cellar'] ?? null),
            'attic_room'      => $boolOrNull($p['attic_room'] ?? null),
            'tavern'          => $boolOrNull($p['tavern'] ?? null),
            'armored_door'    => $boolOrNull($p['armored_door'] ?? null),
            'alarm_system'    => $boolOrNull($p['alarm_system'] ?? null),
            'electric_gate'   => $boolOrNull($p['electric_gate'] ?? null),
            'video_intercom'  => $boolOrNull($p['video_intercom'] ?? null),
            'optical_fiber'   => $boolOrNull($p['optical_fiber'] ?? null),
            'fireplace'       => $boolOrNull($p['fireplace'] ?? null),
            'jacuzzi'         => $boolOrNull($p['jacuzzi'] ?? null),
            'pool'            => $boolOrNull($p['pool'] ?? null),
            'tennis_court'    => $boolOrNull($p['tennis_court'] ?? null),
            'window_frames'   => $p['window_frames'] ?? null,
            'tv_system'       => $p['tv_system'] ?? null,
            'concierge'       => $p['concierge'] ?? null,
        ],
        'systems'        => [
            'heating'               => $p['heating'] ?? null,
            'heating_system'        => $p['heating_system'] ?? null,
            'heating_fuel'          => $p['heating_fuel'] ?? null,
            'air_conditioning'      => $p['air_conditioning'] ?? null,
            'air_conditioning_type' => $p['air_conditioning_type'] ?? null,
        ],
        'energy'         => [
            'class'     => $p['energy_class'] ?? null,
            'ipe_value' => isset($p['ipe_value']) && $p['ipe_value'] !== null ? (float) $p['ipe_value'] : null,
        ],
        'surfaces'       => $surfaces,
        'pricing'        => [
            'price'            => $p['price'] !== null ? (float) $p['price'] : null,
            'price_on_request' => (bool) ($p['price_on_request'] ?? false),
            'currency'         => 'EUR',
            'type'             => $p['price_type'] ?? null,
            'ownership_type'   => $p['ownership_type'] ?? null,
            'condo_fees'       => isset($p['condo_fees']) && $p['condo_fees'] !== null ? (float) $p['condo_fees'] : null,
            'heating_costs'    => isset($p['heating_costs']) && $p['heating_costs'] !== null ? (float) $p['heating_costs'] : null,
            'vacant'           => $boolOrNull($p['is_vacant'] ?? null),
            'rent_to_own'      => $boolOrNull($p['rent_to_own'] ?? null),
            'investment'       => $boolOrNull($p['investment_property'] ?? null),
        ],
        'title'          => $p['listing_title'] ?? null,
        'description'    => $p['description'] ?? null,
        'translations'   => $descriptions ?: new stdClass(),
        'features'       => $features,
        'brokerage'      => [
            'collaboration' => $p['collaboration'] ?? null,
            'mandate_type'  => $p['mandate_type'] ?? null,
        ],
        'owner'          => [
            'name'  => trim(($p['client_name'] ?? '') . ' ' . ($p['client_surname'] ?? '')),
            'phone' => $p['client_phone'] ?? null,
            'email' => $p['client_email'] ?? null,
        ],
        'published_at'   => $p['created_at'] ?? null,
    ];
}

// ---------------------------------------------------------------------------
// XML export (MLS-like feed)
// ---------------------------------------------------------------------------

function exportXml(PDO $db): void
{
    $properties = fetchActiveProperties($db);
    $ids = array_map(static fn($p) => (int) $p['id'], $properties);
    $descMap = fetchDescriptionsMap($db, $ids);
    $surfMap = fetchSurfacesMap($db, $ids);

    // Public listing images (photos/floor plans), grouped by property. Portals
    // require absolute, publicly reachable image URLs.
    $base = defined('APP_URL') && APP_URL !== '' ? rtrim(APP_URL, '/') : '';
    $mediaMap = [];
    try {
        $mrows = $db->query(
            "SELECT property_id, file_path FROM property_media
             WHERE media_type IN ('photo','floor_plan','house_map')
             ORDER BY property_id, sort_order"
        )->fetchAll();
        foreach ($mrows as $m) {
            $mediaMap[(int) $m['property_id']][] = $base . '/' . ltrim($m['file_path'], '/');
        }
    } catch (Throwable $e) { /* media table optional */ }

    header('Content-Type: application/xml; charset=utf-8');
    header('Content-Disposition: attachment; filename="properties_' . date('Ymd') . '.xml"');

    $doc  = new DOMDocument('1.0', 'UTF-8');
    $doc->formatOutput = true;

    $root = $doc->createElement('PropertiesFeed');
    $root->setAttribute('generated_at', date('c'));
    $root->setAttribute('count', (string) count($properties));
    $doc->appendChild($root);

    foreach ($properties as $p) {
        $propEl = $doc->createElement('Property');
        $root->appendChild($propEl);

        $xmlBool = static fn($v) => $v === null || $v === '' ? '' : ((int) $v ? 'true' : 'false');
        $fields = [
            'ID'            => (string) $p['id'],
            'Reference'     => ($p['reference_code'] ?? null) ?: ('IMM-' . str_pad((string) $p['id'], 6, '0', STR_PAD_LEFT)),
            'Status'        => $p['status'],
            'ContractType'  => $p['price_type'] === 'affitto' ? 'locazione' : 'vendita',
            'Category'      => $p['category'] ?? '',
            'PropertyType'  => $p['property_type'] ?? '',
            'Typology'      => $p['typology'] ?? '',
            'Street'        => $p['address'],
            'City'          => $p['city'],
            'ZipCode'       => $p['cap'] ?? '',
            'Province'      => $p['province'] ?? '',
            'Country'       => 'IT',
            'SizeSqm'       => $p['sqm'] !== null ? (string) $p['sqm'] : '',
            'Rooms'         => $p['rooms'] !== null ? (string) $p['rooms'] : '',
            'OtherRooms'    => isset($p['other_rooms']) && $p['other_rooms'] !== null ? (string) $p['other_rooms'] : '',
            'Bathrooms'     => $p['bathrooms'] !== null ? (string) $p['bathrooms'] : '',
            'Kitchen'       => $p['kitchen_type'] ?? '',
            'Floor'         => $p['floor'] ?? '',
            'MultiLevel'    => $xmlBool($p['multi_level'] ?? null),
            'TotalFloors'   => $p['total_floors'] !== null ? (string) $p['total_floors'] : '',
            'Rooms2'        => $p['locali'] !== null ? (string) $p['locali'] : '',
            'YearBuilt'     => $p['year_built'] !== null ? (string) $p['year_built'] : '',
            'PropertyClass' => $p['property_class'] ?? '',
            'FreeSides'     => isset($p['free_sides']) && $p['free_sides'] !== null ? (string) $p['free_sides'] : '',
            'Overlooking'   => $p['overlooking'] ?? '',
            'EnergyClass'   => $p['energy_class'] ?? '',
            'EnergyIPE'     => $p['ipe_value'] !== null ? (string) $p['ipe_value'] : '',
            'Heating'       => $p['heating'] ?? '',
            'HeatingSystem' => $p['heating_system'] ?? '',
            'HeatingFuel'   => $p['heating_fuel'] ?? '',
            'AirConditioning'     => $p['air_conditioning'] ?? '',
            'AirConditioningType' => $p['air_conditioning_type'] ?? '',
            'Elevator'      => $xmlBool($p['elevator'] ?? null),
            'DisabledAccess'=> $xmlBool($p['disabled_access'] ?? null),
            'Furnished'     => $p['furnished'] ?? '',
            'Garden'        => $p['garden'] ?? '',
            'GarageType'    => $p['garage_type'] ?? '',
            'Balconies'     => $p['balconies'] !== null ? (string) $p['balconies'] : '',
            'Terraces'      => $p['terraces'] !== null ? (string) $p['terraces'] : '',
            'ParkingSpaces' => $p['parking_spaces'] !== null ? (string) $p['parking_spaces'] : '',
            'Wardrobes'     => $xmlBool($p['wardrobes'] ?? null),
            'Cellar'        => $xmlBool($p['cellar'] ?? null),
            'AtticRoom'     => $xmlBool($p['attic_room'] ?? null),
            'Tavern'        => $xmlBool($p['tavern'] ?? null),
            'ArmoredDoor'   => $xmlBool($p['armored_door'] ?? null),
            'AlarmSystem'   => $xmlBool($p['alarm_system'] ?? null),
            'ElectricGate'  => $xmlBool($p['electric_gate'] ?? null),
            'VideoIntercom' => $xmlBool($p['video_intercom'] ?? null),
            'OpticalFiber'  => $xmlBool($p['optical_fiber'] ?? null),
            'Fireplace'     => $xmlBool($p['fireplace'] ?? null),
            'Jacuzzi'       => $xmlBool($p['jacuzzi'] ?? null),
            'Pool'          => $xmlBool($p['pool'] ?? null),
            'TennisCourt'   => $xmlBool($p['tennis_court'] ?? null),
            'WindowFrames'  => $p['window_frames'] ?? '',
            'TvSystem'      => $p['tv_system'] ?? '',
            'Concierge'     => $p['concierge'] ?? '',
            'Exposure'      => $p['exposure'] ?? '',
            'ConditionState'=> $p['condition_state'] ?? '',
            'OwnershipType' => $p['ownership_type'] ?? '',
            'CondoFees'     => $p['condo_fees'] !== null ? (string) $p['condo_fees'] : '',
            'HeatingCosts'  => isset($p['heating_costs']) && $p['heating_costs'] !== null ? (string) $p['heating_costs'] : '',
            'Vacant'        => $xmlBool($p['is_vacant'] ?? null),
            'RentToOwn'     => $xmlBool($p['rent_to_own'] ?? null),
            'Investment'    => $xmlBool($p['investment_property'] ?? null),
            'Price'         => $p['price'] !== null ? (string) $p['price'] : '',
            'PriceOnRequest'=> (int) ($p['price_on_request'] ?? 0) ? 'true' : 'false',
            'Currency'      => 'EUR',
            'Latitude'      => $p['latitude'] !== null ? (string) $p['latitude'] : '',
            'Longitude'     => $p['longitude'] !== null ? (string) $p['longitude'] : '',
            'Title'         => $p['listing_title'] ?? '',
            'Description'   => $p['description'] ?? '',
            'Collaboration' => $p['collaboration'] ?? '',
            'MandateType'   => $p['mandate_type'] ?? '',
            'OwnerName'     => trim(($p['client_name'] ?? '') . ' ' . ($p['client_surname'] ?? '')),
            'OwnerPhone'    => $p['client_phone'] ?? '',
            'PublishedAt'   => $p['created_at'] ?? '',
        ];

        foreach ($fields as $tag => $value) {
            $el = $doc->createElement($tag);
            $el->appendChild($doc->createTextNode($value));
            $propEl->appendChild($el);
        }

        // Righe superficie (consistenza / conteggio % / commerciale)
        $surfs = $surfMap[(int) $p['id']] ?? [];
        if ($surfs) {
            $surfacesEl = $doc->createElement('Surfaces');
            $propEl->appendChild($surfacesEl);
            foreach ($surfs as $s) {
                $sEl = $doc->createElement('Surface');
                $sEl->setAttribute('type', (string) $s['type']);
                $sEl->setAttribute('floor', (string) ($s['floor'] ?? ''));
                $sEl->setAttribute('sqm', (string) $s['sqm']);
                $sEl->setAttribute('weight_percent', (string) $s['weight_percent']);
                $sEl->setAttribute('commercial_sqm', (string) $s['commercial_sqm']);
                $sEl->setAttribute('accessory', $s['is_accessory'] ? 'true' : 'false');
                $surfacesEl->appendChild($sEl);
            }
        }

        // Traduzioni titolo/descrizione per i portali
        $trans = $descMap[(int) $p['id']] ?? [];
        if ($trans) {
            $transEl = $doc->createElement('Translations');
            $propEl->appendChild($transEl);
            foreach ($trans as $lang => $t) {
                $tEl = $doc->createElement('Translation');
                $tEl->setAttribute('lang', (string) $lang);
                $tTitle = $doc->createElement('Title');
                $tTitle->appendChild($doc->createTextNode((string) ($t['title'] ?? '')));
                $tEl->appendChild($tTitle);
                $tDesc = $doc->createElement('Description');
                $tDesc->appendChild($doc->createTextNode((string) ($t['description'] ?? '')));
                $tEl->appendChild($tDesc);
                $transEl->appendChild($tEl);
            }
        }

        // Public image URLs
        $imgs = $mediaMap[(int) $p['id']] ?? [];
        if ($imgs) {
            $imagesEl = $doc->createElement('Images');
            $propEl->appendChild($imagesEl);
            foreach ($imgs as $url) {
                $img = $doc->createElement('Image');
                $img->appendChild($doc->createTextNode($url));
                $imagesEl->appendChild($img);
            }
        }

        // Features as child elements
        if (!empty($p['additional_features'])) {
            $decoded  = json_decode($p['additional_features'], true);
            $features = is_array($decoded) ? $decoded : [$p['additional_features']];
            $featuresEl = $doc->createElement('Features');
            $propEl->appendChild($featuresEl);
            foreach ($features as $feat) {
                $f = $doc->createElement('Feature');
                $f->appendChild($doc->createTextNode((string) $feat));
                $featuresEl->appendChild($f);
            }
        }
    }

    echo $doc->saveXML();
    exit;
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

function exportCsv(PDO $db): void
{
    $properties = fetchActiveProperties($db);

    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="properties_' . date('Ymd') . '.csv"');

    $out = fopen('php://output', 'w');
    // UTF-8 BOM for Excel compatibility
    fwrite($out, "\xEF\xBB\xBF");

    fputcsv($out, [
        'id', 'indirizzo', 'citta', 'cap', 'provincia', 'mq', 'stanze', 'bagni',
        'piano', 'prezzo', 'tipo_prezzo', 'stato', 'tipo_contratto', 'latitudine', 'longitudine',
        'proprietario', 'telefono_proprietario', 'email_proprietario', 'descrizione',
    ]);

    foreach ($properties as $p) {
        fputcsv($out, [
            $p['id'],
            $p['address'],
            $p['city'],
            $p['cap'] ?? '',
            $p['province'] ?? '',
            $p['sqm'] ?? '',
            $p['rooms'] ?? '',
            $p['bathrooms'] ?? '',
            $p['floor'] ?? '',
            $p['price'] ?? '',
            $p['price_type'] ?? '',
            $p['status'],
            $p['price_type'] === 'affitto' ? 'locazione' : 'vendita',
            $p['latitude'] ?? '',
            $p['longitude'] ?? '',
            trim(($p['client_name'] ?? '') . ' ' . ($p['client_surname'] ?? '')),
            $p['client_phone'] ?? '',
            $p['client_email'] ?? '',
            $p['description'] ?? '',
        ]);
    }

    fclose($out);
    exit;
}
