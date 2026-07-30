<?php
/**
 * Solleciti pagamenti — le regole, in un posto solo.
 *
 * Questo lavoro esisteva due volte: api/payment_reminder_log.php (pagina
 * "Solleciti pagamenti", invio a mano) e cron/send_payment_reminders.php
 * (invio automatico notturno). Due implementazioni scritte a mano delle stesse
 * regole, e gia' divergenti in modo sostanziale — non per sfumature:
 *
 *   - il cron guardava solo i pagamenti scaduti da NON PIU' di 60 giorni,
 *     l'API non aveva alcun limite. Sulla base dati attuale la pagina
 *     annunciava 69 solleciti mentre il cron ne avrebbe spediti una frazione;
 *   - il cron ripiegava sull'email del PROPRIETARIO quando l'inquilino non ne
 *     aveva una, e gli mandava un testo che dice "La preghiamo di provvedere
 *     al pagamento" — cioe' chiedeva al proprietario di pagare l'affitto a se
 *     stesso;
 *   - il cron usava LEFT JOIN sugli inquilini, l'API INNER JOIN, quindi i
 *     pagamenti senza inquilino collegato entravano in uno e non nell'altro.
 *
 * Ora la selezione, la finestra temporale, il periodo di attesa e il testo del
 * messaggio stanno qui, e i due chiamanti li leggono. La pagina, il pulsante e
 * il cron notturno decidono con lo stesso codice.
 */

require_once __DIR__ . '/db.php';

/** Quanti giorni prima di risollecitare lo stesso pagamento. */
const PAYMENT_REMINDER_COOLDOWN_DAYS = 7;

/**
 * Oltre questo ritardo il sollecito automatico si ferma.
 *
 * Era gia' la regola del cron (`due_date >= CURDATE() - 60 giorni`), solo che
 * viveva dentro la query: i pagamenti piu' vecchi sparivano senza che nessuno
 * sapesse che esistevano. Qui la soglia resta identica, ma le righe escluse
 * vengono comunque restituite con il loro motivo, cosi' la pagina puo' dirlo
 * invece di far finta che quel debito non ci sia. Un credito di nove mesi non
 * si recupera con un'email automatica: si passa alle vie legali, e continuare a
 * mandare solleciti indeboliva la posizione dell'agenzia invece di rafforzarla.
 */
const PAYMENT_REMINDER_MAX_OVERDUE_DAYS = 60;

/**
 * I pagamenti in ritardo, ognuno gia' giudicato: si sollecita o no, e perche'.
 *
 * Restituisce TUTTI gli scaduti, non solo i sollecitabili. L'anteprima e
 * l'invio devono guardare la stessa lista — se il numero mostrato prima di
 * premere "Invia" lo calcolasse per conto suo, prometterebbe una cifra e ne
 * spedirebbe un'altra, e quel pulsante scrive a decine di persone in una volta.
 *
 * Il controllo del periodo di attesa e' una sottoquery e non una query per
 * riga: con l'archivio pieno l'anteprima deve restare immediata.
 */
function collectPaymentReminderCandidates(PDO $db): array
{
    $stmt = $db->query(
        "SELECT pay.id AS payment_id, pay.amount, pay.due_date,
                pay.tenant_id, pay.property_id,
                DATEDIFF(CURDATE(), pay.due_date) AS days_overdue,
                t.name    AS tenant_name,
                t.surname AS tenant_surname,
                t.email   AS tenant_email,
                p.address AS property_address,
                p.city    AS property_city,
                p.client_id,
                (SELECT MAX(rl.sent_at) FROM payment_reminder_log rl
                  WHERE rl.payment_id = pay.id AND rl.status = 'sent') AS last_sent_at
         FROM payments pay
         LEFT JOIN tenants    t ON t.id = pay.tenant_id
         LEFT JOIN properties p ON p.id = pay.property_id
         WHERE pay.status IN ('pending', 'late')
           AND pay.due_date < CURDATE()
         ORDER BY days_overdue DESC"
    );

    $rows = [];
    foreach ($stmt->fetchAll() as $row) {
        $email       = trim((string) ($row['tenant_email'] ?? ''));
        $daysOverdue = (int) $row['days_overdue'];

        // L'ordine conta: il motivo mostrato deve essere quello che davvero
        // ferma l'invio, non il primo che capita.
        $skip = null;
        if (empty($row['tenant_id'])) {
            // Il sollecito e' indirizzato a chi deve pagare. Senza inquilino
            // collegato non c'e' un destinatario: mandarlo al proprietario
            // significherebbe chiedergli di pagare l'affitto a se stesso.
            $skip = 'Nessun inquilino collegato al pagamento';
        } elseif ($daysOverdue > PAYMENT_REMINDER_MAX_OVERDUE_DAYS) {
            $skip = 'Scaduto da oltre ' . PAYMENT_REMINDER_MAX_OVERDUE_DAYS
                . ' giorni: fuori dal sollecito automatico';
        } elseif ($row['last_sent_at'] !== null
            && strtotime($row['last_sent_at']) >= strtotime('-' . PAYMENT_REMINDER_COOLDOWN_DAYS . ' days')) {
            $skip = 'Gia\' sollecitato il ' . date('d/m/Y', strtotime($row['last_sent_at']));
        } elseif ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $skip = 'Nessun indirizzo email valido';
        }

        $row['tenant_full_name'] = trim(($row['tenant_name'] ?? '') . ' ' . ($row['tenant_surname'] ?? ''));
        $row['property_label']   = trim(($row['property_address'] ?? '') . ', ' . ($row['property_city'] ?? ''), ', ');
        $row['eligible']         = $skip === null;
        $row['skip_reason']      = $skip;
        $rows[] = $row;
    }

    return $rows;
}

/**
 * Il testo del sollecito. Uno solo, cosi' l'inquilino riceve lo stesso
 * messaggio che parta dal cron o dal pulsante: prima erano due testi diversi,
 * e un destinatario poteva riceverli entrambi con parole differenti.
 *
 * @return array{subject: string, text: string, html: string}
 */
function buildPaymentReminderEmail(array $row): array
{
    $name        = $row['tenant_full_name'] !== '' ? $row['tenant_full_name'] : 'Gentile inquilino';
    $property    = $row['property_label'] !== '' ? $row['property_label'] : '(immobile)';
    $amount      = number_format((float) $row['amount'], 2, ',', '.');
    $dueDate     = date('d/m/Y', strtotime($row['due_date']));
    $daysOverdue = (int) $row['days_overdue'];

    $subject = "Sollecito pagamento — scaduto da {$daysOverdue} giorni";

    $text = "Gentile {$name},\n\n"
        . "Le ricordiamo che risulta un pagamento in attesa relativo all'immobile {$property}.\n\n"
        . "  Importo:  € {$amount}\n"
        . "  Scadenza: {$dueDate}\n"
        . "  Giorni di ritardo: {$daysOverdue}\n\n"
        . "La preghiamo di provvedere al pagamento il prima possibile o di contattarci per chiarimenti.\n\n"
        . "Distinti saluti";

    $esc  = static fn ($v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
    $html = '<p>Gentile <strong>' . $esc($name) . '</strong>,</p>'
        . '<p>Le ricordiamo che risulta un pagamento in attesa relativo all\'immobile <strong>'
        . $esc($property) . '</strong>.</p>'
        . '<table style="border-collapse:collapse;margin:12px 0">'
        . '<tr><td style="padding:4px 12px 4px 0"><strong>Importo</strong></td><td>€ ' . $esc($amount) . '</td></tr>'
        . '<tr><td style="padding:4px 12px 4px 0"><strong>Scadenza</strong></td><td>' . $esc($dueDate) . '</td></tr>'
        . '<tr><td style="padding:4px 12px 4px 0"><strong>Giorni di ritardo</strong></td><td>' . $daysOverdue . '</td></tr>'
        . '</table>'
        . '<p>La preghiamo di provvedere al pagamento il prima possibile o di contattarci per chiarimenti.</p>'
        . '<p>Distinti saluti</p>';

    return ['subject' => $subject, 'text' => $text, 'html' => $html];
}
