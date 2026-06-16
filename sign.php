<?php
/**
 * Public e-signature page — no auth required.
 * Accessed via: sign.php?token=XXXXXX
 */
require_once __DIR__ . '/config/db.php';
require_once __DIR__ . '/config/settings.php';

$token = trim($_GET['token'] ?? '');
$branding = getPublicBranding();
$agencyName = $branding['agency_name'] ?: 'Gestionale Immobiliare';

function sEsc(string $v): string {
    return htmlspecialchars($v, ENT_QUOTES, 'UTF-8');
}

$request = null;
$error   = null;

if ($token === '') {
    $error = 'Token mancante.';
} else {
    try {
        $db   = getDB();
        $stmt = $db->prepare('SELECT * FROM esign_requests WHERE token = :token LIMIT 1');
        $stmt->execute(['token' => $token]);
        $request = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$request) {
            $error = 'Link non valido o scaduto.';
        } elseif ($request['status'] === 'expired' || strtotime($request['expires_at']) < time()) {
            $error = 'Questo link di firma è scaduto.';
        } elseif ($request['status'] === 'signed') {
            $error = 'signed'; // special case — show success message
        }
    } catch (PDOException) {
        $error = 'Errore interno. Riprova più tardi.';
    }
}
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Firma digitale — <?= sEsc($agencyName) ?></title>
    <link rel="stylesheet" href="assets/css/style.css">
    <link rel="stylesheet" href="branding.css.php">
    <style>
        body { background: var(--color-bg); display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
        .sign-box { background: var(--color-surface); border-radius: var(--radius-lg); padding: 40px; max-width: 540px; width: 100%; box-shadow: var(--shadow-lg); text-align: center; }
        .sign-box__logo { font-size: 48px; margin-bottom: 12px; }
        .sign-box__agency { font-size: 13px; color: var(--color-text-muted); margin-bottom: 24px; }
        .sign-box__title { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
        .sign-box__meta { font-size: 14px; color: var(--color-text-muted); margin-bottom: 24px; }
        .sign-box__document { background: var(--color-bg); border-radius: var(--radius); padding: 16px; text-align: left; margin-bottom: 24px; font-size: 14px; }
        .sign-box__document dt { font-weight: 600; margin-top: 8px; }
        .sign-box__document dd { margin: 0; color: var(--color-text-muted); }
        .sign-box__consent { font-size: 12px; color: var(--color-text-muted); margin-bottom: 20px; text-align: left; line-height: 1.5; }
        .sign-success { color: var(--color-success); font-size: 48px; }
    </style>
</head>
<body>
<div class="sign-box">
    <div class="sign-box__logo">
        <?php if (!empty($branding['logo_path'])): ?>
            <img src="<?= sEsc($branding['logo_path']) ?>" alt="Logo" style="max-height:48px">
        <?php else: ?>🏠<?php endif; ?>
    </div>
    <div class="sign-box__agency"><?= sEsc($agencyName) ?></div>

    <?php if ($error === 'signed'): ?>
        <div class="sign-success">✅</div>
        <h2 class="sign-box__title" style="color:var(--color-success)">Documento già firmato</h2>
        <p class="sign-box__meta">Hai già firmato questo documento il <?= sEsc(date('d/m/Y H:i', strtotime($request['signed_at']))) ?>.</p>

    <?php elseif ($error): ?>
        <div style="font-size:48px">⚠️</div>
        <h2 class="sign-box__title">Link non disponibile</h2>
        <p class="sign-box__meta"><?= sEsc($error) ?></p>

    <?php else: ?>
        <h2 class="sign-box__title">Firma documento</h2>
        <p class="sign-box__meta">
            Gentile <strong><?= sEsc($request['signer_name']) ?></strong>, ti è stato inviato un documento da firmare digitalmente.
        </p>

        <dl class="sign-box__document">
            <dt>Firmatario</dt>
            <dd><?= sEsc($request['signer_name']) ?> &lt;<?= sEsc($request['signer_email']) ?>&gt;</dd>
            <dt>Link valido fino al</dt>
            <dd><?= sEsc(date('d/m/Y', strtotime($request['expires_at']))) ?></dd>
        </dl>

        <p class="sign-box__consent">
            Cliccando "Firma il documento" dichiari di aver letto e accettato il documento presentato e autorizzi
            <?= sEsc($agencyName) ?> a registrare la tua firma digitale con data, ora e indirizzo IP.
            Questa firma ha valore legale ai sensi dell'art. 21 del D.Lgs. 82/2005 (Codice del digitale).
        </p>

        <div id="sign-result" hidden></div>

        <button class="btn btn--primary" id="btn-sign" style="width:100%;padding:14px;font-size:16px">
            ✍️ Firma il documento
        </button>
        <p style="font-size:12px;color:var(--color-text-muted);margin-top:12px">
            Hai ricevuto questo link per errore? Ignoralo — non ha effetti finché non clicchi "Firma".
        </p>

        <script>
        document.getElementById('btn-sign').addEventListener('click', async function () {
            this.disabled = true;
            this.textContent = 'Firma in corso…';
            try {
                const res  = await fetch('api/esign.php?token=<?= sEsc($token) ?>&action=sign', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                });
                const json = await res.json();
                const result = document.getElementById('sign-result');
                result.hidden = false;
                if (json.success) {
                    result.innerHTML = '<div style="color:var(--color-success);font-size:32px;margin-bottom:8px">✅</div>' +
                        '<p style="font-weight:600;font-size:16px">Documento firmato con successo!</p>' +
                        '<p style="font-size:14px;color:var(--color-text-muted)">La tua firma è stata registrata. Puoi chiudere questa finestra.</p>';
                    this.remove();
                } else {
                    result.innerHTML = '<div class="alert alert--error" style="display:block">' + (json.error || 'Errore sconosciuto.') + '</div>';
                    this.disabled = false;
                    this.textContent = '✍️ Firma il documento';
                }
            } catch (err) {
                document.getElementById('sign-result').innerHTML =
                    '<div class="alert alert--error" style="display:block">Errore di rete. Riprova.</div>';
                this.disabled = false;
                this.textContent = '✍️ Firma il documento';
            }
        });
        </script>
    <?php endif; ?>
</div>
</body>
</html>
