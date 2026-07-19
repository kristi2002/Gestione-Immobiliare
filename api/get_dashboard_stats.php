<?php
/**
 * Dashboard statistics API.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();
apiRequireMethod('GET');

try {
    $db = getDB();

    // ---- Revenue trend chart (period-aware + navigable) ----
    // Computed first so the navigator can refetch just the chart (?chart_only=1)
    // without re-running every dashboard query below.
    $period = $_GET['chart_period'] ?? 'annuale';
    if (!in_array($period, ['settimanale', 'mensile', 'annuale'], true)) {
        $period = 'annuale';
    }

    // Navigation bounds: prev/next arrows are gated to the range that actually has
    // data (earliest → latest payment), extended to today so the current period is
    // always reachable.
    $bounds  = $db->query("SELECT MIN(due_date) AS mn, MAX(due_date) AS mx FROM payments")
                  ->fetch(PDO::FETCH_ASSOC);
    $today   = date('Y-m-d');
    $minNav  = !empty($bounds['mn']) ? $bounds['mn'] : $today;
    $maxData = !empty($bounds['mx']) ? $bounds['mx'] : $today;
    $maxNav  = ($maxData > $today) ? $maxData : $today;

    // Explicit anchor from the navigator (YYYY-MM-DD); otherwise default to the most
    // recent activity so the chart always opens on a period that has data.
    $anchorParam = $_GET['chart_anchor'] ?? '';
    $anchorDate  = preg_match('/^\d{4}-\d{2}-\d{2}$/', $anchorParam) ? $anchorParam : $maxData;

    $revenueChart = buildRevenueChart($db, $period, $anchorDate, $minNav, $maxNav);

    if (isset($_GET['chart_only'])) {
        apiSuccess(['revenue_chart' => $revenueChart]);
    }

    $totalClients = (int) $db->query(
        "SELECT COUNT(*) FROM clients WHERE status != 'archived'"
    )->fetchColumn();

    $totalProperties = (int) $db->query(
        "SELECT COUNT(*) FROM properties WHERE status != 'archived'"
    )->fetchColumn();

    $availableProperties = (int) $db->query(
        "SELECT COUNT(*) FROM properties WHERE status = 'available'"
    )->fetchColumn();

    $rentedProperties = (int) $db->query(
        "SELECT COUNT(*) FROM properties WHERE status = 'rented'"
    )->fetchColumn();

    $activeTenants = (int) $db->query(
        "SELECT COUNT(*) FROM tenants WHERE status = 'active'"
    )->fetchColumn();

    $stmt = $db->prepare(
        "SELECT COUNT(*) FROM reminders
         WHERE status = 'pending'
           AND reminder_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 7 DAY)"
    );
    $stmt->execute();
    $expiringReminders = (int) $stmt->fetchColumn();

    $overdueReminders = (int) $db->query(
        "SELECT COUNT(*) FROM reminders WHERE status = 'pending' AND reminder_date < NOW()"
    )->fetchColumn();

    $upcomingStmt = $db->prepare(
        "SELECT r.id, r.title, r.reminder_date, r.frequency,
                c.name AS client_name, c.surname AS client_surname,
                p.address AS property_address
         FROM reminders r
         LEFT JOIN clients c ON r.client_id = c.id
         LEFT JOIN properties p ON r.property_id = p.id
         WHERE r.status = 'pending'
           AND r.reminder_date >= NOW()
         ORDER BY r.reminder_date ASC
         LIMIT 5"
    );
    $upcomingStmt->execute();
    $upcomingReminders = $upcomingStmt->fetchAll(PDO::FETCH_ASSOC);

    $soldProperties = (int) $db->query(
        "SELECT COUNT(*) FROM properties WHERE status = 'sold'"
    )->fetchColumn();

    $totalLeads = (int) $db->query(
        "SELECT COUNT(*) FROM leads WHERE status NOT IN ('lost','archived')"
    )->fetchColumn();

    // Listing breakdown by price type
    $propertiesForSale = (int) $db->query(
        "SELECT COUNT(*) FROM properties WHERE status != 'archived' AND price_type = 'vendita'"
    )->fetchColumn();
    $propertiesForRent = (int) $db->query(
        "SELECT COUNT(*) FROM properties WHERE status != 'archived' AND price_type = 'affitto'"
    )->fetchColumn();

    // "New this month" counters (real month-over-month deltas for the stat cards)
    $propertiesNewMonth = (int) $db->query(
        "SELECT COUNT(*) FROM properties
         WHERE status != 'archived'
           AND created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')"
    )->fetchColumn();
    $leadsNewMonth = (int) $db->query(
        "SELECT COUNT(*) FROM leads
         WHERE status NOT IN ('lost','archived')
           AND created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')"
    )->fetchColumn();

    // Recent transactions (payments) for the dashboard table
    $recentPaymentsStmt = $db->prepare(
        "SELECT pay.amount, pay.status, pay.due_date, pay.paid_date,
                t.name AS tenant_name, t.surname AS tenant_surname,
                p.address AS property_address, p.price_type
         FROM payments pay
         LEFT JOIN tenants t ON pay.tenant_id = t.id
         LEFT JOIN properties p ON pay.property_id = p.id
         WHERE pay.status != 'cancelled'
         ORDER BY COALESCE(pay.paid_date, pay.due_date) DESC, pay.id DESC
         LIMIT 6"
    );
    $recentPaymentsStmt->execute();
    $recentPayments = $recentPaymentsStmt->fetchAll(PDO::FETCH_ASSOC);

    // Recently added properties — "Immobili Recenti" table
    $recentPropertiesStmt = $db->prepare(
        "SELECT p.id, p.address, p.city, p.price, p.price_type, p.property_type, p.status,
                COALESCE(
                    (SELECT cm.file_path FROM property_media cm WHERE cm.id = p.cover_media_id LIMIT 1),
                    (SELECT fm.file_path FROM property_media fm
                     WHERE fm.property_id = p.id
                       AND fm.media_type IN ('photo', 'floor_plan', 'house_map')
                       AND fm.mime_type LIKE 'image/%'
                     ORDER BY fm.sort_order ASC, fm.created_at ASC LIMIT 1)
                ) AS cover_url
         FROM properties p
         WHERE p.status != 'archived'
         ORDER BY p.created_at DESC
         LIMIT 6"
    );
    $recentPropertiesStmt->execute();
    $recentProperties = $recentPropertiesStmt->fetchAll(PDO::FETCH_ASSOC);

    // Today's appointments — "Appuntamenti di Oggi" rail
    $apptStmt = $db->prepare(
        "SELECT a.id, a.appointment_date, a.duration_minutes, a.status, a.notes,
                p.address AS property_address, p.property_type,
                COALESCE(
                    NULLIF(TRIM(CONCAT(COALESCE(c.name,''),' ',COALESCE(c.surname,''))), ''),
                    NULLIF(TRIM(CONCAT(COALESCE(l.name,''),' ',COALESCE(l.surname,''))), '')
                ) AS person_name,
                au.username AS agent_name
         FROM appointments a
         LEFT JOIN properties p ON a.property_id = p.id
         LEFT JOIN clients c ON a.client_id = c.id
         LEFT JOIN leads l ON a.lead_id = l.id
         LEFT JOIN admin_users au ON a.agent_id = au.id
         WHERE DATE(a.appointment_date) = CURDATE()
           AND a.status != 'cancelled'
         ORDER BY a.appointment_date ASC
         LIMIT 6"
    );
    $apptStmt->execute();
    $appointmentsToday = $apptStmt->fetchAll(PDO::FETCH_ASSOC);

    // Monthly created-counts (last 8 months) — real series for the stat sparklines
    $propSparkStmt = $db->query(
        "SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym,
                COUNT(*) AS n,
                SUM(price_type = 'vendita') AS n_sale,
                SUM(price_type = 'affitto') AS n_rent
         FROM properties
         WHERE status != 'archived'
           AND created_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 7 MONTH)
         GROUP BY ym ORDER BY ym ASC"
    );
    $propertySpark = $propSparkStmt->fetchAll(PDO::FETCH_ASSOC);
    $leadSparkStmt = $db->query(
        "SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym, COUNT(*) AS n
         FROM leads
         WHERE status NOT IN ('lost','archived')
           AND created_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 7 MONTH)
         GROUP BY ym ORDER BY ym ASC"
    );
    $leadSpark = $leadSparkStmt->fetchAll(PDO::FETCH_ASSOC);

    // Recent communications for the right rail feed
    $recentCommsStmt = $db->prepare(
        "SELECT c.subject, c.body, c.direction, c.channel, c.created_at,
                cl.name AS client_name, cl.surname AS client_surname
         FROM communications c
         LEFT JOIN clients cl ON c.client_id = cl.id
         ORDER BY c.created_at DESC
         LIMIT 5"
    );
    $recentCommsStmt->execute();
    $recentCommunications = $recentCommsStmt->fetchAll(PDO::FETCH_ASSOC);

    // Monthly revenue for a full calendar year (Jan–Dec). Anchor on the year of
    // the most recent payment so the chart always has data (in production this is
    // the current year; with older seed data it follows the data). The front-end
    // pads the series to all 12 months for a complete axis.
    $chartYear = (int) $db->query(
        "SELECT COALESCE(YEAR(MAX(due_date)), YEAR(CURDATE())) FROM payments"
    )->fetchColumn();

    $monthlyStmt = $db->prepare(
        "SELECT DATE_FORMAT(due_date, '%Y-%m') AS ym,
                COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END), 0) AS revenue,
                COALESCE(SUM(amount), 0) AS expected
         FROM payments
         WHERE YEAR(due_date) = :year
         GROUP BY ym
         ORDER BY ym ASC"
    );
    $monthlyStmt->execute(['year' => $chartYear]);
    $monthlyRevenue = $monthlyStmt->fetchAll(PDO::FETCH_ASSOC);

    // Pending payments due this month
    $pendingThisMonth = (float) $db->query(
        "SELECT COALESCE(SUM(amount),0) FROM payments
         WHERE status IN('pending','late')
           AND due_date BETWEEN DATE_FORMAT(CURDATE(),'%Y-%m-01') AND LAST_DAY(CURDATE())"
    )->fetchColumn();

    apiSuccess([
        'total_clients'        => $totalClients,
        'total_properties'     => $totalProperties,
        'available_properties' => $availableProperties,
        'rented_properties'    => $rentedProperties,
        'sold_properties'      => $soldProperties,
        'active_tenants'       => $activeTenants,
        'total_leads'          => $totalLeads,
        'properties_for_sale'  => $propertiesForSale,
        'properties_for_rent'  => $propertiesForRent,
        'properties_new_month' => $propertiesNewMonth,
        'leads_new_month'      => $leadsNewMonth,
        'expiring_reminders'   => $expiringReminders,
        'overdue_reminders'    => $overdueReminders,
        'upcoming_reminders'   => $upcomingReminders,
        'monthly_revenue'      => $monthlyRevenue,
        'chart_year'           => $chartYear,
        'revenue_chart'        => $revenueChart,
        'pending_this_month'   => $pendingThisMonth,
        'recent_payments'      => $recentPayments,
        'recent_properties'    => $recentProperties,
        'recent_communications'=> $recentCommunications,
        'appointments_today'   => $appointmentsToday,
        'property_spark'       => $propertySpark,
        'lead_spark'           => $leadSpark,
    ]);
} catch (PDOException $e) {
    apiError('Unable to fetch dashboard statistics.', 500);
}

/**
 * Build the "Andamento Entrate" revenue series for the requested period, anchored
 * on a specific week/month/year so the chart is navigable.
 *
 * Returns short x-axis labels, full point labels (tooltip + peak bubble), the
 * paid-revenue data, a header subtitle, plus navigation: the normalised `anchor`
 * and the `prev`/`next` anchor dates (null when there is no data past that edge).
 * Everything is localised in Italian.
 *
 *   settimanale → 7 days (Mon–Sun) of the anchor's week
 *   mensile     → each day of the anchor's month
 *   annuale     → 12 months (Gen–Dic) of the anchor's year
 *
 * @param string $minNav earliest navigable date (first payment)
 * @param string $maxNav latest navigable date (last payment or today)
 */
function buildRevenueChart(PDO $db, string $period, string $anchorDate, string $minNav, string $maxNav): array
{
    static $MC  = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
    static $MF  = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
    static $DOW = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'];

    $ts = strtotime($anchorDate) ?: time();

    // Paid revenue grouped by day within an inclusive [start, end] date range.
    $dailySums = function (string $start, string $end) use ($db): array {
        $stmt = $db->prepare(
            "SELECT DATE_FORMAT(due_date, '%Y-%m-%d') AS d,
                    COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END), 0) AS revenue
             FROM payments
             WHERE due_date BETWEEN :start AND :end
             GROUP BY d"
        );
        $stmt->execute(['start' => $start, 'end' => $end]);
        $out = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $out[$r['d']] = (float) $r['revenue'];
        }
        return $out;
    };

    if ($period === 'settimanale') {
        $dow    = (int) date('N', $ts);                       // 1=Mon .. 7=Sun
        $monday = strtotime('-' . ($dow - 1) . ' days', $ts);
        $sunday = strtotime('+6 days', $monday);
        $sums   = $dailySums(date('Y-m-d', $monday), date('Y-m-d', $sunday));

        $labels = $points = $data = [];
        for ($i = 0; $i < 7; $i++) {
            $d = strtotime("+$i days", $monday);
            $labels[] = $DOW[$i];
            $points[] = $DOW[$i] . ' ' . (int) date('j', $d) . ' ' . $MC[(int) date('n', $d) - 1];
            $data[]   = $sums[date('Y-m-d', $d)] ?? 0;
        }
        $subtitle = 'Settimana ' . (int) date('j', $monday) . '–' . (int) date('j', $sunday)
            . ' ' . $MC[(int) date('n', $sunday) - 1] . ' ' . date('Y', $sunday);

        $prevMon = strtotime('-7 days', $monday);
        $nextMon = strtotime('+7 days', $monday);
        $prev = (date('Y-m-d', strtotime('+6 days', $prevMon)) >= $minNav) ? date('Y-m-d', $prevMon) : null;
        $next = (date('Y-m-d', $nextMon) <= $maxNav) ? date('Y-m-d', $nextMon) : null;
        $anchor = date('Y-m-d', $monday);
    } elseif ($period === 'mensile') {
        $days = (int) date('t', $ts);
        $sums = $dailySums(date('Y-m-01', $ts), date('Y-m-' . $days, $ts));
        $mon  = (int) date('n', $ts);
        $year = date('Y', $ts);
        $ymPrefix = date('Y-m-', $ts);

        $labels = $points = $data = [];
        for ($i = 1; $i <= $days; $i++) {
            $key = $ymPrefix . str_pad((string) $i, 2, '0', STR_PAD_LEFT);
            $labels[] = (string) $i;
            $points[] = $i . ' ' . $MF[$mon - 1] . ' ' . $year;
            $data[]   = $sums[$key] ?? 0;
        }
        $subtitle = $MF[$mon - 1] . ' ' . $year;

        $prevFirst = strtotime('first day of -1 month', $ts);
        $nextFirst = strtotime('first day of +1 month', $ts);
        $prev = (date('Y-m-t', $prevFirst) >= $minNav) ? date('Y-m-d', $prevFirst) : null;
        $next = (date('Y-m-d', $nextFirst) <= $maxNav) ? date('Y-m-d', $nextFirst) : null;
        $anchor = date('Y-m-01', $ts);
    } else {
        // annuale (default): 12 months of the anchor year.
        $year = (int) date('Y', $ts);
        $stmt = $db->prepare(
            "SELECT DATE_FORMAT(due_date, '%Y-%m') AS ym,
                    COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END), 0) AS revenue
             FROM payments
             WHERE YEAR(due_date) = :year
             GROUP BY ym"
        );
        $stmt->execute(['year' => $year]);
        $byMonth = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $byMonth[(int) substr($r['ym'], 5, 2)] = (float) $r['revenue'];
        }
        $labels = $points = $data = [];
        for ($m = 1; $m <= 12; $m++) {
            $labels[] = $MC[$m - 1];
            $points[] = $MF[$m - 1] . ' ' . $year;
            $data[]   = $byMonth[$m] ?? 0;
        }
        $subtitle = (string) $year;

        $prev = (($year - 1) . '-12-31' >= $minNav) ? ($year - 1) . '-01-01' : null;
        $next = (($year + 1) . '-01-01' <= $maxNav) ? ($year + 1) . '-01-01' : null;
        $anchor = $year . '-01-01';
    }

    return [
        'period'       => $period,
        'labels'       => $labels,
        'point_labels' => $points,
        'data'         => $data,
        'subtitle'     => $subtitle,
        'anchor'       => $anchor,
        'prev'         => $prev,
        'next'         => $next,
    ];
}
