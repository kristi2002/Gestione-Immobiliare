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
        apiSuccess(getAgentStats($db, $agentId));
    }

    $stmt = $db->query(
        "SELECT id, username, role, email FROM admin_users
         WHERE is_active = 1 AND role IN ('super_admin','admin','agent')
         ORDER BY username"
    );
    $agents = $stmt->fetchAll();
    $result = [];

    foreach ($agents as $agent) {
        $result[] = array_merge(
            ['id' => (int) $agent['id'], 'username' => $agent['username'], 'role' => $agent['role'], 'email' => $agent['email']],
            getAgentStats($db, (int) $agent['id'], false)
        );
    }

    apiSuccess($result);
} catch (PDOException) {
    apiError('Errore database.', 500);
}

function getAgentStats(PDO $db, int $agentId, bool $withMeta = true): array
{
    $user = $db->prepare('SELECT id, username, role, email FROM admin_users WHERE id = :id');
    $user->execute(['id' => $agentId]);
    $agent = $user->fetch();
    if (!$agent) apiError('Agente non trovato.', 404);

    $leads = $db->prepare(
        "SELECT status, COUNT(*) AS cnt FROM leads WHERE assigned_to = :id GROUP BY status"
    );
    $leads->execute(['id' => $agentId]);
    $leadCounts = [];
    foreach ($leads->fetchAll() as $row) {
        $leadCounts[$row['status']] = (int) $row['cnt'];
    }

    $apptStmt = $db->prepare("SELECT COUNT(*) FROM appointments WHERE agent_id = :id");
    $apptStmt->execute(['id' => $agentId]);
    $appointments = (int) $apptStmt->fetchColumn();

    $keyStmt = $db->prepare("SELECT COUNT(*) FROM property_keys WHERE holder_id = :id AND status = 'out'");
    $keyStmt->execute(['id' => $agentId]);
    $keysOut = (int) $keyStmt->fetchColumn();

    $propStmt = $db->prepare(
        "SELECT COUNT(DISTINCT p.id) FROM properties p
         INNER JOIN appointments a ON a.property_id = p.id
         WHERE a.agent_id = :id AND p.status != 'archived'"
    );
    $propStmt->execute(['id' => $agentId]);
    $properties = (int) $propStmt->fetchColumn();

    $stats = [
        'leads_total'      => array_sum($leadCounts),
        'leads_new'        => $leadCounts['new'] ?? 0,
        'leads_converted'  => $leadCounts['converted'] ?? 0,
        'appointments'     => $appointments,
        'properties'       => $properties,
        'keys_out'         => $keysOut,
        'conversion_rate'  => ($leadCounts['converted'] ?? 0) > 0 && array_sum($leadCounts) > 0
            ? round(100 * ($leadCounts['converted'] ?? 0) / array_sum($leadCounts), 1) : 0,
    ];

    if ($withMeta) {
        return array_merge([
            'agent' => $agent,
        ], $stats);
    }

    return $stats;
}
