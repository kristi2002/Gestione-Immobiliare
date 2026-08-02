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
 * GET    /api/portal_sync.php?action=preflight&property_id=X&portal=Y
 *                                              — violazioni bloccanti, senza salvare
 *
 * NOTE: this tracks WHERE each listing is published and its status. The actual
 * push to a portal requires that portal's feed/API credentials & terms and is
 * intentionally out of scope (transport is a stub). The immobiliare.it-compatible
 * feed already exists in api/property_export.php.
 *
 * Il pre-flight (lib/portal_validation.php) gira PRIMA di dichiarare un annuncio
 * "in pubblicazione"/"pubblicato": e' l'unico pezzo della sindacazione che
 * funziona senza contratto col portale, ed e' quello che evita il giro lungo
 * "pubblico -> vengo scartato -> leggo il feed di ritorno -> correggo".
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../lib/portal_validation.php';
apiHandleOptions();

if (isViewDisabled('portal_sync')) {
    apiError('Pubblicazione portali non attiva: richiede un feed/API a pagamento non ancora configurato.', 403);
}

const PORTALS         = ['immobiliare', 'idealista', 'casa', 'subito', 'sito_agenzia', 'altro'];
const PORTAL_STATUSES = ['draft', 'publishing', 'published', 'error', 'removed'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            if (($_GET['action'] ?? '') === 'preflight') {
                preflightCheck($db);
                break;
            }
            if (($_GET['action'] ?? '') === 'feed_info') {
                feedInfo($db);
                break;
            }
            $id ? getListing($db, $id) : listListings($db);
            break;
        case 'POST':
            if (($_GET['action'] ?? '') === 'import_feedback') {
                importFeedback($db);
                break;
            }
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

/**
 * 422 con l'elenco delle violazioni. apiError() porta solo una stringa, e qui
 * serve una lista strutturata: la modale evidenzia i campi mancanti uno per
 * uno, e "non pubblicabile" senza dire cosa manca non aiuta nessuno.
 * Helper locale di proposito — non tocca l'envelope condiviso.
 */
function apiPortalBlocked(array $violations): void
{
    apiDiscardBufferedOutput();
    apiHeaders();
    http_response_code(422);
    echo json_encode([
        'success'    => false,
        'error'      => 'Pubblicazione bloccata: ' . count($violations) . ' requisito/i non soddisfatto/i.',
        'violations' => array_values($violations),
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Pre-flight a sé stante: risponde 200 con l'esito, senza salvare nulla.
 * Serve alla UI per mostrare i problemi PRIMA che l'agente scelga uno stato,
 * invece di fargli scoprire il blocco solo al salvataggio.
 */
function preflightCheck(PDO $db): void
{
    $propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : 0;
    $portal     = trim($_GET['portal'] ?? '');

    if ($propertyId <= 0) apiError('Seleziona un immobile.');
    if (!in_array($portal, PORTALS, true)) apiError('Portale non valido.');

    $violations = portalValidateProperty($db, $propertyId, $portal);

    apiSuccess([
        'property_id'  => $propertyId,
        'portal'       => $portal,
        'publishable'  => $violations === [],
        'violations'   => $violations,
    ]);
}

/**
 * URL dei feed da consegnare ai portali in fase di onboarding, con il conteggio
 * di cosa uscirebbe adesso. Il token e' visibile solo a chi ha gia' una sessione
 * admin — e comunque protegge un catalogo di annunci destinati alla
 * pubblicazione, non l'anagrafica (vedi lib/portal_feed.php).
 */
function feedInfo(PDO $db): void
{
    require_once __DIR__ . '/../lib/portal_feed.php';

    $token = portalFeedToken();
    $base  = portalFeedBaseUrl();

    $feeds = [];
    foreach (PORTAL_SPECS as $portal => $spec) {
        // Il sito dell'agenzia e "altro" non sono destinazioni da sindacare.
        if (in_array($portal, ['sito_agenzia', 'altro'], true)) {
            continue;
        }
        try {
            $built = portalFeedBuild($db, $portal);
            $feeds[] = [
                'portal'   => $portal,
                'label'    => $spec['label'],
                'url'      => $base . '/api/portal_feed.php?portal=' . $portal . '&token=' . $token,
                'inclusi'  => count($built['included']),
                'esclusi'  => $built['excluded'],
            ];
        } catch (Throwable $e) {
            $feeds[] = [
                'portal' => $portal, 'label' => $spec['label'],
                'url' => null, 'inclusi' => 0, 'esclusi' => [], 'errore' => $e->getMessage(),
            ];
        }
    }

    apiSuccess(['feeds' => $feeds]);
}

/**
 * Importa il feed di ritorno di un portale (XML o CSV incollato/caricato).
 *
 * Passa dal bootstrap normale, quindi eredita gia' CSRF e blocco sola-lettura.
 * Non e' un webhook: e' l'agente (o un cron) che porta dentro un file che il
 * portale ha messo a disposizione, quindi la sessione admin e' l'autenticazione
 * giusta — nessun endpoint pubblico in piu' da difendere.
 */
function importFeedback(PDO $db): void
{
    require_once __DIR__ . '/../lib/portal_feedback.php';

    $body   = apiGetJsonBody();
    $portal = trim($body['portal'] ?? '');
    if (!in_array($portal, PORTALS, true)) apiError('Portale non valido.');

    $payload = (string) ($body['payload'] ?? '');
    if (trim($payload) === '') apiError('Nessun contenuto da importare.');

    try {
        $parsed = portalFeedbackParse($payload);
    } catch (Throwable $e) {
        apiError('Impossibile leggere il feed di ritorno: ' . $e->getMessage());
    }

    if ($parsed['results'] === []) {
        apiError('Nessuna riga riconosciuta nel feed di ritorno'
            . ($parsed['unparsed'] > 0 ? ' (' . $parsed['unparsed'] . ' righe senza riferimento).' : '.'));
    }

    $outcome = portalFeedbackApply($db, $portal, $parsed['results']);

    logActivity('update', 'portal_listing', 0,
        'Import esiti ' . $portal . ': ' . $outcome['published'] . ' pubblicati, ' . $outcome['errors'] . ' errori');

    apiSuccess([
        'portal'         => $portal,
        'lette'          => count($parsed['results']),
        'senza_riferimento' => $parsed['unparsed'],
        'aggiornate'     => $outcome['applied'],
        'pubblicate'     => $outcome['published'],
        'in_errore'      => $outcome['errors'],
        'non_agganciate' => $outcome['unmatched'],
        'message'        => $outcome['applied'] . ' pubblicazioni aggiornate dal feed di ritorno.',
    ]);
}

function listListings(PDO $db): void
{
    $pagination = apiGetPagination();
    $propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : null;
    $portal     = trim($_GET['portal'] ?? '');
    $status     = trim($_GET['status'] ?? '');
    $search     = trim($_GET['search'] ?? '');

    $where  = 'WHERE 1=1';
    $params = [];
    // Stessa join per conteggio e dati: si cerca soprattutto per indirizzo.
    $joins  = ' LEFT JOIN properties p ON p.id = pl.property_id';
    if ($propertyId) { $where .= ' AND pl.property_id = :pid'; $params['pid'] = $propertyId; }
    if ($portal !== '' && in_array($portal, PORTALS, true)) { $where .= ' AND pl.portal = :portal'; $params['portal'] = $portal; }
    if ($status !== '' && in_array($status, PORTAL_STATUSES, true)) { $where .= ' AND pl.status = :status'; $params['status'] = $status; }
    if ($search !== '') {
        $frag = apiWordSearch($search, [
            'p.address', 'p.city', 'pl.external_id', 'pl.external_url',
            'pl.error_message', 'pl.notes',
        ], $params, 'pls');
        if ($frag !== '') $where .= " AND ($frag)";
    }

    $countSql = "SELECT COUNT(*) FROM portal_listings pl $joins $where";
    $dataSql  = "SELECT pl.*, p.address AS property_address, p.city AS property_city
                 FROM portal_listings pl
                 $joins
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

    // Pre-flight: si passa solo dichiarando l'annuncio vivo sul portale.
    // La bozza resta libera, altrimenti non si potrebbe piu' parcheggiare un
    // annuncio incompleto — che e' esattamente a cosa serve la bozza.
    if (portalStatusRequiresPreflight($status)) {
        $violations = portalValidateProperty($db, $propertyId, $portal);
        if ($violations !== []) {
            apiPortalBlocked($violations);
        }
    }

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
