<?php
/**
 * Portal listing sync-state tracker (immobiliare.it, idealista, casa.it, …).
 *
 * GET    /api/portal_sync.php                 — list (property_id, portal, status)
 * GET    /api/portal_sync.php?id={id}         — single
 * POST   /api/portal_sync.php                 — create/upsert a per-portal state
 * PUT    /api/portal_sync.php?id={id}         — update
 * DELETE /api/portal_sync.php?id={id}         — delete
 *
 * NOTE: this tracks WHERE each listing is published and its status. The actual
 * push to a portal requires that portal's feed/API credentials & terms and is
 * intentionally out of scope (transport is a stub). The immobiliare.it-compatible
 * feed already exists in api/property_export.php.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
apiHandleOptions();

const PORTALS         = ['immobiliare', 'idealista', 'casa', 'subito', 'sito_agenzia', 'altro'];
const PORTAL_STATUSES = ['draft', 'publishing', 'published', 'error', 'removed'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            $id ? getListing($db, $id) : listListings($db);
            break;
        case 'POST':
            createListing($db);
            break;
        case 'PUT':
            if (!$id) apiError('ID pubblicazione mancante.');
            updateListing($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID pubblicazione mancante.');
            deleteListing($db, $id);
            break;
        default:
            apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------

function listListings(PDO $db): void
{
    $pagination = apiGetPagination();
    $propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : null;
    $portal     = trim($_GET['portal'] ?? '');
    $status     = trim($_GET['status'] ?? '');

    $where  = 'WHERE 1=1';
    $params = [];
    if ($propertyId) { $where .= ' AND pl.property_id = :pid'; $params['pid'] = $propertyId; }
    if ($portal !== '' && in_array($portal, PORTALS, true)) { $where .= ' AND pl.portal = :portal'; $params['portal'] = $portal; }
    if ($status !== '' && in_array($status, PORTAL_STATUSES, true)) { $where .= ' AND pl.status = :status'; $params['status'] = $status; }

    $countSql = "SELECT COUNT(*) FROM portal_listings pl $where";
    $dataSql  = "SELECT pl.*, p.address AS property_address, p.city AS property_city
                 FROM portal_listings pl
                 LEFT JOIN properties p ON p.id = pl.property_id
                 $where
                 ORDER BY pl.updated_at DESC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);

    $statsRow = $db->query(
        "SELECT
            COUNT(*) AS total,
            SUM(status = 'published') AS published,
            SUM(status = 'error') AS errors,
            SUM(status IN ('draft','publishing')) AS pending
         FROM portal_listings"
    )->fetch();

    $pages = $total > 0 ? (int) ceil($total / $pagination['limit']) : 0;
    apiSuccess([
        'items' => $items,
        'total' => $total,
        'page'  => $pagination['page'],
        'limit' => $pagination['limit'],
        'pages' => $pages,
        'stats' => [
            'total'     => (int) $statsRow['total'],
            'published' => (int) $statsRow['published'],
            'errors'    => (int) $statsRow['errors'],
            'pending'   => (int) $statsRow['pending'],
        ],
    ]);
}

function getListing(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT pl.*, p.address AS property_address, p.city AS property_city
         FROM portal_listings pl
         LEFT JOIN properties p ON p.id = pl.property_id
         WHERE pl.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    if (!$row) apiError('Pubblicazione non trovata.', 404);
    apiSuccess($row);
}

function createListing(PDO $db): void
{
    $v = validateListingInput($db, apiGetJsonBody());

    // Upsert on (property, portal) — the table has a UNIQUE key on that pair.
    $stmt = $db->prepare(
        "INSERT INTO portal_listings (property_id, portal, status, external_id, external_url, last_synced_at, error_message, notes)
         VALUES (:property_id, :portal, :status, :external_id, :external_url, :last_synced_at, :error_message, :notes)
         ON DUPLICATE KEY UPDATE
            status = VALUES(status), external_id = VALUES(external_id), external_url = VALUES(external_url),
            last_synced_at = VALUES(last_synced_at), error_message = VALUES(error_message), notes = VALUES(notes)"
    );
    $stmt->execute($v);

    logActivity('create', 'portal_listing', (int) $db->lastInsertId(), 'Pubblicazione portale: ' . $v['portal']);
    apiSuccess(['message' => 'Pubblicazione salvata.']);
}

function updateListing(PDO $db, int $id): void
{
    $stmt = $db->prepare('SELECT id FROM portal_listings WHERE id = :id');
    $stmt->execute(['id' => $id]);
    if (!$stmt->fetch()) apiError('Pubblicazione non trovata.', 404);

    $v = validateListingInput($db, apiGetJsonBody());
    $stmt = $db->prepare(
        "UPDATE portal_listings SET
            property_id = :property_id, portal = :portal, status = :status,
            external_id = :external_id, external_url = :external_url,
            last_synced_at = :last_synced_at, error_message = :error_message, notes = :notes
         WHERE id = :id"
    );
    $stmt->execute(array_merge($v, ['id' => $id]));

    logActivity('update', 'portal_listing', $id, 'Pubblicazione aggiornata #' . $id);
    getListing($db, $id);
}

function deleteListing(PDO $db, int $id): void
{
    $stmt = $db->prepare('SELECT id FROM portal_listings WHERE id = :id');
    $stmt->execute(['id' => $id]);
    if (!$stmt->fetch()) apiError('Pubblicazione non trovata.', 404);

    $db->prepare('DELETE FROM portal_listings WHERE id = :id')->execute(['id' => $id]);
    logActivity('delete', 'portal_listing', $id, 'Pubblicazione eliminata #' . $id);
    apiSuccess(['id' => $id, 'message' => 'Pubblicazione eliminata.']);
}

// ---------------------------------------------------------------------------

function validateListingInput(PDO $db, array $data): array
{
    $propertyId = (int) ($data['property_id'] ?? 0);
    if ($propertyId <= 0) apiError('Seleziona un immobile.');

    $portal = trim($data['portal'] ?? '');
    if (!in_array($portal, PORTALS, true)) apiError('Portale non valido.');

    $status = trim($data['status'] ?? 'draft');
    if (!in_array($status, PORTAL_STATUSES, true)) apiError('Stato non valido.');

    $stmt = $db->prepare('SELECT id FROM properties WHERE id = :id');
    $stmt->execute(['id' => $propertyId]);
    if (!$stmt->fetch()) apiError('Immobile non trovato.');

    $strOrNull  = static fn($v) => isset($v) && trim((string) $v) !== '' ? trim((string) $v) : null;

    // Stamp last_synced_at when moving into a terminal sync state.
    $lastSynced = $strOrNull($data['last_synced_at'] ?? null);
    if ($lastSynced === null && in_array($status, ['published', 'error'], true)) {
        $lastSynced = date('Y-m-d H:i:s');
    }

    return [
        'property_id'    => $propertyId,
        'portal'         => $portal,
        'status'         => $status,
        'external_id'    => $strOrNull($data['external_id'] ?? null),
        'external_url'   => $strOrNull($data['external_url'] ?? null),
        'last_synced_at' => $lastSynced,
        'error_message'  => $strOrNull($data['error_message'] ?? null),
        'notes'          => $strOrNull($data['notes'] ?? null),
    ];
}
