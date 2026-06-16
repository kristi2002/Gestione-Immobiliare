<?php
/**
 * Activity log helper — records admin write/auth actions.
 */

/**
 * Insert an activity log row. Pulls the current admin user from the session.
 *
 * @param string   $action      One of: create, update, delete, login, logout.
 * @param string|null $entityType e.g. 'client', 'property', 'tenant', 'payment'.
 * @param int|null   $entityId   Affected entity id.
 * @param string|null $description Free-text description.
 */
function logActivity(string $action, ?string $entityType = null, ?int $entityId = null, ?string $description = null): void
{
    static $allowed = ['create', 'update', 'delete', 'login', 'logout'];
    if (!in_array($action, $allowed, true)) {
        return;
    }

    try {
        require_once __DIR__ . '/db.php';
        $db = getDB();

        $adminId  = isset($_SESSION['admin_id']) ? (int) $_SESSION['admin_id'] : null;
        $username = $_SESSION['admin_username'] ?? null;
        $ip       = $_SERVER['REMOTE_ADDR'] ?? null;

        $stmt = $db->prepare(
            "INSERT INTO activity_log
                (admin_user_id, username, action, entity_type, entity_id, description, ip_address)
             VALUES
                (:admin_user_id, :username, :action, :entity_type, :entity_id, :description, :ip_address)"
        );
        $stmt->execute([
            'admin_user_id' => $adminId ?: null,
            'username'      => $username,
            'action'        => $action,
            'entity_type'   => $entityType,
            'entity_id'     => $entityId,
            'description'   => $description !== null ? mb_substr($description, 0, 500) : null,
            'ip_address'    => $ip,
        ]);
    } catch (Throwable $e) {
        // Logging must never break the main request.
    }
}
