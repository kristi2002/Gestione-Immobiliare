<?php
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/db.php';
require_once __DIR__ . '/config/totp.php';
require_once __DIR__ . '/config/login_throttle.php';

if (isLoggedIn()) {
    header('Location: /');
    exit;
}

$pendingId = (int) ($_SESSION['_2fa_pending'] ?? 0);
if ($pendingId <= 0) {
    header('Location: login.php');
    exit;
}

$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (isLoginLocked()) {
        $error = loginLockoutMessage();
    } else {
        $code = trim($_POST['code'] ?? '');

        $stmt = getDB()->prepare(
            'SELECT id, username, role, totp_secret, totp_backup_codes
             FROM admin_users WHERE id = :id AND is_active = 1 LIMIT 1'
        );
        $stmt->execute(['id' => $pendingId]);
        $user = $stmt->fetch();

        if (!$user) {
            unset($_SESSION['_2fa_pending']);
            header('Location: login.php');
            exit;
        }

        $verified = false;

        if ($code !== '' && verifyTotpCode($user['totp_secret'] ?? '', $code)) {
            $verified = true;
        } elseif ($code !== '') {
            $codes = json_decode($user['totp_backup_codes'] ?? '[]', true);
            if (is_array($codes)) {
                $hash = hashBackupCode($code);
                $idx  = array_search($hash, $codes, true);
                if ($idx !== false) {
                    unset($codes[$idx]);
                    getDB()->prepare('UPDATE admin_users SET totp_backup_codes = :codes WHERE id = :id')
                        ->execute(['codes' => json_encode(array_values($codes)), 'id' => $user['id']]);
                    $verified = true;
                }
            }
        }

        if ($verified) {
            recordLoginAttempt(true);
            completeAdminLogin((int) $user['id'], $user['username'], $user['role'] ?? 'admin');
            header('Location: /');
            exit;
        }

        recordLoginAttempt(false);
        $error = 'Codice non valido.';
    }
}
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verifica 2FA — Gestionale Immobiliare</title>
    <link rel="stylesheet" href="assets/css/style.css">
    <style>
        .login-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--color-bg); padding: 24px; }
        .login-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; padding: 32px; width: 100%; max-width: 400px; box-shadow: var(--shadow-md); }
        .login-card h1 { font-size: 22px; margin-bottom: 8px; }
        .login-card p { color: var(--color-text-muted); margin-bottom: 24px; font-size: 14px; }
        .login-error { background: #fef2f2; color: var(--color-danger); border: 1px solid #fecaca; padding: 12px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
    </style>
</head>
<body>
    <div class="login-page">
        <div class="login-card">
            <h1>🔐 Verifica in due passaggi</h1>
            <p>Inserisci il codice a 6 cifre dalla tua app di autenticazione, oppure un codice di backup.</p>

            <?php if ($error): ?>
                <div class="login-error"><?= htmlspecialchars($error) ?></div>
            <?php endif; ?>

            <form method="post" autocomplete="off">
                <div class="form-group">
                    <label for="code">Codice</label>
                    <input type="text" id="code" name="code" class="form-input" inputmode="numeric" autocomplete="one-time-code" required autofocus>
                </div>
                <button type="submit" class="btn btn--primary" style="width:100%">Verifica</button>
            </form>
            <p style="margin-top:16px;margin-bottom:0"><a href="login.php">← Torna al login</a></p>
        </div>
    </div>
</body>
</html>
