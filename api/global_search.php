<?php
/**
 * Global search (topbar) — one query across the main entities.
 *
 * GET /api/global_search.php?q=rossi
 *
 * Returns grouped results (proprietari, immobili, inquilini, lead) with a target
 * view + params so the client can navigate straight to each record.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
apiHandleOptions();
apiRequireMethod('GET');

$q = trim($_GET['q'] ?? '');
if (mb_strlen($q) < 2) {
    apiSuccess(['groups' => []]);
}

try {
    $db     = getDB();
    $groups = [];
    $per    = 5;

    // ── Proprietari (clients) ────────────────────────────────────────────────
    $items = searchGroup($db, 'clients',
        ['name', 'surname', 'codice_fiscale', 'email', 'phone'], $q, $per,
        "SELECT id, TRIM(CONCAT(name,' ',surname)) AS title, COALESCE(email, phone, codice_fiscale, '') AS sub FROM clients",
        'client_profile', 'clientId');
    if ($items) $groups[] = ['label' => 'Proprietari', 'icon' => 'users', 'items' => $items];

    // ── Immobili (properties) ────────────────────────────────────────────────
    $items = searchGroup($db, 'properties',
        ['address', 'city', 'reference_code', 'cap'], $q, $per,
        "SELECT id, address AS title, TRIM(CONCAT(COALESCE(city,''),' ',COALESCE(cap,''))) AS sub FROM properties WHERE status <> 'archived'",
        'property_profile', 'propertyId', true);
    if ($items) $groups[] = ['label' => 'Immobili', 'icon' => 'building-2', 'items' => $items];

    // ── Inquilini (tenants) ──────────────────────────────────────────────────
    $items = searchGroup($db, 'tenants',
        ['name', 'surname', 'email', 'phone'], $q, $per,
        "SELECT id, TRIM(CONCAT(name,' ',surname)) AS title, COALESCE(email, phone, '') AS sub FROM tenants",
        'tenant_edit', 'tenantId');
    if ($items) $groups[] = ['label' => 'Inquilini', 'icon' => 'key-round', 'items' => $items];

    // ── Lead ─────────────────────────────────────────────────────────────────
    $items = searchGroup($db, 'leads',
        ['name', 'surname', 'email', 'phone', 'preferred_city'], $q, $per,
        "SELECT id, TRIM(CONCAT(name,' ',surname)) AS title, COALESCE(preferred_city, email, phone, '') AS sub FROM leads",
        'lead_edit', 'leadId');
    if ($items) $groups[] = ['label' => 'Lead', 'icon' => 'target', 'items' => $items];

    apiSuccess(['groups' => $groups]);
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

/**
 * Run a word-search over $columns of a base SELECT and return normalised items.
 */
function searchGroup(PDO $db, string $table, array $columns, string $q, int $limit,
                     string $baseSelect, string $view, string $paramKey, bool $baseHasWhere = false): array
{
    $params = [];
    $frag = apiWordSearch($q, $columns, $params, substr($table, 0, 2));
    if ($frag === '') return [];

    $glue = $baseHasWhere ? ' AND ' : ' WHERE ';
    $sql  = $baseSelect . $glue . '(' . $frag . ") LIMIT $limit";
    $stmt = $db->prepare($sql);
    $stmt->execute($params);

    $out = [];
    foreach ($stmt->fetchAll() as $r) {
        $out[] = [
            'title'  => $r['title'] !== '' ? $r['title'] : ('#' . $r['id']),
            'sub'    => $r['sub'] ?? '',
            'view'   => $view,
            'params' => [$paramKey => (int) $r['id']],
        ];
    }
    return $out;
}
