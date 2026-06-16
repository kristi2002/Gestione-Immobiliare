<?php
/**
 * Reports & statistics API.
 *
 * GET /api/reports.php?type=properties|payments|expenses&year=YYYY
 *     Returns JSON report data.
 * GET /api/reports.php?type=...&year=YYYY&format=csv
 *     Streams a CSV download.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();
apiRequireMethod('GET');
requireViewAccess('reports');

const REPORT_TYPES = ['properties', 'payments', 'expenses'];

try {
    $db   = getDB();
    $type = trim($_GET['type'] ?? '');
    $year = isset($_GET['year']) && $_GET['year'] !== '' ? (int) $_GET['year'] : (int) date('Y');
    $csv  = ($_GET['format'] ?? '') === 'csv';

    if (!in_array($type, REPORT_TYPES, true)) {
        apiError('Tipo report non valido.');
    }

    $report = match ($type) {
        'properties' => buildPropertiesReport($db),
        'payments'   => buildPaymentsReport($db, $year),
        'expenses'   => buildExpensesReport($db, $year),
    };

    if ($csv) {
        streamCsv($type, $year, $report);
    }

    apiSuccess($report);
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------
// Report builders
// ---------------------------------------------------------------------------

function buildPropertiesReport(PDO $db): array
{
    $byStatus = $db->query(
        "SELECT status, COUNT(*) AS total
         FROM properties WHERE status != 'archived'
         GROUP BY status ORDER BY total DESC"
    )->fetchAll();

    $byType = $db->query(
        "SELECT property_type, COUNT(*) AS total
         FROM properties WHERE status != 'archived'
         GROUP BY property_type ORDER BY total DESC"
    )->fetchAll();

    $avgPrice = $db->query(
        "SELECT price_type, AVG(price) AS avg_price, COUNT(*) AS total
         FROM properties WHERE status != 'archived' AND price IS NOT NULL
         GROUP BY price_type"
    )->fetchAll();

    return [
        'by_status' => $byStatus,
        'by_type'   => $byType,
        'avg_price' => $avgPrice,
    ];
}

function buildPaymentsReport(PDO $db, int $year): array
{
    $stmt = $db->prepare(
        "SELECT MONTH(due_date) AS month,
                SUM(amount) AS expected,
                SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) AS collected
         FROM payments
         WHERE YEAR(due_date) = :year AND status != 'cancelled'
         GROUP BY MONTH(due_date)
         ORDER BY MONTH(due_date)"
    );
    $stmt->execute(['year' => $year]);
    $rows = $stmt->fetchAll();

    // Normalize to all 12 months.
    $byMonth = [];
    foreach (range(1, 12) as $m) {
        $byMonth[$m] = ['month' => $m, 'expected' => 0.0, 'collected' => 0.0];
    }
    foreach ($rows as $r) {
        $m = (int) $r['month'];
        $byMonth[$m]['expected']  = (float) $r['expected'];
        $byMonth[$m]['collected'] = (float) $r['collected'];
    }

    return [
        'year'   => $year,
        'months' => array_values($byMonth),
    ];
}

function buildExpensesReport(PDO $db, int $year): array
{
    $stmt = $db->prepare(
        "SELECT category, SUM(amount) AS total, COUNT(*) AS count
         FROM expenses
         WHERE YEAR(expense_date) = :year
         GROUP BY category ORDER BY total DESC"
    );
    $stmt->execute(['year' => $year]);

    return [
        'year'          => $year,
        'by_category'   => $stmt->fetchAll(),
    ];
}

// ---------------------------------------------------------------------------
// CSV streaming
// ---------------------------------------------------------------------------

function streamCsv(string $type, int $year, array $report): void
{
    $filename = "report_{$type}_{$year}.csv";
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');

    $out = fopen('php://output', 'w');
    // BOM for Excel UTF-8 compatibility.
    fwrite($out, "\xEF\xBB\xBF");

    if ($type === 'properties') {
        fputcsv($out, ['Sezione', 'Voce', 'Valore']);
        foreach ($report['by_status'] as $r) {
            fputcsv($out, ['Stato', $r['status'], $r['total']]);
        }
        foreach ($report['by_type'] as $r) {
            fputcsv($out, ['Tipo', $r['property_type'], $r['total']]);
        }
        foreach ($report['avg_price'] as $r) {
            fputcsv($out, ['Prezzo medio', $r['price_type'], round((float) $r['avg_price'], 2)]);
        }
    } elseif ($type === 'payments') {
        fputcsv($out, ['Mese', 'Atteso', 'Incassato']);
        foreach ($report['months'] as $m) {
            fputcsv($out, [$m['month'], round($m['expected'], 2), round($m['collected'], 2)]);
        }
    } elseif ($type === 'expenses') {
        fputcsv($out, ['Categoria', 'Totale', 'Numero']);
        foreach ($report['by_category'] as $r) {
            fputcsv($out, [$r['category'], round((float) $r['total'], 2), $r['count']]);
        }
    }

    fclose($out);
    exit;
}
