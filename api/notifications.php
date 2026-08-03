<?php
/**
 * In-app notifications API.
 *
 * GET  /api/notifications.php                     — { count, items[] }: scadenze
 *                                                   in ritardo PIU' i messaggi
 *                                                   in arrivo non ancora letti.
 * POST /api/notifications.php?action=read {id}|{all:true} — segna letto.
 *
 * Perche' due sorgenti. La campanella leggeva solo `reminders`, mentre due
 * webhook — api/whatsapp_webhook.php e api/email_inbound.php — scrivevano
 * righe nella tabella `notifications` che nessuna schermata leggeva mai. Un
 * WhatsApp del cliente, o un nuovo lead da Immobiliare.it arrivato via email,
 * producevano una notifica che non suonava da nessuna parte: la si scopriva
 * solo aprendo l'Inbox per caso. Le due sorgenti restano tabelle distinte —
 * una scadenza si evade, un messaggio si legge — ma la campanella e' una sola.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();

/** Quante voci entrano nella tendina (il conteggio non e' limitato). */
const NOTIF_LIST_LIMIT = 50;

/**
 * Dove porta il click, per tipo di notifica. Un messaggio WhatsApp che aprisse
 * l'elenco dei promemoria sarebbe peggio di nessun collegamento.
 */
const NOTIF_TARGET_VIEW = [
    'whatsapp_inbound' => 'whatsapp_inbox',
    'email_inbound'    => 'communications',
];

try {
    $db = getDB();

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        markNotificationsRead($db);
    }
    apiRequireMethod('GET');

    // ── Scadenze ────────────────────────────────────────────────────────────
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
    $dueCount = (int) $db->query("SELECT COUNT(*) FROM reminders $where")->fetchColumn();

    $stmt = $db->query(
        "SELECT id, title, reminder_date
         FROM reminders
         $where
         ORDER BY reminder_date ASC
         LIMIT " . NOTIF_LIST_LIMIT
    );

    $items = [];
    foreach ($stmt->fetchAll() as $r) {
        $items[] = [
            'source'        => 'reminder',
            'id'            => (int) $r['id'],
            'title'         => $r['title'],
            'body'          => null,
            'date'          => $r['reminder_date'],
            // Retrocompatibilita': un client non aggiornato legge ancora questo.
            'reminder_date' => $r['reminder_date'],
            'view'          => 'reminders',
        ];
    }

    // ── Messaggi in arrivo ──────────────────────────────────────────────────
    $inboxCount = 0;
    try {
        $inboxCount = (int) $db->query('SELECT COUNT(*) FROM notifications WHERE is_read = 0')->fetchColumn();

        $nstmt = $db->query(
            'SELECT id, type, title, body, entity_type, entity_id, created_at
               FROM notifications
              WHERE is_read = 0
              ORDER BY created_at DESC
              LIMIT ' . NOTIF_LIST_LIMIT
        );
        foreach ($nstmt->fetchAll() as $n) {
            $items[] = [
                'source'        => 'notification',
                'id'            => (int) $n['id'],
                'type'          => $n['type'],
                'title'         => $n['title'],
                'body'          => $n['body'],
                'date'          => $n['created_at'],
                'reminder_date' => $n['created_at'],
                'entity_type'   => $n['entity_type'],
                'entity_id'     => $n['entity_id'] !== null ? (int) $n['entity_id'] : null,
                'view'          => NOTIF_TARGET_VIEW[$n['type']] ?? 'reminders',
            ];
        }
    } catch (PDOException $e) {
        // Installazione senza la tabella: la campanella continua a fare il suo
        // lavoro sulle scadenze invece di spegnersi del tutto.
        error_log('[notifiche] tabella notifications non leggibile: ' . $e->getMessage());
    }

    // I messaggi in arrivo vanno in cima: sono la cosa a cui si risponde adesso.
    // Fra loro, dal piu' recente; le scadenze dalla piu' vecchia, che e' la piu'
    // in ritardo.
    usort($items, static function (array $a, array $b): int {
        if ($a['source'] !== $b['source']) {
            return $a['source'] === 'notification' ? -1 : 1;
        }
        return $a['source'] === 'notification'
            ? strcmp((string) $b['date'], (string) $a['date'])
            : strcmp((string) $a['date'], (string) $b['date']);
    });

    $count = $dueCount + $inboxCount;
    $items = array_slice($items, 0, NOTIF_LIST_LIMIT);

    apiSuccess([
        'count'       => $count,
        'due_count'   => $dueCount,
        'inbox_count' => $inboxCount,
        'items'       => $items,
        // La tendina mostra le prime NOTIF_LIST_LIMIT: senza questo il client
        // non sa che ne sta nascondendo altre.
        'truncated'   => $count > count($items),
    ]);
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

/**
 * Segna letta una notifica (o tutte).
 *
 * Senza questo la campanella non si spegne mai: le righe restano is_read = 0
 * per sempre e il badge annuncia lo stesso messaggio all'infinito. Vale solo
 * per i messaggi in arrivo — una scadenza si chiude evadendola, non
 * nascondendola.
 */
function markNotificationsRead(PDO $db): void
{
    $data = apiGetJsonBody();

    if (!empty($data['all'])) {
        $n = $db->exec('UPDATE notifications SET is_read = 1, read_at = NOW() WHERE is_read = 0');
        apiSuccess(['marked' => (int) $n]);
    }

    $id = (int) ($data['id'] ?? 0);
    if ($id <= 0) {
        apiError('id mancante.');
    }

    $stmt = $db->prepare('UPDATE notifications SET is_read = 1, read_at = NOW() WHERE id = :id AND is_read = 0');
    $stmt->execute(['id' => $id]);

    apiSuccess(['marked' => $stmt->rowCount()]);
}
