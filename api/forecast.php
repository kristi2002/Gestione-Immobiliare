<?php
/**
 * Revenue & Occupancy Forecast API (read-only, derived data).
 *
 * GET /api/forecast.php?months=6
 *
 * Response shape (consumed by assets/js/forecast.js):
 *   data.stats          { expected_next_6m, avg_occupancy_rate, overdue_total, top_property_address }
 *   data.monthly        [{ month, label, expected, confirmed, occupancy_rate }]
 *   data.top_properties [{ property_id, address, income_12m }]
 *   data.overdue        [{ tenant_id, tenant_name, property_id, property_address, amount, days_overdue }]
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
apiHandleOptions();
apiRequireMethod('GET');

requireRole('admin', 'super_admin');

const FORECAST_MONTH_LABELS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

try {
    $db = getDB();

    $months = max(1, min(24, (int) ($_GET['months'] ?? 6)));

    $monthly       = getMonthlySeries($db, $months);
    $topProperties = getTopProperties($db);
    $overdue       = getOverdueList($db);

    $expectedTotal = array_sum(array_column($monthly, 'expected'));
    $occupancyVals = array_column($monthly, 'occupancy_rate');
    $avgOccupancy  = $occupancyVals ? array_sum($occupancyVals) / count($occupancyVals) : 0.0;
    $overdueTotal  = (float) $db->query(
        "SELECT COALESCE(SUM(amount), 0) FROM payments
         WHERE status IN ('pending', 'late') AND due_date < CURDATE()"
    )->fetchColumn();

    apiSuccess([
        'months' => $months,
        'stats'  => [
            'expected_next_6m'      => round($expectedTotal, 2),
            'avg_occupancy_rate'    => round($avgOccupancy, 1),
            'overdue_total'         => $overdueTotal,
            'top_property_address'  => $topProperties[0]['address'] ?? null,
        ],
        'monthly'        => $monthly,
        'top_properties' => $topProperties,
        'overdue'        => $overdue,
    ]);
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------
// Sub-queries
// ---------------------------------------------------------------------------

function getMonthlySeries(PDO $db, int $months): array
{
    $start = (new DateTimeImmutable('first day of this month'))->format('Y-m-d');
    $end   = (new DateTimeImmutable('first day of this month'))
        ->modify('+' . ($months - 1) . ' months')
        ->modify('last day of this month')
        ->format('Y-m-d');

    // Expected vs confirmed revenue grouped by month.
    $revStmt = $db->prepare(
        "SELECT DATE_FORMAT(due_date, '%Y-%m') AS ym,
                SUM(amount) AS expected,
                SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) AS confirmed
         FROM payments
         WHERE status != 'cancelled'
           AND due_date BETWEEN :start AND :end
         GROUP BY DATE_FORMAT(due_date, '%Y-%m')"
    );
    $revStmt->execute(['start' => $start, 'end' => $end]);
    $revMap = [];
    foreach ($revStmt->fetchAll() as $r) {
        $revMap[$r['ym']] = $r;
    }

    $totalProps = (int) $db->query("SELECT COUNT(*) FROM properties WHERE status != 'archived'")->fetchColumn();

    $occStmt = $db->prepare(
        "SELECT COUNT(DISTINCT property_id)
         FROM contracts
         WHERE status = 'signed'
           AND start_date <= :last_day
           AND (end_date IS NULL OR end_date >= :first_day)"
    );

    $series = [];
    for ($i = 0; $i < $months; $i++) {
        $monthDate = (new DateTimeImmutable('first day of this month'))->modify("+{$i} months");
        $ym        = $monthDate->format('Y-m');
        $firstDay  = $monthDate->format('Y-m-d');
        $lastDay   = $monthDate->modify('last day of this month')->format('Y-m-d');

        $occStmt->execute(['last_day' => $lastDay, 'first_day' => $firstDay]);
        $occupied = (int) $occStmt->fetchColumn();

        $monthNum = (int) $monthDate->format('n');
        $series[] = [
            'month'          => $ym,
            'label'          => FORECAST_MONTH_LABELS[$monthNum - 1] . ' ' . $monthDate->format('y'),
            'expected'       => isset($revMap[$ym]) ? (float) $revMap[$ym]['expected'] : 0.0,
            'confirmed'      => isset($revMap[$ym]) ? (float) $revMap[$ym]['confirmed'] : 0.0,
            'occupancy_rate' => $totalProps > 0 ? round($occupied / $totalProps * 100, 1) : 0.0,
        ];
    }

    return $series;
}

function getTopProperties(PDO $db): array
{
    $stmt = $db->query(
        "SELECT p.id, p.address, p.city,
                SUM(pay.amount) AS income_12m
         FROM payments pay
         INNER JOIN properties p ON p.id = pay.property_id
         WHERE pay.status = 'paid'
           AND pay.paid_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
         GROUP BY p.id, p.address, p.city
         ORDER BY income_12m DESC
         LIMIT 5"
    );

    return array_map(fn(array $r): array => [
        'property_id' => (int) $r['id'],
        'address'     => $r['address'] . ($r['city'] ? ', ' . $r['city'] : ''),
        'income_12m'  => (float) $r['income_12m'],
    ], $stmt->fetchAll());
}

function getOverdueList(PDO $db): array
{
    $stmt = $db->query(
        "SELECT pay.id, pay.amount, pay.due_date,
                DATEDIFF(CURDATE(), pay.due_date) AS days_overdue,
                pay.property_id, pay.tenant_id,
                p.address AS property_address,
                TRIM(CONCAT(COALESCE(t.name, ''), ' ', COALESCE(t.surname, ''))) AS tenant_name
         FROM payments pay
         LEFT JOIN properties p ON p.id = pay.property_id
         LEFT JOIN tenants t ON t.id = pay.tenant_id
         WHERE pay.status IN ('pending', 'late')
           AND pay.due_date < CURDATE()
         ORDER BY pay.due_date ASC
         LIMIT 50"
    );

    return array_map(fn(array $r): array => [
        'tenant_id'        => (int) $r['tenant_id'],
        'tenant_name'      => $r['tenant_name'] ?: ('#' . $r['tenant_id']),
        'property_id'      => (int) $r['property_id'],
        'property_address' => $r['property_address'] ?? ('#' . $r['property_id']),
        'amount'           => (float) $r['amount'],
        'days_overdue'     => (int) $r['days_overdue'],
    ], $stmt->fetchAll());
}
