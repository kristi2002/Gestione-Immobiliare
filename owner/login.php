<?php
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/../config/settings.php';
require_once __DIR__ . '/../config/login_throttle.php';
initOwnerSession();

if (isOwnerLoggedIn()) {
    header('Location: index.php');
    exit;
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $email = trim($_POST['email'] ?? '');
    $pass  = $_POST['password'] ?? '';

    // Stesso motivo di tenant/login.php: senza identificativo il blocco per
    // account non scatta, e su questo portale si entra nei dati di un
    // proprietario. Ogni ingresso amministratore lo passa gia'.
    if (isLoginLocked(null, $email)) {
        $error = loginLockoutMessage();
    } else {
        if ($email && $pass && attemptOwnerLogin($email, $pass)) {
            recordLoginAttempt(true, null, $email);
            header('Location: index.php');
            exit;
        }
        recordLoginAttempt(false, null, $email);
        $error = 'Credenziali non valide.';
    }
}

$branding = getPublicBranding();
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Portale Proprietario — <?= htmlspecialchars($branding['agency_name']) ?></title>
    <link rel="icon" type="image/png" href="../favicon.png">
    <link rel="apple-touch-icon" href="../favicon.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Playfair+Display:wght@600;700;800&display=swap" rel="stylesheet">
    <?php $__distCss = __DIR__ . '/../assets/dist/app.min.css'; ?>
    <?php if (is_file($__distCss)): ?>
    <link rel="stylesheet" href="../assets/dist/app.min.css?v=<?= filemtime($__distCss) ?>">
    <?php else: ?>
    <link rel="stylesheet" href="../assets/css/style.css?v=<?= @filemtime(__DIR__ . '/../assets/css/style.css') ?: time() ?>">
    <?php endif; ?>
    <link rel="stylesheet" href="../branding.css.php">
    <link rel="stylesheet" href="../assets/css/theme-orlandi.css?v=<?= @filemtime(__DIR__ . '/../assets/css/theme-orlandi.css') ?: time() ?>">
    <style>
        .login-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--color-bg); padding: 24px; }
        .login-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; padding: 32px; width: 100%; max-width: 400px; }
    </style>
</head>
<body>
    <div class="login-page">
        <div class="login-card">
            <h1>Portale Proprietario</h1>
            <p class="text-muted">Accedi per consultare i tuoi immobili, contratti e documenti.</p>
            <?php if ($error): ?><div class="alert alert--error"><?= htmlspecialchars($error) ?></div><?php endif; ?>
            <form method="post">
                <div class="form-group">
                    <label>Email</label>
                    <input type="email" name="email" class="form-input" required>
                </div>
                <div class="form-group">
                    <label>Password</label>
                    <input type="password" name="password" class="form-input" required>
                </div>
                <button type="submit" class="btn btn--primary" style="width:100%">Accedi</button>
            </form>
        </div>
    </div>
</body>
</html>
