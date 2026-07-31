<?php
/**
 * Buildings / Complex Grouping CRUD API.
 *
 * GET    /api/buildings.php              — paginated list (unit_count, occupancy_count)
 * GET    /api/buildings.php?id={id}      — single building + linked properties
 * POST   /api/buildings.php              — create
 * PUT    /api/buildings.php?id={id}      — update
 * DELETE /api/buildings.php?id={id}      — delete (only if no linked properties)
 * POST   /api/buildings.php?id={id}&action=link_property   — body: {property_id}
 * DELETE /api/buildings.php?id={id}&action=unlink_property&property_id=Y
 *
 * Condominio (phase77):
 * POST   /api/buildings.php?id={id}&action=generate_units      — bulk-crea le unita' figlie
 * GET    /api/buildings.php?id={id}&action=millesimi           — tabelle millesimali
 * PUT    /api/buildings.php?id={id}&action=millesimi           — sostituisce una tabella
 * POST   /api/buildings.php?id={id}&action=distribute_expense  — ripartisce una spesa
 * GET    /api/buildings.php?id={id}&action=documents           — documenti condominiali
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
apiHandleOptions();

/** Tipi di tabella millesimale ammessi (allineato all'ENUM building_millesimi.table_type). */
const MILLESIMI_TABLES = ['proprieta', 'riscaldamento', 'ascensore', 'scale', 'acqua', 'altro'];

/** Categorie spesa ammesse (allineato all'ENUM expenses.category dopo phase77). */
const BUILDING_EXPENSE_CATEGORIES = ['manutenzione', 'utenze', 'tasse', 'assicurazione', 'agenzia', 'condominio', 'altro'];

/**
 * Un'unita' e' "occupata" quando ha una locazione in corso OGGI con un inquilino attivo.
 *
 * Tre condizioni, tutte necessarie — la versione precedente ne aveva una sola
 * (end_date nel futuro) e quindi contava come occupati anche i contratti in
 * bozza, quelli annullati e quelli che iniziano il mese prossimo:
 *   - status: NULL = "Automatico" (phase69, stato derivato dalle date) oppure
 *     'signed'. Stessa condizione del filtro "Attivi" di api/contracts.php.
 *   - start_date <= oggi: un contratto firmato che decorre a settembre non
 *     rende l'appartamento occupato ad agosto.
 *   - end_date >= oggi (o aperta).
 */
const OCCUPANCY_EXISTS_SQL = "EXISTS (
    SELECT 1 FROM contracts c
    INNER JOIN tenants tn ON tn.id = c.tenant_id AND tn.status = 'active'
    WHERE c.property_id = p.id
      AND (c.status IS NULL OR c.status = 'signed')
      AND (c.start_date IS NULL OR c.start_date <= CURDATE())
      AND (c.end_date   IS NULL OR c.end_date   >= CURDATE())
)";

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;
    $action = trim($_GET['action'] ?? '');

    switch ($method) {
        case 'GET':
            if ($action === 'stats') {
                buildingStats($db);
            }
            if ($id && $action === 'millesimi') {
                listMillesimi($db, $id);
            }
            if ($id && $action === 'documents') {
                listBuildingDocuments($db, $id);
            }
            $id ? getBuilding($db, $id) : listBuildings($db);
            break;
        case 'POST':
            if ($id && $action === 'link_property') {
                linkProperty($db, $id);
            } elseif ($id && $action === 'generate_units') {
                generateUnits($db, $id);
            } elseif ($id && $action === 'distribute_expense') {
                distributeExpense($db, $id);
            } else {
                createBuilding($db);
            }
            break;
        case 'PUT':
            if (!$id) apiError('ID edificio mancante.');
            if ($action === 'millesimi') {
                saveMillesimiTable($db, $id);
            }
            updateBuilding($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID edificio mancante.');
            if ($action === 'unlink_property') {
                $propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : 0;
                unlinkProperty($db, $id, $propertyId);
            } else {
                deleteBuilding($db, $id);
            }
            break;
        default:
            apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    if ($e->getCode() === '23000') {
        apiError('Operazione non consentita: esistono immobili collegati a questo edificio. Rimuoverli prima di procedere.', 409);
    }
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function buildingStats(PDO $db): void
{
    // `units` somma il campo dichiarato dall'agente (total_units); `units_linked`
    // conta le unita' che esistono davvero come immobili. Vederli affiancati e'
    // il modo piu' diretto per accorgersi che un edificio da 56 unita' non ne ha
    // ancora nessuna in anagrafica — cioe' che c'e' da premere "Genera unita'".
    apiSuccess([
        'total'        => (int) $db->query('SELECT COUNT(*) FROM buildings')->fetchColumn(),
        'units'        => (int) $db->query('SELECT COALESCE(SUM(total_units),0) FROM buildings')->fetchColumn(),
        'units_linked' => (int) $db->query('SELECT COUNT(*) FROM properties WHERE building_id IS NOT NULL')->fetchColumn(),
        'occupied'     => (int) $db->query(
            'SELECT COUNT(*) FROM properties p WHERE p.building_id IS NOT NULL AND ' . OCCUPANCY_EXISTS_SQL
        )->fetchColumn(),
        'cities'       => (int) $db->query('SELECT COUNT(DISTINCT city) FROM buildings WHERE city IS NOT NULL AND city != ""')->fetchColumn(),
        'new_year'     => (int) $db->query('SELECT COUNT(*) FROM buildings WHERE YEAR(created_at) = YEAR(CURDATE())')->fetchColumn(),
    ]);
}

function listBuildings(PDO $db): void
{
    $pagination = apiGetPagination();
    $search = trim($_GET['search'] ?? '');

    $where  = 'WHERE 1=1';
    $params = [];

    if ($search !== '') {
        $where .= ' AND (b.name LIKE :search OR b.address LIKE :search OR b.city LIKE :search
                         OR b.administrator_name LIKE :search OR adm.name LIKE :search)';
        $params['search'] = '%' . $search . '%';
    }

    $countSql = "SELECT COUNT(*) FROM buildings b
                 LEFT JOIN suppliers adm ON adm.id = b.administrator_supplier_id
                 $where";

    $dataSql = "SELECT b.*,
                   adm.name  AS administrator_supplier_name,
                   adm.phone AS administrator_supplier_phone,
                   adm.email AS administrator_supplier_email,
                   COUNT(DISTINCT p.id) AS unit_count,
                   COUNT(DISTINCT CASE WHEN " . OCCUPANCY_EXISTS_SQL . " THEN p.id END) AS occupancy_count
            FROM buildings b
            LEFT JOIN suppliers adm ON adm.id = b.administrator_supplier_id
            LEFT JOIN properties p ON p.building_id = b.id
            $where
            GROUP BY b.id
            ORDER BY b.name ASC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    foreach ($items as &$item) {
        resolveAdministrator($item);
    }
    unset($item);

    apiPaginatedSuccess($items, $total, $pagination);
}

function getBuilding(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT b.*,
                adm.name  AS administrator_supplier_name,
                adm.phone AS administrator_supplier_phone,
                adm.email AS administrator_supplier_email
         FROM buildings b
         LEFT JOIN suppliers adm ON adm.id = b.administrator_supplier_id
         WHERE b.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $building = $stmt->fetch();

    if (!$building) {
        apiError('Edificio non trovato.', 404);
    }

    resolveAdministrator($building);

    $propStmt = $db->prepare(
        "SELECT p.id, p.address, p.city, p.sqm, p.rooms, p.status, p.price, p.price_type,
                c.name AS client_name, c.surname AS client_surname,
                (" . OCCUPANCY_EXISTS_SQL . ") AS is_occupied,
                COALESCE(
                    (SELECT COALESCE(cm.thumb_path, cm.file_path) FROM property_media cm WHERE cm.id = p.cover_media_id LIMIT 1),
                    (SELECT COALESCE(fm.thumb_path, fm.file_path) FROM property_media fm
                     WHERE fm.property_id = p.id
                       AND fm.media_type IN ('photo', 'floor_plan', 'house_map')
                       AND fm.mime_type LIKE 'image/%'
                     ORDER BY fm.sort_order ASC, fm.created_at ASC LIMIT 1)
                ) AS cover_url
         FROM properties p
         LEFT JOIN clients c ON c.id = p.client_id
         WHERE p.building_id = :bid
         ORDER BY p.address ASC"
    );
    $propStmt->execute(['bid' => $id]);
    $building['properties'] = $propStmt->fetchAll();
    $building['unit_count'] = count($building['properties']);
    $building['occupancy_count'] = count(array_filter(
        $building['properties'],
        fn($p) => (int) $p['is_occupied'] === 1
    ));

    // Quante unita' dichiarate non hanno ancora un immobile in anagrafica.
    $building['units_missing'] = max(0, (int) $building['total_units'] - $building['unit_count']);

    // Riepilogo tabelle millesimali, per mostrare a colpo d'occhio se sono compilate.
    $mStmt = $db->prepare(
        "SELECT table_type, COUNT(*) AS rows_count, SUM(quota) AS total_quota
         FROM building_millesimi WHERE building_id = :bid GROUP BY table_type"
    );
    $mStmt->execute(['bid' => $id]);
    $building['millesimi_summary'] = $mStmt->fetchAll();

    $dStmt = $db->prepare('SELECT COUNT(*) FROM documents WHERE building_id = :bid');
    $dStmt->execute(['bid' => $id]);
    $building['document_count'] = (int) $dStmt->fetchColumn();

    apiSuccess($building);
}

/**
 * Il fornitore collegato vince sul testo libero.
 *
 * Le tre colonne administrator_* restano come fallback per gli edifici inseriti
 * prima di phase77 (e per quando l'agenzia ha solo un nome). Il client non deve
 * decidere: legge sempre administrator_name/phone/email gia' risolti, e trova in
 * administrator_source se il dato viene dalla rubrica o dal testo libero.
 */
function resolveAdministrator(array &$row): void
{
    $fromSupplier = !empty($row['administrator_supplier_id']) && !empty($row['administrator_supplier_name']);

    if ($fromSupplier) {
        $row['administrator_name']  = $row['administrator_supplier_name'];
        $row['administrator_phone'] = $row['administrator_supplier_phone'] ?: $row['administrator_phone'];
        $row['administrator_email'] = $row['administrator_supplier_email'] ?: $row['administrator_email'];
    }
    $row['administrator_source'] = $fromSupplier ? 'supplier' : (!empty($row['administrator_name']) ? 'text' : null);
}

function createBuilding(PDO $db): void
{
    $data      = apiGetJsonBody();
    $validated = validateBuildingInput($db, $data);

    $stmt = $db->prepare(
        "INSERT INTO buildings (name, address, city, cap, province, latitude, longitude,
                                total_units, notes,
                                administrator_supplier_id,
                                administrator_name, administrator_phone, administrator_email)
         VALUES (:name, :address, :city, :cap, :province, :latitude, :longitude,
                 :total_units, :notes,
                 :administrator_supplier_id,
                 :administrator_name, :administrator_phone, :administrator_email)"
    );
    $stmt->execute($validated);

    $newId = (int) $db->lastInsertId();
    logActivity('create', 'building', $newId, 'Edificio creato: ' . $validated['name']);
    getBuilding($db, $newId);
}

function updateBuilding(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT id FROM buildings WHERE id = :id");
    $stmt->execute(['id' => $id]);
    if (!$stmt->fetch()) {
        apiError('Edificio non trovato.', 404);
    }

    $data      = apiGetJsonBody();
    $validated = validateBuildingInput($db, $data);

    // Le coordinate sopravvivono a un salvataggio che non le manda.
    //
    // Nessun modulo di modifica espone latitudine e longitudine: le scrive il
    // geocoder ("Genera unita'", riga 490). Ma qui l'UPDATE le riscriveva
    // sempre, e validateBuildingInput() le mette a null quando la chiave manca
    // (riga 957): salvare l'edificio dalla sua scheda — cambiare una nota, il
    // nome dell'amministratore — cancellava il posizionamento sulla mappa, e
    // l'edificio spariva dalla mappa senza che nessuno avesse toccato la mappa.
    //
    // Stessa semantica di updateProperty (f17fb9a): chiave assente = "non la
    // tocco", chiave presente = valore nuovo. Chi vuole azzerarle puo' ancora
    // mandarle esplicitamente a null.
    if (!array_key_exists('latitude', $data))  { unset($validated['latitude']); }
    if (!array_key_exists('longitude', $data)) { unset($validated['longitude']); }

    $latSql = array_key_exists('latitude', $validated)  ? 'latitude = :latitude, '   : '';
    $lngSql = array_key_exists('longitude', $validated) ? 'longitude = :longitude, ' : '';

    $stmt = $db->prepare(
        "UPDATE buildings
         SET name = :name, address = :address, city = :city, cap = :cap, province = :province,
             {$latSql}{$lngSql}
             total_units = :total_units, notes = :notes,
             administrator_supplier_id = :administrator_supplier_id,
             administrator_name = :administrator_name, administrator_phone = :administrator_phone,
             administrator_email = :administrator_email
         WHERE id = :id"
    );
    $stmt->execute(array_merge($validated, ['id' => $id]));

    logActivity('update', 'building', $id, 'Edificio aggiornato: ' . $validated['name']);
    getBuilding($db, $id);
}

function deleteBuilding(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT id FROM buildings WHERE id = :id");
    $stmt->execute(['id' => $id]);
    if (!$stmt->fetch()) {
        apiError('Edificio non trovato.', 404);
    }

    // Check linked properties
    $check = $db->prepare("SELECT COUNT(*) FROM properties WHERE building_id = :id");
    $check->execute(['id' => $id]);
    if ((int) $check->fetchColumn() > 0) {
        apiError('Impossibile eliminare: ci sono immobili collegati. Scollegarli prima.');
    }

    // I documenti e le spese hanno FK RESTRICT: senza questo controllo l'utente
    // vedrebbe l'errore 23000 generico ("immobili collegati"), che indica il
    // posto sbagliato dove guardare.
    $docs = $db->prepare('SELECT COUNT(*) FROM documents WHERE building_id = :id');
    $docs->execute(['id' => $id]);
    if ((int) $docs->fetchColumn() > 0) {
        apiError('Impossibile eliminare: ci sono documenti condominiali allegati. Rimuoverli prima.');
    }

    $exp = $db->prepare('SELECT COUNT(*) FROM expenses WHERE building_id = :id');
    $exp->execute(['id' => $id]);
    if ((int) $exp->fetchColumn() > 0) {
        apiError('Impossibile eliminare: ci sono spese registrate su questo edificio.');
    }

    $db->prepare("DELETE FROM buildings WHERE id = :id")->execute(['id' => $id]);

    logActivity('delete', 'building', $id, 'Edificio eliminato #' . $id);
    apiSuccess(['id' => $id, 'message' => 'Edificio eliminato.']);
}

function linkProperty(PDO $db, int $buildingId): void
{
    $stmt = $db->prepare("SELECT id FROM buildings WHERE id = :id");
    $stmt->execute(['id' => $buildingId]);
    if (!$stmt->fetch()) {
        apiError('Edificio non trovato.', 404);
    }

    $data       = apiGetJsonBody();
    $propertyId = !empty($data['property_id']) ? (int) $data['property_id'] : 0;

    if ($propertyId <= 0) {
        apiError('property_id obbligatorio.');
    }

    $propCheck = $db->prepare("SELECT id, building_id FROM properties WHERE id = :id");
    $propCheck->execute(['id' => $propertyId]);
    $prop = $propCheck->fetch();
    if (!$prop) {
        apiError('Immobile non trovato.');
    }

    // A property belongs to exactly one building — check it isn't already this one.
    if ((int) $prop['building_id'] === $buildingId) {
        apiError('Immobile già collegato a questo edificio.');
    }

    // Re-linking moves the property from any previous building to this one.
    $db->prepare(
        "UPDATE properties SET building_id = :bid WHERE id = :pid"
    )->execute(['bid' => $buildingId, 'pid' => $propertyId]);

    logActivity('update', 'building', $buildingId, 'Immobile #' . $propertyId . ' collegato all\'edificio');
    getBuilding($db, $buildingId);
}

function unlinkProperty(PDO $db, int $buildingId, int $propertyId): void
{
    if ($propertyId <= 0) {
        apiError('property_id obbligatorio.');
    }

    $stmt = $db->prepare(
        "UPDATE properties SET building_id = NULL WHERE id = :pid AND building_id = :bid"
    );
    $stmt->execute(['bid' => $buildingId, 'pid' => $propertyId]);

    if ($stmt->rowCount() === 0) {
        apiError('Collegamento non trovato.', 404);
    }

    // I millesimi sono relativi a QUESTO edificio: scollegando l'unita' la riga
    // non ha piu' significato (e la UNIQUE la bloccherebbe a un futuro ri-collegamento
    // con quota diversa). La FK CASCADE copre la cancellazione, non lo scollegamento.
    $db->prepare('DELETE FROM building_millesimi WHERE building_id = :bid AND property_id = :pid')
       ->execute(['bid' => $buildingId, 'pid' => $propertyId]);

    logActivity('update', 'building', $buildingId, 'Immobile #' . $propertyId . ' scollegato dall\'edificio');
    apiSuccess(['building_id' => $buildingId, 'property_id' => $propertyId, 'message' => 'Immobile scollegato.']);
}

// ---------------------------------------------------------------------------
// Generazione unita' (bulk instantiation)
// ---------------------------------------------------------------------------

/**
 * Crea in blocco le unita' figlie di un edificio.
 *
 * Il campo "Unita' totali" era solo un numero digitato: dichiarare 56 unita' non
 * creava nulla, e collegarle voleva dire aprire 56 volte il form immobile. Qui
 * il numero diventa un'azione.
 *
 * Le unita' ereditano indirizzo, citta', CAP, provincia e coordinate del padre.
 * La geocodifica viene fatta UNA volta sull'edificio (non 56 volte): se l'edificio
 * non ha ancora coordinate e ha un CAP, si risolve ora e si salva sul padre.
 *
 * Ri-eseguibile senza duplicare: un'unita' il cui indirizzo generato esiste gia'
 * in questo edificio viene saltata, e il numero riparte dopo l'ultima esistente.
 */
function generateUnits(PDO $db, int $buildingId): void
{
    $stmt = $db->prepare('SELECT * FROM buildings WHERE id = :id');
    $stmt->execute(['id' => $buildingId]);
    $building = $stmt->fetch();
    if (!$building) {
        apiError('Edificio non trovato.', 404);
    }

    $data = apiGetJsonBody();

    $existing = (int) $db->query(
        'SELECT COUNT(*) FROM properties WHERE building_id = ' . $buildingId
    )->fetchColumn();

    // Default: quante ne mancano per arrivare al totale dichiarato.
    $count = isset($data['count']) && $data['count'] !== ''
        ? (int) $data['count']
        : max(0, (int) $building['total_units'] - $existing);

    if ($count <= 0) {
        apiError('Nessuna unità da generare: indica quante unità creare.');
    }
    // Tetto di sicurezza: oltre questa soglia si tratta quasi certamente di un
    // errore di battitura, e sarebbero centinaia di immobili da cancellare a mano.
    if ($count > 200) {
        apiError('Massimo 200 unità per volta.');
    }

    $clientId = !empty($data['client_id']) ? (int) $data['client_id'] : 0;
    if ($clientId <= 0) {
        apiError('Seleziona il proprietario a cui intestare le unità generate.');
    }
    $cCheck = $db->prepare('SELECT id FROM clients WHERE id = :id');
    $cCheck->execute(['id' => $clientId]);
    if (!$cCheck->fetch()) {
        apiError('Proprietario non trovato.');
    }

    $prefix = trim($data['prefix'] ?? '') ?: 'Unità';
    if (mb_strlen($prefix) > 40) {
        apiError('Prefisso unità troppo lungo.');
    }

    $propertyType = trim($data['property_type'] ?? 'appartamento');
    if (!in_array($propertyType, ['appartamento', 'villa', 'ufficio', 'negozio', 'box', 'terreno', 'altro'], true)) {
        apiError('Tipo immobile non valido.');
    }
    $priceType = trim($data['price_type'] ?? 'affitto');
    if (!in_array($priceType, ['affitto', 'vendita'], true)) {
        apiError('Tipo prezzo non valido.');
    }

    $startNumber = isset($data['start_number']) && $data['start_number'] !== ''
        ? max(1, (int) $data['start_number'])
        : 1;

    // Geocodifica una sola volta, sul padre.
    $lat  = $building['latitude'];
    $lng  = $building['longitude'];
    $conf = null;
    if (($lat === null || $lng === null) && !empty($building['cap'])) {
        require_once __DIR__ . '/../config/geocode.php';
        try {
            $resolved = geocodeResolve([
                'address'  => $building['address'],
                'city'     => $building['city'],
                'cap'      => $building['cap'],
                'province' => $building['province'] ?? '',
            ]);
            if (!empty($resolved['result'])) {
                $lat  = $resolved['result']['lat'];
                $lng  = $resolved['result']['lng'];
                $conf = $resolved['result']['confidence'] ?? null;
                $db->prepare('UPDATE buildings SET latitude = :lat, longitude = :lng WHERE id = :id')
                   ->execute(['lat' => $lat, 'lng' => $lng, 'id' => $buildingId]);
            }
        } catch (Throwable $e) {
            // La geocodifica e' un di piu': se il servizio non risponde o il CAP
            // non torna, le unita' si creano lo stesso senza coordinate.
            $lat = $lng = $conf = null;
        }
    }

    // Indirizzi gia' presenti in questo edificio — per non duplicare a una seconda esecuzione.
    $addrStmt = $db->prepare('SELECT address FROM properties WHERE building_id = :bid');
    $addrStmt->execute(['bid' => $buildingId]);
    $taken = array_flip(array_map('mb_strtolower', $addrStmt->fetchAll(PDO::FETCH_COLUMN)));

    $insert = $db->prepare(
        "INSERT INTO properties
            (client_id, building_id, address, city, cap, province, latitude, longitude, geo_confidence,
             property_type, price_type, status, internal_notes)
         VALUES
            (:client_id, :building_id, :address, :city, :cap, :province, :latitude, :longitude, :geo_confidence,
             :property_type, :price_type, 'available', :internal_notes)"
    );

    $created = [];
    $skipped = 0;

    $db->beginTransaction();
    try {
        // Si scorre un intervallo FISSO di numeri — da $startNumber per $count
        // posizioni — e si crea solo cio' che manca. Non "finche' non ne ho
        // create $count": con quella logica una seconda esecuzione con gli
        // stessi parametri saltava le dieci esistenti e ne creava altre dieci
        // numerate 11-20, raddoppiando l'edificio a ogni click di troppo.
        // Cosi' invece la seconda esecuzione crea 0 e salta 10.
        for ($n = $startNumber; $n < $startNumber + $count; $n++) {
            $label   = $prefix . ' ' . $n;
            $address = $building['address'] . ' - ' . $label;

            if (isset($taken[mb_strtolower($address)])) { $skipped++; continue; }

            $insert->execute([
                'client_id'      => $clientId,
                'building_id'    => $buildingId,
                'address'        => $address,
                'city'           => $building['city'],
                'cap'            => $building['cap'] ?: null,
                'province'       => $building['province'] ?: null,
                'latitude'       => $lat,
                'longitude'      => $lng,
                'geo_confidence' => $conf,
                'property_type'  => $propertyType,
                'price_type'     => $priceType,
                'internal_notes' => 'Generata automaticamente da ' . $building['name'],
            ]);
            $taken[mb_strtolower($address)] = true;
            $created[] = ['id' => (int) $db->lastInsertId(), 'address' => $address];
        }

        // Il totale dichiarato non deve mai essere inferiore alle unita' che esistono.
        $total = $existing + count($created);
        if ($total > (int) $building['total_units']) {
            $db->prepare('UPDATE buildings SET total_units = :t WHERE id = :id')
               ->execute(['t' => $total, 'id' => $buildingId]);
        }

        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
    }

    logActivity('create', 'building', $buildingId,
        count($created) . ' unità generate per l\'edificio ' . $building['name']);

    apiSuccess([
        'building_id' => $buildingId,
        'created'     => count($created),
        'skipped'     => $skipped,
        'geocoded'    => $lat !== null,
        'units'       => $created,
        'message'     => count($created) === 0
            ? 'Nessuna unità creata: le ' . $skipped . ' unità di questo intervallo esistono già.'
            : count($created) . ' unità create'
              . ($skipped ? " ($skipped già esistenti, saltate)" : '') . '.',
    ]);
}

// ---------------------------------------------------------------------------
// Tabelle millesimali
// ---------------------------------------------------------------------------

function listMillesimi(PDO $db, int $buildingId): void
{
    $check = $db->prepare('SELECT id FROM buildings WHERE id = :id');
    $check->execute(['id' => $buildingId]);
    if (!$check->fetch()) {
        apiError('Edificio non trovato.', 404);
    }

    $tableType = trim($_GET['table_type'] ?? '');
    if ($tableType !== '' && !in_array($tableType, MILLESIMI_TABLES, true)) {
        apiError('Tipo tabella millesimale non valido.');
    }

    // LEFT JOIN dall'immobile: le unita' senza quota devono comparire con 0,
    // altrimenti l'agente non si accorge di quali ha dimenticato.
    $sql = "SELECT p.id AS property_id, p.address, p.city,
                   COALESCE(m.quota, 0) AS quota, m.notes, m.id AS millesimo_id
            FROM properties p
            LEFT JOIN building_millesimi m
                   ON m.property_id = p.id AND m.building_id = p.building_id
                  AND m.table_type = :table_type
            WHERE p.building_id = :bid
            ORDER BY p.address ASC";

    $type = $tableType !== '' ? $tableType : 'proprieta';
    $stmt = $db->prepare($sql);
    $stmt->execute(['bid' => $buildingId, 'table_type' => $type]);
    $rows = $stmt->fetchAll();

    $total = 0.0;
    foreach ($rows as $r) { $total += (float) $r['quota']; }

    $sumStmt = $db->prepare(
        'SELECT table_type, COUNT(*) AS rows_count, SUM(quota) AS total_quota
         FROM building_millesimi WHERE building_id = :bid GROUP BY table_type'
    );
    $sumStmt->execute(['bid' => $buildingId]);

    apiSuccess([
        'building_id' => $buildingId,
        'table_type'  => $type,
        'rows'        => $rows,
        'total_quota' => round($total, 4),
        // 1000 e' la base convenzionale: mostrarla permette alla UI di segnalare
        // "997/1000" senza che l'API imponga un vincolo che i condomini reali
        // a volte non rispettano.
        'base'        => 1000,
        'summary'     => $sumStmt->fetchAll(),
        'tables'      => MILLESIMI_TABLES,
    ]);
}

/**
 * Sostituisce l'intera tabella millesimale di un tipo (replace-set).
 *
 * Replace-set e non merge: una tabella millesimale e' un insieme coerente che
 * somma a una base. Aggiornare le righe una a una lascerebbe in giro le quote
 * di unita' nel frattempo scollegate, e il totale non tornerebbe mai.
 */
function saveMillesimiTable(PDO $db, int $buildingId): void
{
    $check = $db->prepare('SELECT id FROM buildings WHERE id = :id');
    $check->execute(['id' => $buildingId]);
    if (!$check->fetch()) {
        apiError('Edificio non trovato.', 404);
    }

    $data      = apiGetJsonBody();
    $tableType = trim($data['table_type'] ?? 'proprieta');
    if (!in_array($tableType, MILLESIMI_TABLES, true)) {
        apiError('Tipo tabella millesimale non valido.');
    }

    $rows = $data['rows'] ?? [];
    if (!is_array($rows)) {
        apiError('Formato righe non valido.');
    }

    // Solo immobili realmente collegati a questo edificio.
    $owned = $db->prepare('SELECT id FROM properties WHERE building_id = :bid');
    $owned->execute(['bid' => $buildingId]);
    $ownedIds = array_flip(array_map('intval', $owned->fetchAll(PDO::FETCH_COLUMN)));

    $clean = [];
    $total = 0.0;
    foreach ($rows as $row) {
        $pid = isset($row['property_id']) ? (int) $row['property_id'] : 0;
        if ($pid <= 0) continue;
        if (!isset($ownedIds[$pid])) {
            apiError('L\'immobile #' . $pid . ' non appartiene a questo edificio.');
        }
        $quota = isset($row['quota']) && $row['quota'] !== '' ? (float) $row['quota'] : 0.0;
        if ($quota < 0) apiError('Le quote millesimali non possono essere negative.');
        if ($quota > 1000) apiError('Una quota non può superare 1000 millesimi.');

        if ($quota == 0.0) continue; // quota nulla = nessuna riga, non una riga a zero
        $clean[] = [
            'property_id' => $pid,
            'quota'       => round($quota, 4),
            'notes'       => trim($row['notes'] ?? '') ?: null,
        ];
        $total += $quota;
    }

    if ($total > 1000.0001) {
        apiError('Il totale della tabella (' . round($total, 2) . ') supera i 1000 millesimi.');
    }

    $db->beginTransaction();
    try {
        $db->prepare('DELETE FROM building_millesimi WHERE building_id = :bid AND table_type = :t')
           ->execute(['bid' => $buildingId, 't' => $tableType]);

        $ins = $db->prepare(
            'INSERT INTO building_millesimi (building_id, property_id, table_type, quota, notes)
             VALUES (:bid, :pid, :t, :q, :n)'
        );
        foreach ($clean as $row) {
            $ins->execute([
                'bid' => $buildingId, 'pid' => $row['property_id'], 't' => $tableType,
                'q'   => $row['quota'], 'n' => $row['notes'],
            ]);
        }
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
    }

    logActivity('update', 'building', $buildingId,
        'Tabella millesimale "' . $tableType . '" aggiornata (' . count($clean) . ' unità, ' . round($total, 2) . '/1000)');

    $_GET['table_type'] = $tableType;
    listMillesimi($db, $buildingId);
}

// ---------------------------------------------------------------------------
// Ripartizione spese condominiali
// ---------------------------------------------------------------------------

/**
 * Ripartisce una spesa dell'edificio sulle unita' secondo una tabella millesimale.
 *
 * Body: {description, amount, expense_date, category?, supplier_id?, notes?, table_type?}
 *   oppure {expense_id, table_type?} per ripartire una spesa gia' registrata.
 *
 * La riga padre resta la spesa vera (la fattura pagata); le figlie sono
 * l'imputazione per unita' e portano parent_expense_id + millesimi_quota.
 * Ri-eseguibile: la ripartizione precedente viene sostituita, non sommata.
 *
 * Arrotondamento: le quote si calcolano al centesimo per difetto e i centesimi
 * residui si assegnano uno per uno alle quote piu' alte. Cosi' la somma delle
 * figlie e' ESATTAMENTE l'importo del padre — con un semplice round() si perdono
 * o si inventano centesimi, e su una spesa condominiale l'agente se ne accorge.
 */
function distributeExpense(PDO $db, int $buildingId): void
{
    $bStmt = $db->prepare('SELECT * FROM buildings WHERE id = :id');
    $bStmt->execute(['id' => $buildingId]);
    $building = $bStmt->fetch();
    if (!$building) {
        apiError('Edificio non trovato.', 404);
    }

    $data      = apiGetJsonBody();
    $tableType = trim($data['table_type'] ?? 'proprieta');
    if (!in_array($tableType, MILLESIMI_TABLES, true)) {
        apiError('Tipo tabella millesimale non valido.');
    }

    // ── Quote ────────────────────────────────────────────────────────────
    $qStmt = $db->prepare(
        'SELECT m.property_id, m.quota, p.client_id, p.address
         FROM building_millesimi m
         INNER JOIN properties p ON p.id = m.property_id AND p.building_id = m.building_id
         WHERE m.building_id = :bid AND m.table_type = :t AND m.quota > 0
         ORDER BY m.quota DESC, m.property_id ASC'
    );
    $qStmt->execute(['bid' => $buildingId, 't' => $tableType]);
    $quotas = $qStmt->fetchAll();

    if (!$quotas) {
        apiError('Nessuna quota millesimale definita per la tabella "' . $tableType . '". Compilala prima di ripartire una spesa.');
    }
    $quotaTotal = 0.0;
    foreach ($quotas as $q) { $quotaTotal += (float) $q['quota']; }
    if ($quotaTotal <= 0) {
        apiError('Il totale della tabella millesimale è zero: impossibile ripartire.');
    }

    // ── Spesa padre: esistente o nuova ───────────────────────────────────
    $parentId = !empty($data['expense_id']) ? (int) $data['expense_id'] : 0;

    $db->beginTransaction();
    try {
        if ($parentId > 0) {
            $pStmt = $db->prepare('SELECT * FROM expenses WHERE id = :id');
            $pStmt->execute(['id' => $parentId]);
            $parent = $pStmt->fetch();
            if (!$parent) {
                $db->rollBack();
                apiError('Spesa non trovata.', 404);
            }
            if (!empty($parent['parent_expense_id'])) {
                $db->rollBack();
                apiError('Questa spesa è già una quota di una ripartizione: non può essere ripartita a sua volta.');
            }
            if ((int) $parent['building_id'] !== $buildingId) {
                // Una spesa registrata senza edificio viene agganciata qui.
                if (!empty($parent['building_id'])) {
                    $db->rollBack();
                    apiError('La spesa appartiene a un altro edificio.');
                }
                $db->prepare('UPDATE expenses SET building_id = :bid WHERE id = :id')
                   ->execute(['bid' => $buildingId, 'id' => $parentId]);
            }
        } else {
            $description = trim($data['description'] ?? '');
            $amountRaw   = $data['amount'] ?? '';
            $expenseDate = trim($data['expense_date'] ?? '');
            $category    = trim($data['category'] ?? 'condominio');
            $supplierId  = !empty($data['supplier_id']) ? (int) $data['supplier_id'] : null;
            $notes       = trim($data['notes'] ?? '') ?: null;

            if ($description === '') { $db->rollBack(); apiError('Descrizione obbligatoria.'); }
            if ($amountRaw === '' || !is_numeric($amountRaw) || (float) $amountRaw <= 0) {
                $db->rollBack(); apiError('Importo non valido.');
            }
            if ($expenseDate === '' || !DateTime::createFromFormat('!Y-m-d', $expenseDate)) {
                $db->rollBack(); apiError('Data spesa non valida (formato AAAA-MM-GG).');
            }
            if (!in_array($category, BUILDING_EXPENSE_CATEGORIES, true)) {
                $db->rollBack(); apiError('Categoria spesa non valida.');
            }

            $ins = $db->prepare(
                "INSERT INTO expenses (building_id, supplier_id, category, description, amount, expense_date, notes, created_by)
                 VALUES (:bid, :sid, :cat, :descr, :amt, :dt, :notes, :uid)"
            );
            $ins->execute([
                'bid'   => $buildingId,
                'sid'   => $supplierId,
                'cat'   => $category,
                'descr' => $description,
                'amt'   => round((float) $amountRaw, 2),
                'dt'    => $expenseDate,
                'notes' => $notes,
                'uid'   => getCurrentAdminId() ?: null,
            ]);
            $parentId = (int) $db->lastInsertId();

            $pStmt = $db->prepare('SELECT * FROM expenses WHERE id = :id');
            $pStmt->execute(['id' => $parentId]);
            $parent = $pStmt->fetch();
        }

        // Ripartizione precedente: sostituita, mai sommata.
        $db->prepare('DELETE FROM expenses WHERE parent_expense_id = :pid')->execute(['pid' => $parentId]);

        // ── Riparto al centesimo ─────────────────────────────────────────
        $totalCents = (int) round(((float) $parent['amount']) * 100);
        $shares     = [];
        $assigned   = 0;
        foreach ($quotas as $q) {
            $cents      = (int) floor($totalCents * ((float) $q['quota'] / $quotaTotal));
            $shares[]   = ['quota' => $q, 'cents' => $cents];
            $assigned  += $cents;
        }
        // I centesimi persi negli arrotondamenti per difetto: uno a testa,
        // partendo dalle quote piu' alte (le righe sono gia' ordinate cosi').
        $remainder = $totalCents - $assigned;
        for ($i = 0; $remainder > 0 && $i < count($shares); $i++, $remainder--) {
            $shares[$i]['cents']++;
        }

        $insChild = $db->prepare(
            "INSERT INTO expenses (property_id, building_id, parent_expense_id, millesimi_quota,
                                   client_id, supplier_id, category, description, amount, expense_date, notes, created_by)
             VALUES (:pid, :bid, :parent, :quota, :cid, :sid, :cat, :descr, :amt, :dt, :notes, :uid)"
        );

        $allocated = [];
        foreach ($shares as $share) {
            if ($share['cents'] <= 0) continue;
            $amount = $share['cents'] / 100;
            $insChild->execute([
                'pid'    => $share['quota']['property_id'],
                'bid'    => $buildingId,
                'parent' => $parentId,
                'quota'  => $share['quota']['quota'],
                'cid'    => $share['quota']['client_id'],
                'sid'    => $parent['supplier_id'],
                'cat'    => $parent['category'],
                'descr'  => 'Quota millesimale (' . $tableType . ') — ' . $parent['description'],
                'amt'    => $amount,
                'dt'     => $parent['expense_date'],
                'notes'  => $share['quota']['quota'] . '/' . round($quotaTotal, 2) . ' millesimi',
                'uid'    => getCurrentAdminId() ?: null,
            ]);
            $allocated[] = [
                'expense_id'  => (int) $db->lastInsertId(),
                'property_id' => (int) $share['quota']['property_id'],
                'address'     => $share['quota']['address'],
                'quota'       => (float) $share['quota']['quota'],
                'amount'      => $amount,
            ];
        }

        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }

    logActivity('create', 'building', $buildingId,
        'Spesa #' . $parentId . ' ripartita su ' . count($allocated) . ' unità (tabella ' . $tableType . ')');

    apiSuccess([
        'building_id'       => $buildingId,
        'parent_expense_id' => $parentId,
        'table_type'        => $tableType,
        'quota_total'       => round($quotaTotal, 4),
        'amount'            => (float) $parent['amount'],
        'allocated'         => $allocated,
        'allocated_total'   => round(array_sum(array_column($allocated, 'amount')), 2),
        'message'           => 'Spesa ripartita su ' . count($allocated) . ' unità.',
    ]);
}

// ---------------------------------------------------------------------------
// Documenti condominiali
// ---------------------------------------------------------------------------

function listBuildingDocuments(PDO $db, int $buildingId): void
{
    $check = $db->prepare('SELECT id FROM buildings WHERE id = :id');
    $check->execute(['id' => $buildingId]);
    if (!$check->fetch()) {
        apiError('Edificio non trovato.', 404);
    }

    $stmt = $db->prepare(
        "SELECT d.id, d.doc_type, d.title, d.original_name, d.mime_type, d.file_size,
                d.notes, d.created_at
         FROM documents d
         WHERE d.building_id = :bid
         ORDER BY d.created_at DESC"
    );
    $stmt->execute(['bid' => $buildingId]);
    $items = $stmt->fetchAll();
    foreach ($items as &$d) {
        $d['download_url'] = 'api/download_document.php?id=' . $d['id'];
    }
    unset($d);

    apiSuccess(['building_id' => $buildingId, 'items' => $items, 'total' => count($items)]);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateBuildingInput(PDO $db, array $data): array
{
    $name       = trim($data['name'] ?? '');
    $address    = trim($data['address'] ?? '');
    $city       = trim($data['city'] ?? '');
    // total_units is NOT NULL (no default) in the buildings table — default
    // to 0 rather than null when left blank, or the INSERT/UPDATE fails with
    // a raw "Column 'total_units' cannot be null" integrity-constraint error.
    $totalUnits = isset($data['total_units']) && $data['total_units'] !== '' ? (int) $data['total_units'] : 0;
    $notes      = trim($data['notes'] ?? '') ?: null;

    $cap        = trim($data['cap'] ?? '') ?: null;
    $province   = strtoupper(trim($data['province'] ?? '')) ?: null;
    $latitude   = isset($data['latitude'])  && $data['latitude']  !== '' ? (float) $data['latitude']  : null;
    $longitude  = isset($data['longitude']) && $data['longitude'] !== '' ? (float) $data['longitude'] : null;

    // Amministratore di condominio — preferibilmente un fornitore in rubrica
    // (una modifica al suo profilo si propaga a tutti gli stabili che amministra),
    // in alternativa il testo libero storico.
    $adminSupplierId = !empty($data['administrator_supplier_id']) ? (int) $data['administrator_supplier_id'] : null;
    $adminName  = trim($data['administrator_name'] ?? '') ?: null;
    $adminPhone = trim($data['administrator_phone'] ?? '') ?: null;
    $adminEmail = trim($data['administrator_email'] ?? '') ?: null;

    if ($name === '') apiError('Nome edificio obbligatorio.');
    if ($address === '') apiError('Indirizzo obbligatorio.');
    if ($city === '') apiError('Città obbligatoria.');
    if ($totalUnits < 0) apiError('Numero unità non valido.');
    if ($cap !== null && !preg_match('/^\d{5}$/', $cap)) apiError('CAP non valido (5 cifre).');
    if ($province !== null && !preg_match('/^[A-Z]{2}$/', $province)) apiError('Provincia non valida (2 lettere, es. MC).');
    if ($adminEmail !== null && !filter_var($adminEmail, FILTER_VALIDATE_EMAIL)) {
        apiError('Email amministratore non valida.');
    }

    if ($adminSupplierId !== null) {
        $s = $db->prepare('SELECT id FROM suppliers WHERE id = :id');
        $s->execute(['id' => $adminSupplierId]);
        if (!$s->fetch()) apiError('Amministratore non trovato in rubrica fornitori.');
        // Con un fornitore collegato le colonne testo diventano rumore: un nome
        // rimasto li' dentro riapparirebbe se il fornitore venisse poi scollegato.
        $adminName = $adminPhone = $adminEmail = null;
    }

    return [
        'name'                      => $name,
        'address'                   => $address,
        'city'                      => $city,
        'cap'                       => $cap,
        'province'                  => $province,
        'latitude'                  => $latitude,
        'longitude'                 => $longitude,
        'total_units'               => $totalUnits,
        'notes'                     => $notes,
        'administrator_supplier_id' => $adminSupplierId,
        'administrator_name'        => $adminName,
        'administrator_phone'       => $adminPhone,
        'administrator_email'       => $adminEmail,
    ];
}
