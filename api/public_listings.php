<?php
/**
 * Public listings endpoint for the marketing site (web-orlandi).
 *
 * GET /api/public_listings.php — available properties with coordinates (no auth).
 *
 * Deliberately does NOT use api_bootstrap.php: that bootstrap enforces an
 * admin session + CSRF, while this endpoint must be reachable by anonymous
 * visitors. Only a whitelisted, non-personal field set is exposed and only
 * properties with status 'available'.
 */

ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
if (!ob_get_level()) {
    ob_start();
}

require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/api_helpers.php';

apiHandleOptions();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    apiError('Metodo non consentito.', 405);
}

const PUBLIC_LISTINGS_MAX = 500;

try {
    $db = getDB();

    $where  = ["p.status = 'available'", 'p.latitude IS NOT NULL', 'p.longitude IS NOT NULL'];
    $params = [];

    $priceType = trim((string) ($_GET['price_type'] ?? ''));
    if (in_array($priceType, ['affitto', 'vendita'], true)) {
        $where[]  = 'p.price_type = ?';
        $params[] = $priceType;
    }

    $city = trim((string) ($_GET['city'] ?? ''));
    if ($city !== '' && mb_strlen($city) <= 100) {
        $where[]  = 'p.city LIKE ?';
        $params[] = '%' . $city . '%';
    }

    // energy_class (APE) is legally required in property advertisements
    // (D.Lgs 192/2005 art. 6): the public listing must expose it.
    $sql = "SELECT p.id, p.address, p.city, p.cap, p.province,
                   p.sqm, p.rooms, p.bathrooms, p.property_type,
                   p.energy_class,
                   p.price, p.price_type, p.latitude, p.longitude,
                   COALESCE(
                       (SELECT cm.file_path FROM property_media cm WHERE cm.id = p.cover_media_id LIMIT 1),
                       (SELECT fm.file_path FROM property_media fm
                        WHERE fm.property_id = p.id
                          AND fm.media_type IN ('photo', 'floor_plan', 'house_map')
                          AND fm.mime_type LIKE 'image/%'
                        ORDER BY fm.sort_order ASC, fm.created_at ASC LIMIT 1)
                   ) AS cover_url
            FROM properties p
            WHERE " . implode(' AND ', $where) . '
            ORDER BY p.created_at DESC
            LIMIT ' . PUBLIC_LISTINGS_MAX;

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

    foreach ($items as &$row) {
        $row['latitude']  = (float) $row['latitude'];
        $row['longitude'] = (float) $row['longitude'];
        $row['price']     = $row['price'] !== null ? (float) $row['price'] : null;
    }
    unset($row);

    apiSuccess(['items' => $items, 'total' => count($items)]);
} catch (PDOException $e) {
    error_log('public_listings: ' . $e->getMessage());
    apiError('Errore database.', 500);
}
