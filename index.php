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
    <title><?= htmlspecialchars($agencyName) ?></title>
    <link rel="stylesheet" href="assets/css/style.css">
    <link rel="stylesheet" href="branding.css.php">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="">
</head>
<body>
    <div class="sidebar-backdrop" id="sidebar-backdrop" hidden aria-hidden="true"></div>
    <div class="app-layout">
        <aside class="sidebar" id="sidebar">
            <div class="sidebar-header">
                <div class="logo">
                    <?php if (!empty($branding['logo_path'])): ?>
                        <img src="<?= htmlspecialchars($branding['logo_path']) ?>" alt="Logo" class="logo-img" style="max-height:36px;max-width:120px">
                    <?php else: ?>
                        <span class="logo-icon">🏠</span>
                    <?php endif; ?>
                    <span class="logo-text"><?= htmlspecialchars($agencyName) ?><br><small><?= htmlspecialchars($tagline) ?></small></span>
                </div>
            </div>

            <nav class="sidebar-nav">
                <ul>
                    <li><a href="view.php?name=dashboard" class="nav-link active" data-view="dashboard"><span class="nav-icon">📊</span><span class="nav-label">Dashboard</span></a></li>
                    <li><a href="view.php?name=clients" class="nav-link" data-view="clients"><span class="nav-icon">👥</span><span class="nav-label">Proprietari</span></a></li>
                    <?php if (canAccessView('leads')): ?>
                    <li><a href="view.php?name=leads" class="nav-link" data-view="leads"><span class="nav-icon">🎯</span><span class="nav-label">Leads</span></a></li>
                    <?php endif; ?>
                    <li><a href="view.php?name=properties" class="nav-link" data-view="properties"><span class="nav-icon">🏢</span><span class="nav-label">Immobili</span></a></li>
                    <?php if (canAccessView('contracts')): ?>
                    <li><a href="view.php?name=contracts" class="nav-link" data-view="contracts"><span class="nav-icon">📝</span><span class="nav-label">Contratti</span></a></li>
                    <?php endif; ?>
                    <li><a href="view.php?name=documents" class="nav-link" data-view="documents"><span class="nav-icon">📄</span><span class="nav-label">Documenti</span></a></li>
                    <?php if (canAccessView('payments')): ?>
                    <li><a href="view.php?name=payments" class="nav-link" data-view="payments"><span class="nav-icon">💶</span><span class="nav-label">Pagamenti</span></a></li>
                    <?php endif; ?>
                    <?php if (canAccessView('expenses')): ?>
                    <li><a href="view.php?name=expenses" class="nav-link" data-view="expenses"><span class="nav-icon">💰</span><span class="nav-label">Spese</span></a></li>
                    <?php endif; ?>
                    <?php if (canAccessView('invoices')): ?>
                    <li><a href="view.php?name=invoices" class="nav-link" data-view="invoices"><span class="nav-icon">🧾</span><span class="nav-label">Fatture</span></a></li>
                    <?php endif; ?>
                    <li><a href="view.php?name=communications" class="nav-link" data-view="communications"><span class="nav-icon">✉️</span><span class="nav-label">Comunicazioni</span></a></li>
                    <?php if (canAccessView('appointments')): ?>
                    <li><a href="view.php?name=appointments" class="nav-link" data-view="appointments"><span class="nav-icon">📅</span><span class="nav-label">Visite</span></a></li>
                    <?php endif; ?>
                    <?php if (canAccessView('calendar')): ?>
                    <li><a href="view.php?name=calendar" class="nav-link" data-view="calendar"><span class="nav-icon">🗓️</span><span class="nav-label">Calendario</span></a></li>
                    <?php endif; ?>
                    <?php if (canAccessView('map')): ?>
                    <li><a href="view.php?name=map" class="nav-link" data-view="map"><span class="nav-icon">🗺️</span><span class="nav-label">Mappa</span></a></li>
                    <?php endif; ?>
                    <li><a href="view.php?name=reminders" class="nav-link" data-view="reminders"><span class="nav-icon">🔔</span><span class="nav-label">Promemoria</span></a></li>
                    <?php if (canAccessView('tenants')): ?>
                    <li><a href="view.php?name=tenants" class="nav-link" data-view="tenants"><span class="nav-icon">🔑</span><span class="nav-label">Inquilini</span></a></li>
                    <?php endif; ?>
                    <?php if (canAccessView('keys')): ?>
                    <li><a href="view.php?name=keys" class="nav-link" data-view="keys"><span class="nav-icon">🗝️</span><span class="nav-label">Chiavi</span></a></li>
                    <?php endif; ?>
                    <?php if (canAccessView('agents')): ?>
                    <li><a href="view.php?name=agents" class="nav-link" data-view="agents"><span class="nav-icon">👤</span><span class="nav-label">Portafoglio agenti</span></a></li>
                    <?php endif; ?>
                    <?php if (canAccessView('reports')): ?>
                    <li><a href="view.php?name=reports" class="nav-link" data-view="reports"><span class="nav-icon">📊</span><span class="nav-label">Report</span></a></li>
                    <?php endif; ?>
                    <?php if (canAccessView('social')): ?>
                    <li><a href="view.php?name=social" class="nav-link" data-view="social"><span class="nav-icon">📱</span><span class="nav-label">Social Media</span></a></li>
                    <?php endif; ?>
                    <?php if (canAccessView('activity_log')): ?>
                    <li><a href="view.php?name=activity_log" class="nav-link" data-view="activity_log"><span class="nav-icon">📋</span><span class="nav-label">Log Attività</span></a></li>
                    <?php endif; ?>
                    <?php if (canAccessView('buildings')): ?>
                    <li><a href="view.php?name=buildings" class="nav-link" data-view="buildings"><span class="nav-icon">🏗️</span><span class="nav-label">Edifici</span></a></li>
                    <?php endif; ?>
                    <?php if (canAccessView('insurance')): ?>
                    <li><a href="view.php?name=insurance" class="nav-link" data-view="insurance"><span class="nav-icon">🛡️</span><span class="nav-label">Assicurazioni</span></a></li>
                    <?php endif; ?>
                    <?php if (canAccessView('meters')): ?>
                    <li><a href="view.php?name=meters" class="nav-link" data-view="meters"><span class="nav-icon">💡</span><span class="nav-label">Contatori</span></a></li>
                    <?php endif; ?>
                    <?php if (canAccessView('suppliers')): ?>
                    <li><a href="view.php?name=suppliers" class="nav-link" data-view="suppliers"><span class="nav-icon">🔧</span><span class="nav-label">Fornitori</span></a></li>
                    <?php endif; ?>
                    <?php if (canAccessView('inventory')): ?>
                    <li><a href="view.php?name=inventory" class="nav-link" data-view="inventory"><span class="nav-icon">📦</span><span class="nav-label">Inventario</span></a></li>
                    <?php endif; ?>
                    <?php if (canAccessView('commissions')): ?>
                    <li><a href="view.php?name=commissions" class="nav-link" data-view="commissions"><span class="nav-icon">💼</span><span class="nav-label">Provvigioni</span></a></li>
                    <?php endif; ?>
                    <?php if (canAccessView('surveys')): ?>
                    <li><a href="view.php?name=surveys" class="nav-link" data-view="surveys"><span class="nav-icon">⭐</span><span class="nav-label">Sondaggi</span></a></li>
                    <?php endif; ?>
                    <?php if (canAccessView('forecast')): ?>
                    <li><a href="view.php?name=forecast" class="nav-link" data-view="forecast"><span class="nav-icon">📈</span><span class="nav-label">Previsioni</span></a></li>
                    <?php endif; ?>
                    <?php if (canAccessView('maintenance_workflow')): ?>
                    <li><a href="view.php?name=maintenance_workflow" class="nav-link" data-view="maintenance_workflow"><span class="nav-icon">🔨</span><span class="nav-label">Manutenzione</span></a></li>
                    <?php endif; ?>
                    <?php if (canAccessView('whatsapp_inbox')): ?>
                    <li><a href="view.php?name=whatsapp_inbox" class="nav-link" data-view="whatsapp_inbox"><span class="nav-icon">💬</span><span class="nav-label">WhatsApp Inbox</span></a></li>
                    <?php endif; ?>
                    <?php if (canAccessView('property_applications')): ?>
                    <li><a href="view.php?name=property_applications" class="nav-link" data-view="property_applications"><span class="nav-icon">📋</span><span class="nav-label">Richieste</span></a></li>
                    <?php endif; ?>
                    <?php if (canAccessView('settings')): ?>
                    <li><a href="view.php?name=settings" class="nav-link" data-view="settings"><span class="nav-icon">⚙️</span><span class="nav-label">Impostazioni</span></a></li>
                    <?php endif; ?>
                </ul>
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
    <script src="assets/js/pagination.js"></script>
    <script src="assets/js/app.js"></script>
    <script src="assets/js/notifications.js"></script>
    <script>
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    </script>
</body>
</html>
