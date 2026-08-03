<?php
/**
 * Account dell'utente collegato — stato e 2FA.
 *
 * Perché non dentro api/settings.php: le Impostazioni sono riservate al
 * super_admin (config/roles.php, VIEW_MIN_ROLE), quindi finché la 2FA stava lì
 * un `admin`, un `agent` o un `readonly` non potevano attivarla su di sé — e il
 * blocco in sola lettura la negava comunque. Qui ogni ruolo agisce sul proprio
 * account e su nessun altro: l'id lo prende dalla sessione, non dalla richiesta.
 *
 *   GET  ?action=status     — 2FA attiva sì/no
 *   GET  ?action=2fa_setup  — nuovo segreto + QR (non salva nulla)
 *   POST ?action=2fa_enable — {secret, code}
 *   POST ?action=2fa_disable— {password}
 */

// Agisce solo sull'account di chi è collegato: vale anche per i ruoli in sola
// lettura (vedi config/api_bootstrap.php).
define('API_SELF_SERVICE', true);

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/settings.php';
require_once __DIR__ . '/../config/totp.php';

apiHandleOptions();

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $action = trim($_GET['action'] ?? 'status');

    if ($method === 'GET' && $action === 'status') {
        apiSuccess(accountStatus($db));
    } elseif ($method === 'GET' && $action === '2fa_setup') {
        twoFaSetup();
    } elseif ($method === 'POST' && $action === '2fa_enable') {
        twoFaEnable($db);
    } elseif ($method === 'POST' && $action === '2fa_disable') {
        twoFaDisable($db);
    } else {
        apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    error_log('[account] ' . $e->getMessage());
    apiError('Errore database.', 500);
}

function accountStatus(PDO $db): array
{
    $stmt = $db->prepare('SELECT username, email, role, totp_enabled FROM admin_users WHERE id = :id');
    $stmt->execute(['id' => getCurrentAdminId()]);
    $row = $stmt->fetch() ?: [];

    return [
        'username' => $row['username'] ?? getCurrentUsername(),
        'email'    => $row['email'] ?? null,
        'role'     => $row['role'] ?? getCurrentRole(),
        'twofa'    => ['enabled' => (bool) ($row['totp_enabled'] ?? false)],
    ];
}

function twoFaSetup(): void
{
    $secret = generateTotpSecret();
    $issuer = getSetting('agency_name', 'Gestionale Immobiliare');
    $uri    = generateQrCodeUrl($secret, getCurrentUsername(), $issuer);

    // Nessun QR generato da terzi: l'immagine veniva chiesta a api.qrserver.com
    // passando l'otpauth URI nella query string, cioe' spedendo il SEGRETO TOTP
    // dell'amministratore a un servizio esterno (e nei log di chiunque stia in
    // mezzo). Un secondo fattore che un terzo conosce non e' un secondo fattore.
    // L'inserimento manuale del segreto e' la strada standard "non riesco a
    // scansionare" ed e' supportata da Google Authenticator, Authy e 1Password.
    apiSuccess([
        'secret'  => $secret,
        'otpauth' => $uri,
    ]);
}

function twoFaEnable(PDO $db): void
{
    $data   = apiGetJsonBody();
    $secret = trim($data['secret'] ?? '');
    $code   = trim($data['code'] ?? '');

    if ($secret === '' || $code === '') {
        apiError('Segreto e codice obbligatori.');
    }
    if (!verifyTotpCode($secret, $code)) {
        apiError('Codice non valido. Riprova.');
    }

    $codes  = generateBackupCodes();
    $hashed = array_map('hashBackupCode', $codes);

    $stmt = $db->prepare(
        'UPDATE admin_users SET totp_secret = :secret, totp_enabled = 1, totp_backup_codes = :codes WHERE id = :id'
    );
    $stmt->execute([
        'secret' => $secret,
        'codes'  => json_encode($hashed),
        'id'     => getCurrentAdminId(),
    ]);

    // logActivity() accetta solo create/update/delete/login/logout: qualunque
    // altra etichetta verrebbe scartata senza dire niente.
    logActivity('update', 'admin_user', getCurrentAdminId(), '2FA attivata');
    apiSuccess(['enabled' => true, 'backup_codes' => $codes]);
}

function twoFaDisable(PDO $db): void
{
    $data     = apiGetJsonBody();
    $password = $data['password'] ?? '';

    $stmt = $db->prepare('SELECT password_hash FROM admin_users WHERE id = :id');
    $stmt->execute(['id' => getCurrentAdminId()]);
    $row = $stmt->fetch();

    if (!$row || !password_verify($password, $row['password_hash'])) {
        apiError('Password non corretta.');
    }

    $db->prepare(
        'UPDATE admin_users SET totp_secret = NULL, totp_enabled = 0, totp_backup_codes = NULL WHERE id = :id'
    )->execute(['id' => getCurrentAdminId()]);

    logActivity('update', 'admin_user', getCurrentAdminId(), '2FA disattivata');
    apiSuccess(['enabled' => false]);
}
