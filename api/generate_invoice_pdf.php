<?php
/**
 * Invoice PDF generation.
 *
 * POST /api/generate_invoice_pdf.php  { invoice_id }
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/pdf.php';

apiHandleOptions();
requireWriteAccess();

if (!in_array(getCurrentRole(), ['admin', 'super_admin'], true)) {
    apiError('Permesso negato.', 403);
}

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        apiError('Metodo non consentito.', 405);
    }

    $data      = apiGetJsonBody();
    $invoiceId = (int) ($data['invoice_id'] ?? 0);
    if ($invoiceId <= 0) {
        apiError('invoice_id obbligatorio.');
    }

    $db   = getDB();
    $stmt = $db->prepare(
        "SELECT i.*, c.name AS client_name, c.surname AS client_surname,
                c.email AS client_email, c.phone AS client_phone,
                l.name AS lead_name, l.surname AS lead_surname
         FROM invoices i
         LEFT JOIN clients c ON c.id = i.client_id
         LEFT JOIN leads l ON l.id = i.lead_id
         WHERE i.id = :id"
    );
    $stmt->execute(['id' => $invoiceId]);
    $inv = $stmt->fetch();
    if (!$inv) {
        apiError('Fattura non trovata.', 404);
    }

    $agencyName    = getSetting('agency_name', 'Gestionale Immobiliare');
    $agencyAddress = getSetting('agency_address', '');
    $agencyPhone   = getSetting('agency_phone', '');
    $agencyEmail   = getSetting('agency_email', '');

    $billTo = $inv['client_id']
        ? trim($inv['client_name'] . ' ' . $inv['client_surname'])
        : ($inv['lead_id'] ? trim($inv['lead_name'] . ' ' . $inv['lead_surname']) : 'Cliente');

    $lines = [
        strtoupper($agencyName),
        $agencyAddress ?: '',
        trim(($agencyPhone ? 'Tel: ' . $agencyPhone : '') . ($agencyEmail ? '  Email: ' . $agencyEmail : '')),
        str_repeat('-', 60),
        'FATTURA ' . $inv['invoice_number'],
        'Data emissione: ' . formatDateIt($inv['issue_date']),
        $inv['due_date'] ? 'Scadenza: ' . formatDateIt($inv['due_date']) : '',
        '',
        'INTESTATARIO',
        $billTo,
        '',
        'DESCRIZIONE',
        wordwrap($inv['description'], 70, "\n", true),
        '',
        str_repeat('-', 60),
        'Imponibile:   EUR ' . number_format((float) $inv['amount'], 2, ',', '.'),
        'IVA (' . rtrim(rtrim($inv['vat_rate'], '0'), '.') . '%): EUR ' . number_format((float) $inv['vat_amount'], 2, ',', '.'),
        'TOTALE:       EUR ' . number_format((float) $inv['total'], 2, ',', '.'),
        str_repeat('-', 60),
        '',
        'Stato: ' . strtoupper($inv['status']),
        $inv['notes'] ? 'Note: ' . wordwrap($inv['notes'], 70, "\n", true) : '',
        '',
        'Generato il ' . date('d/m/Y H:i'),
    ];
    $lines = array_values(array_filter($lines, fn($l) => $l !== ''));

    $result = savePdf(
        $db,
        'invoice',
        'Fattura ' . $inv['invoice_number'],
        $lines,
        $inv['client_id'] ? (int) $inv['client_id'] : null,
        null,
        null,
        getCurrentAdminId()
    );

    apiSuccess($result);
} catch (Throwable $e) {
    apiError('Errore generazione PDF fattura.', 500);
}
