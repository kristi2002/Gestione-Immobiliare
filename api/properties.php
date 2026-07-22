<?php
/**
 * Properties (Immobili) CRUD API.
 *
 * GET    /api/properties.php                  — list (search, status, client_id)
 * GET    /api/properties.php?id={id}          — single property with media count
 * POST   /api/properties.php                  — create
 * PUT    /api/properties.php?id={id}          — update
 * DELETE /api/properties.php?id={id}          — archive (soft delete)
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();

const PROPERTY_STATUSES = ['available', 'rented', 'sold', 'archived'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            if (($_GET['format'] ?? '') === 'csv') {
                exportPropertiesCsv($db);
            }
            if (($_GET['action'] ?? '') === 'matching_leads') {
                if (!$id) apiError('ID immobile mancante.');
                matchingLeads($db, $id);
            }
            $id ? getProperty($db, $id) : listProperties($db);
            break;
        case 'POST':
            $postBody = apiGetJsonBody();
            if (($_GET['action'] ?? '') === 'import') {
                importProperties($db);
            } elseif (($_GET['action'] ?? '') === 'bulk' || ($postBody['action'] ?? '') === 'bulk') {
                bulkProperties($db);
            } else {
                createProperty($db);
            }
            break;
        case 'PUT':
            if (!$id) {
                apiError('ID immobile mancante.');
            }
            updateProperty($db, $id);
            break;
        case 'DELETE':
            if (!$id) {
                apiError('ID immobile mancante.');
            }
            deleteProperty($db, $id);
            break;
        default:
            apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    if ($e->getCode() === '23000') {
        apiError('Operazione non consentita: esistono record collegati a questo elemento. Rimuoverli prima di procedere.', 409);
    }
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function listProperties(PDO $db): void
{
    $pagination = apiGetPagination(25, 500);
    $search   = trim($_GET['search'] ?? '');
    $status   = trim($_GET['status'] ?? '');
    $clientId = isset($_GET['client_id']) ? (int) $_GET['client_id'] : null;

    $where = 'WHERE 1=1';
    $params = [];

    if ($search !== '') {
        $frag = apiWordSearch($search, ['p.address', 'p.city', 'p.cap', 'p.province', 'p.description', 'c.name', 'c.surname'], $params);
        if ($frag) $where .= " AND $frag";
    }

    if ($status !== '' && in_array($status, PROPERTY_STATUSES, true)) {
        $where .= ' AND p.status = :status';
        $params['status'] = $status;
    } else {
        $where .= " AND p.status != 'archived'";
    }

    if ($clientId) {
        $where .= ' AND p.client_id = :client_id';
        $params['client_id'] = $clientId;
    }

    // Optional facet filters (power the Immobili filter bar).
    $type = trim($_GET['property_type'] ?? '');
    if ($type !== '') {
        $where .= ' AND p.property_type = :ptype';
        $params['ptype'] = $type;
    }

    $priceType = trim($_GET['price_type'] ?? '');
    if (in_array($priceType, ['vendita', 'affitto'], true)) {
        $where .= ' AND p.price_type = :price_type';
        $params['price_type'] = $priceType;
    }

    if (is_numeric($_GET['min_price'] ?? null)) {
        $where .= ' AND p.price >= :min_price';
        $params['min_price'] = (float) $_GET['min_price'];
    }
    if (is_numeric($_GET['max_price'] ?? null)) {
        $where .= ' AND p.price <= :max_price';
        $params['max_price'] = (float) $_GET['max_price'];
    }
    if (is_numeric($_GET['min_sqm'] ?? null)) {
        $where .= ' AND p.sqm >= :min_sqm';
        $params['min_sqm'] = (int) $_GET['min_sqm'];
    }

    // Whitelisted sort — never interpolate user input into ORDER BY.
    $orderBy = match ($_GET['sort'] ?? '') {
        'price_asc'  => 'p.price ASC',
        'price_desc' => 'p.price DESC',
        'recent'     => 'p.created_at DESC',
        'sqm_desc'   => 'p.sqm DESC',
        default      => 'p.city ASC, p.address ASC',
    };

    $countSql = "SELECT COUNT(*) FROM properties p
            INNER JOIN clients c ON c.id = p.client_id
            $where";

    $dataSql = "SELECT p.id, p.client_id, p.address, p.city, p.cap, p.province, p.sqm,
                   p.rooms, p.bathrooms, p.floor, p.year_built, p.property_type, p.description,
                   p.additional_features, p.internal_notes, p.status,
                   p.price, p.price_type, p.latitude, p.longitude, p.geo_confidence,
                   p.cover_media_id, p.created_at,
                   c.name AS client_name, c.surname AS client_surname,
                   COUNT(m.id) AS media_count,
                   SUM(CASE WHEN m.media_type = 'photo' THEN 1 ELSE 0 END) AS photo_count,
                   (SELECT c2.monthly_rent FROM contracts c2
                    WHERE c2.property_id = p.id
                      AND c2.status NOT IN ('terminated', 'cancelled')
                      AND (c2.end_date IS NULL OR c2.end_date >= CURDATE())
                    ORDER BY c2.start_date DESC LIMIT 1) AS monthly_rent,
                   COALESCE(
                       (SELECT cm.file_path FROM property_media cm WHERE cm.id = p.cover_media_id LIMIT 1),
                       (SELECT fm.file_path FROM property_media fm
                        WHERE fm.property_id = p.id
                          AND fm.media_type IN ('photo', 'floor_plan', 'house_map')
                          AND fm.mime_type LIKE 'image/%'
                        ORDER BY fm.sort_order ASC, fm.created_at ASC LIMIT 1),
                       (SELECT im.file_path FROM property_media im
                        WHERE im.property_id = p.id AND im.mime_type LIKE 'image/%'
                        ORDER BY im.sort_order ASC, im.created_at ASC LIMIT 1)
                   ) AS cover_url
            FROM properties p
            INNER JOIN clients c ON c.id = p.client_id
            LEFT JOIN property_media m ON m.property_id = p.id
            $where
            GROUP BY p.id ORDER BY $orderBy";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getProperty(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT p.*, c.name AS client_name, c.surname AS client_surname,
                COUNT(m.id) AS media_count,
                SUM(CASE WHEN m.media_type = 'photo' THEN 1 ELSE 0 END) AS photo_count,
                COALESCE(
                    (SELECT cm.file_path FROM property_media cm WHERE cm.id = p.cover_media_id LIMIT 1),
                    (SELECT fm.file_path FROM property_media fm
                     WHERE fm.property_id = p.id
                       AND fm.media_type IN ('photo', 'floor_plan', 'house_map')
                       AND fm.mime_type LIKE 'image/%'
                     ORDER BY fm.sort_order ASC, fm.created_at ASC LIMIT 1)
                ) AS cover_url
         FROM properties p
         INNER JOIN clients c ON c.id = p.client_id
         LEFT JOIN property_media m ON m.property_id = p.id
         WHERE p.id = :id
         GROUP BY p.id"
    );
    $stmt->execute(['id' => $id]);
    $property = $stmt->fetch();

    if (!$property) {
        apiError('Immobile non trovato.', 404);
    }

    $histStmt = $db->prepare(
        "SELECT h.old_price, h.new_price, h.old_price_type, h.new_price_type,
                h.changed_at, u.username AS changed_by_name
         FROM property_price_history h
         LEFT JOIN admin_users u ON u.id = h.changed_by
         WHERE h.property_id = :id
         ORDER BY h.changed_at DESC
         LIMIT 10"
    );
    $histStmt->execute(['id' => $id]);
    $property['price_history'] = $histStmt->fetchAll();

    apiSuccess($property);
}

/**
 * Magic Match (reverse): score active buyer/tenant leads against a listing.
 * GET /api/properties.php?action=matching_leads&id={property_id}
 */
function matchingLeads(PDO $db, int $id): void
{
    $stmt = $db->prepare('SELECT * FROM properties WHERE id = :id');
    $stmt->execute(['id' => $id]);
    $p = $stmt->fetch();
    if (!$p) apiError('Immobile non trovato.', 404);

    // A rental listing matches renters (affitto/entrambi); a sale matches buyers.
    $wantInterest = ($p['price_type'] ?? 'affitto') === 'vendita'
        ? ['acquisto', 'entrambi']
        : ['affitto', 'entrambi'];
    $in = implode(',', array_fill(0, count($wantInterest), '?'));

    $sql = "SELECT * FROM leads
            WHERE status IN ('new','contacted','interested','negotiating')
              AND interest_type IN ($in)";
    $stmt = $db->prepare($sql);
    $stmt->execute($wantInterest);
    $leads = $stmt->fetchAll();

    $price = $p['price'] !== null ? (float) $p['price'] : null;
    $matches = [];

    foreach ($leads as $l) {
        $score   = 0;
        $reasons = [];

        if (!empty($l['preferred_city']) && !empty($p['city'])
            && mb_strtolower(trim($l['preferred_city'])) === mb_strtolower(trim($p['city']))) {
            $score += 30; $reasons[] = 'Città';
        }
        if (!empty($l['preferred_type']) && $l['preferred_type'] === $p['property_type']) {
            $score += 25; $reasons[] = 'Tipologia';
        }
        if ($price !== null) {
            $min = $l['budget_min'] !== null ? (float) $l['budget_min'] : null;
            $max = $l['budget_max'] !== null ? (float) $l['budget_max'] : null;
            $okMin = $min === null || $price >= $min;
            $okMax = $max === null || $price <= $max;
            if ($okMin && $okMax && ($min !== null || $max !== null)) {
                $score += 30; $reasons[] = 'Budget';
            }
        }
        if (!empty($l['min_rooms']) && $p['rooms'] !== null && (int) $p['rooms'] >= (int) $l['min_rooms']) {
            $score += 10; $reasons[] = 'Locali';
        }
        if (!empty($l['min_sqm']) && $p['sqm'] !== null && (float) $p['sqm'] >= (float) $l['min_sqm']) {
            $score += 5; $reasons[] = 'Superficie';
        }

        if ($score <= 0) continue;

        $matches[] = [
            'id'       => (int) $l['id'],
            'name'     => trim(($l['name'] ?? '') . ' ' . ($l['surname'] ?? '')),
            'phone'    => $l['phone'] ?? null,
            'email'    => $l['email'] ?? null,
            'status'   => $l['status'],
            'interest_type' => $l['interest_type'],
            'budget_min' => $l['budget_min'] !== null ? (float) $l['budget_min'] : null,
            'budget_max' => $l['budget_max'] !== null ? (float) $l['budget_max'] : null,
            'score'    => $score,
            'reasons'  => $reasons,
        ];
    }

    usort($matches, fn($a, $b) => $b['score'] <=> $a['score']);
    $matches = array_slice($matches, 0, 5);

    apiSuccess([
        'property' => [
            'id'         => (int) $p['id'],
            'address'    => $p['address'],
            'city'       => $p['city'],
            'price'      => $price,
            'price_type' => $p['price_type'],
        ],
        'matches' => $matches,
    ]);
}

function createProperty(PDO $db): void
{
    $data      = apiGetJsonBody();
    $validated = validatePropertyInput($db, $data);

    $stmt = $db->prepare(
        "INSERT INTO properties
            (client_id, building_id, address, city, cap, province, sqm, rooms, bathrooms, floor,
             year_built, property_type, description, additional_features, internal_notes, status,
             price, price_type, latitude, longitude, geo_confidence,
             locali, total_floors, energy_class, heating, elevator, furnished, balconies, terraces,
             garden, parking_spaces, condition_state, exposure, condo_fees, reference_code,
             cadastral_comune, cadastral_foglio, cadastral_particella, cadastral_subalterno,
             cadastral_category, cadastral_class, cadastral_rendita, cadastral_zone,
             ape_number, ape_issue_date, ape_expiry_date, ipe_value)
         VALUES
            (:client_id, :building_id, :address, :city, :cap, :province, :sqm, :rooms, :bathrooms, :floor,
             :year_built, :property_type, :description, :additional_features, :internal_notes, :status,
             :price, :price_type, :latitude, :longitude, :geo_confidence,
             :locali, :total_floors, :energy_class, :heating, :elevator, :furnished, :balconies, :terraces,
             :garden, :parking_spaces, :condition_state, :exposure, :condo_fees, :reference_code,
             :cadastral_comune, :cadastral_foglio, :cadastral_particella, :cadastral_subalterno,
             :cadastral_category, :cadastral_class, :cadastral_rendita, :cadastral_zone,
             :ape_number, :ape_issue_date, :ape_expiry_date, :ipe_value)"
    );
    $stmt->execute($validated);

    $newId = (int) $db->lastInsertId();
    logActivity('create', 'property', $newId, 'Immobile creato: ' . ($validated['address'] ?? ('#' . $newId)));
    getProperty($db, $newId);
}

function updateProperty(PDO $db, int $id): void
{
    $stmt = $db->prepare('SELECT price, price_type FROM properties WHERE id = :id');
    $stmt->execute(['id' => $id]);
    $existing = $stmt->fetch();
    if (!$existing) {
        apiError('Immobile non trovato.', 404);
    }

    $data      = apiGetJsonBody();
    $validated = validatePropertyInput($db, $data);

    // Compare numerically — the DB stores DECIMAL (e.g. "1413.00") while the
    // submitted value is a float, so a string compare would always differ.
    $oldPriceNum = $existing['price'] !== null ? (float) $existing['price'] : null;
    $newPriceNum = $validated['price'] !== null ? (float) $validated['price'] : null;

    $priceValueChanged = (($oldPriceNum === null) !== ($newPriceNum === null))
        || ($oldPriceNum !== null && $newPriceNum !== null && abs($oldPriceNum - $newPriceNum) >= 0.005);

    $typeChanged = (string) ($existing['price_type'] ?? '') !== (string) ($validated['price_type'] ?? '');

    // Only log a price-type change when an actual price exists (avoids empty noise rows).
    $priceChanged = $priceValueChanged
        || ($typeChanged && ($oldPriceNum !== null || $newPriceNum !== null));

    if ($priceChanged) {
        $hist = $db->prepare(
            'INSERT INTO property_price_history
             (property_id, old_price, new_price, old_price_type, new_price_type, changed_by)
             VALUES (:property_id, :old_price, :new_price, :old_price_type, :new_price_type, :changed_by)'
        );
        $hist->execute([
            'property_id'    => $id,
            'old_price'      => $existing['price'],
            'new_price'      => $validated['price'],
            'old_price_type' => $existing['price_type'],
            'new_price_type' => $validated['price_type'],
            'changed_by'     => getCurrentAdminId(),
        ]);
    }

    $stmt = $db->prepare(
        "UPDATE properties
         SET client_id = :client_id, building_id = :building_id, address = :address, city = :city, cap = :cap,
             province = :province, sqm = :sqm, rooms = :rooms, bathrooms = :bathrooms, floor = :floor,
             year_built = :year_built, property_type = :property_type,
             description = :description, additional_features = :additional_features,
             internal_notes = :internal_notes, status = :status,
             price = :price, price_type = :price_type,
             latitude = :latitude, longitude = :longitude, geo_confidence = :geo_confidence,
             locali = :locali, total_floors = :total_floors, energy_class = :energy_class,
             heating = :heating, elevator = :elevator, furnished = :furnished,
             balconies = :balconies, terraces = :terraces, garden = :garden,
             parking_spaces = :parking_spaces, condition_state = :condition_state,
             exposure = :exposure, condo_fees = :condo_fees, reference_code = :reference_code,
             cadastral_comune = :cadastral_comune, cadastral_foglio = :cadastral_foglio,
             cadastral_particella = :cadastral_particella, cadastral_subalterno = :cadastral_subalterno,
             cadastral_category = :cadastral_category, cadastral_class = :cadastral_class,
             cadastral_rendita = :cadastral_rendita, cadastral_zone = :cadastral_zone,
             ape_number = :ape_number, ape_issue_date = :ape_issue_date,
             ape_expiry_date = :ape_expiry_date, ipe_value = :ipe_value
         WHERE id = :id"
    );
    $stmt->execute(array_merge($validated, ['id' => $id]));

    logActivity('update', 'property', $id, 'Immobile aggiornato #' . $id);
    getProperty($db, $id);
}

function deleteProperty(PDO $db, int $id): void
{
    if (!fetchPropertyById($db, $id)) {
        apiError('Immobile non trovato.', 404);
    }

    $stmt = $db->prepare("UPDATE properties SET status = 'archived' WHERE id = :id");
    $stmt->execute(['id' => $id]);

    logActivity('delete', 'property', $id, 'Immobile archiviato #' . $id);
    apiSuccess(['id' => $id, 'message' => 'Immobile archiviato.']);
}

function bulkProperties(PDO $db): void
{
    $data = apiGetJsonBody();
    $operation = trim($data['action'] ?? '');
    if ($operation === 'bulk') {
        $operation = trim($data['operation'] ?? '');
    }
    $ids = normalizeBulkIds($data['ids'] ?? []);

    if ($operation === 'archive') {
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $db->prepare("UPDATE properties SET status = 'archived' WHERE id IN ($placeholders)");
        $stmt->execute($ids);
        apiSuccess(['updated' => $stmt->rowCount(), 'action' => 'archive']);
    } elseif ($operation === 'assign') {
        $clientId = !empty($data['client_id']) ? (int) $data['client_id'] : 0;
        if ($clientId <= 0) {
            apiError('client_id obbligatorio per la riassegnazione.');
        }
        $check = $db->prepare("SELECT id FROM clients WHERE id = :id AND status != 'archived'");
        $check->execute(['id' => $clientId]);
        if (!$check->fetch()) {
            apiError('Proprietario non trovato o archiviato.');
        }
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $db->prepare("UPDATE properties SET client_id = ? WHERE id IN ($placeholders)");
        $stmt->execute(array_merge([$clientId], $ids));
        apiSuccess(['updated' => $stmt->rowCount(), 'action' => 'assign', 'client_id' => $clientId]);
    } else {
        apiError('Azione bulk non valida. Usa: archive, assign.');
    }
}

function normalizeBulkIds(array $ids): array
{
    if (!is_array($ids) || empty($ids)) {
        apiError('Nessun ID selezionato.');
    }
    $ids = array_values(array_unique(array_filter(array_map('intval', $ids), fn($id) => $id > 0)));
    if (empty($ids)) {
        apiError('ID non validi.');
    }
    return $ids;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validatePropertyInput(PDO $db, array $data): array
{
    $clientId   = (int) ($data['client_id'] ?? 0);
    $buildingId = !empty($data['building_id']) ? (int) $data['building_id'] : null;
    $address   = trim($data['address'] ?? '');
    $city      = trim($data['city'] ?? '');
    $cap       = trim($data['cap'] ?? '') ?: null;
    $province  = trim($data['province'] ?? '') ?: null;
    $sqm       = isset($data['sqm']) && $data['sqm'] !== '' ? (float) $data['sqm'] : null;
    $rooms     = isset($data['rooms']) && $data['rooms'] !== '' ? (int) $data['rooms'] : null;
    $bathrooms = isset($data['bathrooms']) && $data['bathrooms'] !== '' ? (int) $data['bathrooms'] : null;
    $floor        = trim($data['floor'] ?? '') ?: null;
    $yearBuilt    = isset($data['year_built']) && $data['year_built'] !== '' ? (int) $data['year_built'] : null;
    $propertyType = trim($data['property_type'] ?? 'appartamento');
    $desc         = trim($data['description'] ?? '') ?: null;
    $features  = trim($data['additional_features'] ?? '') ?: null;
    $notes     = trim($data['internal_notes'] ?? '') ?: null;
    $status    = trim($data['status'] ?? 'available');
    $price     = isset($data['price']) && $data['price'] !== '' ? (float) $data['price'] : null;
    $priceType = trim($data['price_type'] ?? 'affitto');
    $latitude  = isset($data['latitude']) && $data['latitude'] !== '' ? (float) $data['latitude'] : null;
    $longitude = isset($data['longitude']) && $data['longitude'] !== '' ? (float) $data['longitude'] : null;
    $geoConf   = trim($data['geo_confidence'] ?? '') ?: null;
    if ($geoConf !== null && !in_array($geoConf, ['exact', 'street', 'cap_area'], true)) {
        $geoConf = null;
    }

    // immobiliare.it-compatible fields (all optional)
    $intOrNull = static fn($v) => isset($v) && $v !== '' ? (int) $v : null;
    $locali         = $intOrNull($data['locali'] ?? null);
    $totalFloors    = $intOrNull($data['total_floors'] ?? null);
    $balconies      = $intOrNull($data['balconies'] ?? null);
    $terraces       = $intOrNull($data['terraces'] ?? null);
    $parkingSpaces  = $intOrNull($data['parking_spaces'] ?? null);
    $elevator       = isset($data['elevator']) && $data['elevator'] !== '' ? (int) (bool) $data['elevator'] : null;
    $condoFees      = isset($data['condo_fees']) && $data['condo_fees'] !== '' ? (float) $data['condo_fees'] : null;
    $energyClass    = trim($data['energy_class'] ?? '') ?: null;
    $heating        = trim($data['heating'] ?? '') ?: null;
    $furnished      = trim($data['furnished'] ?? '') ?: null;
    $garden         = trim($data['garden'] ?? '') ?: null;
    $conditionState = trim($data['condition_state'] ?? '') ?: null;
    $exposure       = trim($data['exposure'] ?? '') ?: null;
    $referenceCode  = trim($data['reference_code'] ?? '') ?: null;

    // Dati catastali (structured) + APE tracking — all optional
    $strOrNull      = static fn($v) => isset($v) && trim((string) $v) !== '' ? trim((string) $v) : null;
    $dateOrNull     = static function ($v) {
        $v = isset($v) ? trim((string) $v) : '';
        return $v !== '' && DateTime::createFromFormat('Y-m-d', $v) ? $v : null;
    };
    $catComune      = $strOrNull($data['cadastral_comune'] ?? null);
    $catFoglio      = $strOrNull($data['cadastral_foglio'] ?? null);
    $catParticella  = $strOrNull($data['cadastral_particella'] ?? null);
    $catSubalterno  = $strOrNull($data['cadastral_subalterno'] ?? null);
    $catCategory    = $strOrNull($data['cadastral_category'] ?? null);
    $catClass       = $strOrNull($data['cadastral_class'] ?? null);
    $catRendita     = isset($data['cadastral_rendita']) && $data['cadastral_rendita'] !== '' ? (float) $data['cadastral_rendita'] : null;
    $catZone        = $strOrNull($data['cadastral_zone'] ?? null);
    $apeNumber      = $strOrNull($data['ape_number'] ?? null);
    $apeIssueDate   = $dateOrNull($data['ape_issue_date'] ?? null);
    $apeExpiryDate  = $dateOrNull($data['ape_expiry_date'] ?? null);
    $ipeValue       = isset($data['ipe_value']) && $data['ipe_value'] !== '' ? (float) $data['ipe_value'] : null;

    // APE is valid 10 years — auto-fill expiry from the issue date when omitted.
    if ($apeExpiryDate === null && $apeIssueDate !== null) {
        $apeExpiryDate = (new DateTime($apeIssueDate))->modify('+10 years')->format('Y-m-d');
    }

    if ($clientId <= 0) {
        apiError('Seleziona un proprietario.');
    }
    if ($address === '') {
        apiError('L\'indirizzo è obbligatorio.');
    }
    if ($city === '') {
        apiError('La città è obbligatoria.');
    }
    if (!in_array($status, PROPERTY_STATUSES, true)) {
        apiError('Stato non valido.');
    }
    if (!in_array($priceType, ['affitto', 'vendita'], true)) {
        apiError('Tipo prezzo non valido.');
    }
    $validTypes = ['appartamento', 'villa', 'ufficio', 'negozio', 'box', 'terreno', 'altro'];
    if (!in_array($propertyType, $validTypes, true)) {
        $propertyType = 'appartamento';
    }
    if ($yearBuilt !== null && ($yearBuilt < 1800 || $yearBuilt > (int) date('Y'))) {
        apiError('Anno di costruzione non valido.');
    }
    if ($sqm !== null && $sqm < 0) {
        apiError('I metri quadri non possono essere negativi.');
    }
    if ($rooms !== null && $rooms < 0) {
        apiError('Il numero di stanze non può essere negativo.');
    }
    if ($bathrooms !== null && $bathrooms < 0) {
        apiError('Il numero di bagni non può essere negativo.');
    }

    $clientStmt = $db->prepare("SELECT id FROM clients WHERE id = :id AND status != 'archived'");
    $clientStmt->execute(['id' => $clientId]);
    if (!$clientStmt->fetch()) {
        apiError('Proprietario non trovato o archiviato.');
    }

    if ($buildingId !== null) {
        $buildingStmt = $db->prepare('SELECT id FROM buildings WHERE id = :id');
        $buildingStmt->execute(['id' => $buildingId]);
        if (!$buildingStmt->fetch()) {
            apiError('Edificio non trovato.');
        }
    }

    return [
        'client_id'           => $clientId,
        'building_id'         => $buildingId,
        'address'             => $address,
        'city'                => $city,
        'cap'                 => $cap,
        'province'            => $province,
        'sqm'                 => $sqm,
        'rooms'               => $rooms,
        'bathrooms'           => $bathrooms,
        'floor'               => $floor,
        'year_built'          => $yearBuilt,
        'property_type'       => $propertyType,
        'description'         => $desc,
        'additional_features' => $features,
        'internal_notes'      => $notes,
        'status'              => $status,
        'price'               => $price,
        'price_type'          => $priceType,
        'latitude'            => $latitude,
        'longitude'           => $longitude,
        'geo_confidence'      => $geoConf,
        'locali'              => $locali,
        'total_floors'        => $totalFloors,
        'energy_class'        => $energyClass,
        'heating'             => $heating,
        'elevator'            => $elevator,
        'furnished'           => $furnished,
        'balconies'           => $balconies,
        'terraces'            => $terraces,
        'garden'              => $garden,
        'parking_spaces'      => $parkingSpaces,
        'condition_state'     => $conditionState,
        'exposure'            => $exposure,
        'condo_fees'          => $condoFees,
        'reference_code'      => $referenceCode,
        'cadastral_comune'     => $catComune,
        'cadastral_foglio'     => $catFoglio,
        'cadastral_particella' => $catParticella,
        'cadastral_subalterno' => $catSubalterno,
        'cadastral_category'   => $catCategory,
        'cadastral_class'      => $catClass,
        'cadastral_rendita'    => $catRendita,
        'cadastral_zone'       => $catZone,
        'ape_number'           => $apeNumber,
        'ape_issue_date'       => $apeIssueDate,
        'ape_expiry_date'      => $apeExpiryDate,
        'ipe_value'            => $ipeValue,
    ];
}

function fetchPropertyById(PDO $db, int $id): ?array
{
    $stmt = $db->prepare("SELECT id FROM properties WHERE id = :id");
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    return $row ?: null;
}

// ---------------------------------------------------------------------------
// CSV export / import
// ---------------------------------------------------------------------------

function exportPropertiesCsv(PDO $db): void
{
    $rows = $db->query(
        "SELECT p.address, p.city, p.cap, p.sqm, p.rooms, p.bathrooms,
                p.price, p.price_type, p.status,
                c.name AS client_name, c.surname AS client_surname
         FROM properties p
         INNER JOIN clients c ON c.id = p.client_id
         WHERE p.status != 'archived'
         ORDER BY p.city ASC, p.address ASC"
    )->fetchAll();

    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="immobili_' . date('Ymd') . '.csv"');

    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");
    fputcsv($out, ['indirizzo', 'citta', 'cap', 'mq', 'stanze', 'bagni', 'prezzo', 'tipo_prezzo', 'stato', 'proprietario']);
    foreach ($rows as $r) {
        fputcsv($out, [
            $r['address'], $r['city'], $r['cap'], $r['sqm'], $r['rooms'], $r['bathrooms'],
            $r['price'], $r['price_type'], $r['status'],
            trim($r['client_surname'] . ' ' . $r['client_name']),
        ]);
    }
    fclose($out);
    exit;
}

function importProperties(PDO $db): void
{
    $data     = apiGetJsonBody();
    $rows     = $data['rows'] ?? [];
    $clientId = (int) ($data['client_id'] ?? 0);

    if (!is_array($rows) || empty($rows)) {
        apiError('Nessuna riga da importare.');
    }
    if ($clientId <= 0) {
        apiError('Seleziona un proprietario per le righe importate.');
    }

    $check = $db->prepare("SELECT id FROM clients WHERE id = :id AND status != 'archived'");
    $check->execute(['id' => $clientId]);
    if (!$check->fetch()) {
        apiError('Proprietario non valido.');
    }

    $imported = 0;
    $errors   = [];
    $stmt = $db->prepare(
        "INSERT INTO properties
            (client_id, address, city, cap, sqm, rooms, bathrooms, status, price, price_type)
         VALUES
            (:client_id, :address, :city, :cap, :sqm, :rooms, :bathrooms, :status, :price, :price_type)"
    );

    foreach ($rows as $i => $row) {
        $address = trim((string) ($row['indirizzo'] ?? ''));
        $city    = trim((string) ($row['citta'] ?? ''));
        if ($address === '' || $city === '') {
            $errors[] = 'Riga ' . ($i + 1) . ': indirizzo/città mancante.';
            continue;
        }
        $status    = trim((string) ($row['stato'] ?? 'available'));
        $priceType = trim((string) ($row['tipo_prezzo'] ?? 'affitto'));
        if (!in_array($status, PROPERTY_STATUSES, true))    $status = 'available';
        if (!in_array($priceType, ['affitto', 'vendita'], true)) $priceType = 'affitto';

        $stmt->execute([
            'client_id'  => $clientId,
            'address'    => $address,
            'city'       => $city,
            'cap'        => trim((string) ($row['cap'] ?? '')) ?: null,
            'sqm'        => ($row['mq'] ?? '') !== '' ? (float) $row['mq'] : null,
            'rooms'      => ($row['stanze'] ?? '') !== '' ? (int) $row['stanze'] : null,
            'bathrooms'  => ($row['bagni'] ?? '') !== '' ? (int) $row['bagni'] : null,
            'status'     => $status,
            'price'      => ($row['prezzo'] ?? '') !== '' ? (float) $row['prezzo'] : null,
            'price_type' => $priceType,
        ]);
        $imported++;
    }

    apiSuccess(['imported' => $imported, 'errors' => $errors]);
}
