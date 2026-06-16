<?php
/**
 * Dashboard preferences API.
 *
 * GET /api/dashboard_prefs.php          — read the saved quick-access links
 * PUT /api/dashboard_prefs.php          — save the quick-access links (JSON: { quick_links: [...] })
 *
 * Stored as a JSON array of view keys in the app_settings table.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/settings.php';

apiHandleOptions();
apiRequireMethod('GET', 'PUT');

const QUICK_LINKS_KEY = 'dashboard_quick_links';
const QUICK_LINKS_MAX = 9;

try {
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $raw   = getSetting(QUICK_LINKS_KEY, '');
        $links = [];
        if ($raw) {
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) {
                $links = array_values(array_filter($decoded, 'is_string'));
            }
        }
        apiSuccess(['quick_links' => $links]);
    }

    // PUT — save
    $data  = apiGetJsonBody();
    $links = $data['quick_links'] ?? null;

    if (!is_array($links)) {
        apiError('quick_links deve essere un array di viste.');
    }

    // Sanitize: strings only, unique, capped.
    $clean = [];
    foreach ($links as $link) {
        if (!is_string($link)) {
            continue;
        }
        $link = preg_replace('/[^a-z_]/', '', strtolower(trim($link)));
        if ($link !== '' && !in_array($link, $clean, true)) {
            $clean[] = $link;
        }
    }

    if (count($clean) > QUICK_LINKS_MAX) {
        $clean = array_slice($clean, 0, QUICK_LINKS_MAX);
    }

    setSetting(QUICK_LINKS_KEY, json_encode($clean, JSON_UNESCAPED_UNICODE));

    apiSuccess(['quick_links' => $clean, 'message' => 'Accesso rapido aggiornato.']);
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}
