<?php
/**
 * Owner portal administration API (admin side).
 *
 * POST /api/owner_portal.php  { action: 'set_password', client_id, email, password }
 *      Sets/resets a client's owner-portal password.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();
apiRequireMethod('POST');

try {
    $db   = getDB();
    $data = apiGetJsonBody();

    $action = trim($data['action'] ?? '');

    if ($action === 'set_password') {
        setOwnerPassword($db, $data);
    } else {
        apiError('Azione non valida.');
    }
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

function setOwnerPassword(PDO $db, array $data): void
{
    $clientId = (int) ($data['client_id'] ?? 0);
    $email    = trim($data['email'] ?? '');
    $password = (string) ($data['password'] ?? '');

    if ($clientId <= 0) {
        apiError('Proprietario non valido.');
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        apiError('Email portale non valida.');
    }
    if (strlen($password) < 8) {
        apiError('La password deve contenere almeno 8 caratteri.');
    }

    $stmt = $db->prepare("SELECT id FROM clients WHERE id = :id");
    $stmt->execute(['id' => $clientId]);
    if (!$stmt->fetch()) {
        apiError('Proprietario non trovato.', 404);
    }

    $hash = password_hash($password, PASSWORD_DEFAULT);
    $upd  = $db->prepare(
        "UPDATE clients SET portal_password_hash = :hash, portal_email = :email WHERE id = :id"
    );
    $upd->execute(['hash' => $hash, 'email' => $email, 'id' => $clientId]);

    logActivity('update', 'client', $clientId, 'Accesso portale proprietario impostato (' . $email . ')');
    apiSuccess(['client_id' => $clientId, 'message' => 'Accesso portale aggiornato.']);
}
