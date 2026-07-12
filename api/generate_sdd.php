<?php
/**
 * SEPA SDD (addebito diretto) file export — pain.008.001.02.
 *
 * GET /api/generate_sdd.php?month=YYYY-MM[&collection_date=YYYY-MM-DD]  — download file
 * GET /api/generate_sdd.php?month=YYYY-MM&check=1                       — JSON readiness/preview
 *
 * Collects PENDING payments with method='sdd' whose due_date falls in the given
 * month AND whose tenant has an IBAN + SDD mandate. Creditor identity comes from
 * Settings (agency_iban, agency_sepa_creditor_id, agency name).
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/settings.php';
require_once __DIR__ . '/../lib/sepa_sdd.php';

if (!in_array(getCurrentRole(), ['admin', 'super_admin'], true)) {
    apiError('Permesso negato.', 403);
}

try {
    $db    = getDB();
    $month = trim($_GET['month'] ?? date('Y-m'));
    if (!preg_match('/^\d{4}-\d{2}$/', $month)) apiError('Parametro month non valido (usa YYYY-MM).');

    $creditor = [
        'name'        => (string) (getSetting('agency_denominazione', '') ?: getSetting('agency_name', 'Agenzia')),
        'iban'        => (string) getSetting('agency_iban', ''),
        'creditor_id' => (string) getSetting('agency_sepa_creditor_id', ''),
    ];

    $missing = [];
    if ($creditor['iban'] === '')        $missing[] = 'IBAN agenzia (Impostazioni → Fatturazione)';
    if ($creditor['creditor_id'] === '') $missing[] = 'Identificativo Creditore SEPA (Impostazioni → Fatturazione)';

    // Collect due SDD payments with a valid mandate.
    $stmt = $db->prepare(
        "SELECT pay.id, pay.amount, pay.due_date,
                t.name AS t_name, t.surname AS t_surname, t.iban, t.sdd_mandate_ref, t.sdd_mandate_date,
                p.address AS property_address
         FROM payments pay
         JOIN tenants t ON t.id = pay.tenant_id
         LEFT JOIN properties p ON p.id = pay.property_id
         WHERE pay.method = 'sdd'
           AND pay.status = 'pending'
           AND DATE_FORMAT(pay.due_date, '%Y-%m') = :month
         ORDER BY pay.due_date"
    );
    $stmt->execute(['month' => $month]);
    $rows = $stmt->fetchAll();

    $txs = [];
    $skipped = [];
    foreach ($rows as $r) {
        $debtor = trim(($r['t_name'] ?? '') . ' ' . ($r['t_surname'] ?? ''));
        if (empty($r['iban']) || empty($r['sdd_mandate_ref']) || empty($r['sdd_mandate_date'])) {
            $skipped[] = $debtor . ' (mandato/IBAN mancante)';
            continue;
        }
        $txs[] = [
            'end_to_end_id' => 'RENT-' . $r['id'],
            'amount'        => (float) $r['amount'],
            'mandate_id'    => $r['sdd_mandate_ref'],
            'mandate_date'  => $r['sdd_mandate_date'],
            'debtor_name'   => $debtor,
            'debtor_iban'   => $r['iban'],
            'remittance'    => 'Canone locazione ' . $month . ' ' . ($r['property_address'] ?? ''),
        ];
    }

    if (!empty($_GET['check'])) {
        apiSuccess([
            'ready'       => empty($missing) && count($txs) > 0,
            'missing'     => $missing,
            'count'       => count($txs),
            'total'       => array_sum(array_map(fn($t) => $t['amount'], $txs)),
            'skipped'     => $skipped,
            'month'       => $month,
        ]);
    }

    if (!empty($missing)) apiError('Configurazione incompleta: ' . implode(', ', $missing));
    if (empty($txs))      apiError('Nessun addebito SDD idoneo per ' . $month . '.');

    $collectionDate = trim($_GET['collection_date'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $collectionDate)) {
        $collectionDate = $month . '-05'; // default: 5th of the month
    }

    // Deterministic ids (no clock in the lib): stamp here.
    $msgId     = 'SDD-' . str_replace('-', '', $month) . '-' . substr(md5($creditor['iban'] . $month), 0, 8);
    $createdAt = date('Y-m-d\TH:i:s');

    $xml = sepaSddBuildXml($creditor, $txs, $collectionDate, $msgId, $createdAt);

    apiDiscardBufferedOutput();
    header('Content-Type: application/xml; charset=utf-8');
    header('Content-Disposition: attachment; filename="SDD_' . $month . '.xml"');
    echo $xml;
    exit;
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}
