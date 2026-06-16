<?php
/**
 * Shared pagination helpers for list APIs.
 */

function apiGetPagination(int $defaultLimit = 25, int $maxLimit = 100): array
{
    $page  = max(1, (int) ($_GET['page'] ?? 1));
    $limit = min($maxLimit, max(1, (int) ($_GET['limit'] ?? $defaultLimit)));
    $offset = ($page - 1) * $limit;

    return [
        'page'   => $page,
        'limit'  => $limit,
        'offset' => $offset,
        'pages'  => 0,
    ];
}

function apiPaginatedSuccess(array $items, int $total, array $pagination): void
{
    $pages = $total > 0 ? (int) ceil($total / $pagination['limit']) : 0;

    apiSuccess([
        'items'  => $items,
        'total'  => $total,
        'page'   => $pagination['page'],
        'limit'  => $pagination['limit'],
        'pages'  => $pages,
    ]);
}

function apiFetchPaginated(PDO $db, string $countSql, string $dataSql, array $params, array $pagination): array
{
    $countStmt = $db->prepare($countSql);
    $countStmt->execute($params);
    $total = (int) $countStmt->fetchColumn();

    $dataSql .= ' LIMIT ' . (int) $pagination['limit'] . ' OFFSET ' . (int) $pagination['offset'];
    $stmt = $db->prepare($dataSql);
    $stmt->execute($params);

    return [$stmt->fetchAll(), $total];
}
