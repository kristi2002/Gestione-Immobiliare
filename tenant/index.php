<?php
/**
 * Portale Inquilino — guscio.
 *
 * Questa pagina fa tre cose: autentica, chiede i dati a lib/portal_data.php e
 * monta le viste. Non contiene query e non contiene logica di presentazione:
 * quelle stanno in lib/ e views/.
 *
 * La shell e' pensata PRIMA per il telefono — barra schede in basso — e la
 * barra laterale compare solo da 1024px (assets/css/style/17-tenant-portal.css).
 */

require_once __DIR__ . '/../config/bootstrap.php';
initTenantSession();
requireTenantAuthWeb();

// Questa (tenant) sessione deve avere il suo CSRF: bootstrap semina solo quello
// della sessione admin. Viene esposto al guscio come data-attribute, non
// interpolato dentro il JS — il modulo ora e' un file esterno.
initCsrfToken();
$csrfToken = getCsrfToken();

require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/settings.php';
require_once __DIR__ . '/lib/portal_data.php';
require_once __DIR__ . '/lib/portal_view.php';
// Per PASSWORD_MIN_LENGTH: la scheda Account deve dire la stessa soglia che
// l'endpoint poi applica, altrimenti il modulo promette e il server rifiuta.
require_once __DIR__ . '/../lib/password_reset.php';

$tenantId = getCurrentTenantId();
$db       = getDB();

// Le pagine arrivano dalla query string. L'impaginatore le riporta dentro
// l'intervallo reale (tenantPage) e la vista scrive comunque i numeri veri,
// cosi' un "?pay=99" non fa finta di niente.
$data = loadTenantPortalData($db, $tenantId, [
    'pay' => (int) ($_GET['pay'] ?? 1),
    'doc' => (int) ($_GET['doc'] ?? 1),
    'req' => (int) ($_GET['req'] ?? 1),
]);

// Estratte per le viste, che le leggono per nome.
$tenant    = $data['tenant'];
$lease     = $data['lease'];
$payments  = $data['payments'];
$upcoming  = $data['upcoming'];
$totals    = $data['totals'];
$documents = $data['documents'];
$requests  = $data['requests'];
$surveys   = $data['surveys'];

// I documenti del PROPRIO contratto, per la scheda Contratto. Sottoinsieme di
// quelli gia' autorizzati: nessun perimetro nuovo, solo un filtro in memoria.
$contractDocs = array_values(array_filter(
    $documents['rows'],
    static fn(array $d): bool => (int) ($d['contract_id'] ?? 0) > 0
));

$branding    = getPublicBranding();
$name        = $_SESSION['tenant_name'] ?? 'Inquilino';
$agencyPhone = getSetting('agency_phone');
$agencyEmail = getSetting('agency_email');
$agencyName  = (string) ($branding['agency_name'] ?? '');
// L'IBAN e' gia' validato in fase di salvataggio (config/settings.php ne
// verifica il codice di controllo): qui basta sapere se c'e'.
$agencyIban  = trim((string) getSetting('agency_iban'));

/** Le voci di navigazione: una sola lista, usata da entrambe le barre. */
$navItems = [
    ['key' => 'immobile',   'icon' => 'building-2',     'label' => 'Immobile',   'long' => 'Il mio immobile'],
    ['key' => 'contratto',  'icon' => 'file-signature', 'label' => 'Contratto',  'long' => 'Contratto'],
    ['key' => 'pagamenti',  'icon' => 'wallet',         'label' => 'Pagamenti',  'long' => 'Pagamenti'],
    ['key' => 'documenti',  'icon' => 'folder',         'label' => 'Documenti',  'long' => 'Documenti'],
    ['key' => 'assistenza', 'icon' => 'life-buoy',      'label' => 'Assistenza', 'long' => 'Assistenza'],
];

$distCss = __DIR__ . '/../assets/dist/app.min.css';
$vendorJs = __DIR__ . '/../assets/vendor/lucide-1.27.0.min.js';
$entryJs = __DIR__ . '/../assets/js/tenant_portal/index.js';
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="theme-color" content="#06224F">
    <title>Il mio immobile — Portale Inquilino</title>
    <link rel="icon" type="image/png" href="../favicon.png">
    <link rel="apple-touch-icon" href="../favicon.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Playfair+Display:wght@600;700;800&display=swap" rel="stylesheet">
    <?php if (is_file($distCss)): ?>
    <link rel="stylesheet" href="../assets/dist/app.min.css?v=<?= filemtime($distCss) ?>">
    <?php else: ?>
    <link rel="stylesheet" href="../assets/css/style.css?v=<?= @filemtime(__DIR__ . '/../assets/css/style.css') ?: time() ?>">
    <?php endif; ?>
    <link rel="stylesheet" href="../branding.css.php">
    <!-- Il tema e' l'ultimo di proposito: sovrascrive il bundle (vedi
         assets/css/README.md §1). Mancava del tutto qui e nel portale
         proprietario, percio' i due portali rendevano il layer base
         non tematizzato mentre l'admin era blu notte. -->
    <link rel="stylesheet" href="../assets/css/theme-orlandi.css?v=<?= @filemtime(__DIR__ . '/../assets/css/theme-orlandi.css') ?: time() ?>">
</head>
<body>
<div class="tp-shell" data-csrf="<?= tEsc($csrfToken) ?>">

    <!-- ── Barra laterale (solo da 1024px) ───────────────────────────────── -->
    <aside class="tp-sidebar">
        <div class="tp-sidebar__brand">
            <?php if ($branding['logo_path']): ?>
                <img src="../<?= tEsc($branding['logo_path']) ?>" alt="" class="tp-sidebar__logo">
            <?php else: ?>
                <span class="tp-sidebar__brand-ico"><?= tIcon('home') ?></span>
            <?php endif; ?>
            <span class="tp-sidebar__name"><?= tEsc($branding['agency_name']) ?></span>
        </div>

        <div class="tp-sidebar__label">Portale inquilino</div>

        <nav class="tp-sidebar__nav" aria-label="Sezioni del portale">
            <ul>
                <?php foreach ($navItems as $i => $item): ?>
                    <li>
                        <a href="#<?= tEsc($item['key']) ?>"
                           class="tp-navlink<?= $i === 0 ? ' is-active' : '' ?>"
                           data-section="<?= tEsc($item['key']) ?>"
                           <?= $i === 0 ? 'aria-current="page"' : '' ?>>
                            <?= tIcon($item['icon'], 'tp-navlink__ico') ?>
                            <span><?= tEsc($item['long']) ?></span>
                        </a>
                    </li>
                <?php endforeach; ?>
            </ul>
        </nav>

        <div class="tp-sidebar__foot">
            <a href="#account" class="tp-user" data-section="account">
                <span class="tp-user__avatar"><?= tEsc(strtoupper(mb_substr($name, 0, 1))) ?></span>
                <span class="tp-user__text">
                    <span class="tp-user__name"><?= tEsc($name) ?></span>
                    <span class="tp-user__role">Il mio account</span>
                </span>
                <?= tIcon('chevron-right', 'tp-user__chev') ?>
            </a>
            <a href="logout.php" class="tp-signout">
                <?= tIcon('log-out', 'tp-signout__ico') ?> Esci
            </a>
        </div>
    </aside>

    <!-- ── Colonna dei contenuti ─────────────────────────────────────────── -->
    <div class="tp-pane">
        <header class="tp-topbar">
            <span class="tp-topbar__brand">
                <?php if ($branding['logo_path']): ?>
                    <img src="../<?= tEsc($branding['logo_path']) ?>" alt="" class="tp-topbar__logo">
                <?php else: ?>
                    <span class="tp-sidebar__brand-ico"><?= tIcon('home') ?></span>
                <?php endif; ?>
            </span>
            <h1 class="tp-topbar__title" id="tp-title">Il mio immobile</h1>
            <span class="tp-topbar__spacer"></span>
            <a href="#account" class="tp-topbar__acc" data-section="account"
               title="Il mio account" aria-label="Il mio account"><?= tIcon('user-round') ?></a>
        </header>

        <main class="tp-main">
            <?php
            require __DIR__ . '/views/immobile.php';
            require __DIR__ . '/views/contratto.php';
            require __DIR__ . '/views/pagamenti.php';
            require __DIR__ . '/views/documenti.php';
            require __DIR__ . '/views/assistenza.php';
            require __DIR__ . '/views/account.php';
            ?>
        </main>
    </div>

    <!-- ── Barra schede in basso (sparisce da 1024px) ────────────────────── -->
    <nav class="tp-tabbar" role="tablist" aria-label="Sezioni del portale">
        <?php foreach ($navItems as $i => $item): ?>
            <a href="#<?= tEsc($item['key']) ?>"
               class="tp-tab<?= $i === 0 ? ' is-active' : '' ?>"
               id="tp-tab-<?= tEsc($item['key']) ?>"
               data-section="<?= tEsc($item['key']) ?>"
               role="tab"
               aria-controls="tp-section-<?= tEsc($item['key']) ?>"
               aria-selected="<?= $i === 0 ? 'true' : 'false' ?>">
                <?= tIcon($item['icon'], 'tp-tab__ico') ?>
                <span><?= tEsc($item['label']) ?></span>
            </a>
        <?php endforeach; ?>
    </nav>

</div>

<script src="../assets/vendor/lucide-1.27.0.min.js?v=<?= @filemtime($vendorJs) ?: time() ?>"></script>
<script type="module" src="../assets/js/tenant_portal/index.js?v=<?= @filemtime($entryJs) ?: time() ?>"></script>
<script src="../assets/js/cookie_consent.js"></script>
</body>
</html>
