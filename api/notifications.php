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

/** Quante scadenze entrano nella tendina (il conteggio non e' limitato). */
const NOTIF_LIST_LIMIT = 50;

try {
    $db = getDB();

    // Stesso filtro del motore di invio (processDueReminders in
    // config/reminders.php): una REGOLA a evento non e' una scadenza da
    // mostrare. Ha una reminder_date solo perche' la colonna e' NOT NULL, e
    // quella data non arriva mai — resta 'pending' per sempre e la campanella
    // la contava come un promemoria in ritardo che nessuno puo' evadere.
    // Le occorrenze materializzate dal dispatcher sono normali righe
    // 'scheduled' e continuano a comparire qui.
    //
    // Una sola definizione di "scaduto" per il conteggio e per l'elenco: se le
    // due WHERE divergono, il numero sulla campanella smette di descrivere la
    // tendina che apre.
    $where = "WHERE status = 'pending'
                AND reminder_date <= NOW()
                AND trigger_type = 'scheduled'";

    // Il totale si conta sul database. Contarlo in PHP sulle righe gia' tagliate
    // dal LIMIT significa fermare il badge a 50: con 80 scadenze in ritardo ne
    // annuncia 50, e il badge tace proprio quando il ritardo e' peggiore.
    $count = (int) $db->query("SELECT COUNT(*) FROM reminders $where")->fetchColumn();

    $stmt = $db->query(
        "SELECT id, title, reminder_date
         FROM reminders
         $where
         ORDER BY reminder_date ASC
         LIMIT " . NOTIF_LIST_LIMIT
    );
    $items = $stmt->fetchAll();

    apiSuccess([
        'count' => $count,
        'items' => $items,
        // La tendina mostra le prime NOTIF_LIST_LIMIT: senza questo il client
        // non sa che ne sta nascondendo altre.
        'truncated' => $count > count($items),
    ]);
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}
