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

    apiSuccess([
        'total_clients'        => $totalClients,
        'total_properties'     => $totalProperties,
        'available_properties' => $availableProperties,
        'rented_properties'    => $rentedProperties,
        'active_tenants'       => $activeTenants,
        'expiring_reminders'   => $expiringReminders,
        'overdue_reminders'    => $overdueReminders,
        'upcoming_reminders'   => $upcomingReminders,
    ]);
} catch (PDOException $e) {
    apiError('Unable to fetch dashboard statistics.', 500);
}
