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
        // A malformed IBAN would sail through XML generation and be rejected by the
        // bank on upload. Skip it here so it shows up in the readiness preview as a
        // fixable row instead of silently poisoning the batch.
        if (!sepaIbanIsValid($r['iban'])) {
            $skipped[] = $debtor . ' (IBAN non valido)';
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

    $today = date('Y-m-d');

    // Requested collection date. CORE direct debits need lead time for the bank to
    // present them, so a date in the past (or today) is an automatic reject — when
    // the caller doesn't pick one, fall back to the 5th of the month only while it
    // is still far enough ahead, otherwise the soonest safe date.
    $collectionDate = trim($_GET['collection_date'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $collectionDate)) {
        $earliest       = date('Y-m-d', strtotime($today . ' +2 days'));
        $collectionDate = max($month . '-05', $earliest);
    }

    $problems = sepaSddValidate($creditor, $txs, $collectionDate, $today);

    if (!empty($_GET['check'])) {
        $schemaAvailable = is_readable(sepaSddSchemaPath());
        apiSuccess([
            'ready'           => empty($missing) && empty($problems) && count($txs) > 0,
            'missing'         => $missing,
            'problems'        => $problems,
            'count'           => count($txs),
            'total'           => array_sum(array_map(fn($t) => $t['amount'], $txs)),
            'skipped'         => $skipped,
            'month'           => $month,
            'collection_date' => $collectionDate,
            'schema_validation' => $schemaAvailable ? 'attiva' : 'non disponibile',
        ]);
    }

    if (!empty($missing))  apiError('Configurazione incompleta: ' . implode(', ', $missing));
    if (empty($txs))       apiError('Nessun addebito SDD idoneo per ' . $month . '.');
    if (!empty($problems)) apiError('File non generato — correggi prima: ' . implode(' | ', $problems));

    // Deterministic ids (no clock in the lib): stamp here.
    $msgId     = 'SDD-' . str_replace('-', '', $month) . '-' . substr(md5($creditor['iban'] . $month), 0, 8);
    $createdAt = date('Y-m-d\TH:i:s');

    $xml = sepaSddBuildXml($creditor, $txs, $collectionDate, $msgId, $createdAt);

    // Structural check against the official XSD when the schema is installed
    // (lib/schema/README.md); a no-op otherwise. Never serve a file we know the
    // bank will bounce.
    $schema = sepaSddSchemaValidate($xml);
    if (!$schema['valid']) {
        apiError('Il file generato non rispetta lo schema pain.008.001.02: ' . implode(' | ', array_slice($schema['errors'], 0, 5)), 500);
    }

    apiDiscardBufferedOutput();
    header('Content-Type: application/xml; charset=utf-8');
    header('Content-Disposition: attachment; filename="SDD_' . $month . '.xml"');
    echo $xml;
    exit;
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}
