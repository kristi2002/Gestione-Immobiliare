<?php
/**
 * Automazioni — flussi automatici per email, notifiche e azioni.
 *
 * GET /api/automations.php
 *   → { items:[ {id,name,description,trigger,actions,color,active,run_count} ],
 *       stats:{ active_count,total_runs,hours_saved } }
 * PUT /api/automations.php { id, active }
 *   → toggles an automation on/off.
 *
 * Reads/writes a `automations` table when present. That table is not yet part
 * of the migrations, so until it ships GET responds with a well-formed empty
 * dataset (never a fatal) and PUT is a no-op. No fabricated rows reach
 * production; the React page renders its empty state.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
apiHandleOptions();

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'PUT' || $method === 'PATCH') {
    $body = apiGetJsonBody();
    $id = (int) ($body['id'] ?? 0);
    $active = !empty($body['active']) ? 1 : 0;
    try {
        $db = getDB();
        $stmt = $db->prepare("UPDATE automations SET active = ? WHERE id = ?");
        $stmt->execute([$active, $id]);
    } catch (PDOException $e) {
        // Table not migrated — treat as a successful no-op.
    }
    apiSuccess(['id' => $id, 'active' => (bool) $active]);
}

apiRequireMethod('GET');

$empty = ['items' => [], 'stats' => ['active_count' => 0, 'total_runs' => 0, 'hours_saved' => 0]];

try {
    $db = getDB();
    $rows = $db->query(
        "SELECT id, name, description, trigger_desc AS `trigger`, action_desc AS actions,
                color, active, run_count
         FROM automations
         ORDER BY id ASC"
    )->fetchAll();
} catch (PDOException $e) {
    apiSuccess($empty);
}

$activeCount = 0;
$totalRuns = 0;
foreach ($rows as &$r) {
    $r['active'] = (bool) $r['active'];
    $r['run_count'] = (int) $r['run_count'];
    if ($r['active']) $activeCount++;
    $totalRuns += $r['run_count'];
}
unset($r);

apiSuccess([
    'items' => $rows,
    'stats' => [
        'active_count' => $activeCount,
        'total_runs' => $totalRuns,
        // rough heuristic: ~2 min saved per automated run
        'hours_saved' => (int) round($totalRuns * 2 / 60),
    ],
]);
