<?php
/**
 * Revenue & Occupancy Forecast API (read-only, derived data).
 *
 * GET /api/forecast.php?months=6  — revenue forecast, vacancy trend, top properties, overdue summary
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
apiHandleOptions();
apiRequireMethod('GET');

requireRole('admin', 'super_admin');

try {
    $db = getDB();

    $months = max(1, min(24, (int) ($_GET['months'] ?? 12)));

    $expectedRevenue = getExpectedRevenue($db, $months);
    $vacancyTrend    = getVacancyTrend($db, $months);
    $topProperties   = getTopProperties($db);
    $overdueSummary  = getOverdueSummary($db);

    apiSuccess([
        'months'           => $months,
        'expected_revenue' => $expectedRevenue,
        'vacancy_trend'    => $vacancyTrend,
        'top_properties'   => $topProperties,
        'overdue_summary'  => $overdueSummary,
    ]);
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------
// Sub-queries
// ---------------------------------------------------------------------------

function getExpectedRevenue(PDO $db, int $months): array
{
    $stmt = $db->prepare(
        "SELECT
            DATE_FORMAT(pay.due_date, '%Y-%m') AS month,
            SUM(pay.amount) AS expected,
            SUM(CASE WHEN pay.status = 'paid' THEN pay.amount ELSE 0 END) AS confirmed
         FROM payments pay
         WHERE pay.due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL :months MONTH)
           AND pay.status != 'cancelled'
         GROUP BY DATE_FORMAT(pay.due_date, '%Y-%m')
         ORDER BY month ASC"
    );
    $stmt->execute(['months' => $months]);
    $rows = $stmt->fetchAll();

    return array_map(function (array $r): array {
        return [
            'month'     => $r['month'],
            'expected'  => (float) $r['expected'],
            'confirmed' => (float) $r['confirmed'],
        ];
    }, $rows);
}

function getVacancyTrend(PDO $db, int $months): array
{
    // Total active (non-archived) properties count
    $totalStmt = $db->query("SELECT COUNT(*) FROM properties WHERE status != 'archived'");
    $total = (int) $totalStmt->fetchColumn();

    // Build month series and count occupied properties per month
    $result = [];
    for ($i = 0; $i < $months; $i++) {
        $monthStr = date('Y-m', strtotime("+{$i} months"));
        $firstDay = $monthStr . '-01';
        $lastDay  = date('Y-m-t', strtotime($firstDay));

        $stmt = $db->prepare(
            "SELECT COUNT(DISTINCT ct.property_id) AS occupied
             FROM contracts ct
             WHERE ct.status = 'signed'
               AND ct.start_date <= :last_day
               AND (ct.end_date IS NULL OR ct.end_date >= :first_day)"
        );
        $stmt->execute(['last_day' => $lastDay, 'first_day' => $firstDay]);
        $occupied = (int) $stmt->fetchColumn();

        $result[] = [
            'month'    => $monthStr,
            'occupied' => $occupied,
            'total'    => $total,
            'vacant'   => max(0, $total - $occupied),
        ];
    }

    return $result;
}

function getTopProperties(PDO $db): array
{
    $stmt = $db->query(
        "SELECT p.id, p.address, p.city,
                c.name AS client_name, c.surname AS client_surname,
                SUM(pay.amount) AS total_income
         FROM payments pay
         INNER JOIN properties p ON p.id = pay.property_id
         LEFT JOIN clients c ON c.id = p.client_id
         WHERE pay.status = 'paid'
           AND pay.paid_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
         GROUP BY p.id, p.address, p.city, c.name, c.surname
         ORDER BY total_income DESC
         LIMIT 5"
    );

    return array_map(function (array $r): array {
        return [
            'property_id'     => (int) $r['id'],
            'address'         => $r['address'],
            'city'            => $r['city'],
            'client_name'     => trim(($r['client_name'] ?? '') . ' ' . ($r['client_surname'] ?? '')),
            'total_income_12m' => (float) $r['total_income'],
        ];
    }, $stmt->fetchAll());
}

function getOverdueSummary(PDO $db): array
{
    $stmt = $db->query(
        "SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS total
         FROM payments
         WHERE status IN ('pending', 'late')
           AND due_date < CURDATE()"
    );
    $row = $stmt->fetch();

    return [
        'count' => (int) $row['cnt'],
        'total' => (float) $row['total'],
    ];
}
