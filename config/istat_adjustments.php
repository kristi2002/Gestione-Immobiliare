<?php
/**
 * Chi ha diritto a un adeguamento ISTAT, e non lo sta ricevendo.
 *
 * L'indice, il calcolo e (da oggi) l'applicazione esistono. Mancava la domanda
 * che li mette in moto: *quali* contratti sono maturi. Senza qualcuno che se lo
 * chieda, l'adeguamento e' una funzione che c'e' e non si usa — e ogni anno
 * salltato non si recupera: il canone resta indietro per tutta la locazione, e
 * su una 4+4 sono quattro aumenti mancati.
 *
 * Qui si PROPONE, non si applica. Cambiare un canone e' toccare i soldi di due
 * persone: la decisione resta all'agenzia, che con un clic la esegue dalla
 * scheda del contratto. E' la stessa scelta fatta per la scadenza dei contratti
 * (lib/contract_lifecycle.php): il cron chiede una decisione umana, non la
 * prende.
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/../lib/istat.php';

/** Sotto questa soglia non vale la pena disturbare nessuno. */
const ISTAT_MIN_MONTHLY_DELTA = 1.00;

/** Un adeguamento all'anno: sotto gli 11 mesi dall'ultimo, si tace. */
const ISTAT_MIN_MONTHS_BETWEEN = 11;

/**
 * @return array{processed:int, created:int, skipped:int, results:array}
 */
function processIstatAdjustments(PDO $db): array
{
    $out = ['processed' => 0, 'created' => 0, 'skipped' => 0, 'results' => []];

    if (!istatTableAvailable($db)) {
        return $out + ['note' => 'Tabella indici ISTAT non presente.'];
    }
    if (istatLatestPeriod($db) === null) {
        return $out + ['note' => 'Nessun indice ISTAT importato: nulla da proporre.'];
    }

    // Il perimetro: locazioni in vigore con l'adeguamento attivo, senza disdetta
    // registrata, e con l'anniversario della decorrenza già passato quest'anno.
    // `last_istat_update` nullo = mai adeguato, che è il caso più comune e il
    // più urgente.
    $stmt = $db->query(
        "SELECT c.id, c.title, c.client_id, c.property_id, c.monthly_rent,
                c.start_date, c.end_date, c.istat_baseline_index, c.istat_baseline_month,
                c.last_istat_update
           FROM contracts c
          WHERE c.contract_type = 'locazione'
            AND (c.status IS NULL OR c.status = 'signed')
            AND c.istat_update_enabled = 1
            AND c.termination_notice_date IS NULL
            AND c.monthly_rent > 0
            AND c.start_date IS NOT NULL
            AND (c.end_date IS NULL OR c.end_date > CURDATE())
            AND (c.last_istat_update IS NULL
                 OR c.last_istat_update <= DATE_SUB(CURDATE(), INTERVAL " . ISTAT_MIN_MONTHS_BETWEEN . " MONTH))
            AND c.start_date <= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)"
    );
    $contracts = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $out['processed'] = count($contracts);

    $dup = $db->prepare(
        "SELECT id FROM reminders
          WHERE title = :title AND status = 'pending'
            AND created_at >= DATE_SUB(NOW(), INTERVAL 180 DAY)
          LIMIT 1"
    );

    $ins = $db->prepare(
        "INSERT INTO reminders
            (title, description, reminder_date, frequency, status, client_id, property_id,
             notify_admin, notify_client)
         VALUES
            (:title, :description, NOW(), 'once', 'pending', :client_id, :property_id, 1, 0)"
    );

    $target = istatLatestPeriod($db);

    foreach ($contracts as $c) {
        // Base illeggibile = si salta, non si indovina. Un promemoria costruito
        // su una base sbagliata proporrebbe all'agenzia una cifra sbagliata, e
        // l'agenzia la applicherebbe fidandosi — e' il modo peggiore in cui
        // questo difetto potrebbe arrivare all'inquilino: automatizzato.
        $base = istatContractBaseline($c);
        if (!$base['ok']) {
            $out['skipped']++;
            continue;
        }

        $res = istatComputeAdjustment(
            $db,
            (float) $c['monthly_rent'],
            ['year' => $base['year'], 'month' => $base['month'], 'index' => $base['index']],
            $target
        );

        // Un calcolo che non riesce (indice base mancante in tabella) non e' un
        // errore da far esplodere nel cron: e' un contratto su cui non si puo'
        // ancora dire niente.
        if (empty($res['ok']) || (float) $res['monthly_increase'] < ISTAT_MIN_MONTHLY_DELTA) {
            $out['skipped']++;
            continue;
        }

        $title = 'Adeguamento ISTAT contratto #' . $c['id'] . ': ' . $c['title'];

        $dup->execute(['title' => $title]);
        if ($dup->fetch()) {
            $out['skipped']++;
            continue;
        }

        $descr = sprintf(
            'Il canone può essere adeguato da € %s a € %s (+€ %s al mese, +€ %s l\'anno). '
            . 'Variazione FOI %s → %s applicata al %d%%. '
            . 'Si applica dalla scheda del contratto con «Adegua ISTAT». (contratto #%d)',
            number_format((float) $res['current_rent'], 2, ',', '.'),
            number_format((float) $res['new_rent'], 2, ',', '.'),
            number_format((float) $res['monthly_increase'], 2, ',', '.'),
            number_format((float) $res['annual_increase'], 2, ',', '.'),
            $res['baseline_period'],
            $res['target_period'],
            (int) round($res['share'] * 100),
            $c['id']
        );

        $ins->execute([
            'title'       => $title,
            'description' => $descr,
            'client_id'   => $c['client_id'],
            'property_id' => $c['property_id'],
        ]);
        $out['created']++;

        $out['results'][] = [
            'contract_id'      => (int) $c['id'],
            'current_rent'     => $res['current_rent'],
            'new_rent'         => $res['new_rent'],
            'monthly_increase' => $res['monthly_increase'],
        ];
    }

    return $out;
}
