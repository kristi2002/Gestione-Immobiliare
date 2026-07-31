<?php
/**
 * Scadenzario Fiscale Unico — one ranked feed of every deadline in the system.
 *
 * GET /api/scadenzario.php[?horizon=365][&type=contract_expiry|registration|ape|insurance|aml]
 *
 * Aggregates, with an overdue / soon(<=30gg) / upcoming classification:
 *   - contract expiry            (contracts.end_date)
 *   - imposta di registro        (contracts.imposta_registro_due_date)
 *   - APE expiry                 (properties.ape_expiry_date)
 *   - insurance expiry           (property_insurance.end_date)
 *   - antiriciclaggio retention  (aml_records.retention_until)
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
apiHandleOptions();

try {
    $db      = getDB();
    $horizon = isset($_GET['horizon']) ? max(30, min(1825, (int) $_GET['horizon'])) : 365;
    // Finestra all'INDIETRO. Prima non esisteva: ogni query aveva solo il
    // limite superiore, quindi una scadenza passata restava nel elenco per
    // sempre. Un contratto finito nel 2019 compariva accanto a uno in scadenza
    // la settimana prossima, e la lista non poteva che allungarsi ogni anno --
    // senza LIMIT, tutta caricata in memoria e resa in un colpo solo.
    // Un anno indietro copre cio' su cui si puo' ancora agire (un'imposta non
    // versata, un APE da rifare); piu' indietro e' archivio, non scadenzario.
    $lookback = isset($_GET['lookback']) ? max(30, min(1825, (int) $_GET['lookback'])) : 365;
    $typeF   = trim($_GET['type'] ?? '');

    $items = [];

    // Contract expiry
    $rows = $db->query(
        "SELECT c.id, c.title, c.end_date AS d, p.address
         FROM contracts c
         LEFT JOIN properties p ON p.id = c.property_id
         WHERE c.end_date IS NOT NULL
           AND c.end_date <= DATE_ADD(CURDATE(), INTERVAL $horizon DAY)
           AND c.end_date >= DATE_SUB(CURDATE(), INTERVAL $lookback DAY)
           AND (c.status IS NULL OR c.status NOT IN ('cancelled'))"
    )->fetchAll();
    foreach ($rows as $r) {
        $items[] = makeItem('contract_expiry', 'Scadenza contratto', $r['title'], $r['address'], $r['d'], 'contracts', (int) $r['id']);
    }

    // Imposta di registro
    $rows = $db->query(
        "SELECT c.id, c.title, c.imposta_registro_due_date AS d, p.address
         FROM contracts c
         LEFT JOIN properties p ON p.id = c.property_id
         WHERE c.imposta_registro_due_date IS NOT NULL
           AND c.cedolare_secca = 0
           AND c.imposta_registro_due_date <= DATE_ADD(CURDATE(), INTERVAL $horizon DAY)
           AND c.imposta_registro_due_date >= DATE_SUB(CURDATE(), INTERVAL $lookback DAY)"
    )->fetchAll();
    foreach ($rows as $r) {
        $items[] = makeItem('registration', 'Imposta di registro', $r['title'], $r['address'], $r['d'], 'contracts', (int) $r['id']);
    }

    // APE expiry
    $rows = $db->query(
        "SELECT id, address, ape_expiry_date AS d
         FROM properties
         WHERE ape_expiry_date IS NOT NULL
           AND ape_expiry_date <= DATE_ADD(CURDATE(), INTERVAL $horizon DAY)
           AND ape_expiry_date >= DATE_SUB(CURDATE(), INTERVAL $lookback DAY)
           AND status != 'archived'"
    )->fetchAll();
    foreach ($rows as $r) {
        $items[] = makeItem('ape', 'Scadenza APE', $r['address'], $r['address'], $r['d'], 'properties', (int) $r['id']);
    }

    // Insurance expiry
    $rows = $db->query(
        "SELECT pi.id, pi.insurer_name, pi.end_date AS d, p.address
         FROM property_insurance pi
         LEFT JOIN properties p ON p.id = pi.property_id
         WHERE pi.end_date IS NOT NULL
           AND pi.end_date <= DATE_ADD(CURDATE(), INTERVAL $horizon DAY)
           AND pi.end_date >= DATE_SUB(CURDATE(), INTERVAL $lookback DAY)"
    )->fetchAll();
    foreach ($rows as $r) {
        $items[] = makeItem('insurance', 'Scadenza assicurazione', $r['insurer_name'], $r['address'], $r['d'], 'insurance', (int) $r['id']);
    }

    // Antiriciclaggio retention
    $rows = $db->query(
        "SELECT id, subject_name, retention_until AS d
         FROM aml_records
         WHERE retention_until IS NOT NULL
           AND retention_until <= DATE_ADD(CURDATE(), INTERVAL $horizon DAY)
           AND retention_until >= DATE_SUB(CURDATE(), INTERVAL $lookback DAY)"
    )->fetchAll();
    foreach ($rows as $r) {
        $items[] = makeItem('aml', 'Conservazione antiriciclaggio', $r['subject_name'], null, $r['d'], 'aml', (int) $r['id']);
    }

    if ($typeF !== '') {
        $items = array_values(array_filter($items, fn($it) => $it['type'] === $typeF));
    }

    // Sort by date ascending (overdue first).
    usort($items, fn($a, $b) => strcmp((string) $a['date'], (string) $b['date']));

    $stats = ['overdue' => 0, 'soon' => 0, 'upcoming' => 0, 'total' => count($items)];
    foreach ($items as $it) {
        $stats[$it['severity']]++;
    }

    // Le statistiche restano calcolate sull'insieme COMPLETO della finestra:
    // troncare anche quelle farebbe sparire scadenze dai contatori, che e'
    // peggio che non mostrarle in elenco. L'elenco invece ha un tetto, e quando
    // lo tocca la risposta lo dichiara invece di far credere che sia tutto.
    $cap       = 500;
    $truncated = count($items) > $cap;
    if ($truncated) {
        $items = array_slice($items, 0, $cap);
    }

    apiSuccess([
        'items'     => $items,
        'stats'     => $stats,
        'horizon'   => $horizon,
        'lookback'  => $lookback,
        'truncated' => $truncated,
        'shown'     => count($items),
    ]);
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------

function makeItem(string $type, string $label, ?string $subject, ?string $context, ?string $date, string $view, int $id): array
{
    $days = null;
    $severity = 'upcoming';
    if ($date) {
        $today = new DateTime('today');
        $due   = DateTime::createFromFormat('Y-m-d', substr($date, 0, 10)) ?: $today;
        $days  = (int) $today->diff($due)->format('%r%a');
        if ($days < 0)       $severity = 'overdue';
        elseif ($days <= 30) $severity = 'soon';
        else                 $severity = 'upcoming';
    }
    return [
        'type'       => $type,
        'label'      => $label,
        'subject'    => $subject ?: '—',
        'context'    => $context,
        'date'       => $date ? substr($date, 0, 10) : null,
        'days_until' => $days,
        'severity'   => $severity,
        'view'       => $view,
        'entity_id'  => $id,
    ];
}
