<?php
/**
 * Owner portal — rendiconto PDF download (uses owner session, no admin auth needed).
 */
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/../config/settings.php';
require_once __DIR__ . '/../lib/SimplePdf.php';

initOwnerSession();
requireOwnerAuth();

require_once __DIR__ . '/../config/db.php';

$ownerId = getCurrentOwnerId();
$db      = getDB();
$year    = isset($_GET['year']) ? (int) $_GET['year'] : (int) date('Y');
$month   = isset($_GET['month']) && $_GET['month'] !== '' ? (int) $_GET['month'] : null;

if ($year < 2000 || $year > 2100) $year = (int) date('Y');
if ($month !== null && ($month < 1 || $month > 12)) $month = null;

$client = $db->prepare("SELECT * FROM clients WHERE id = :id");
$client->execute(['id' => $ownerId]);
$client = $client->fetch(PDO::FETCH_ASSOC);

if (!$client) {
    http_response_code(404);
    exit('Proprietario non trovato.');
}

if ($month !== null) {
    $periodStart = sprintf('%04d-%02d-01', $year, $month);
    $periodEnd   = date('Y-m-t', strtotime($periodStart));
    $periodLabel = sprintf('%02d/%d', $month, $year);
} else {
    $periodStart = sprintf('%04d-01-01', $year);
    $periodEnd   = sprintf('%04d-12-31', $year);
    $periodLabel = 'Anno ' . $year;
}

$properties = $db->prepare(
    "SELECT address, city, status, price, price_type
     FROM properties WHERE client_id = :cid AND status != 'archived'
     ORDER BY city, address"
);
$properties->execute(['cid' => $ownerId]);
$properties = $properties->fetchAll(PDO::FETCH_ASSOC);

$payments = $db->prepare(
    "SELECT pay.amount, pay.due_date, pay.status, p.address
     FROM payments pay
     INNER JOIN properties p ON p.id = pay.property_id
     WHERE p.client_id = :cid
       AND pay.due_date BETWEEN :start AND :end
     ORDER BY pay.due_date ASC"
);
$payments->execute(['cid' => $ownerId, 'start' => $periodStart, 'end' => $periodEnd]);
$payments = $payments->fetchAll(PDO::FETCH_ASSOC);

$agencyName    = getSetting('agency_name', 'Gestionale Immobiliare');
$agencyAddress = getSetting('agency_address', '');

$paidTotal    = array_sum(array_column(array_filter($payments, fn($p) => $p['status'] === 'paid'), 'amount'));
$pendingTotal = array_sum(array_column(array_filter($payments, fn($p) => in_array($p['status'], ['pending','late'])), 'amount'));

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
    'IMMOBILI IN GESTIONE',
];

$totalRent = 0.0;
foreach ($properties as $p) {
    $rent = ($p['price_type'] === 'affitto' && $p['price'] !== null) ? (float) $p['price'] : 0.0;
    $totalRent += $rent;
    $lines[] = '- ' . $p['address'] . ', ' . $p['city']
        . ' (' . $p['status'] . ')'
        . ($rent > 0 ? ' — Canone: EUR ' . number_format($rent, 2, ',', '.') : '');
}

if (!$properties) $lines[] = 'Nessun immobile attivo.';

$lines[] = '';
$lines[] = 'PAGAMENTI NEL PERIODO';
foreach ($payments as $pay) {
    $lines[] = '- ' . date('d/m/Y', strtotime($pay['due_date']))
        . ' | ' . $pay['address']
        . ' | EUR ' . number_format((float)$pay['amount'], 2, ',', '.')
        . ' [' . $pay['status'] . ']';
}
if (!$payments) $lines[] = 'Nessun pagamento nel periodo.';

$lines[] = '';
$lines[] = str_repeat('-', 60);
$lines[] = 'RIEPILOGO ECONOMICO';
$lines[] = 'Totale incassato: EUR '   . number_format($paidTotal,    2, ',', '.');
$lines[] = 'Totale da incassare: EUR ' . number_format($pendingTotal, 2, ',', '.');
$lines[] = str_repeat('-', 60);
$lines[] = 'Generato il ' . date('d/m/Y H:i');

$lines = array_values(array_filter($lines, fn($l) => trim($l) !== ''));

$title = 'Rendiconto_' . $client['surname'] . '_' . $periodLabel;
$pdf   = SimplePdf::fromText($title, $lines, $agencyName);
$bytes = $pdf->output();

$filename = 'rendiconto_' . preg_replace('/[^a-zA-Z0-9_\-]/', '_', $client['surname']) . '_' . $periodLabel . '.pdf';

header('Content-Type: application/pdf');
header('Content-Disposition: attachment; filename="' . rawurlencode($filename) . '"');
header('Content-Length: ' . strlen($bytes));
header('Cache-Control: no-cache');
echo $bytes;
exit;
