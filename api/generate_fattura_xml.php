<?php
/**
 * FatturaPA XML export for an invoice.
 *
 * GET /api/generate_fattura_xml.php?id={invoice_id}          — download XML
 * GET /api/generate_fattura_xml.php?id={invoice_id}&check=1  — JSON readiness check
 *
 * The agency fiscal identity comes from Settings → Fatturazione (app_settings).
 * Transmission to SdI is out of scope — hand the file to your intermediary.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/settings.php';
require_once __DIR__ . '/../lib/FatturaPA.php';

if (!in_array(getCurrentRole(), ['admin', 'super_admin'], true)) {
    apiError('Permesso negato.', 403);
}

try {
    $db = getDB();
    $id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
    if ($id <= 0) apiError('ID fattura mancante.');

    $stmt = $db->prepare(
        "SELECT i.*, c.name AS client_name, c.surname AS client_surname,
                c.codice_fiscale AS client_cf,
                l.name AS lead_name, l.surname AS lead_surname, l.codice_fiscale AS lead_cf
         FROM invoices i
         LEFT JOIN clients c ON c.id = i.client_id
         LEFT JOIN leads l ON l.id = i.lead_id
         WHERE i.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $inv = $stmt->fetch();
    if (!$inv) apiError('Fattura non trovata.', 404);

    $agency = [
        'piva'           => getSetting('agency_piva', ''),
        'cf'             => getSetting('agency_cf', ''),
        'denominazione'  => getSetting('agency_denominazione', '') ?: getSetting('agency_name', ''),
        'regime_fiscale' => getSetting('agency_regime_fiscale', 'RF01'),
        'indirizzo'      => getSetting('agency_indirizzo', '') ?: getSetting('agency_address', ''),
        'cap'            => getSetting('agency_cap', ''),
        'comune'         => getSetting('agency_comune', ''),
        'provincia'      => getSetting('agency_provincia', ''),
        'pec'            => getSetting('agency_pec', ''),
    ];

    // Build the cessionario (customer) from the linked client or lead.
    if (!empty($inv['client_id'])) {
        $customer = [
            'nome'    => $inv['client_name'] ?? '',
            'cognome' => $inv['client_surname'] ?? '',
            'cf'      => $inv['client_cf'] ?? '',
        ];
    } else {
        $customer = [
            'nome'    => $inv['lead_name'] ?? '',
            'cognome' => $inv['lead_surname'] ?? '',
            'cf'      => $inv['lead_cf'] ?? '',
        ];
    }

    $missing = fatturaPaMissingAgencyFields($agency);

    if (!empty($_GET['check'])) {
        apiSuccess([
            'ready'          => empty($missing),
            'missing'        => $missing,
            'invoice_number' => $inv['invoice_number'],
        ]);
    }

    $progressivo = (int) $id;
    $xml = fatturaPaBuildXml($inv, $agency, $customer, $progressivo);

    // Filename convention: IT{piva}_{progressivo in base36-ish}.xml (SdI-like).
    $sender   = preg_replace('/\D/', '', (string) ($agency['piva'] ?: $agency['cf'] ?: '00000000000'));
    $filename = 'IT' . ($sender ?: '00000000000') . '_' . str_pad((string) $progressivo, 5, '0', STR_PAD_LEFT) . '.xml';

    apiDiscardBufferedOutput();
    header('Content-Type: application/xml; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    echo $xml;
    exit;
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}
