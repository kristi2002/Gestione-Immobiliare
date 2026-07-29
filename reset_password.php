<?php
/**
 * Pagina pubblica di impostazione password — nessuna autenticazione.
 * Si arriva qui solo dal link nell'email: reset_password.php?token=XXXX
 *
 * Vale sia per il portale inquilino sia per quello proprietario: e' il token a
 * dire di chi si tratta, quindi non esistono due pagine da tenere allineate.
 */

require_once __DIR__ . '/config/db.php';
require_once __DIR__ . '/config/settings.php';
require_once __DIR__ . '/lib/password_reset.php';

// Il token e' nella query string, quindi finirebbe nell'header Referer di
// qualunque risorsa esterna caricata da questa pagina. Non ce ne sono, ma la
// pagina puo' cambiare: la policy vale una riga e chiude la questione.
header('Referrer-Policy: no-referrer');
// Un link di reset non va conservato da nessuna cache intermedia.
header('Cache-Control: no-store, private');

$branding   = getPublicBranding();
$agencyName = $branding['agency_name'] ?: 'Gestionale Immobiliare';

function rpEsc(string $v): string
{
    return htmlspecialchars($v, ENT_QUOTES, 'UTF-8');
}

$token   = trim($_POST['token'] ?? $_GET['token'] ?? '');
$error   = null;
$done    = false;
$reset   = null;
$loginUrl = 'tenant/login.php';

try {
    $db    = getDB();
    $reset = passwordResetFind($db, $token);

    if ($reset === null) {
        // Un solo messaggio per inesistente / scaduto / gia' usato / revocato:
        // dire quale dei quattro aiuterebbe soltanto chi tira a indovinare.
        $error = 'Questo link non e\' piu\' valido. I link di accesso scadono dopo '
               . PASSWORD_RESET_TTL_HOURS . ' ore e valgono una sola volta: '
               . 'contatti l\'agenzia per riceverne uno nuovo.';
    } else {
        $loginUrl = $reset['subject_type'] === 'tenant' ? 'tenant/login.php' : 'owner/login.php';

        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $password = (string) ($_POST['password'] ?? '');
            $confirm  = (string) ($_POST['password_confirm'] ?? '');

            // Validazione PRIMA di consumare: una password troppo corta non deve
            // bruciare il link e costringere a richiederne un altro.
            if (strlen($password) < PASSWORD_MIN_LENGTH) {
                $error = 'La password deve contenere almeno ' . PASSWORD_MIN_LENGTH . ' caratteri.';
            } elseif ($password !== $confirm) {
                $error = 'Le due password non coincidono.';
            } else {
                passwordResetConsume($db, $reset, $password, $_SERVER['REMOTE_ADDR'] ?? null);
                $done = true;
            }
        }
    }
} catch (Throwable $e) {
    error_log('reset_password failed: ' . $e->getMessage());
    $error = 'Errore interno. Riprovi piu\' tardi o contatti l\'agenzia.';
}
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="referrer" content="no-referrer">
    <title>Imposta password — <?= rpEsc($agencyName) ?></title>
    <link rel="icon" type="image/png" href="favicon.png">
    <link rel="stylesheet" href="assets/css/style.css">
    <style>
        .rp-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--color-bg); padding: 24px; }
        .rp-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; padding: 32px; width: 100%; max-width: 420px; }
        .rp-hint { font-size: 13px; }
    </style>
</head>
<body>
    <div class="rp-page">
        <div class="rp-card">
            <h1><?= rpEsc($agencyName) ?></h1>

            <?php if ($done): ?>
                <h2>Password impostata</h2>
                <div class="alert alert--success">
                    Da adesso puo' accedere al portale con la sua email e la password appena scelta.
                </div>
                <p class="rp-hint text-muted">
                    L'agenzia non conosce questa password e non puo' recuperarla: se la dimentica,
                    chieda un nuovo link di accesso.
                </p>
                <!-- text-decoration inline: .btn non azzera la sottolineatura sui
                     link, quindi ogni <a class="btn"> dell'app esce sottolineato.
                     Si corregge qui invece che nel CSS condiviso per non toccare
                     tutte le altre pagine da questa modifica. -->
                <a class="btn btn--primary" style="width:100%;text-decoration:none" href="<?= rpEsc($loginUrl) ?>">Vai al portale</a>

            <?php elseif ($reset === null): ?>
                <h2>Link non valido</h2>
                <div class="alert alert--error"><?= rpEsc((string) $error) ?></div>

            <?php else: ?>
                <h2>Scelga la sua password</h2>
                <p class="text-muted">
                    Imposti la password per accedere al portale. La sceglie lei: l'agenzia
                    non la vede e non puo' recuperarla.
                </p>
                <?php if ($error): ?>
                    <div class="alert alert--error"><?= rpEsc($error) ?></div>
                <?php endif; ?>
                <form method="post" autocomplete="off">
                    <input type="hidden" name="token" value="<?= rpEsc($token) ?>">
                    <div class="form-group">
                        <label for="rp-password">Nuova password</label>
                        <input type="password" id="rp-password" name="password" class="form-input"
                               minlength="<?= PASSWORD_MIN_LENGTH ?>" autocomplete="new-password" required autofocus>
                        <small class="text-muted">Almeno <?= PASSWORD_MIN_LENGTH ?> caratteri.</small>
                    </div>
                    <div class="form-group">
                        <label for="rp-confirm">Ripeta la password</label>
                        <input type="password" id="rp-confirm" name="password_confirm" class="form-input"
                               minlength="<?= PASSWORD_MIN_LENGTH ?>" autocomplete="new-password" required>
                    </div>
                    <button type="submit" class="btn btn--primary" style="width:100%">Imposta password</button>
                </form>
                <p class="rp-hint text-muted" style="margin-top:16px">
                    Se non ha richiesto lei questo accesso, chiuda questa pagina: senza
                    confermare non cambia nulla.
                </p>
            <?php endif; ?>
        </div>
    </div>
</body>
</html>
