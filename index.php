<?php
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/settings.php';
requireAuthWeb();
$username = getCurrentUsername();
$role     = getCurrentRole();
$branding = getPublicBranding();
$agencyName = $branding['agency_name'] ?: 'Gestionale Immobiliare';
$tagline    = $branding['agency_tagline'] ?: 'Immobiliare';
// Wordmark split: last word becomes the big serif name, the rest the eyebrow
// ("Immobiliare Orlandi" → IMMOBILIARE / ORLANDI, like the design mockups).
$brandWords   = preg_split('/\s+/', trim($agencyName)) ?: [];
$brandName    = mb_strtoupper((string) array_pop($brandWords), 'UTF-8');
if ($brandName === '') { $brandName = 'GESTIONALE'; }
$brandEyebrow = mb_strtoupper(trim(implode(' ', $brandWords)), 'UTF-8');
if ($brandEyebrow === '') { $brandEyebrow = mb_strtoupper($tagline, 'UTF-8'); }
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="csrf-token" content="<?= htmlspecialchars(getCsrfToken(), ENT_QUOTES, 'UTF-8') ?>">
    <meta name="theme-color" content="<?= htmlspecialchars($branding['primary_color'] ?? '#2563eb', ENT_QUOTES, 'UTF-8') ?>">
    <link rel="manifest" href="manifest.json">
    <link rel="icon" type="image/png" sizes="192x192" href="assets/icons/icon-192.png">
    <link rel="icon" type="image/png" sizes="32x32" href="assets/icons/icon-192.png">
    <link rel="apple-touch-icon" href="assets/icons/icon-192.png">
    <title><?= htmlspecialchars($agencyName) ?></title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Playfair+Display:wght@600;700;800&display=swap" rel="stylesheet">
    <?php $__distCss = __DIR__ . '/assets/dist/app.min.css'; ?>
    <?php if (is_file($__distCss)): ?>
    <link rel="stylesheet" href="assets/dist/app.min.css?v=<?= filemtime($__distCss) ?>">
    <?php else: ?>
    <link rel="stylesheet" href="assets/css/style.css?v=<?= @filemtime(__DIR__ . '/assets/css/style.css') ?: time() ?>">
    <?php endif; ?>
    <link rel="stylesheet" href="branding.css.php">
    <link rel="stylesheet" href="assets/css/theme-orlandi.css?v=<?= @filemtime(__DIR__ . '/assets/css/theme-orlandi.css') ?: time() ?>">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          integrity="sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H"
          crossorigin="anonymous" referrerpolicy="no-referrer">
    <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css"
          integrity="sha384-pmjIAcz2bAn0xukfxADbZIb3t8oRT9Sv0rvO+BR5Csr6Dhqq+nZs59P0pPKQJkEV"
          crossorigin="anonymous" referrerpolicy="no-referrer">
    <!-- Ospitato in casa, come su login.php. Prima era `lucide@latest` da unpkg:
         nessuna versione fissata e nessun SRI, cioe' qualunque cosa la CDN
         servisse quel giorno eseguita dentro il gestionale — che tiene contratti,
         documenti d'identita' e anagrafiche. Vale anche quando unpkg e'
         semplicemente irraggiungibile: senza le icone la barra laterale resta
         una colonna di parole senza simboli, ma soprattutto non e' accettabile
         che l'apertura dell'applicazione dipenda da un terzo. -->
    <script src="assets/vendor/lucide-1.27.0.min.js?v=<?= @filemtime(__DIR__ . '/assets/vendor/lucide-1.27.0.min.js') ?: time() ?>"></script>
    <script>
        // Expose role + write permission to all view scripts.
        // canWrite is false only for the 'readonly' role — API enforces the same.
        window.userRole = <?= json_encode($role) ?>;
        window.canWrite = <?= json_encode(!isReadOnlyRole()) ?>;
        // Serve alle liste che filtrano "i miei": senza l'id, un elenco di
        // agenti è una tendina di sconosciuti in cui non ti riconosci.
        window.userId   = <?= json_encode(getCurrentAdminId()) ?>;
    </script>
</head>
<body>
    <?php /* Icone di marca, che lucide non ha: definite una volta qui e
       richiamate con <use href="#icon-*"> ovunque servano. Le viste sono
       frammenti innestati in questo documento, quindi il simbolo e' a
       portata anche del markup che le pagine costruiscono da JavaScript. */ ?>
    <svg class="app-icon-sprite" aria-hidden="true" focusable="false" width="0" height="0"><defs>
        <symbol id="icon-whatsapp" viewBox="0 0 24 24"><path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884a9.82 9.82 0 0 1 6.988 2.898 9.83 9.83 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.82 11.82 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.9 11.9 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.82 11.82 0 0 0 20.464 3.488"/></symbol>
    </defs></svg>
    <div class="sidebar-backdrop" id="sidebar-backdrop" hidden aria-hidden="true"></div>
    <div class="app-layout">
        <aside class="sidebar" id="sidebar">
            <div class="sidebar-brand">
                <a class="sb-brand topbar-link" href="view.php?name=dashboard" data-view="dashboard" title="<?= htmlspecialchars($agencyName) ?>">
                    <?php if (!empty($branding['logo_path'])): ?>
                        <img class="sb-brand__logo" src="<?= htmlspecialchars($branding['logo_path']) ?>" alt="<?= htmlspecialchars($agencyName) ?>">
                    <?php else: ?>
                        <span class="sb-brand__ico"><i data-lucide="home"></i></span>
                        <span class="sb-brand__word">
                            <span class="sb-brand__eyebrow"><?= htmlspecialchars($brandEyebrow) ?></span>
                            <b class="sb-brand__name"><?= htmlspecialchars($brandName) ?></b>
                        </span>
                    <?php endif; ?>
                </a>
                <button class="sidebar-close-btn" id="sidebar-close-btn" aria-label="Chiudi menu">&times;</button>
            </div>
            <?php if (canAccessView('agents')): ?>
            <a class="sb-profile topbar-link" href="view.php?name=agents" data-view="agents" title="Profilo agente">
                <span class="sb-profile__avatar"><?= strtoupper(substr($username, 0, 1)) ?></span>
                <span class="sb-profile__meta"><b><?= htmlspecialchars($username) ?></b><small><?= htmlspecialchars(str_replace('_', ' ', $role)) ?></small></span>
                <span class="sb-profile__chev"><i data-lucide="chevron-right"></i></span>
            </a>
            <?php else: ?>
            <span class="sb-profile">
                <span class="sb-profile__avatar"><?= strtoupper(substr($username, 0, 1)) ?></span>
                <span class="sb-profile__meta"><b><?= htmlspecialchars($username) ?></b><small><?= htmlspecialchars(str_replace('_', ' ', $role)) ?></small></span>
            </span>
            <?php endif; ?>
            <nav class="sidebar-nav">
                <ul>
                    <li><a href="view.php?name=dashboard" class="nav-link active" data-view="dashboard"><i class="nav-icon" data-lucide="layout-dashboard"></i><span class="nav-label">Dashboard</span></a></li>
                </ul>

                <details class="nav-group" open>
                    <summary><span class="nav-group-label">Persone</span><span class="nav-group-arrow">▾</span></summary>
                    <ul>
                        <li><a href="view.php?name=clients" class="nav-link" data-view="clients"><i class="nav-icon" data-lucide="users"></i><span class="nav-label">Proprietari</span></a></li>
                        <?php if (canAccessView('leads')): ?>
                        <li><a href="view.php?name=leads" class="nav-link" data-view="leads"><i class="nav-icon" data-lucide="target"></i><span class="nav-label">Leads</span></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('tenants')): ?>
                        <li><a href="view.php?name=tenants" class="nav-link" data-view="tenants"><i class="nav-icon" data-lucide="key-round"></i><span class="nav-label">Inquilini</span></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('agents')): ?>
                        <li><a href="view.php?name=agents" class="nav-link" data-view="agents"><i class="nav-icon" data-lucide="user-round"></i><span class="nav-label">Portafoglio agenti</span></a></li>
                        <?php endif; ?>
                    </ul>
                </details>

                <details class="nav-group" open>
                    <summary><span class="nav-group-label">Immobili</span><span class="nav-group-arrow">▾</span></summary>
                    <ul>
                        <li><a href="view.php?name=properties" class="nav-link" data-view="properties"><i class="nav-icon" data-lucide="building-2"></i><span class="nav-label">Immobili</span></a></li>
                        <?php if (canAccessView('buildings')): ?>
                        <li><a href="view.php?name=buildings" class="nav-link" data-view="buildings"><i class="nav-icon" data-lucide="building"></i><span class="nav-label">Edifici</span></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('map')): ?>
                        <li><a href="view.php?name=map" class="nav-link" data-view="map"><i class="nav-icon" data-lucide="map"></i><span class="nav-label">Mappa</span></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('keys')): ?>
                        <li><a href="view.php?name=keys" class="nav-link" data-view="keys"><i class="nav-icon" data-lucide="key"></i><span class="nav-label">Chiavi</span></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('meters')): ?>
                        <li><a href="view.php?name=meters" class="nav-link" data-view="meters"><i class="nav-icon" data-lucide="gauge"></i><span class="nav-label">Contatori</span></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('inventory')): ?>
                        <li><a href="view.php?name=inventory" class="nav-link" data-view="inventory"><i class="nav-icon" data-lucide="package"></i><span class="nav-label">Inventario</span></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('portal_sync')): ?>
                        <li><a href="view.php?name=portal_sync" class="nav-link<?= isViewDisabled('portal_sync') ? ' nav-link--disabled' : '' ?>" data-view="portal_sync" aria-disabled="<?= isViewDisabled('portal_sync') ? 'true' : 'false' ?>"><i class="nav-icon" data-lucide="globe-2"></i><span class="nav-label">Pubblicazioni portali</span><?php if (isViewDisabled('portal_sync')): ?><span class="nav-badge">Presto</span><?php endif; ?></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('valuation')): ?>
                        <li><a href="view.php?name=valuation" class="nav-link" data-view="valuation"><i class="nav-icon" data-lucide="calculator"></i><span class="nav-label">Valutazioni OMI</span></a></li>
                        <?php endif; ?>
                    </ul>
                </details>

                <details class="nav-group" open>
                    <summary><span class="nav-group-label">Documenti</span><span class="nav-group-arrow">▾</span></summary>
                    <ul>
                        <?php if (canAccessView('contracts')): ?>
                        <li><a href="view.php?name=contracts" class="nav-link" data-view="contracts"><i class="nav-icon" data-lucide="scroll-text"></i><span class="nav-label">Contratti</span></a></li>
                        <?php endif; ?>
                        <li><a href="view.php?name=documents" class="nav-link" data-view="documents"><i class="nav-icon" data-lucide="file-text"></i><span class="nav-label">Documenti</span></a></li>
                        <?php if (canAccessView('invoices')): ?>
                        <li><a href="view.php?name=invoices" class="nav-link" data-view="invoices"><i class="nav-icon" data-lucide="receipt"></i><span class="nav-label">Fatture</span></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('esign')): ?>
                        <li><a href="view.php?name=esign" class="nav-link" data-view="esign"><i class="nav-icon" data-lucide="pen-tool"></i><span class="nav-label">Firme digitali</span></a></li>
                        <?php endif; ?>
                    </ul>
                </details>

                <details class="nav-group" open>
                    <summary><span class="nav-group-label">Finanze</span><span class="nav-group-arrow">▾</span></summary>
                    <ul>
                        <?php if (canAccessView('payments')): ?>
                        <li><a href="view.php?name=payments" class="nav-link" data-view="payments"><i class="nav-icon" data-lucide="banknote"></i><span class="nav-label">Pagamenti</span></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('expenses')): ?>
                        <li><a href="view.php?name=expenses" class="nav-link" data-view="expenses"><i class="nav-icon" data-lucide="wallet"></i><span class="nav-label">Spese</span></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('commissions')): ?>
                        <li><a href="view.php?name=commissions" class="nav-link" data-view="commissions"><i class="nav-icon" data-lucide="briefcase"></i><span class="nav-label">Provvigioni</span></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('forecast')): ?>
                        <li><a href="view.php?name=forecast" class="nav-link" data-view="forecast"><i class="nav-icon" data-lucide="trending-up"></i><span class="nav-label">Previsioni</span></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('reports')): ?>
                        <li><a href="view.php?name=reports" class="nav-link" data-view="reports"><i class="nav-icon" data-lucide="bar-chart-3"></i><span class="nav-label">Report</span></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('scadenzario')): ?>
                        <li><a href="view.php?name=scadenzario" class="nav-link" data-view="scadenzario"><i class="nav-icon" data-lucide="calendar-clock"></i><span class="nav-label">Scadenzario fiscale</span></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('payment_reminders')): ?>
                        <li><a href="view.php?name=payment_reminders" class="nav-link" data-view="payment_reminders"><i class="nav-icon" data-lucide="bell-ring"></i><span class="nav-label">Solleciti pagamenti</span></a></li>
                        <?php endif; ?>
                    </ul>
                </details>

                <details class="nav-group" open>
                    <summary><span class="nav-group-label">Gestione</span><span class="nav-group-arrow">▾</span></summary>
                    <ul>
                        <?php if (canAccessView('maintenance_workflow')): ?>
                        <li><a href="view.php?name=maintenance_workflow" class="nav-link" data-view="maintenance_workflow"><i class="nav-icon" data-lucide="wrench"></i><span class="nav-label">Manutenzione</span></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('insurance')): ?>
                        <li><a href="view.php?name=insurance" class="nav-link" data-view="insurance"><i class="nav-icon" data-lucide="shield-check"></i><span class="nav-label">Assicurazioni</span></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('suppliers')): ?>
                        <li><a href="view.php?name=suppliers" class="nav-link" data-view="suppliers"><i class="nav-icon" data-lucide="truck"></i><span class="nav-label">Fornitori</span></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('property_applications')): ?>
                        <li><a href="view.php?name=property_applications" class="nav-link" data-view="property_applications"><i class="nav-icon" data-lucide="clipboard-list"></i><span class="nav-label">Richieste</span></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('aml')): ?>
                        <li><a href="view.php?name=aml" class="nav-link" data-view="aml"><i class="nav-icon" data-lucide="shield-alert"></i><span class="nav-label">Antiriciclaggio</span></a></li>
                        <?php endif; ?>
                    </ul>
                </details>

                <details class="nav-group" open>
                    <summary><span class="nav-group-label">Comunicazioni</span><span class="nav-group-arrow">▾</span></summary>
                    <ul>
                        <li><a href="view.php?name=communications" class="nav-link" data-view="communications"><i class="nav-icon" data-lucide="mail"></i><span class="nav-label">Comunicazioni</span></a></li>
                        <?php if (canAccessView('whatsapp_inbox')): ?>
                        <li><a href="view.php?name=whatsapp_inbox" class="nav-link" data-view="whatsapp_inbox"><svg class="nav-icon icon-brand-whatsapp" aria-hidden="true" focusable="false"><use href="#icon-whatsapp"></use></svg><span class="nav-label">WhatsApp Inbox</span></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('social')): ?>
                        <li><a href="view.php?name=social" class="nav-link" data-view="social"><i class="nav-icon" data-lucide="megaphone"></i><span class="nav-label">Social Media</span></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('surveys')): ?>
                        <li><a href="view.php?name=surveys" class="nav-link" data-view="surveys"><i class="nav-icon" data-lucide="star"></i><span class="nav-label">Sondaggi</span></a></li>
                        <?php endif; ?>
                    </ul>
                </details>

                <details class="nav-group" open>
                    <summary><span class="nav-group-label">Agenda</span><span class="nav-group-arrow">▾</span></summary>
                    <ul>
                        <?php if (canAccessView('appointments')): ?>
                        <li><a href="view.php?name=appointments" class="nav-link" data-view="appointments"><i class="nav-icon" data-lucide="calendar-check"></i><span class="nav-label">Appuntamenti</span></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('calendar')): ?>
                        <li><a href="view.php?name=calendar" class="nav-link" data-view="calendar"><i class="nav-icon" data-lucide="calendar"></i><span class="nav-label">Calendario</span></a></li>
                        <?php endif; ?>
                        <li><a href="view.php?name=reminders" class="nav-link" data-view="reminders"><i class="nav-icon" data-lucide="bell"></i><span class="nav-label">Promemoria</span></a></li>
                        <?php if (canAccessView('automations')): ?>
                        <li><a href="view.php?name=automations" class="nav-link" data-view="automations"><i class="nav-icon" data-lucide="workflow"></i><span class="nav-label">Automazioni</span></a></li>
                        <?php endif; ?>
                    </ul>
                </details>

                <details class="nav-group" open>
                    <summary><span class="nav-group-label">Sistema</span><span class="nav-group-arrow">▾</span></summary>
                    <ul>
                        <?php if (canAccessView('activity_log')): ?>
                        <li><a href="view.php?name=activity_log" class="nav-link" data-view="activity_log"><i class="nav-icon" data-lucide="history"></i><span class="nav-label">Log Attività</span></a></li>
                        <?php endif; ?>
                        <li><a href="view.php?name=account" class="nav-link" data-view="account"><i class="nav-icon" data-lucide="user-cog"></i><span class="nav-label">Il mio account</span></a></li>
                        <?php if (canAccessView('settings')): ?>
                        <li><a href="view.php?name=settings" class="nav-link" data-view="settings"><i class="nav-icon" data-lucide="settings"></i><span class="nav-label">Impostazioni</span></a></li>
                        <?php endif; ?>
                    </ul>
                </details>
            </nav>

            <div class="sidebar-footer">
                <a href="logout.php" class="btn btn--ghost btn--sm" style="width:100%">Esci</a>
            </div>
        </aside>

        <div class="main-wrapper">
            <header class="topbar">
                <button class="sidebar-toggle" id="sidebar-toggle" aria-label="Apri/chiudi menu"><span></span><span></span><span></span></button>
                <div class="topbar-title">
                    <h1 id="page-title">Dashboard</h1>
                    <p class="topbar-sub" id="topbar-sub"></p>
                </div>
                <div class="global-search">
                    <i class="global-search__icon" data-lucide="search"></i>
                    <input type="search" id="global-search-input" class="global-search__input" placeholder="Cerca proprietari, immobili, inquilini, lead…" autocomplete="off" aria-label="Ricerca globale">
                    <div class="global-search__results" id="global-search-results" hidden></div>
                </div>
                <div class="topbar-actions">
                    <a href="view.php?name=communications" class="topbar-link topbar-icon-btn" data-view="communications" title="Messaggi" aria-label="Messaggi"><i data-lucide="mail"></i></a>
                    <?php if (canAccessView('whatsapp_inbox')): ?>
                    <a href="view.php?name=whatsapp_inbox" class="topbar-link topbar-icon-btn" data-view="whatsapp_inbox" title="WhatsApp" aria-label="WhatsApp"><svg class="icon-brand-whatsapp" aria-hidden="true" focusable="false"><use href="#icon-whatsapp"></use></svg></a>
                    <?php endif; ?>
                    <div class="notif-wrapper">
                        <button class="notif-bell" id="notif-bell" aria-label="Notifiche" title="Notifiche">🔔<span class="notif-badge" id="notif-badge" hidden>0</span></button>
                        <div class="notif-dropdown" id="notif-dropdown" hidden>
                            <div class="notif-dropdown__header">Notifiche</div>
                            <div class="notif-dropdown__list" id="notif-list"><p class="notif-empty text-muted">Nessuna notifica.</p></div>
                        </div>
                    </div>
                </div>
            </header>
            <!-- Percorso di navigazione: lo riempie app.js con il cammino
                 realmente percorso (Proprietari / Mario Rossi / Via Roma 1),
                 non con una gerarchia fissa. Resta nascosto solo sulle pagine
                 di primo livello. È l'unico ritorno indietro dell'app: le
                 pagine non hanno più un loro bottone "Indietro". La freccia non
                 porta più la scritta — il passo accanto dice già dove torna. -->
            <nav class="crumbbar" id="crumbbar" hidden aria-label="Percorso di navigazione">
                <button type="button" class="crumbbar__back" id="crumb-back" title="Torna indietro" aria-label="Torna indietro"><i data-lucide="arrow-left"></i></button>
                <ol class="crumbs" id="crumbs"></ol>
            </nav>
            <main id="app-content" class="app-content">
                <div class="loading-spinner"><div class="spinner"></div><p>Caricamento...</p></div>
            </main>
        </div>
    </div>
        <!-- integrity= su tutto quello che resta su CDN. La versione era gia' fissata,
         quindi il problema non era "cambia sotto i piedi" ma "nessuno verifica
         cosa arriva": senza SRI il browser esegue qualunque cosa la CDN
         restituisca a quell'URL. crossorigin e' obbligatorio perche' SRI possa
         essere controllato. Se un file non corrisponde all'hash il browser lo
         scarta: la mappa degrada (map.js gestisce gia' l'assenza del cluster) e
         i grafici non si disegnano, ma non gira codice non verificato. -->
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"
            integrity="sha384-NrKB+u6Ts6AtkIhwPixiKTzgSKNblyhlk0Sohlgar9UHUBzai/sgnNNWWd291xqt"
            crossorigin="anonymous" referrerpolicy="no-referrer"></script>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
            integrity="sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH"
            crossorigin="anonymous" referrerpolicy="no-referrer"></script>
    <!-- Raggruppamento marker. map.js degrada a layerGroup se questo script non
         arriva, quindi la mappa resta utilizzabile anche senza CDN. Il tema
         (assets/css/theme-orlandi.css) sostituisce le icone di default del
         plugin, per questo NON carichiamo MarkerCluster.Default.css. -->
    <script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"
            integrity="sha384-eXVCORTRlv4FUUgS/xmOyr66XBVraen8ATNLMESp92FKXLAMiKkerixTiBvXriZr"
            crossorigin="anonymous" referrerpolicy="no-referrer"></script>
    <!-- format.js prima di tutti: ogni controller ci appoggia le date. -->
    <script src="assets/js/format.js?v=<?= @filemtime(__DIR__ . '/assets/js/format.js') ?: time() ?>"></script>
    <script src="assets/js/geocode.js"></script>
    <script src="assets/js/confirm.js?v=<?= @filemtime(__DIR__ . '/assets/js/confirm.js') ?: time() ?>"></script>
    <script src="assets/js/pagination.js?v=<?= @filemtime(__DIR__ . '/assets/js/pagination.js') ?: time() ?>"></script>
    <script src="assets/js/filters.js?v=<?= @filemtime(__DIR__ . '/assets/js/filters.js') ?: time() ?>"></script>
    <script src="assets/js/datepicker.js?v=<?= @filemtime(__DIR__ . '/assets/js/datepicker.js') ?: time() ?>"></script>
    <script src="assets/js/form_guard.js?v=<?= @filemtime(__DIR__ . '/assets/js/form_guard.js') ?: time() ?>"></script>
    <script>
    // Topbar welcome line — "Benvenuto, <utente> · Lunedì 14 Luglio 2026"
    (function () {
        var el = document.getElementById('topbar-sub');
        if (!el) return;
        var d = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        d = d.charAt(0).toUpperCase() + d.slice(1);
        el.textContent = 'Benvenuto, ' + <?= json_encode($username) ?> + ' · ' + d;
    })();
    </script>
    <script src="assets/js/app.js?v=<?= @filemtime(__DIR__ . '/assets/js/app.js') ?: time() ?>"></script>
    <script src="assets/js/notifications.js?v=<?= @filemtime(__DIR__ . '/assets/js/notifications.js') ?: time() ?>"></script>
    <script>
    if ('serviceWorker' in navigator) {
        // Auto-reload once when an UPDATED service worker takes control, so stale
        // cached CSS/JS from a previous version is replaced without a manual hard refresh.
        // Skip the reload on the very first install (no previous controller).
        const hadController = !!navigator.serviceWorker.controller;
        let swReloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (swReloaded || !hadController) return;
            swReloaded = true;
            window.location.reload();
        });
        navigator.serviceWorker.register('sw.js')
            .then((reg) => { reg.update(); })
            .catch(() => {});
    }
    </script>
    <script src="assets/js/cookie_consent.js"></script>
</body>
</html>
