<?php
/**
 * Manutenzione — interventi, guasti e manutenzione programmata.
 *
 * GET /api/maintenance.php
 *   → { items:[ {id,title,property_address,tenant_name,supplier_name,
 *                status,priority,reported_date,eta_date,started_date,
 *                completed_date,cost,rating,progress} ],
 *       stats:{ open,in_progress,completed_month,avg_cost,total_open_cost,top_supplier } }
 *
 * Reads from a `maintenance_requests` table when present. That table is not yet
 * part of the migrations, so until it ships this endpoint responds with a
 * well-formed empty dataset (never a fatal), and the React page shows its
 * empty states. No fabricated rows reach production.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
apiHandleOptions();
apiRequireMethod('GET');

$empty = [
    'items' => [],
    'stats' => [
        'open' => 0,
        'in_progress' => 0,
        'completed_month' => 0,
        'avg_cost' => 0,
        'total_open_cost' => 0,
        'top_supplier' => null,
    ],
];

try {
    $db = getDB();

    $rows = $db->query(
        "SELECT m.id, m.title, m.status, m.priority, m.reported_date, m.eta_date,
                m.started_date, m.completed_date, m.cost, m.rating, m.progress,
                p.address AS property_address,
                TRIM(CONCAT(COALESCE(t.first_name,''),' ',COALESCE(t.last_name,''))) AS tenant_name,
                s.name AS supplier_name
         FROM maintenance_requests m
         LEFT JOIN properties p ON p.id = m.property_id
         LEFT JOIN tenants    t ON t.id = m.tenant_id
         LEFT JOIN suppliers  s ON s.id = m.supplier_id
         ORDER BY m.reported_date DESC"
    )->fetchAll();
} catch (PDOException $e) {
    // Table not migrated yet — respond empty rather than 500.
    apiSuccess($empty);
}

$open = $inProgress = $completedMonth = 0;
$openCost = 0.0;
$costs = [];
$supplierCounts = [];
$thisMonth = date('Y-m');

foreach ($rows as $r) {
    switch ($r['status']) {
        case 'todo':        $open++; $openCost += (float) $r['cost']; break;
        case 'in_progress': $inProgress++; $openCost += (float) $r['cost']; break;
        case 'done':
            if ($r['completed_date'] && substr($r['completed_date'], 0, 7) === $thisMonth) $completedMonth++;
            if ($r['cost'] !== null) $costs[] = (float) $r['cost'];
            break;
    }
    if (!empty($r['supplier_name'])) {
        $supplierCounts[$r['supplier_name']] = ($supplierCounts[$r['supplier_name']] ?? 0) + 1;
    }
}

$topSupplier = null;
if ($supplierCounts) {
    arsort($supplierCounts);
    $name = array_key_first($supplierCounts);
    $topSupplier = ['name' => $name, 'count' => $supplierCounts[$name]];
}

apiSuccess([
    'items' => $rows,
    'stats' => [
        'open' => $open,
        'in_progress' => $inProgress,
        'completed_month' => $completedMonth,
        'avg_cost' => $costs ? round(array_sum($costs) / count($costs)) : 0,
        'total_open_cost' => round($openCost),
        'top_supplier' => $topSupplier,
    ],
]);
