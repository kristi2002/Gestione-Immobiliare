<?php
require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../config/login_throttle.php';
require_once __DIR__ . '/../config/settings.php';
initTenantSession();

if (isTenantLoggedIn()) {
    header('Location: index.php');
    exit;
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $email = trim($_POST['email'] ?? '');
    $pass  = $_POST['password'] ?? '';

    // L'identificativo va passato al blocco tentativi, come fa ogni ingresso
    // amministratore (login.php, api/login.php, login_2fa.php). Senza, di
    // config/login_throttle.php restava attivo il solo asse per IP: l'asse per
    // account — quello che ferma chi ruota indirizzi contro una sola casella —
    // non e' mai entrato in funzione su questo portale.
    if (isLoginLocked(null, $email)) {
        $error = loginLockoutMessage();
    } else {
        if ($email && $pass && attemptTenantLogin($email, $pass)) {
            recordLoginAttempt(true, null, $email);
            header('Location: index.php');
            exit;
        }
        recordLoginAttempt(false, null, $email);
        $error = 'Credenziali non valide.';
    }
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
</head>
<body>
    <?php $branding = getPublicBranding(); ?>
    <div class="tp-auth">
        <div class="tp-auth__card">
            <div class="tp-auth__brand">
                <?php if (!empty($branding['logo_path'])): ?>
                    <img src="../<?= htmlspecialchars($branding['logo_path'], ENT_QUOTES, 'UTF-8') ?>"
                         alt="" class="tp-auth__logo">
                <?php else: ?>
                    <span class="tp-auth__mark"><i data-lucide="home"></i></span>
                <?php endif; ?>
                <span class="tp-auth__agency"><?= htmlspecialchars($branding['agency_name'], ENT_QUOTES, 'UTF-8') ?></span>
            </div>

            <!-- ── Accesso ────────────────────────────────────────────── -->
            <div id="tp-auth-login">
                <h1 class="tp-auth__title">Portale Inquilino</h1>
                <p class="tp-auth__sub">Accedi per vedere il tuo immobile, i pagamenti e i documenti.</p>

                <?php if ($error): ?>
                    <div class="alert alert--error"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></div>
                <?php endif; ?>

                <form method="post">
                    <div class="form-group">
                        <label for="tp-login-email">Email</label>
                        <input type="email" id="tp-login-email" name="email" class="form-input"
                               autocomplete="username" required autofocus>
                    </div>
                    <div class="form-group">
                        <label for="tp-login-pwd">Password</label>
                        <input type="password" id="tp-login-pwd" name="password" class="form-input"
                               autocomplete="current-password" required>
                    </div>
                    <button type="submit" class="btn btn--primary tp-btn-block">Accedi</button>
                </form>

                <button type="button" class="tp-auth__link" id="tp-show-forgot">Password dimenticata?</button>
            </div>

            <!-- ── Recupero password ──────────────────────────────────── -->
            <div id="tp-auth-forgot" hidden>
                <h1 class="tp-auth__title">Reimposta la password</h1>
                <p class="tp-auth__sub">
                    Inserisci l'email con cui accedi: ti mandiamo un link per sceglierne una nuova.
                </p>

                <div id="tp-forgot-alert" class="alert" hidden></div>

                <form id="tp-forgot-form" novalidate>
                    <div class="form-group">
                        <label for="tp-forgot-email">Email</label>
                        <input type="email" id="tp-forgot-email" class="form-input"
                               autocomplete="username" required>
                    </div>
                    <button type="submit" class="btn btn--primary tp-btn-block" id="tp-forgot-send">
                        Invia il link
                    </button>
                </form>

                <button type="button" class="tp-auth__link" id="tp-show-login">← Torna all'accesso</button>
            </div>
        </div>
    </div>

    <script src="../assets/vendor/lucide-1.27.0.min.js?v=<?= @filemtime(__DIR__ . '/../assets/vendor/lucide-1.27.0.min.js') ?: time() ?>"></script>
    <script type="module" src="../assets/js/tenant_portal/login.js?v=<?= @filemtime(__DIR__ . '/../assets/js/tenant_portal/login.js') ?: time() ?>"></script>
</body>
</html>
