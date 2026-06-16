<?php
/**
 * Admin users API — super_admin only.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();
requireRole('super_admin');

const USER_ROLES = ['super_admin', 'admin', 'agent', 'readonly'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    if ($method === 'GET') {
        if ($id) {
            getUser($db, $id);
        } else {
            listUsers($db);
        }
    } elseif ($method === 'POST') {
        requireWriteAccess();
        createUser($db);
    } elseif ($method === 'PUT' && $id) {
        requireWriteAccess();
        updateUser($db, $id);
    } elseif ($method === 'DELETE' && $id) {
        requireWriteAccess();
        deleteUser($db, $id);
    } else {
        apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

function listUsers(PDO $db): void
{
    $pagination = apiGetPagination();
    $countSql = 'SELECT COUNT(*) FROM admin_users';
    $dataSql = 'SELECT id, username, email, role, is_active, created_at, updated_at FROM admin_users ORDER BY username';

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, [], $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getUser(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        'SELECT id, username, email, role, is_active, created_at, updated_at FROM admin_users WHERE id = :id'
    );
    $stmt->execute(['id' => $id]);
    $user = $stmt->fetch();
    if (!$user) {
        apiError('Utente non trovato.', 404);
    }
    apiSuccess($user);
}

function createUser(PDO $db): void
{
    $data     = apiGetJsonBody();
    $username = trim($data['username'] ?? '');
    $password = $data['password'] ?? '';
    $role     = trim($data['role'] ?? 'agent');
    $email    = trim($data['email'] ?? '') ?: null;

    if ($username === '' || strlen($password) < 8) {
        apiError('Username e password (min 8 caratteri) obbligatori.');
    }
    if (!in_array($role, USER_ROLES, true)) {
        apiError('Ruolo non valido.');
    }

    $stmt = $db->prepare(
        'INSERT INTO admin_users (username, password_hash, email, role) VALUES (:u, :p, :e, :r)'
    );
    $stmt->execute([
        'u' => $username,
        'p' => password_hash($password, PASSWORD_DEFAULT),
        'e' => $email,
        'r' => $role,
    ]);

    getUser($db, (int) $db->lastInsertId());
}

function updateUser(PDO $db, int $id): void
{
    $data = apiGetJsonBody();
    $user = $db->prepare('SELECT * FROM admin_users WHERE id = :id');
    $user->execute(['id' => $id]);
    $existing = $user->fetch();
    if (!$existing) {
        apiError('Utente non trovato.', 404);
    }

    if ($id === getCurrentAdminId()) {
        if (isset($data['is_active']) && !$data['is_active']) {
            apiError('Non puoi disattivare il tuo account.');
        }
        if (isset($data['role']) && $data['role'] !== getCurrentRole()) {
            apiError('Non puoi modificare il tuo ruolo.');
        }
    }

    $fields = [];
    $params = ['id' => $id];

    if (isset($data['email'])) {
        $fields[] = 'email = :email';
        $params['email'] = trim($data['email']) ?: null;
    }
    if (isset($data['role']) && in_array($data['role'], USER_ROLES, true)) {
        $fields[] = 'role = :role';
        $params['role'] = $data['role'];
    }
    if (isset($data['is_active'])) {
        $fields[] = 'is_active = :active';
        $params['active'] = $data['is_active'] ? 1 : 0;
    }
    if (!empty($data['password']) && strlen($data['password']) >= 8) {
        $fields[] = 'password_hash = :pass';
        $params['pass'] = password_hash($data['password'], PASSWORD_DEFAULT);
    }

    if (empty($fields)) {
        apiError('Nessun campo da aggiornare.');
    }

    $db->prepare('UPDATE admin_users SET ' . implode(', ', $fields) . ' WHERE id = :id')->execute($params);
    getUser($db, $id);
}

function deleteUser(PDO $db, int $id): void
{
    if ($id === getCurrentAdminId()) {
        apiError('Non puoi eliminare il tuo account.');
    }
    $count = (int) $db->query('SELECT COUNT(*) FROM admin_users')->fetchColumn();
    if ($count <= 1) {
        apiError('Deve restare almeno un amministratore.');
    }
    $stmt = $db->prepare('DELETE FROM admin_users WHERE id = :id');
    $stmt->execute(['id' => $id]);
    apiSuccess(['deleted' => true]);
}
