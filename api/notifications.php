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

    // Stesso filtro del motore di invio (processDueReminders in
    // config/reminders.php): una REGOLA a evento non e' una scadenza da
    // mostrare. Ha una reminder_date solo perche' la colonna e' NOT NULL, e
    // quella data non arriva mai — resta 'pending' per sempre e la campanella
    // la contava come un promemoria in ritardo che nessuno puo' evadere.
    // Le occorrenze materializzate dal dispatcher sono normali righe
    // 'scheduled' e continuano a comparire qui.
    $stmt = $db->query(
        "SELECT id, title, reminder_date
         FROM reminders
         WHERE status = 'pending'
           AND reminder_date <= NOW()
           AND trigger_type = 'scheduled'
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
