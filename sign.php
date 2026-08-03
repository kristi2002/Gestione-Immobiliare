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

/**
 * Tipi che il browser sa mostrare dentro la pagina. Per gli altri si offre il
 * download: meglio un allegato da aprire che un riquadro vuoto sotto la frase
 * "dichiari di aver letto".
 */
const SIGN_VIEWABLE_MIMES = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'];

if ($token === '') {
    $error = 'Token mancante.';
} else {
    try {
        $db = getDB();
        // Non basta la richiesta: serve COSA si sta firmando. Senza queste join
        // la pagina chiedeva una firma su un documento che non mostrava.
        $stmt = $db->prepare(
            'SELECT er.*,
                    d.original_name, d.mime_type, d.doc_type, d.title AS document_title,
                    c.title AS contract_title, c.contract_type, c.start_date, c.end_date,
                    c.monthly_rent, c.sale_price,
                    p.address AS property_address, p.city AS property_city,
                    cl.name AS client_name, cl.surname AS client_surname,
                    t.name AS tenant_name, t.surname AS tenant_surname
               FROM esign_requests er
               LEFT JOIN documents  d  ON d.id  = er.document_id
               LEFT JOIN contracts  c  ON c.id  = er.contract_id
               LEFT JOIN properties p  ON p.id  = c.property_id
               LEFT JOIN clients    cl ON cl.id = c.client_id
               LEFT JOIN tenants    t  ON t.id  = c.tenant_id
              WHERE er.token = :token
              LIMIT 1'
        );
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

$hasFile     = $request && !empty($request['document_id']) && !empty($request['original_name']);
$fileMime    = $request['mime_type'] ?? '';
$fileViewable= $hasFile && in_array($fileMime, SIGN_VIEWABLE_MIMES, true);
$hasContract = $request && !empty($request['contract_id']);
// Niente da mostrare = niente da firmare. Raccogliere una firma su una pagina
// che non mostra nulla e' proprio il difetto da chiudere, non un caso limite.
$nothingToShow = $request && !$hasFile && !$hasContract;

$fmtDate = static fn(?string $d): string => $d ? date('d/m/Y', strtotime($d)) : '—';
$fmtEur  = static fn($v): string => ($v === null || $v === '') ? '—' : '€ ' . number_format((float) $v, 2, ',', '.');
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
        /* Il documento si legge dentro la pagina: e' il motivo per cui la
           scatola della firma e' piu' larga quando c'e' qualcosa da mostrare. */
        .sign-box--doc { max-width: 820px; }
        .sign-box__preview { width: 100%; height: 60vh; min-height: 380px; border: 1px solid var(--color-border, #d0d5dd);
                             border-radius: var(--radius); background: #fff; margin-bottom: 12px; }
        .sign-box__openlink { font-size: 13px; text-align: left; margin-bottom: 20px; }
        @media (max-width: 640px) { .sign-box__preview { height: 46vh; min-height: 260px; } }
    </style>
</head>
<body>
<div class="sign-box<?= $fileViewable ? ' sign-box--doc' : '' ?>">
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

        <?php if ($nothingToShow): ?>
            <div style="font-size:48px">⚠️</div>
            <h3 class="sign-box__title" style="font-size:17px">Documento non disponibile</h3>
            <p class="sign-box__meta">
                Questa richiesta non ha un documento allegato, quindi non è possibile mostrarti cosa firmeresti.
                Non raccogliamo una firma alla cieca: contatta <?= sEsc($agencyName) ?> e chiedi un nuovo link.
            </p>

        <?php else: ?>

            <?php /* COSA si sta firmando: prima del consenso, non dopo. */ ?>
            <dl class="sign-box__document">
                <dt>Documento</dt>
                <dd>
                    <?php if ($hasFile): ?>
                        <?= sEsc($request['document_title'] ?: $request['original_name']) ?>
                        <?php if (!empty($request['doc_type'])): ?>
                            <span style="opacity:.7">(<?= sEsc($request['doc_type']) ?>)</span>
                        <?php endif; ?>
                    <?php else: ?>
                        <?= sEsc($request['contract_title'] ?: 'Contratto') ?>
                        <?php if (!empty($request['contract_type'])): ?>
                            <span style="opacity:.7">(<?= sEsc($request['contract_type']) ?>)</span>
                        <?php endif; ?>
                    <?php endif; ?>
                </dd>

                <?php if ($hasContract): ?>
                    <?php if (!empty($request['property_address'])): ?>
                        <dt>Immobile</dt>
                        <dd><?= sEsc($request['property_address']) ?><?= $request['property_city'] ? ', ' . sEsc($request['property_city']) : '' ?></dd>
                    <?php endif; ?>
                    <?php if (!empty($request['client_name'])): ?>
                        <dt>Proprietario</dt>
                        <dd><?= sEsc(trim($request['client_name'] . ' ' . $request['client_surname'])) ?></dd>
                    <?php endif; ?>
                    <?php if (!empty($request['tenant_name'])): ?>
                        <dt>Conduttore</dt>
                        <dd><?= sEsc(trim($request['tenant_name'] . ' ' . $request['tenant_surname'])) ?></dd>
                    <?php endif; ?>
                    <?php if (!empty($request['start_date'])): ?>
                        <dt>Decorrenza</dt>
                        <dd><?= sEsc($fmtDate($request['start_date'])) ?> — <?= sEsc($fmtDate($request['end_date'])) ?></dd>
                    <?php endif; ?>
                    <?php if (!empty($request['monthly_rent'])): ?>
                        <dt>Canone mensile</dt>
                        <dd><?= sEsc($fmtEur($request['monthly_rent'])) ?></dd>
                    <?php endif; ?>
                    <?php if (!empty($request['sale_price'])): ?>
                        <dt>Prezzo di vendita</dt>
                        <dd><?= sEsc($fmtEur($request['sale_price'])) ?></dd>
                    <?php endif; ?>
                <?php endif; ?>

                <dt>Firmatario</dt>
                <dd><?= sEsc($request['signer_name']) ?> &lt;<?= sEsc($request['signer_email']) ?>&gt;</dd>
                <dt>Link valido fino al</dt>
                <dd><?= sEsc(date('d/m/Y', strtotime($request['expires_at']))) ?></dd>
            </dl>

            <?php if ($fileViewable): ?>
                <iframe class="sign-box__preview"
                        src="sign_document.php?token=<?= sEsc(rawurlencode($token)) ?>"
                        title="Documento da firmare"></iframe>
                <p class="sign-box__openlink">
                    <a href="sign_document.php?token=<?= sEsc(rawurlencode($token)) ?>" target="_blank" rel="noopener">
                        Apri il documento in una nuova scheda ↗
                    </a>
                </p>
            <?php elseif ($hasFile): ?>
                <p class="sign-box__openlink">
                    Il documento è in un formato che il browser non mostra qui.
                    <a href="sign_document.php?token=<?= sEsc(rawurlencode($token)) ?>">Scarica il documento ↓</a>
                    e leggilo prima di firmare.
                </p>
            <?php else: ?>
                <p class="sign-box__openlink" style="opacity:.85">
                    Qui sopra ci sono i termini del contratto come registrati da <?= sEsc($agencyName) ?>.
                    Se ti aspettavi un documento allegato, chiedilo prima di firmare.
                </p>
            <?php endif; ?>

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
        <?php endif; /* $nothingToShow */ ?>
    <?php endif; /* $error */ ?>
</div>
</body>
</html>
