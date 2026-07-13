<?php
/**
 * Dashboard statistics API.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();
apiRequireMethod('GET');

try {
    $db = getDB();

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

    // Recently added properties for the right rail
    $recentPropertiesStmt = $db->prepare(
        "SELECT p.id, p.address, p.city, p.price, p.price_type, p.property_type,
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
         LIMIT 4"
    );
    $recentPropertiesStmt->execute();
    $recentProperties = $recentPropertiesStmt->fetchAll(PDO::FETCH_ASSOC);

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
        'pending_this_month'   => $pendingThisMonth,
        'recent_payments'      => $recentPayments,
        'recent_properties'    => $recentProperties,
        'recent_communications'=> $recentCommunications,
    ]);
} catch (PDOException $e) {
    apiError('Unable to fetch dashboard statistics.', 500);
}
