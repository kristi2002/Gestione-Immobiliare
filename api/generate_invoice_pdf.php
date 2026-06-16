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

    $billTo = $inv['client_id']
        ? trim($inv['client_name'] . ' ' . $inv['client_surname'])
        : ($inv['lead_id'] ? trim($inv['lead_name'] . ' ' . $inv['lead_surname']) : 'Cliente');

    $statusLabels = [
        'draft' => 'Bozza', 'sent' => 'Inviata', 'paid' => 'Pagata',
        'overdue' => 'Scaduta', 'cancelled' => 'Annullata',
    ];

    $vatRate = rtrim(rtrim((string) $inv['vat_rate'], '0'), '.');

    $blocks = [
        ['type' => 'kv', 'pairs' => [
            ['Numero fattura', $inv['invoice_number']],
            ['Stato',          $statusLabels[$inv['status']] ?? ucfirst((string) $inv['status'])],
            ['Data emissione', formatDateIt($inv['issue_date'])],
            ['Scadenza',       $inv['due_date'] ? formatDateIt($inv['due_date']) : '—'],
        ]],
        ['type' => 'h2', 'text' => 'Intestatario'],
        ['type' => 'kv', 'pairs' => [
            ['Cliente',  $billTo],
            ['Email',    $inv['client_email'] ?? '—'],
            ['Telefono', $inv['client_phone'] ?? '—'],
        ]],
        ['type' => 'h2', 'text' => 'Descrizione'],
        ['type' => 'paragraph', 'text' => $inv['description'] ?: '—'],
        ['type' => 'h2', 'text' => 'Importi'],
        ['type' => 'table', 'columns' => [
            ['label' => 'Voce', 'width' => 0.7],
            ['label' => 'Importo', 'width' => 0.3, 'align' => 'right'],
        ], 'rows' => [
            ['Imponibile', '€ ' . number_format((float) $inv['amount'], 2, ',', '.')],
            ['IVA (' . $vatRate . '%)', '€ ' . number_format((float) $inv['vat_amount'], 2, ',', '.')],
        ], 'totalLabel' => 'Totale documento', 'totalValue' => '€ ' . number_format((float) $inv['total'], 2, ',', '.')],
    ];

    if (!empty($inv['notes'])) {
        $blocks[] = ['type' => 'h2', 'text' => 'Note'];
        $blocks[] = ['type' => 'paragraph', 'text' => $inv['notes']];
    }

    $title = 'Fattura ' . $inv['invoice_number'];
    $pdf   = SimplePdf::fromBlocks($title, $blocks, pdfDocOpts($title, [
        'meta' => 'N. ' . $inv['invoice_number'],
    ]));

    $result = persistPdf(
        $db,
        'invoice',
        $title,
        $pdf,
        $inv['client_id'] ? (int) $inv['client_id'] : null,
        null,
        null,
        getCurrentAdminId()
    );

    apiSuccess($result);
} catch (Throwable $e) {
    apiError('Errore generazione PDF fattura.', 500);
}
