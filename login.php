<?php
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/login_throttle.php';

if (isLoggedIn()) {
    header('Location: index.php');
    exit;
}

$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim($_POST['username'] ?? '');
    $password = $_POST['password'] ?? '';

    if (isLoginLocked(null, $username)) {
        $error = loginLockoutMessage();
    } elseif ($username === '' || $password === '') {
        $error = 'Inserisci username e password.';
        recordLoginAttempt(false, null, $username);
    } else {
        $step = attemptLoginStep($username, $password);
        if ($step === 'ok') {
            recordLoginAttempt(true, null, $username);
            header('Location: index.php');
            exit;
        } elseif ($step === '2fa') {
            // Password correct but 2FA still required — do NOT record success (that
            // would reset the throttle before the second factor is verified). The
            // counter persists; login_2fa.php records the 2FA outcome.
            header('Location: login_2fa.php');
            exit;
        } else {
            recordLoginAttempt(false, null, $username);
            $error = 'Credenziali non valide.';
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
    <title>Accedi — Immobiliare Orlandi</title>
    <link rel="icon" type="image/png" href="favicon.png">
    <link rel="apple-touch-icon" href="favicon.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="assets/css/style.css">
    <link rel="stylesheet" href="assets/css/theme-orlandi.css">
    <script src="https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"></script>
    <style>
        .auth { min-height: 100vh; display: grid; grid-template-columns: 1fr 1fr; background: #eef2f7; font-family: 'Inter', sans-serif; }
        @media (max-width: 860px) { .auth { grid-template-columns: 1fr; } .auth__brand { display: none; } }

        /* Left brand panel */
        .auth__brand {
            position: relative; overflow: hidden; color: #fff;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            text-align: center; padding: 48px;
            background:
                radial-gradient(120% 90% at 50% -10%, rgba(49,134,213,.35), transparent 60%),
                linear-gradient(160deg, #2b3346 0%, #202634 45%, #161b26 100%);
            background-color: #202634;
        }
        .auth__brand::after { /* subtle vignette */
            content: ""; position: absolute; inset: 0;
            background: radial-gradient(90% 70% at 50% 45%, transparent 55%, rgba(0,0,0,.35));
            pointer-events: none;
        }
        .auth__brand > * { position: relative; z-index: 1; }
        .auth__mark { width: 76px; height: 76px; display: flex; align-items: center; justify-content: center;
            border: 2px solid rgba(255,255,255,.85); border-radius: 20px; margin-bottom: 22px; }
        .auth__mark svg { width: 40px; height: 40px; color: #fff; }
        .auth__eyebrow { letter-spacing: .28em; font-size: 13px; font-weight: 600; opacity: .8; }
        .auth__wordmark { font-family: 'Playfair Display', serif; font-size: 52px; font-weight: 700; letter-spacing: .06em; line-height: 1; margin: 6px 0 26px; }
        .auth__quote { font-family: 'Playfair Display', serif; font-style: italic; font-size: 21px; line-height: 1.5; max-width: 420px; color: #dbe4f0; }
        .auth__loc { margin-top: 34px; font-size: 13px; letter-spacing: .04em; color: #9fb0c6; }

        /* Right form panel */
        .auth__form { display: flex; align-items: center; justify-content: center; padding: 40px; background: #fff; }
        .auth__inner { width: 100%; max-width: 400px; }
        .auth__logo { display: flex; justify-content: center; margin-bottom: 18px; }
        .auth__logo span { width: 54px; height: 54px; display: flex; align-items: center; justify-content: center;
            background: var(--color-primary-light); border-radius: 16px; color: var(--color-primary); }
        .auth__logo svg { width: 28px; height: 28px; }
        .auth__title { font-family: 'Playfair Display', serif; font-size: 32px; font-weight: 700; text-align: center; color: #1f2a3a; }
        .auth__sub { text-align: center; color: var(--color-text-muted); margin: 6px 0 30px; font-size: 14.5px; }
        .auth__label { display: block; font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--color-text-muted); font-weight: 600; margin: 16px 0 7px; }
        .auth__field { position: relative; }
        .auth__field svg.lead { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); width: 18px; color: var(--color-primary); }
        .auth__field input { width: 100%; padding: 13px 44px 13px 42px; border: 1.5px solid var(--color-border-strong); border-radius: 12px; font-size: 15px; color: #1f2a3a; transition: border-color .15s, box-shadow .15s; }
        .auth__field input:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }
        .auth__eye { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: #8a95a6; padding: 6px; display: flex; }
        .auth__eye svg { width: 18px; }
        .auth__submit { width: 100%; margin-top: 26px; padding: 13px; border: none; border-radius: 12px; background: var(--color-primary); color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; box-shadow: 0 10px 22px rgba(49,134,213,.28); transition: background .15s; }
        .auth__submit:hover { background: var(--color-primary-dark); }
        .auth__error { background: #fdecec; color: var(--color-danger); border: 1px solid #f7c9c9; padding: 12px 14px; border-radius: 10px; margin-bottom: 18px; font-size: 14px; }
        .auth__foot { text-align: center; margin-top: 26px; font-size: 12.5px; color: #9aa6b6; }
        .auth__foot a { color: var(--color-primary); text-decoration: none; }
    </style>
</head>
<body>
    <div class="auth">
        <aside class="auth__brand">
            <div class="auth__mark"><i data-lucide="home"></i></div>
            <div class="auth__eyebrow">IMMOBILIARE</div>
            <div class="auth__wordmark">ORLANDI</div>
            <p class="auth__quote">"Ogni proprietà racconta una storia. Noi la gestiamo con cura."</p>
            <div class="auth__loc">Civitanova Marche · Italia</div>
        </aside>

        <main class="auth__form">
            <div class="auth__inner">
                <div class="auth__logo"><span><i data-lucide="home"></i></span></div>
                <h1 class="auth__title">Accedi al Gestionale</h1>
                <p class="auth__sub">Inserisci le tue credenziali per continuare.</p>

                <?php if ($error): ?>
                    <div class="auth__error"><?= htmlspecialchars($error) ?></div>
                <?php endif; ?>

                <form method="post" autocomplete="off">
                    <label class="auth__label" for="username">Username</label>
                    <div class="auth__field">
                        <i class="lead" data-lucide="user"></i>
                        <input type="text" id="username" name="username" placeholder="Il tuo username" required autofocus>
                    </div>

                    <label class="auth__label" for="password">Password</label>
                    <div class="auth__field">
                        <i class="lead" data-lucide="lock"></i>
                        <input type="password" id="password" name="password" placeholder="La tua password" required>
                        <button type="button" class="auth__eye" id="pw-toggle" aria-label="Mostra password"><i data-lucide="eye"></i></button>
                    </div>

                    <button type="submit" class="auth__submit">Accedi</button>
                </form>

                <p class="auth__foot">© 2026 Immobiliare Orlandi · <a href="privacy.php">Privacy</a></p>
            </div>
        </main>
    </div>
    <script>
        (function () {
            var pw = document.getElementById('password');
            var tg = document.getElementById('pw-toggle');
            if (tg) tg.addEventListener('click', function () {
                var show = pw.type === 'password';
                pw.type = show ? 'text' : 'password';
                tg.innerHTML = show ? '<i data-lucide="eye-off"></i>' : '<i data-lucide="eye"></i>';
                if (window.lucide) lucide.createIcons();
            });
            if (window.lucide) lucide.createIcons();
        })();
    </script>
</body>
</html>
