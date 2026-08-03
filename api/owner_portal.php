<?php
/**
 * Owner portal administration API (admin side).
 *
 * POST /api/owner_portal.php  { action: 'set_password', client_id, email, password }
 *      Sets/resets a client's owner-portal password.
 *
 * Soglia: admin. Non e' un'operazione da agente.
 * -----------------------------------------------------------------------------
 * Questo endpoint riscrive `portal_email` E `portal_password_hash` di UN
 * PROPRIETARIO QUALSIASI, identificato dal solo `client_id` che arriva nel
 * corpo. Finche' bastava un permesso di scrittura, un account `agent` poteva:
 * spostare l'email del portale su una casella propria, scegliere la password,
 * entrare come quel proprietario e leggerne contratti, pagamenti e documenti —
 * mentre il proprietario vero restava fuori, senza che nulla glielo dicesse.
 * Provato il 03/08/2026: il titolare non entrava piu', l'altro si'.
 *
 * `agent` e' il ruolo del venditore: vede le sue trattative, non amministra le
 * credenziali di terzi. La soglia qui e' la stessa che i documenti dichiaravano
 * gia' da sempre (docs/guides/06-API-REFERENCE.md: "admin"): era
 * l'implementazione a non rispettarla, non la documentazione a essere ottimista.
 *
 * NB: la scheda del proprietario NON passa di qui. Per attivare il portale
 * manda un link a uso singolo (phase83, lib/password_reset.php) proprio per non
 * far conoscere all'agenzia la password con cui quella persona apre i propri
 * documenti. Questa resta la porta di servizio per un reset manuale.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();
apiRequireMethod('POST');
requireRole('admin', 'super_admin');

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

    $hash = appPasswordHash($password);
    $upd  = $db->prepare(
        "UPDATE clients SET portal_password_hash = :hash, portal_email = :email WHERE id = :id"
    );
    $upd->execute(['hash' => $hash, 'email' => $email, 'id' => $clientId]);

    logActivity('update', 'client', $clientId, 'Accesso portale proprietario impostato (' . $email . ')');
    apiSuccess(['client_id' => $clientId, 'message' => 'Accesso portale aggiornato.']);
}
