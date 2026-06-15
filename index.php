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
    <title><?= htmlspecialchars($agencyName) ?></title>
    <link rel="stylesheet" href="assets/css/style.css">
    <link rel="stylesheet" href="branding.css.php">
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
                    <li><a href="view.php?name=properties" class="nav-link" data-view="properties"><span class="nav-icon">🏢</span><span class="nav-label">Immobili</span></a></li>
                    <li><a href="view.php?name=documents" class="nav-link" data-view="documents"><span class="nav-icon">📄</span><span class="nav-label">Documenti</span></a></li>
                    <li><a href="view.php?name=communications" class="nav-link" data-view="communications"><span class="nav-icon">✉️</span><span class="nav-label">Comunicazioni</span></a></li>
                    <li><a href="view.php?name=reminders" class="nav-link" data-view="reminders"><span class="nav-icon">🔔</span><span class="nav-label">Promemoria</span></a></li>
                    <?php if (canAccessView('tenants')): ?>
                    <li><a href="view.php?name=tenants" class="nav-link" data-view="tenants"><span class="nav-icon">🔑</span><span class="nav-label">Inquilini</span></a></li>
                    <?php endif; ?>
                    <?php if (canAccessView('social')): ?>
                    <li><a href="view.php?name=social" class="nav-link" data-view="social"><span class="nav-icon">📱</span><span class="nav-label">Social Media</span></a></li>
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
            </header>
            <main id="app-content" class="app-content">
                <div class="loading-spinner"><div class="spinner"></div><p>Caricamento...</p></div>
            </main>
        </div>
    </div>
    <script src="assets/js/app.js"></script>
</body>
</html>
