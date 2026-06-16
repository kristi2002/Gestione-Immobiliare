<?php
/**
 * Property Export API — portal-ready formats.
 *
 * GET /api/property_export.php?id=X&format=json  — single property, Immobiliare.it-compatible JSON
 * GET /api/property_export.php?format=xml         — all active properties as XML feed
 * GET /api/property_export.php?format=csv         — all properties as CSV
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
apiHandleOptions();
apiRequireMethod('GET');

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
        apiSuccess(['property' => buildImmobiliareJson($prop)]);
    } else {
        $properties = fetchActiveProperties($db);
        apiSuccess([
            'properties' => array_map('buildImmobiliareJson', $properties),
            'total'      => count($properties),
            'exported_at' => date('c'),
        ]);
    }
}

function buildImmobiliareJson(array $p): array
{
    $features = [];
    if (!empty($p['additional_features'])) {
        $decoded = json_decode($p['additional_features'], true);
        $features = is_array($decoded) ? $decoded : [$p['additional_features']];
    }

    $contractType = $p['price_type'] === 'affitto' ? 'locazione' : 'vendita';

    return [
        'id'             => (int) $p['id'],
        'reference'      => 'IMM-' . str_pad((string) $p['id'], 6, '0', STR_PAD_LEFT),
        'contract_type'  => $contractType,
        'property_type'  => $p['property_type'] ?? null,
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
            'size_sqm'   => $p['sqm'] !== null ? (float) $p['sqm'] : null,
            'rooms'      => $p['rooms'] !== null ? (int) $p['rooms'] : null,
            'bathrooms'  => $p['bathrooms'] !== null ? (int) $p['bathrooms'] : null,
            'floor'      => $p['floor'] ?? null,
            'year_built' => $p['year_built'] ?? null,
        ],
        'pricing'        => [
            'price'    => $p['price'] !== null ? (float) $p['price'] : null,
            'currency' => 'EUR',
            'type'     => $p['price_type'] ?? null,
        ],
        'description'    => $p['description'] ?? null,
        'features'       => $features,
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

        $fields = [
            'ID'            => (string) $p['id'],
            'Reference'     => 'IMM-' . str_pad((string) $p['id'], 6, '0', STR_PAD_LEFT),
            'Status'        => $p['status'],
            'ContractType'  => $p['price_type'] === 'affitto' ? 'locazione' : 'vendita',
            'PropertyType'  => $p['property_type'] ?? '',
            'Street'        => $p['address'],
            'City'          => $p['city'],
            'ZipCode'       => $p['cap'] ?? '',
            'Province'      => $p['province'] ?? '',
            'Country'       => 'IT',
            'SizeSqm'       => $p['sqm'] !== null ? (string) $p['sqm'] : '',
            'Rooms'         => $p['rooms'] !== null ? (string) $p['rooms'] : '',
            'Bathrooms'     => $p['bathrooms'] !== null ? (string) $p['bathrooms'] : '',
            'Floor'         => $p['floor'] ?? '',
            'Price'         => $p['price'] !== null ? (string) $p['price'] : '',
            'Currency'      => 'EUR',
            'Latitude'      => $p['latitude'] !== null ? (string) $p['latitude'] : '',
            'Longitude'     => $p['longitude'] !== null ? (string) $p['longitude'] : '',
            'Description'   => $p['description'] ?? '',
            'OwnerName'     => trim(($p['client_name'] ?? '') . ' ' . ($p['client_surname'] ?? '')),
            'OwnerPhone'    => $p['client_phone'] ?? '',
            'PublishedAt'   => $p['created_at'] ?? '',
        ];

        foreach ($fields as $tag => $value) {
            $el = $doc->createElement($tag);
            $el->appendChild($doc->createTextNode($value));
            $propEl->appendChild($el);
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
