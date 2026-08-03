<?php
/**
 * Activity log helper — records admin write/auth actions.
 */

/**
 * Insert an activity log row. Pulls the current admin user from the session.
 *
 * Dichiarazione condizionata: tests/bootstrap.php installa una versione a vuoto
 * di logActivity() per non trascinare il database dentro i test di unita', e
 * senza questa guardia il primo file di test che carica lib/contract_lifecycle.php
 * moriva con «Cannot redeclare logActivity()» — non un test rosso, un errore
 * fatale del loader, che portava con se' l'INTERA suite. In esercizio nessun
 * altro dichiara questo nome, quindi qui non cambia nulla.
 *
 * @param string   $action      One of: create, update, delete, login, logout.
 * @param string|null $entityType e.g. 'client', 'property', 'tenant', 'payment'.
 * @param int|null   $entityId   Affected entity id.
 * @param string|null $description Free-text description.
 */
if (!function_exists('logActivity')) {
function logActivity(string $action, ?string $entityType = null, ?int $entityId = null, ?string $description = null): void
{
    // 'login_failed' (phase97): senza di lui i tentativi a vuoto non lasciavano
    // traccia, cioe' proprio la meta' che serve per accorgersi di qualcuno che
    // sta provando password. Un'azione fuori da questo elenco viene scartata in
    // SILENZIO, quindi la lista va tenuta allineata all'enum della colonna.
    static $allowed = ['create', 'update', 'delete', 'login', 'logout', 'login_failed'];
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
}
