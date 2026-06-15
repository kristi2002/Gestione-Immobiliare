<?php
/**
 * One-time setup — creates admin user from .env credentials.
 * Disable by setting SETUP_ENABLED=false after first run.
 */
require_once __DIR__ . '/config/bootstrap.php';

$lockFile = __DIR__ . '/.setup_complete';

if (file_exists($lockFile) || !SETUP_ENABLED) {
    http_response_code(403);
    exit('Setup disabilitato.');
}

if (adminUserExists()) {
    file_put_contents($lockFile, date('c'));
    header('Location: login.php');
    exit;
}

$error   = '';
$success = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim($_POST['username'] ?? env('ADMIN_USERNAME', 'admin'));
    $password = $_POST['password'] ?? env('ADMIN_PASSWORD', '');

    if (strlen($password) < 8) {
        $error = 'La password deve avere almeno 8 caratteri.';
    } else {
        createAdminUser($username, $password);
        file_put_contents($lockFile, date('c'));
        $success = true;
    }
}
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Setup — Gestionale Immobiliare</title>
    <link rel="stylesheet" href="assets/css/style.css">
    <style>
        .login-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--color-bg); padding: 24px; }
        .login-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; padding: 32px; width: 100%; max-width: 440px; box-shadow: var(--shadow-md); }
    </style>
</head>
<body>
    <div class="login-page">
        <div class="login-card">
            <?php if ($success): ?>
                <h1>Setup completato</h1>
                <p>Account amministratore creato. <a href="login.php">Vai al login</a>.</p>
                <p class="text-muted" style="margin-top:16px;font-size:13px">Imposta <code>SETUP_ENABLED=false</code> nel file .env.</p>
            <?php else: ?>
                <h1>Setup iniziale</h1>
                <p>Crea l'account amministratore per il gestionale.</p>
                <?php if ($error): ?><div class="alert alert--error"><?= htmlspecialchars($error) ?></div><?php endif; ?>
                <form method="post">
                    <div class="form-group">
                        <label for="username">Username</label>
                        <input type="text" id="username" name="username" class="form-input" value="<?= htmlspecialchars(env('ADMIN_USERNAME', 'admin')) ?>" required>
                    </div>
                    <div class="form-group">
                        <label for="password">Password (min. 8 caratteri)</label>
                        <input type="password" id="password" name="password" class="form-input" required minlength="8">
                    </div>
                    <button type="submit" class="btn btn--primary" style="width:100%">Crea amministratore</button>
                </form>
            <?php endif; ?>
        </div>
    </div>
</body>
</html>
