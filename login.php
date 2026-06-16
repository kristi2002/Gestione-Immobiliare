<?php
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/login_throttle.php';

if (isLoggedIn()) {
    header('Location: index.php');
    exit;
}

$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (isLoginLocked()) {
        $error = loginLockoutMessage();
    } else {
        $username = trim($_POST['username'] ?? '');
        $password = $_POST['password'] ?? '';

        if ($username === '' || $password === '') {
            $error = 'Inserisci username e password.';
            recordLoginAttempt(false);
        } else {
            $step = attemptLoginStep($username, $password);
            if ($step === 'ok') {
                recordLoginAttempt(true);
                header('Location: index.php');
                exit;
            } elseif ($step === '2fa') {
                recordLoginAttempt(true);
                header('Location: login_2fa.php');
                exit;
            } else {
                recordLoginAttempt(false);
                $error = 'Credenziali non valide.';
            }
        }
    }
}

if (!adminUserExists() && SETUP_ENABLED) {
    header('Location: setup.php');
    exit;
}
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login — Gestionale Immobiliare</title>
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
            <h1>🏠 Gestionale Immobiliare</h1>
            <p>Accedi con le credenziali amministratore.</p>

            <?php if ($error): ?>
                <div class="login-error"><?= htmlspecialchars($error) ?></div>
            <?php endif; ?>

            <form method="post" autocomplete="off">
                <div class="form-group">
                    <label for="username">Username</label>
                    <input type="text" id="username" name="username" class="form-input" required autofocus>
                </div>
                <div class="form-group">
                    <label for="password">Password</label>
                    <input type="password" id="password" name="password" class="form-input" required>
                </div>
                <button type="submit" class="btn btn--primary" style="width:100%">Accedi</button>
            </form>
        </div>
    </div>
</body>
</html>
