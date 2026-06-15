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

    $stmt = $db->prepare(
        "SELECT COUNT(*) FROM reminders
         WHERE status = 'pending'
           AND reminder_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 7 DAY)"
    );
    $stmt->execute();
    $expiringReminders = (int) $stmt->fetchColumn();

    apiSuccess([
        'total_clients'      => $totalClients,
        'total_properties'   => $totalProperties,
        'expiring_reminders' => $expiringReminders,
    ]);
} catch (PDOException $e) {
    apiError('Unable to fetch dashboard statistics.', 500);
}
