<?php
/**
 * Endpoint che il portale PASSA A PRENDERE.
 *
 *   GET /api/portal_feed.php?portal=immobiliare&token=<token>   → XML del feed
 *   GET /api/portal_feed.php?portal=immobiliare&preview=1       → riepilogo JSON
 *                                                                 (sessione admin)
 *
 * Due autenticazioni diverse per due chiamanti diversi, ed e' voluto:
 *
 *   - il CRAWLER del portale non ha e non puo' avere una sessione: si
 *     autentica col token in querystring, che e' il meccanismo che i portali
 *     accettano in onboarding.
 *   - l'AGENTE che vuole vedere cosa uscirebbe usa la normale sessione admin,
 *     senza dover conoscere il token.
 *
 * Il token NON e' un'autorizzazione debole per pigrizia: e' l'unica cosa che
 * un crawler sa mandare. Per questo il feed non contiene dati personali del
 * proprietario (vedi lib/portal_feed.php) — se l'URL trapela, esce il
 * catalogo degli annunci, che e' comunque destinato alla pubblicazione, non
 * l'anagrafica dei clienti.
 */

require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/settings.php';
require_once __DIR__ . '/../config/rate_limit.php';
require_once __DIR__ . '/../lib/portal_feed.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    http_response_code(405);
    exit('Metodo non consentito.');
}

$portal  = trim($_GET['portal'] ?? '');
$token   = trim($_GET['token'] ?? '');
$preview = ($_GET['preview'] ?? '') === '1';

if (portalSpec($portal) === null) {
    http_response_code(400);
    exit('Portale non valido.');
}

// Generare il feed costa una query per immobile piu' la validazione: va
// limitato comunque, anche col token giusto (un crawler impazzito o un token
// trapelato non devono poter martellare il database).
checkRateLimit('portal_feed_' . $portal, 30, 60);

// --- Autenticazione ---------------------------------------------------------
// isLoggedIn() e' la sessione ADMIN (config/auth.php): una sessione inquilino o
// proprietario non deve valere come anteprima del feed.
$isAdmin = isLoggedIn();

if (!$isAdmin && !portalFeedTokenValid($token)) {
    // 404 e non 403: a un chiamante non autenticato non si conferma nemmeno
    // che a questo indirizzo ci sia un feed.
    http_response_code(404);
    exit('Non trovato.');
}

try {
    $feed = portalFeedBuild(getDB(), $portal);
} catch (Throwable $e) {
    error_log('[portal_feed] generazione fallita (' . $portal . '): ' . $e->getMessage());
    http_response_code(500);
    exit('Errore nella generazione del feed.');
}

// --- Anteprima per l'agente -------------------------------------------------
if ($preview) {
    if (!$isAdmin) {
        http_response_code(404);
        exit('Non trovato.');
    }
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'success' => true,
        'data'    => [
            'portal'        => $portal,
            'inclusi'       => count($feed['included']),
            'esclusi'       => count($feed['excluded']),
            'dettaglio_esclusi' => $feed['excluded'],
            'riferimenti'   => array_map('portalFeedReference', $feed['included']),
            'byte_xml'      => strlen($feed['xml']),
        ],
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// --- Feed vero --------------------------------------------------------------
header('Content-Type: application/xml; charset=utf-8');
header('Content-Disposition: inline; filename="feed-' . $portal . '.xml"');
// Nessuna cache intermedia: il portale deve leggere lo stato di adesso.
header('Cache-Control: no-store, max-age=0');
echo $feed['xml'];
