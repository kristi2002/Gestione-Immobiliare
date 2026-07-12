<?php
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/settings.php';
requireAuthWeb();
$username = getCurrentUsername();
$role     = getCurrentRole();
$branding = getPublicBranding();
$agencyName = $branding['agency_name'] ?: 'Gestionale Immobiliare';
$tagline    = $branding['agency_tagline'] ?: 'Immobiliare';
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="csrf-token" content="<?= htmlspecialchars(getCsrfToken(), ENT_QUOTES, 'UTF-8') ?>">
    <meta name="theme-color" content="<?= htmlspecialchars($branding['primary_color'] ?? '#2563eb', ENT_QUOTES, 'UTF-8') ?>">
    <link rel="manifest" href="manifest.json">
    <link rel="icon" type="image/png" sizes="32x32" href="favicon.png">
    <link rel="icon" type="image/png" sizes="16x16" href="favicon.png">
    <link rel="apple-touch-icon" href="favicon.png">
    <title><?= htmlspecialchars($agencyName) ?></title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="assets/css/style.css?v=<?= @filemtime(__DIR__ . '/assets/css/style.css') ?: time() ?>">
    <link rel="stylesheet" href="branding.css.php">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="">
    <script src="https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"></script>
    <script>
        // Expose role + write permission to all view scripts.
        // canWrite is false only for the 'readonly' role — API enforces the same.
        window.userRole = <?= json_encode($role) ?>;
        window.canWrite = <?= json_encode(!isReadOnlyRole()) ?>;
    </script>
</head>
<body>
    <div class="sidebar-backdrop" id="sidebar-backdrop" hidden aria-hidden="true"></div>
    <div class="app-layout">
        <aside class="sidebar" id="sidebar">
            <div class="sidebar-header">
                <div class="logo">
                    <?php if (!empty($branding['logo_path'])): ?>
                        <img src="<?= htmlspecialchars($branding['logo_path']) ?>" alt="Logo" class="logo-img">
                    <?php else: ?>
                        <i class="logo-icon" data-lucide="building-2"></i>
                    <?php endif; ?>
                    <span class="logo-text"><?= htmlspecialchars($agencyName) ?><small><?= htmlspecialchars($tagline) ?></small></span>
                </div>
                <button class="sidebar-close-btn" id="sidebar-close-btn" aria-label="Chiudi menu">&#x2715;</button>
            </div>

            <nav class="sidebar-nav">
                <ul>
                    <li><a href="view.php?name=dashboard" class="nav-link active" data-view="dashboard"><i class="nav-icon" data-lucide="layout-dashboard"></i><span class="nav-label">Dashboard</span></a></li>
                </ul>

                <details class="nav-group">
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

                <details class="nav-group">
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
                        <li><a href="view.php?name=portal_sync" class="nav-link" data-view="portal_sync"><i class="nav-icon" data-lucide="globe-2"></i><span class="nav-label">Pubblicazioni portali</span></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('valuation')): ?>
                        <li><a href="view.php?name=valuation" class="nav-link" data-view="valuation"><i class="nav-icon" data-lucide="calculator"></i><span class="nav-label">Valutazioni OMI</span></a></li>
                        <?php endif; ?>
                    </ul>
                </details>

                <details class="nav-group">
                    <summary><span class="nav-group-label">Documenti</span><span class="nav-group-arrow">▾</span></summary>
                    <ul>
                        <?php if (canAccessView('contracts')): ?>
                        <li><a href="view.php?name=contracts" class="nav-link" data-view="contracts"><i class="nav-icon" data-lucide="scroll-text"></i><span class="nav-label">Contratti</span></a></li>
                        <?php endif; ?>
                        <li><a href="view.php?name=documents" class="nav-link" data-view="documents"><i class="nav-icon" data-lucide="file-text"></i><span class="nav-label">Documenti</span></a></li>
                        <?php if (canAccessView('invoices')): ?>
                        <li><a href="view.php?name=invoices" class="nav-link" data-view="invoices"><i class="nav-icon" data-lucide="receipt"></i><span class="nav-label">Fatture</span></a></li>
                        <?php endif; ?>
                    </ul>
                </details>

                <details class="nav-group">
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
                    </ul>
                </details>

                <details class="nav-group">
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

                <details class="nav-group">
                    <summary><span class="nav-group-label">Comunicazioni</span><span class="nav-group-arrow">▾</span></summary>
                    <ul>
                        <li><a href="view.php?name=communications" class="nav-link" data-view="communications"><i class="nav-icon" data-lucide="mail"></i><span class="nav-label">Comunicazioni</span></a></li>
                        <?php if (canAccessView('whatsapp_inbox')): ?>
                        <li><a href="view.php?name=whatsapp_inbox" class="nav-link" data-view="whatsapp_inbox"><i class="nav-icon" data-lucide="message-circle"></i><span class="nav-label">WhatsApp Inbox</span></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('social')): ?>
                        <li><a href="view.php?name=social" class="nav-link" data-view="social"><i class="nav-icon" data-lucide="megaphone"></i><span class="nav-label">Social Media</span></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('surveys')): ?>
                        <li><a href="view.php?name=surveys" class="nav-link" data-view="surveys"><i class="nav-icon" data-lucide="star"></i><span class="nav-label">Sondaggi</span></a></li>
                        <?php endif; ?>
                    </ul>
                </details>

                <details class="nav-group">
                    <summary><span class="nav-group-label">Agenda</span><span class="nav-group-arrow">▾</span></summary>
                    <ul>
                        <?php if (canAccessView('appointments')): ?>
                        <li><a href="view.php?name=appointments" class="nav-link" data-view="appointments"><i class="nav-icon" data-lucide="calendar-check"></i><span class="nav-label">Visite</span></a></li>
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

                <details class="nav-group">
                    <summary><span class="nav-group-label">Sistema</span><span class="nav-group-arrow">▾</span></summary>
                    <ul>
                        <?php if (canAccessView('activity_log')): ?>
                        <li><a href="view.php?name=activity_log" class="nav-link" data-view="activity_log"><i class="nav-icon" data-lucide="history"></i><span class="nav-label">Log Attività</span></a></li>
                        <?php endif; ?>
                        <?php if (canAccessView('settings')): ?>
                        <li><a href="view.php?name=settings" class="nav-link" data-view="settings"><i class="nav-icon" data-lucide="settings"></i><span class="nav-label">Impostazioni</span></a></li>
                        <?php endif; ?>
                        <li><a href="ecommerce/index.html" class="nav-link" target="_blank"><i class="nav-icon" data-lucide="globe"></i><span class="nav-label">Sito Web Demo</span></a></li>
                    </ul>
                </details>
            </nav>

            <div class="sidebar-footer">
                <div class="user-info">
                    <span class="user-avatar"><?= strtoupper(substr($username, 0, 1)) ?></span>
                    <span class="user-name"><?= htmlspecialchars($username) ?> <small class="text-muted">(<?= htmlspecialchars($role) ?>)</small></span>
                </div>
                <a href="logout.php" class="btn btn--ghost btn--sm" style="margin-top:10px;width:100%">Esci</a>
            </div>
        </aside>

        <div class="main-wrapper">
            <header class="topbar">
                <button class="sidebar-toggle" id="sidebar-toggle" aria-label="Apri/chiudi menu"><span></span><span></span><span></span></button>
                <h1 class="page-title" id="page-title">Dashboard</h1>
                <div class="topbar-actions">
                    <a href="view.php?name=communications" class="topbar-link topbar-icon-btn" data-view="communications" title="Messaggi" aria-label="Messaggi"><i data-lucide="mail"></i></a>
                    <?php if (canAccessView('whatsapp_inbox')): ?>
                    <a href="view.php?name=whatsapp_inbox" class="topbar-link topbar-icon-btn" data-view="whatsapp_inbox" title="WhatsApp" aria-label="WhatsApp"><i data-lucide="message-circle"></i></a>
                    <?php endif; ?>
                    <div class="notif-wrapper">
                        <button class="notif-bell" id="notif-bell" aria-label="Notifiche" title="Notifiche">
                            🔔
                            <span class="notif-badge" id="notif-badge" hidden>0</span>
                        </button>
                        <div class="notif-dropdown" id="notif-dropdown" hidden>
                            <div class="notif-dropdown__header">Notifiche</div>
                            <div class="notif-dropdown__list" id="notif-list">
                                <p class="notif-empty text-muted">Nessuna notifica.</p>
                            </div>
                        </div>
                    </div>
                    <?php if (canAccessView('agents')): ?>
                    <a href="view.php?name=agents" class="topbar-link topbar-user" data-view="agents" title="Profilo agente">
                        <span class="topbar-user__avatar"><?= strtoupper(substr($username, 0, 1)) ?></span>
                        <span class="topbar-user__meta"><span class="topbar-user__name"><?= htmlspecialchars($username) ?></span><small><?= htmlspecialchars($role) ?></small></span>
                    </a>
                    <?php else: ?>
                    <span class="topbar-user" title="<?= htmlspecialchars($username) ?>">
                        <span class="topbar-user__avatar"><?= strtoupper(substr($username, 0, 1)) ?></span>
                        <span class="topbar-user__meta"><span class="topbar-user__name"><?= htmlspecialchars($username) ?></span><small><?= htmlspecialchars($role) ?></small></span>
                    </span>
                    <?php endif; ?>
                </div>
            </header>
            <main id="app-content" class="app-content">
                <div class="loading-spinner"><div class="spinner"></div><p>Caricamento...</p></div>
            </main>
        </div>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
    <script src="assets/js/geocode.js"></script>
    <script src="assets/js/confirm.js?v=<?= @filemtime(__DIR__ . '/assets/js/confirm.js') ?: time() ?>"></script>
    <script src="assets/js/pagination.js?v=<?= @filemtime(__DIR__ . '/assets/js/pagination.js') ?: time() ?>"></script>
    <script src="assets/js/filters.js?v=<?= @filemtime(__DIR__ . '/assets/js/filters.js') ?: time() ?>"></script>
    <script src="assets/js/app.js?v=<?= @filemtime(__DIR__ . '/assets/js/app.js') ?: time() ?>"></script>
    <script src="assets/js/notifications.js"></script>
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
