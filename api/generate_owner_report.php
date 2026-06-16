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

    $agencyName    = getSetting('agency_name', 'Gestionale Immobiliare');
    $agencyAddress = getSetting('agency_address', '');

    $lines = [
        strtoupper($agencyName),
        $agencyAddress ?: '',
        str_repeat('-', 60),
        'RENDICONTO PROPRIETARIO',
        'Periodo: ' . $periodLabel,
        '',
        'PROPRIETARIO',
        trim($client['name'] . ' ' . $client['surname']),
        $client['email'] ?? '',
        '',
        'IMMOBILI',
    ];

    $totalRent = 0.0;
    if ($properties) {
        foreach ($properties as $p) {
            $rent = $p['price_type'] === 'affitto' && $p['price'] !== null ? (float) $p['price'] : 0.0;
            $totalRent += $rent;
            $lines[] = '- ' . $p['address'] . ', ' . $p['city']
                . ' (' . $p['status'] . ')'
                . ($rent > 0 ? ' — Canone: EUR ' . number_format($rent, 2, ',', '.') : '');
        }
    } else {
        $lines[] = 'Nessun immobile attivo.';
    }

    $lines[] = '';
    $lines[] = 'CANONE MENSILE TOTALE: EUR ' . number_format($totalRent, 2, ',', '.');
    $lines[] = '';
    $lines[] = 'FATTURE AGENZIA NEL PERIODO';

    $totalInvoiced = 0.0;
    if ($invoices) {
        foreach ($invoices as $i) {
            $totalInvoiced += (float) $i['total'];
            $lines[] = '- ' . $i['invoice_number'] . ' (' . formatDateIt($i['issue_date']) . '): EUR '
                . number_format((float) $i['total'], 2, ',', '.') . ' [' . $i['status'] . ']';
        }
    } else {
        $lines[] = 'Nessuna fattura nel periodo.';
    }

    $multiplier   = $month !== null ? 1 : 12;
    $grossRent    = $totalRent * $multiplier;
    $netEstimated = $grossRent - $totalInvoiced;

    $lines[] = '';
    $lines[] = str_repeat('-', 60);
    $lines[] = 'RIEPILOGO ECONOMICO';
    $lines[] = 'Canone lordo periodo: EUR ' . number_format($grossRent, 2, ',', '.');
    $lines[] = 'Costi agenzia (fatture): EUR ' . number_format($totalInvoiced, 2, ',', '.');
    $lines[] = 'Netto stimato: EUR ' . number_format($netEstimated, 2, ',', '.');
    $lines[] = str_repeat('-', 60);
    $lines[] = '';
    $lines[] = 'Generato il ' . date('d/m/Y H:i');

    $lines = array_values(array_filter($lines, fn($l) => $l !== ''));

    $result = savePdf(
        $db,
        'report',
        'Rendiconto ' . $client['surname'] . ' ' . $periodLabel,
        $lines,
        $clientId,
        null,
        null,
        getCurrentAdminId()
    );

    apiSuccess($result);
} catch (Throwable $e) {
    apiError('Errore generazione rendiconto.', 500);
}
