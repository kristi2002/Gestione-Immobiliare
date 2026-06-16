<?php
/**
 * In-app notifications API.
 *
 * GET /api/notifications.php — returns { count, items[] } of overdue
 *                              and due-today pending reminders.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();
apiRequireMethod('GET');

try {
    $db = getDB();

    $stmt = $db->query(
        "SELECT id, title, reminder_date
         FROM reminders
         WHERE status = 'pending'
           AND reminder_date <= NOW()
         ORDER BY reminder_date ASC
         LIMIT 50"
    );
    $items = $stmt->fetchAll();

    apiSuccess([
        'count' => count($items),
        'items' => $items,
    ]);
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}
