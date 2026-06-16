<?php
require_once __DIR__ . '/../config/bootstrap.php';
initTenantSession();

if (isTenantLoggedIn()) {
    header('Location: index.php');
    exit;
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $email = trim($_POST['email'] ?? '');
    $pass  = $_POST['password'] ?? '';
    if ($email && $pass && attemptTenantLogin($email, $pass)) {
        header('Location: index.php');
        exit;
    }
    $error = 'Credenziali non valide.';
}
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Portale Inquilino</title>
    <link rel="icon" type="image/png" href="../favicon.png">
    <link rel="apple-touch-icon" href="../favicon.png">
    <link rel="stylesheet" href="../assets/css/style.css">
    <style>
        .login-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--color-bg); padding: 24px; }
        .login-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; padding: 32px; width: 100%; max-width: 400px; }
    </style>
</head>
<body>
    <div class="login-page">
        <div class="login-card">
            <h1>Portale Inquilino</h1>
            <p class="text-muted">Accedi per vedere il tuo immobile e i documenti.</p>
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
