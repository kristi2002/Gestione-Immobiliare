<?php
/**
 * Activity log read API (super_admin only).
 *
 * GET /api/activity_log.php — list with pagination (50/page),
 *     filters: action, entity_type, from, to, page.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();
apiRequireMethod('GET');
requireRole('super_admin');

const LOG_ACTIONS  = ['create', 'update', 'delete', 'login', 'logout'];
const LOG_PER_PAGE = 50;

try {
    $db = getDB();

    $action     = trim($_GET['action'] ?? '');
    $entityType = trim($_GET['entity_type'] ?? '');
    $from       = trim($_GET['from'] ?? '');
    $to         = trim($_GET['to'] ?? '');
    $page       = isset($_GET['page']) ? max(1, (int) $_GET['page']) : 1;

    $where  = " WHERE 1=1";
    $params = [];

    if ($action !== '' && in_array($action, LOG_ACTIONS, true)) {
        $where .= " AND action = :action";
        $params['action'] = $action;
    }
    if ($entityType !== '') {
        $where .= " AND entity_type = :entity_type";
        $params['entity_type'] = $entityType;
    }
    if ($from !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) {
        $where .= " AND created_at >= :from";
        $params['from'] = $from . ' 00:00:00';
    }
    if ($to !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) {
        $where .= " AND created_at <= :to";
        $params['to'] = $to . ' 23:59:59';
    }

    $countStmt = $db->prepare("SELECT COUNT(*) FROM activity_log" . $where);
    $countStmt->execute($params);
    $total = (int) $countStmt->fetchColumn();

    $offset = ($page - 1) * LOG_PER_PAGE;
    $sql    = "SELECT * FROM activity_log" . $where .
              " ORDER BY created_at DESC LIMIT " . LOG_PER_PAGE . " OFFSET " . $offset;

    $stmt = $db->prepare($sql);
    $stmt->execute($params);

    apiSuccess([
        'items'     => $stmt->fetchAll(),
        'total'     => $total,
        'page'      => $page,
        'per_page'  => LOG_PER_PAGE,
        'pages'     => (int) ceil($total / LOG_PER_PAGE),
    ]);
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}
