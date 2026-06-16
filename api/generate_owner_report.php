<?php
/**
 * Owner statement (Rendiconto proprietario) PDF.
 *
 * POST /api/generate_owner_report.php  { client_id, month?, year }
 *
 * Summarises the owner's properties, related agency invoices and reminders
 * for the chosen period (month optional → annual report).
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/pdf.php';

apiHandleOptions();
requireWriteAccess();

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        apiError('Metodo non consentito.', 405);
    }

    $data     = apiGetJsonBody();
    $clientId = (int) ($data['client_id'] ?? 0);
    $year     = (int) ($data['year'] ?? date('Y'));
    $month    = isset($data['month']) && $data['month'] !== '' ? (int) $data['month'] : null;

    if ($clientId <= 0) {
        apiError('client_id obbligatorio.');
    }
    if ($year < 2000 || $year > 2100) {
        apiError('Anno non valido.');
    }
    if ($month !== null && ($month < 1 || $month > 12)) {
        apiError('Mese non valido.');
    }

    $db   = getDB();
    $stmt = $db->prepare("SELECT * FROM clients WHERE id = :id");
    $stmt->execute(['id' => $clientId]);
    $client = $stmt->fetch();
    if (!$client) {
        apiError('Proprietario non trovato.', 404);
    }

    // Period boundaries.
    if ($month !== null) {
        $periodStart = sprintf('%04d-%02d-01', $year, $month);
        $periodEnd   = date('Y-m-t', strtotime($periodStart));
        $periodLabel = sprintf('%02d/%d', $month, $year);
    } else {
        $periodStart = sprintf('%04d-01-01', $year);
        $periodEnd   = sprintf('%04d-12-31', $year);
        $periodLabel = 'Anno ' . $year;
    }

    // Properties of the owner.
    $propStmt = $db->prepare(
        "SELECT address, city, status, price, price_type
         FROM properties WHERE client_id = :cid AND status != 'archived'
         ORDER BY city ASC, address ASC"
    );
    $propStmt->execute(['cid' => $clientId]);
    $properties = $propStmt->fetchAll();

    // Agency invoices billed to the owner in the period.
    $invStmt = $db->prepare(
        "SELECT invoice_number, description, total, status, issue_date
         FROM invoices
         WHERE client_id = :cid AND issue_date BETWEEN :start AND :end
         ORDER BY issue_date ASC"
    );
    $invStmt->execute(['cid' => $clientId, 'start' => $periodStart, 'end' => $periodEnd]);
    $invoices = $invStmt->fetchAll();

    // Build property rows
    $totalRent    = 0.0;
    $propPairs    = [];
    $statusLabels = ['available' => 'Disponibile', 'rented' => 'Affittato', 'sold' => 'Venduto'];

    foreach ($properties as $p) {
        $rent        = $p['price_type'] === 'affitto' && $p['price'] !== null ? (float) $p['price'] : 0.0;
        $totalRent  += $rent;
        $statusLabel = $statusLabels[$p['status']] ?? ucfirst($p['status']);
        $rentText    = $rent > 0 ? '€ ' . number_format($rent, 2, ',', '.') . ' / mese' : '—';
        $propPairs[] = [
            $p['address'] . ', ' . $p['city'] . ' (' . $statusLabel . ')',
            $rentText,
        ];
    }

    // Build invoice rows
    $totalInvoiced = 0.0;
    $invPairs      = [];
    foreach ($invoices as $i) {
        $totalInvoiced += (float) $i['total'];
        $invPairs[]     = [
            ($i['invoice_number'] ?? '—') . ' — ' . formatDateIt($i['issue_date']),
            '€ ' . number_format((float) $i['total'], 2, ',', '.') . ' [' . ucfirst($i['status'] ?? '') . ']',
        ];
    }

    $multiplier   = $month !== null ? 1 : 12;
    $grossRent    = $totalRent * $multiplier;
    $netEstimated = $grossRent - $totalInvoiced;
    $rentNote     = $month !== null ? 'Canone mensile' : 'Canone annuo stimato (×12 mesi)';

    $docTitle = 'Rendiconto ' . trim($client['surname'] . ' ' . $client['name']) . ' — ' . $periodLabel;

    $blocks = [
        ['type' => 'h2',  'text'  => 'Proprietario'],
        ['type' => 'kv',  'pairs' => [
            ['Nominativo', trim($client['name'] . ' ' . $client['surname'])],
            ['Email',      $client['email'] ?: '—'],
            ['Telefono',   $client['phone'] ?: '—'],
            ['Periodo',    $periodLabel],
        ]],

        ['type' => 'h2', 'text' => 'Immobili'],
        $propPairs
            ? ['type' => 'kv', 'pairs' => $propPairs]
            : ['type' => 'paragraph', 'text' => 'Nessun immobile attivo nel periodo.'],

        ['type' => 'h2', 'text' => 'Fatture agenzia nel periodo'],
        $invPairs
            ? ['type' => 'kv', 'pairs' => $invPairs]
            : ['type' => 'paragraph', 'text' => 'Nessuna fattura nel periodo.'],

        ['type' => 'divider'],
        ['type' => 'h2',   'text'  => 'Riepilogo economico'],
        ['type' => 'price', 'label' => $rentNote,
                            'value' => '€ ' . number_format($grossRent, 2, ',', '.'),
                            'note'  => 'Lordo'],
        ['type' => 'kv',   'pairs' => [
            ['Costi agenzia (fatture)', '€ ' . number_format($totalInvoiced, 2, ',', '.')],
            ['Netto stimato',           '€ ' . number_format($netEstimated,  2, ',', '.')],
        ]],
        ['type' => 'spacer', 'height' => 4],
        ['type' => 'paragraph', 'text' =>
            'Documento generato automaticamente il ' . date('d/m/Y \a\l\l\e H:i') . '. ' .
            'I valori sono indicativi e basati sui dati presenti nel gestionale alla data di generazione.'],
    ];

    $pdf    = SimplePdf::fromBlocks($docTitle, $blocks, pdfDocOpts($docTitle, ['meta' => $periodLabel]));
    $result = persistPdf($db, 'report', $docTitle, $pdf, $clientId, null, null, getCurrentAdminId());

    apiSuccess($result);
} catch (Throwable $e) {
    apiError('Errore generazione rendiconto.', 500);
}
