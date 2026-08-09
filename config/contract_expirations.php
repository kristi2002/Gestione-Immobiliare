<?php
/**
 * Contract expiration processing — Phase 11, rifatto in phase99.
 *
 * Il promemoria nasceva 30 giorni prima della scadenza. Per una locazione
 * italiana e' troppo tardi per essere utile: un 4+4 vuole la disdetta SEI MESI
 * prima, un commerciale dodici. L'avviso arrivava quando la decisione era gia'
 * stata presa dal silenzio — il contratto si era rinnovato per altri quattro
 * anni e nessuno se n'era accorto. Un promemoria che suona dopo il termine e'
 * peggio del niente: fa credere che qualcuno stia sorvegliando.
 *
 * Adesso la data del promemoria e' la SCADENZA DEL PREAVVISO
 * (contractNoticeDeadline), e l'avviso parte quando quella si avvicina.
 * Sui contratti senza preavviso — transitori, comodati, compravendite —
 * si ricade sui 30 giorni di prima, che li' vanno bene: non c'e' nessuna
 * disdetta da mandare, c'e' solo una scadenza da ricordare.
 *
 * The optional `contracts` table is not part of the base schema; when it is
 * absent the processor is a safe no-op so the cron never errors.
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/mail.php';
require_once __DIR__ . '/mail_html.php';
require_once __DIR__ . '/settings.php';
require_once __DIR__ . '/../lib/contract_lifecycle.php';

/** Con quanto anticipo si avvisa che la scadenza del preavviso si avvicina. */
const NOTICE_ALERT_LEAD_DAYS = 30;

function contractsTableExists(PDO $db): bool
{
    try {
        $db->query("SELECT 1 FROM contracts LIMIT 1");
        return true;
    } catch (PDOException) {
        return false;
    }
}

/**
 * @return array{processed:int, created:int, skipped:int, results:array}
 */
function processContractExpirations(PDO $db): array
{
    if (!contractsTableExists($db)) {
        return ['processed' => 0, 'created' => 0, 'skipped' => 0, 'results' => [], 'note' => 'Tabella contracts non presente.'];
    }

    // `status IS NULL` = "Automatico", che dal phase69 e' il DEFAULT del form dei
    // contratti: filtrare sul solo 'signed' significava saltare la maggior parte
    // dei contratti creati dall'interfaccia: nessun promemoria a -30 giorni,
    // nessuna email, e la scadenza scoperta il giorno stesso o dopo. E' la stessa
    // definizione di "in vigore" usata dal filtro "Attivi" e dallo scadenzario —
    // annullati e bozze restano giustamente fuori.
    // La finestra si allarga fino a 18 mesi perche' il preavviso piu' lungo che
    // il codice conosce e' quello commerciale (12 mesi, 18 per gli alberghi):
    // con i 90 giorni di prima un contratto 4+4 non entrava MAI nella selezione
    // in tempo utile. La scrematura fine avviene poi riga per riga, dove si
    // conosce il preavviso del singolo contratto.
    //
    // I contratti con una disdetta gia' registrata restano fuori: la decisione
    // e' presa, e continuare a chiederla e' rumore.
    $stmt = $db->query(
        "SELECT c.id, c.title, c.client_id, c.property_id, c.end_date,
                c.contract_subtype, c.notice_months, c.renewal_months, c.auto_renew,
                c.termination_notice_date, c.start_date
         FROM contracts c
         WHERE (c.status IS NULL OR c.status = 'signed')
           AND c.end_date IS NOT NULL
           AND c.termination_notice_date IS NULL
           AND c.end_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 18 MONTH)"
    );
    $contracts = $stmt->fetchAll();

    $created = 0;
    $skipped = 0;
    $results = [];

    // Dedup: skip if a pending reminder with same title already exists within 90 days
    $dupStmt = $db->prepare(
        "SELECT id FROM reminders
         WHERE title = :title AND status = 'pending'
           AND created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
         LIMIT 1"
    );

    $insStmt = $db->prepare(
        "INSERT INTO reminders
            (title, description, reminder_date, frequency, status, client_id, property_id,
             notify_admin, notify_client)
         VALUES
            (:title, :description, :reminder_date, 'once', 'pending', :client_id, :property_id,
             1, 0)"
    );

    $today = date('Y-m-d');

    foreach ($contracts as $c) {
        $endHuman = date('d/m/Y', strtotime($c['end_date']));
        $deadline = contractNoticeDeadline($c);

        if ($deadline !== null) {
            // Si avvisa quando la scadenza del preavviso e' vicina, o gia'
            // passata mentre il contratto e' ancora in vigore: in quel secondo
            // caso il rinnovo e' ormai avvenuto e va detto, non nascosto.
            $alertFrom = date('Y-m-d', strtotime($deadline . ' -' . NOTICE_ALERT_LEAD_DAYS . ' days'));
            if ($today < $alertFrom) {
                $skipped++;
                continue;
            }

            $reminderDate = date('Y-m-d H:i:s', strtotime($alertFrom));
            $expired      = $today > $deadline;
            $renews       = !empty($c['auto_renew']);

            $descr = 'Il contratto scadrà il ' . $endHuman . '. ';
            if ($expired && $renews) {
                $descr .= 'Il termine per la disdetta (' . date('d/m/Y', strtotime($deadline))
                    . ') è PASSATO: senza una disdetta già inviata il contratto si rinnova.';
            } elseif ($renews) {
                $descr .= 'Per non rinnovarlo, la disdetta va inviata entro il '
                    . date('d/m/Y', strtotime($deadline)) . '.';
            } else {
                $descr .= 'Termine di preavviso: ' . date('d/m/Y', strtotime($deadline)) . '.';
            }
            $descr .= ' (contratto #' . $c['id'] . ')';
        } else {
            // Nessun preavviso: vale il vecchio anticipo di 30 giorni, e la
            // finestra larga di selezione va richiusa qui.
            if (strtotime($c['end_date']) > strtotime('+90 days')) {
                $skipped++;
                continue;
            }
            $reminderDate = date('Y-m-d H:i:s', strtotime($c['end_date'] . ' -30 days'));
            $descr        = 'Il contratto scadrà il ' . $endHuman . '. (contratto #' . $c['id'] . ')';
        }

        // Il titolo porta l'id: la deduplicazione confronta i titoli, e due
        // contratti che si chiamano uguale — cosa normalissima, «Locazione Via
        // Roma 12» rinnovato — si annullavano a vicenda. Il secondo non riceveva
        // nessun promemoria e nessuno poteva accorgersene.
        $title = 'Scadenza contratto #' . $c['id'] . ': ' . $c['title'];

        $dupStmt->execute(['title' => $title]);
        if ($dupStmt->fetch()) {
            $skipped++;
            continue;
        }

        $insStmt->execute([
            'title'         => $title,
            'description'   => $descr,
            'reminder_date' => $reminderDate,
            'client_id'     => $c['client_id'],
            'property_id'   => $c['property_id'],
        ]);
        $created++;

        $adminEmail = getSetting('agency_email', 'admin@agenzia.it');
        $subject    = '[Scadenza contratto] ' . $c['title'];
        $body       = $descr . "\n\n"
            . "È stato creato un promemoria per il " . date('d/m/Y', strtotime($reminderDate)) . ".";
        sendHtmlEmail($adminEmail, $subject, $body);

        $results[] = [
            'contract_id'     => (int) $c['id'],
            'title'           => $c['title'],
            'reminder_date'   => $reminderDate,
            'notice_deadline' => $deadline,
        ];
    }

    return [
        'processed' => count($contracts),
        'created'   => $created,
        'skipped'   => $skipped,
        'results'   => $results,
    ];
}
