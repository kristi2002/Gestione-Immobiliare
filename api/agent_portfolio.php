<?php
/**
 * Agent portfolio — per-agent performance stats.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();
apiRequireMethod('GET');
requireRole('super_admin', 'admin');

try {
    $db      = getDB();
    $agentId = isset($_GET['agent_id']) ? (int) $_GET['agent_id'] : null;

    if ($agentId) {
        $stmt = $db->prepare('SELECT id, username, role, email FROM admin_users WHERE id = :id');
        $stmt->execute(['id' => $agentId]);
        $agent = $stmt->fetch();
        if (!$agent) apiError('Agente non trovato.', 404);

        $stats = fetchAgentStats($db, [$agentId]);
        apiSuccess(array_merge(['agent' => $agent], $stats[$agentId]));
    }

    $agents = $db->query(
        "SELECT id, username, role, email FROM admin_users
         WHERE is_active = 1 AND role IN ('super_admin','admin','agent')
         ORDER BY username"
    )->fetchAll();

    $stats  = fetchAgentStats($db, array_map(static fn($a) => (int) $a['id'], $agents));
    $result = [];

    foreach ($agents as $agent) {
        $id       = (int) $agent['id'];
        $result[] = array_merge(
            ['id' => $id, 'username' => $agent['username'], 'role' => $agent['role'], 'email' => $agent['email']],
            $stats[$id]
        );
    }

    apiSuccess($result);
} catch (PDOException) {
    apiError('Errore database.', 500);
}

/**
 * Stats for a set of agents in a fixed number of queries.
 *
 * Deliberately set-based. The previous version called a per-agent helper inside
 * the list loop — five queries each, one of which re-SELECTed the admin_users
 * row the loop had *already* fetched and then discarded — so the team page cost
 * 1+5N roundtrips. Now it is 1+5 whatever the headcount, and the single-agent
 * scheda goes down the same path with a one-element list rather than a second
 * implementation that can drift from this one.
 *
 * @param  int[] $agentIds
 * @return array<int, array<string, mixed>> agent id => stats
 */
function fetchAgentStats(PDO $db, array $agentIds): array
{
    if (!$agentIds) return [];

    $stats = array_fill_keys($agentIds, [
        'leads_total'         => 0,
        'leads_new'           => 0,
        'leads_converted'     => 0,
        'appointments'        => 0,
        'properties'          => 0,
        'keys_out'            => 0,
        'commissions_pending' => 0.0,
        'commissions_paid'    => 0.0,
        'conversion_rate'     => 0.0,
    ]);

    // Positional placeholders: every query below re-binds the same id list.
    $in    = implode(',', array_fill(0, count($agentIds), '?'));
    $rows  = static function (string $sql) use ($db, $agentIds): array {
        $stmt = $db->prepare($sql);
        $stmt->execute($agentIds);
        return $stmt->fetchAll();
    };

    foreach ($rows("SELECT assigned_to AS aid, status, COUNT(*) AS cnt
                      FROM leads
                     WHERE assigned_to IN ($in)
                     GROUP BY assigned_to, status") as $r) {
        $aid = (int) $r['aid'];
        $stats[$aid]['leads_total'] += (int) $r['cnt'];
        if ($r['status'] === 'new')       $stats[$aid]['leads_new']       = (int) $r['cnt'];
        if ($r['status'] === 'converted') $stats[$aid]['leads_converted'] = (int) $r['cnt'];
    }

    foreach ($rows("SELECT agent_id AS aid, COUNT(*) AS cnt
                      FROM appointments
                     WHERE agent_id IN ($in)
                     GROUP BY agent_id") as $r) {
        $stats[(int) $r['aid']]['appointments'] = (int) $r['cnt'];
    }

    // holder_id is the *agent* slot of the polymorphic key holder (phase72): the
    // API nulls every holder_* column before writing one, so a non-null holder_id
    // already implies holder_type='agente' and no type filter is needed here.
    foreach ($rows("SELECT holder_id AS aid, COUNT(*) AS cnt
                      FROM property_keys
                     WHERE holder_id IN ($in) AND status = 'out'
                     GROUP BY holder_id") as $r) {
        $stats[(int) $r['aid']]['keys_out'] = (int) $r['cnt'];
    }

    foreach ($rows("SELECT a.agent_id AS aid, COUNT(DISTINCT p.id) AS cnt
                      FROM properties p
                      INNER JOIN appointments a ON a.property_id = p.id
                     WHERE a.agent_id IN ($in) AND p.status != 'archived'
                     GROUP BY a.agent_id") as $r) {
        $stats[(int) $r['aid']]['properties'] = (int) $r['cnt'];
    }

    foreach ($rows("SELECT admin_user_id AS aid,
                           COALESCE(SUM(CASE WHEN status = 'pending' THEN amount END), 0) AS pending,
                           COALESCE(SUM(CASE WHEN status = 'paid'    THEN amount END), 0) AS paid
                      FROM agent_commissions
                     WHERE admin_user_id IN ($in)
                     GROUP BY admin_user_id") as $r) {
        $stats[(int) $r['aid']]['commissions_pending'] = (float) $r['pending'];
        $stats[(int) $r['aid']]['commissions_paid']    = (float) $r['paid'];
    }

    // Sempre float, anche a zero: con 0 intero su chi non ha lead e 0.0 su chi
    // ne ha senza conversioni, lo stesso campo cambiava tipo in JSON a seconda
    // dell'agente.
    foreach ($stats as $aid => $s) {
        $stats[$aid]['conversion_rate'] = $s['leads_total'] > 0
            ? round(100 * $s['leads_converted'] / $s['leads_total'], 1)
            : 0.0;
    }

    return $stats;
}
