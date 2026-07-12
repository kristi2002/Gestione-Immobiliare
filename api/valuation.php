<?php
/**
 * Property valuation engine — OMI quotazioni management + on-demand estimate.
 *
 * OMI quotazioni (per-zone €/m² values, entered manually from the Agenzia delle
 * Entrate OMI database):
 *   GET    /api/valuation.php                    — list OMI rows (comune, search)
 *   GET    /api/valuation.php?id={id}            — single OMI row
 *   POST   /api/valuation.php                    — create/upsert OMI row
 *   PUT    /api/valuation.php?id={id}            — update OMI row
 *   DELETE /api/valuation.php?id={id}            — delete OMI row
 *
 * Estimate (blends OMI range with comparables from the agency's own stock):
 *   GET    /api/valuation.php?action=estimate&property_id={id}
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
apiHandleOptions();

const OMI_TYPES = ['appartamento', 'villa', 'ufficio', 'negozio', 'box', 'terreno', 'altro'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;
    $action = trim($_GET['action'] ?? '');

    if ($method === 'GET' && $action === 'estimate') {
        estimateProperty($db, (int) ($_GET['property_id'] ?? 0));
    }

    switch ($method) {
        case 'GET':
            $id ? getOmi($db, $id) : listOmi($db);
            break;
        case 'POST':
            createOmi($db);
            break;
        case 'PUT':
            if (!$id) apiError('ID quotazione mancante.');
            updateOmi($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID quotazione mancante.');
            deleteOmi($db, $id);
            break;
        default:
            apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------
// Estimate
// ---------------------------------------------------------------------------

function estimateProperty(PDO $db, int $propertyId): void
{
    if ($propertyId <= 0) apiError('property_id mancante.');

    $stmt = $db->prepare('SELECT * FROM properties WHERE id = :id');
    $stmt->execute(['id' => $propertyId]);
    $p = $stmt->fetch();
    if (!$p) apiError('Immobile non trovato.', 404);

    $sqm  = $p['sqm'] !== null ? (float) $p['sqm'] : null;
    $type = $p['property_type'] ?? 'appartamento';

    $result = [
        'property_id'   => $propertyId,
        'address'       => $p['address'],
        'city'          => $p['city'],
        'sqm'           => $sqm,
        'property_type' => $type,
        'omi'           => null,
        'comparables'   => null,
        'suggested'     => null,
        'warnings'      => [],
    ];

    if ($sqm === null || $sqm <= 0) {
        $result['warnings'][] = 'Superficie (m²) mancante: la stima è possibile solo con i m².';
    }

    // --- OMI-based range -----------------------------------------------------
    $omi = null;
    $omiStmt = $db->prepare(
        "SELECT * FROM omi_quotazioni
         WHERE comune = :comune AND property_type = :type
           AND (:zone = '' OR cadastral_zone = :zone2 OR cadastral_zone = '')
         ORDER BY (cadastral_zone = :zone3) DESC
         LIMIT 1"
    );
    $zone = trim((string) ($p['cadastral_zone'] ?? ''));
    $omiStmt->execute([
        'comune' => $p['city'],
        'type'   => $type,
        'zone'   => $zone,
        'zone2'  => $zone,
        'zone3'  => $zone,
    ]);
    $omiRow = $omiStmt->fetch();

    if ($omiRow && $sqm) {
        $vMin = $omiRow['price_min_sqm'] !== null ? (float) $omiRow['price_min_sqm'] * $sqm : null;
        $vMax = $omiRow['price_max_sqm'] !== null ? (float) $omiRow['price_max_sqm'] * $sqm : null;
        $rMin = $omiRow['rent_min_sqm']  !== null ? (float) $omiRow['rent_min_sqm']  * $sqm : null;
        $rMax = $omiRow['rent_max_sqm']  !== null ? (float) $omiRow['rent_max_sqm']  * $sqm : null;
        $omi = [
            'zone'        => $omiRow['cadastral_zone'],
            'period'      => $omiRow['period'],
            'value_min'   => $vMin !== null ? round($vMin) : null,
            'value_max'   => $vMax !== null ? round($vMax) : null,
            'rent_min'    => $rMin !== null ? round($rMin) : null,
            'rent_max'    => $rMax !== null ? round($rMax) : null,
            'price_min_sqm' => (float) $omiRow['price_min_sqm'],
            'price_max_sqm' => (float) $omiRow['price_max_sqm'],
        ];
    } else {
        $result['warnings'][] = 'Nessuna quotazione OMI per ' . $p['city'] . ($zone !== '' ? " (zona $zone)" : '') . ' / ' . $type . '. Inseriscila in Valutazioni.';
    }
    $result['omi'] = $omi;

    // --- Comparables from own stock (same city + type, with a price) ---------
    $cmpStmt = $db->prepare(
        "SELECT id, address, price, price_type, sqm
         FROM properties
         WHERE id <> :id AND city = :city AND property_type = :type
           AND price IS NOT NULL AND price > 0 AND sqm IS NOT NULL AND sqm > 0
           AND status IN ('sold','rented','available')
         ORDER BY updated_at DESC
         LIMIT 8"
    );
    $cmpStmt->execute(['id' => $propertyId, 'city' => $p['city'], 'type' => $type]);
    $rows = $cmpStmt->fetchAll();

    $saleSqmPrices = [];
    $rentSqmPrices = [];
    $sample = [];
    foreach ($rows as $r) {
        $pps = (float) $r['price'] / (float) $r['sqm'];
        if (($r['price_type'] ?? '') === 'vendita') $saleSqmPrices[] = $pps;
        else $rentSqmPrices[] = $pps;
        $sample[] = [
            'address'    => $r['address'],
            'price'      => (float) $r['price'],
            'price_type' => $r['price_type'],
            'sqm'        => (float) $r['sqm'],
            'price_sqm'  => round($pps, 2),
        ];
    }

    $comparables = null;
    if ($sqm && (count($saleSqmPrices) || count($rentSqmPrices))) {
        $comparables = [
            'count'       => count($sample),
            'sample'      => $sample,
            'value_est'   => count($saleSqmPrices) ? round(avg($saleSqmPrices) * $sqm) : null,
            'rent_est'    => count($rentSqmPrices) ? round(avg($rentSqmPrices) * $sqm) : null,
            'sale_sqm_avg'=> count($saleSqmPrices) ? round(avg($saleSqmPrices), 2) : null,
            'rent_sqm_avg'=> count($rentSqmPrices) ? round(avg($rentSqmPrices), 2) : null,
        ];
    } else {
        $result['warnings'][] = 'Comparabili interni insufficienti (stesso comune, stessa tipologia, con prezzo e m²).';
    }
    $result['comparables'] = $comparables;

    // --- Suggested (blend OMI midpoint with comparables) ---------------------
    $valueCandidates = [];
    $rentCandidates  = [];
    if ($omi && $omi['value_min'] !== null && $omi['value_max'] !== null) {
        $valueCandidates[] = ($omi['value_min'] + $omi['value_max']) / 2;
    }
    if ($comparables && $comparables['value_est'] !== null) {
        $valueCandidates[] = $comparables['value_est'];
    }
    if ($omi && $omi['rent_min'] !== null && $omi['rent_max'] !== null) {
        $rentCandidates[] = ($omi['rent_min'] + $omi['rent_max']) / 2;
    }
    if ($comparables && $comparables['rent_est'] !== null) {
        $rentCandidates[] = $comparables['rent_est'];
    }

    $result['suggested'] = [
        'value'        => count($valueCandidates) ? round(avg($valueCandidates)) : null,
        'rent'         => count($rentCandidates) ? round(avg($rentCandidates)) : null,
        'value_min'    => count($valueCandidates) ? round(min($valueCandidates)) : null,
        'value_max'    => count($valueCandidates) ? round(max($valueCandidates)) : null,
        'comparable_1' => $sample[0] ?? null,
        'comparable_2' => $sample[1] ?? null,
        'basis'        => trim(($omi ? 'OMI' : '') . ($omi && $comparables ? ' + ' : '') . ($comparables ? 'comparabili' : '')) ?: 'dati insufficienti',
    ];

    apiSuccess($result);
}

function avg(array $nums): float
{
    return count($nums) ? array_sum($nums) / count($nums) : 0.0;
}

// ---------------------------------------------------------------------------
// OMI CRUD
// ---------------------------------------------------------------------------

function listOmi(PDO $db): void
{
    $pagination = apiGetPagination();
    $comune     = trim($_GET['comune'] ?? '');
    $search     = trim($_GET['search'] ?? '');

    $where = 'WHERE 1=1';
    $params = [];
    if ($comune !== '') { $where .= ' AND comune = :comune'; $params['comune'] = $comune; }
    if ($search !== '') {
        $frag = apiWordSearch($search, ['comune', 'cadastral_zone', 'property_type'], $params);
        if ($frag !== '') $where .= ' AND (' . $frag . ')';
    }

    $countSql = "SELECT COUNT(*) FROM omi_quotazioni $where";
    $dataSql  = "SELECT * FROM omi_quotazioni $where ORDER BY comune, cadastral_zone, property_type";
    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);

    $pages = $total > 0 ? (int) ceil($total / $pagination['limit']) : 0;
    apiSuccess(['items' => $items, 'total' => $total, 'page' => $pagination['page'], 'limit' => $pagination['limit'], 'pages' => $pages]);
}

function getOmi(PDO $db, int $id): void
{
    $stmt = $db->prepare('SELECT * FROM omi_quotazioni WHERE id = :id');
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    if (!$row) apiError('Quotazione non trovata.', 404);
    apiSuccess($row);
}

function createOmi(PDO $db): void
{
    $v = validateOmiInput(apiGetJsonBody());
    $stmt = $db->prepare(
        "INSERT INTO omi_quotazioni (comune, cadastral_zone, property_type, price_min_sqm, price_max_sqm, rent_min_sqm, rent_max_sqm, period, notes)
         VALUES (:comune, :cadastral_zone, :property_type, :price_min_sqm, :price_max_sqm, :rent_min_sqm, :rent_max_sqm, :period, :notes)
         ON DUPLICATE KEY UPDATE
            price_min_sqm = VALUES(price_min_sqm), price_max_sqm = VALUES(price_max_sqm),
            rent_min_sqm = VALUES(rent_min_sqm), rent_max_sqm = VALUES(rent_max_sqm),
            period = VALUES(period), notes = VALUES(notes)"
    );
    $stmt->execute($v);
    logActivity('create', 'omi', (int) $db->lastInsertId(), 'Quotazione OMI: ' . $v['comune'] . ' ' . $v['cadastral_zone']);
    apiSuccess(['message' => 'Quotazione salvata.']);
}

function updateOmi(PDO $db, int $id): void
{
    $stmt = $db->prepare('SELECT id FROM omi_quotazioni WHERE id = :id');
    $stmt->execute(['id' => $id]);
    if (!$stmt->fetch()) apiError('Quotazione non trovata.', 404);

    $v = validateOmiInput(apiGetJsonBody());
    $stmt = $db->prepare(
        "UPDATE omi_quotazioni SET comune = :comune, cadastral_zone = :cadastral_zone, property_type = :property_type,
            price_min_sqm = :price_min_sqm, price_max_sqm = :price_max_sqm,
            rent_min_sqm = :rent_min_sqm, rent_max_sqm = :rent_max_sqm, period = :period, notes = :notes
         WHERE id = :id"
    );
    $stmt->execute(array_merge($v, ['id' => $id]));
    logActivity('update', 'omi', $id, 'Quotazione OMI aggiornata #' . $id);
    getOmi($db, $id);
}

function deleteOmi(PDO $db, int $id): void
{
    $stmt = $db->prepare('SELECT id FROM omi_quotazioni WHERE id = :id');
    $stmt->execute(['id' => $id]);
    if (!$stmt->fetch()) apiError('Quotazione non trovata.', 404);
    $db->prepare('DELETE FROM omi_quotazioni WHERE id = :id')->execute(['id' => $id]);
    logActivity('delete', 'omi', $id, 'Quotazione OMI eliminata #' . $id);
    apiSuccess(['id' => $id, 'message' => 'Quotazione eliminata.']);
}

function validateOmiInput(array $data): array
{
    $comune = trim($data['comune'] ?? '');
    if ($comune === '') apiError('Il comune è obbligatorio.');
    $type = trim($data['property_type'] ?? 'appartamento');
    if (!in_array($type, OMI_TYPES, true)) $type = 'appartamento';

    $numOrNull = static fn($v) => isset($v) && $v !== '' ? (float) $v : null;

    return [
        'comune'         => $comune,
        'cadastral_zone' => trim($data['cadastral_zone'] ?? ''),
        'property_type'  => $type,
        'price_min_sqm'  => $numOrNull($data['price_min_sqm'] ?? null),
        'price_max_sqm'  => $numOrNull($data['price_max_sqm'] ?? null),
        'rent_min_sqm'   => $numOrNull($data['rent_min_sqm'] ?? null),
        'rent_max_sqm'   => $numOrNull($data['rent_max_sqm'] ?? null),
        'period'         => trim($data['period'] ?? '') ?: null,
        'notes'          => trim($data['notes'] ?? '') ?: null,
    ];
}
