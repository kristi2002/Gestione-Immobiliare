<?php
require_once __DIR__ . '/../config/bootstrap.php';
initTenantSession();
requireTenantAuthWeb();

require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/settings.php';

$tenantId = getCurrentTenantId();
$stmt = getDB()->prepare(
    "SELECT t.*, p.address, p.city, p.cap, p.sqm, p.rooms, p.description
     FROM tenants t INNER JOIN properties p ON p.id = t.property_id WHERE t.id = :id"
);
$stmt->execute(['id' => $tenantId]);
$tenant = $stmt->fetch();

$branding = getPublicBranding();
$name = $_SESSION['tenant_name'] ?? 'Inquilino';
$agencyPhone = getSetting('agency_phone');
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Portale Inquilino — <?= htmlspecialchars($branding['agency_name']) ?></title>
    <link rel="stylesheet" href="../assets/css/style.css">
    <link rel="stylesheet" href="../branding.css.php">
</head>
<body>
    <div class="sidebar-backdrop" id="tenant-sidebar-backdrop" hidden aria-hidden="true"></div>
    <div class="app-layout tenant-layout">
        <aside class="sidebar" id="tenant-sidebar">
            <div class="sidebar-header">
                <div class="logo">
                    <?php if ($branding['logo_path']): ?>
                        <img src="../<?= htmlspecialchars($branding['logo_path']) ?>" alt="Logo" class="logo-img" style="max-height:36px;max-width:120px">
                    <?php else: ?>
                        <span class="logo-icon">🏠</span>
                    <?php endif; ?>
                    <span class="logo-text"><?= htmlspecialchars($branding['agency_name']) ?></span>
                </div>
            </div>
            <nav class="sidebar-nav">
                <ul><li><span class="nav-link active"><span class="nav-icon">🏢</span><span class="nav-label">Il mio immobile</span></span></li></ul>
            </nav>
            <div class="sidebar-footer">
                <div class="user-info">
                    <span class="user-avatar"><?= strtoupper(substr($name, 0, 1)) ?></span>
                    <span class="user-name"><?= htmlspecialchars($name) ?></span>
                </div>
                <a href="logout.php" class="btn btn--ghost btn--sm" style="margin-top:10px;width:100%">Esci</a>
            </div>
        </aside>

        <div class="main-wrapper">
            <header class="topbar">
                <button class="sidebar-toggle" id="tenant-sidebar-toggle" aria-label="Menu">
                    <span></span><span></span><span></span>
                </button>
                <h1 class="page-title">Il mio immobile</h1>
            </header>
            <main class="app-content">
                <div class="tenant-cards">
                    <div class="card">
                        <h2 style="font-size:18px;margin-bottom:8px"><?= htmlspecialchars($tenant['address']) ?></h2>
                        <p class="text-muted"><?= htmlspecialchars($tenant['city']) ?><?= $tenant['cap'] ? ' · CAP ' . htmlspecialchars($tenant['cap']) : '' ?></p>

                        <div class="tenant-info-grid" style="margin-top:16px">
                            <div class="tenant-info-item">
                                <span class="tenant-info-item__label">Superficie</span>
                                <span class="tenant-info-item__value"><?= htmlspecialchars($tenant['sqm'] ?? '—') ?> mq</span>
                            </div>
                            <div class="tenant-info-item">
                                <span class="tenant-info-item__label">Locali</span>
                                <span class="tenant-info-item__value"><?= htmlspecialchars($tenant['rooms'] ?? '—') ?></span>
                            </div>
                        </div>

                        <?php if ($tenant['description']): ?>
                            <p style="margin-top:16px;line-height:1.6"><?= nl2br(htmlspecialchars($tenant['description'])) ?></p>
                        <?php endif; ?>
                    </div>

                    <div class="card">
                        <h3 style="font-size:16px;margin-bottom:12px">Il mio contratto</h3>
                        <div class="tenant-info-grid">
                            <div class="tenant-info-item">
                                <span class="tenant-info-item__label">Canone mensile</span>
                                <span class="tenant-info-item__value">€ <?= number_format((float)($tenant['monthly_rent'] ?? 0), 2, ',', '.') ?></span>
                            </div>
                            <div class="tenant-info-item">
                                <span class="tenant-info-item__label">Inizio</span>
                                <span class="tenant-info-item__value"><?= $tenant['lease_start'] ? date('d/m/Y', strtotime($tenant['lease_start'])) : '—' ?></span>
                            </div>
                            <div class="tenant-info-item">
                                <span class="tenant-info-item__label">Fine</span>
                                <span class="tenant-info-item__value"><?= $tenant['lease_end'] ? date('d/m/Y', strtotime($tenant['lease_end'])) : '—' ?></span>
                            </div>
                        </div>
                    </div>

                    <?php if ($agencyPhone): ?>
                    <div class="card" style="background:var(--color-primary-light)">
                        <p style="margin:0;font-size:14px">Hai bisogno di assistenza? Chiama l'agenzia: <strong><?= htmlspecialchars($agencyPhone) ?></strong></p>
                    </div>
                    <?php endif; ?>
                </div>
            </main>
        </div>
    </div>
    <script>
    (function () {
        const sidebar  = document.getElementById('tenant-sidebar');
        const toggle   = document.getElementById('tenant-sidebar-toggle');
        const backdrop = document.getElementById('tenant-sidebar-backdrop');
        function close() {
            sidebar.classList.remove('open');
            backdrop.hidden = true;
            document.body.classList.remove('nav-open');
        }
        toggle.addEventListener('click', () => {
            if (sidebar.classList.contains('open')) close();
            else {
                sidebar.classList.add('open');
                backdrop.hidden = false;
                document.body.classList.add('nav-open');
            }
        });
        backdrop.addEventListener('click', close);
    })();
    </script>
</body>
</html>
