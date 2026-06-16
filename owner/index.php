<?php
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/../config/settings.php';
initOwnerSession();
requireOwnerAuth();

$ownerId = getCurrentOwnerId();
$db = getDB();

// Owner's properties
$propsStmt = $db->prepare(
    "SELECT p.*, COUNT(m.id) AS media_count
     FROM properties p
     LEFT JOIN property_media m ON m.property_id = p.id
     WHERE p.client_id = :id AND p.status != 'archived'
     GROUP BY p.id
     ORDER BY p.city, p.address"
);
$propsStmt->execute(['id' => $ownerId]);
$properties = $propsStmt->fetchAll(PDO::FETCH_ASSOC);

// Owner's contracts
$contractsStmt = $db->prepare(
    "SELECT ct.*, p.address AS property_address, p.city AS property_city
     FROM contracts ct
     INNER JOIN properties p ON p.id = ct.property_id
     WHERE ct.client_id = :id OR p.client_id = :id2
     GROUP BY ct.id
     ORDER BY ct.created_at DESC
     LIMIT 20"
);
$contractsStmt->execute(['id' => $ownerId, 'id2' => $ownerId]);
$contracts = $contractsStmt->fetchAll(PDO::FETCH_ASSOC);

// Payments for owner's properties (last 24 months)
$paymentsStmt = $db->prepare(
    "SELECT pay.*, p.address AS property_address, t.name AS tenant_name, t.surname AS tenant_surname
     FROM payments pay
     INNER JOIN properties p ON p.id = pay.property_id
     LEFT JOIN tenants t ON t.id = pay.tenant_id
     WHERE p.client_id = :id
     ORDER BY pay.due_date DESC
     LIMIT 48"
);
$paymentsStmt->execute(['id' => $ownerId]);
$payments = $paymentsStmt->fetchAll(PDO::FETCH_ASSOC);

// Payment totals
$paidTotal   = array_sum(array_column(array_filter($payments, fn($p) => $p['status'] === 'paid'), 'amount'));
$pendingTotal = array_sum(array_column(array_filter($payments, fn($p) => in_array($p['status'], ['pending','late'])), 'amount'));

// Recent documents
$docsStmt = $db->prepare(
    "SELECT d.* FROM documents d
     LEFT JOIN properties p ON p.id = d.property_id
     WHERE d.client_id = :id OR p.client_id = :id2
     ORDER BY d.created_at DESC
     LIMIT 20"
);
$docsStmt->execute(['id' => $ownerId, 'id2' => $ownerId]);
$documents = $docsStmt->fetchAll(PDO::FETCH_ASSOC);

// Recent communications
$commStmt = $db->prepare(
    "SELECT * FROM communications WHERE client_id = :id
     ORDER BY created_at DESC LIMIT 10"
);
$commStmt->execute(['id' => $ownerId]);
$communications = $commStmt->fetchAll(PDO::FETCH_ASSOC);

$branding    = getPublicBranding();
$name        = getCurrentOwnerName();
$agencyPhone = getSetting('agency_phone');
$agencyEmail = getSetting('agency_email');

$STATUS_LABELS = [
    'available' => 'Disponibile', 'rented' => 'Affittato', 'sold' => 'Venduto', 'archived' => 'Archiviato',
];
$CONTRACT_STATUS = [
    'draft' => 'Bozza', 'sent' => 'Inviato', 'signed' => 'Firmato', 'expired' => 'Scaduto', 'cancelled' => 'Annullato',
];
$PAY_STATUS = [
    'pending' => 'In attesa', 'paid' => 'Pagato', 'late' => 'In ritardo', 'cancelled' => 'Annullato',
];

function oEsc($v): string { return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8'); }
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Portale Proprietario — <?= oEsc($branding['agency_name']) ?></title>
    <link rel="stylesheet" href="../assets/css/style.css">
    <link rel="stylesheet" href="../branding.css.php">
    <style>
        .portal-tabs { display:flex; gap:4px; border-bottom:2px solid var(--color-border); margin-bottom:20px; overflow-x:auto; }
        .portal-tab  { background:none; border:none; padding:10px 18px; font-size:14px; font-weight:600; color:var(--color-text-muted); cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-2px; white-space:nowrap; transition:color var(--transition); }
        .portal-tab.active, .portal-tab:hover { color:var(--color-primary); border-bottom-color:var(--color-primary); }
        .portal-section { display:none; } .portal-section.active { display:block; }
        .pay-summary { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:20px; }
        .pay-summary-card { flex:1; min-width:120px; background:var(--color-bg); border-radius:var(--radius); padding:14px 16px; }
        .pay-summary-card__label { font-size:12px; color:var(--color-text-muted); }
        .pay-summary-card__value { font-size:20px; font-weight:700; margin-top:4px; }
        .pay-summary-card--green .pay-summary-card__value { color:var(--color-success); }
        .pay-summary-card--orange .pay-summary-card__value { color:var(--color-warning, #d97706); }
        .doc-list { list-style:none; padding:0; margin:0; }
        .doc-item { display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid var(--color-border); }
        .doc-item:last-child { border-bottom:none; }
        .doc-item__name { flex:1; font-size:14px; }
        .doc-item__date { font-size:12px; color:var(--color-text-muted); }
    </style>
</head>
<body>
    <div class="sidebar-backdrop" id="owner-sidebar-backdrop" hidden aria-hidden="true"></div>
    <div class="app-layout tenant-layout">
        <aside class="sidebar" id="owner-sidebar">
            <div class="sidebar-header">
                <div class="logo">
                    <?php if ($branding['logo_path']): ?>
                        <img src="../<?= oEsc($branding['logo_path']) ?>" alt="Logo" class="logo-img" style="max-height:36px;max-width:120px">
                    <?php else: ?>
                        <span class="logo-icon">🏠</span>
                    <?php endif; ?>
                    <span class="logo-text"><?= oEsc($branding['agency_name']) ?></span>
                </div>
            </div>
            <nav class="sidebar-nav">
                <ul>
                    <li><a href="#riepilogo" class="nav-link owner-nav-link active" data-section="riepilogo"><span class="nav-icon">🏢</span><span class="nav-label">I miei immobili</span></a></li>
                    <li><a href="#contratti" class="nav-link owner-nav-link" data-section="contratti"><span class="nav-icon">📝</span><span class="nav-label">Contratti</span></a></li>
                    <li><a href="#pagamenti" class="nav-link owner-nav-link" data-section="pagamenti"><span class="nav-icon">💶</span><span class="nav-label">Pagamenti</span></a></li>
                    <li><a href="#documenti" class="nav-link owner-nav-link" data-section="documenti"><span class="nav-icon">📄</span><span class="nav-label">Documenti</span></a></li>
                    <li><a href="#comunicazioni" class="nav-link owner-nav-link" data-section="comunicazioni"><span class="nav-icon">✉️</span><span class="nav-label">Comunicazioni</span></a></li>
                </ul>
            </nav>
            <div class="sidebar-footer">
                <div class="user-info">
                    <span class="user-avatar"><?= strtoupper(substr($name, 0, 1)) ?></span>
                    <span class="user-name"><?= oEsc($name) ?></span>
                </div>
                <a href="logout.php" class="btn btn--ghost btn--sm" style="margin-top:10px;width:100%">Esci</a>
            </div>
        </aside>

        <div class="main-wrapper">
            <header class="topbar">
                <button class="sidebar-toggle" id="owner-sidebar-toggle" aria-label="Menu"><span></span><span></span><span></span></button>
                <h1 class="page-title" id="owner-page-title">I miei immobili</h1>
                <div style="margin-left:auto">
                    <a href="report.php?year=<?= date('Y') ?>" class="btn btn--ghost btn--sm" target="_blank" title="Scarica rendiconto PDF">📊 Rendiconto PDF</a>
                </div>
            </header>

            <main class="app-content">
                <!-- ── TAB: Immobili ────────────────────────────────────── -->
                <div class="portal-section active" id="section-riepilogo">
                    <div class="card" style="margin-bottom:16px">
                        <h2 style="font-size:17px;margin-bottom:4px">Benvenuto, <?= oEsc($name) ?></h2>
                        <p class="text-muted" style="margin:0">Gestisci i tuoi immobili, contratti e pagamenti.</p>
                    </div>

                    <?php if (!$properties): ?>
                        <div class="card"><p class="text-muted">Nessun immobile registrato.</p></div>
                    <?php else: ?>
                    <div class="entity-grid">
                        <?php foreach ($properties as $p): ?>
                        <div class="entity-card">
                            <div class="entity-card__header">
                                <div class="entity-card__avatar">🏢</div>
                                <div class="entity-card__title-group">
                                    <div class="entity-card__name"><?= oEsc($p['address']) ?></div>
                                    <span class="badge badge--<?= oEsc($p['status']) ?>"><?= oEsc($STATUS_LABELS[$p['status']] ?? $p['status']) ?></span>
                                </div>
                            </div>
                            <div class="entity-card__body">
                                <div class="entity-card__info"><span class="entity-card__info-icon">📍</span><?= oEsc($p['city']) ?><?= $p['cap'] ? ' ' . oEsc($p['cap']) : '' ?></div>
                                <?php if ($p['sqm']): ?><div class="entity-card__info"><span class="entity-card__info-icon">📐</span><?= oEsc($p['sqm']) ?> mq</div><?php endif; ?>
                                <?php if ($p['price']): ?><div class="entity-card__info"><span class="entity-card__info-icon">💶</span>€ <?= number_format((float)$p['price'], 0, ',', '.') ?></div><?php endif; ?>
                            </div>
                            <div class="entity-card__footer">
                                <span class="text-muted" style="font-size:12px"><?= (int)$p['media_count'] ?> foto</span>
                            </div>
                        </div>
                        <?php endforeach; ?>
                    </div>
                    <?php endif; ?>

                    <?php if ($agencyPhone || $agencyEmail): ?>
                    <div class="card" style="margin-top:16px;background:var(--color-primary-light)">
                        <p style="margin:0;font-weight:600;font-size:14px">Contatti agenzia</p>
                        <?php if ($agencyPhone): ?><p style="margin:4px 0 0;font-size:14px">📞 <?= oEsc($agencyPhone) ?></p><?php endif; ?>
                        <?php if ($agencyEmail): ?><p style="margin:4px 0 0;font-size:14px">✉️ <a href="mailto:<?= oEsc($agencyEmail) ?>"><?= oEsc($agencyEmail) ?></a></p><?php endif; ?>
                    </div>
                    <?php endif; ?>
                </div>

                <!-- ── TAB: Contratti ──────────────────────────────────── -->
                <div class="portal-section" id="section-contratti">
                    <div class="card">
                        <h3 style="font-size:15px;margin-bottom:12px">I miei contratti (<?= count($contracts) ?>)</h3>
                        <?php if (!$contracts): ?>
                            <p class="text-muted">Nessun contratto registrato.</p>
                        <?php else: ?>
                        <div class="table-responsive">
                            <table class="data-table">
                                <thead><tr><th>Titolo</th><th>Immobile</th><th>Stato</th><th>Periodo</th></tr></thead>
                                <tbody>
                                <?php foreach ($contracts as $ct): ?>
                                    <tr>
                                        <td><?= oEsc($ct['title']) ?></td>
                                        <td><?= oEsc($ct['property_address']) ?>, <?= oEsc($ct['property_city']) ?></td>
                                        <td><span class="badge badge--contract-<?= oEsc($ct['status']) ?>"><?= oEsc($CONTRACT_STATUS[$ct['status']] ?? $ct['status']) ?></span></td>
                                        <td><?= $ct['start_date'] ? date('d/m/Y', strtotime($ct['start_date'])) : '—' ?><?= $ct['end_date'] ? ' → ' . date('d/m/Y', strtotime($ct['end_date'])) : '' ?></td>
                                    </tr>
                                <?php endforeach; ?>
                                </tbody>
                            </table>
                        </div>
                        <?php endif; ?>
                    </div>
                </div>

                <!-- ── TAB: Pagamenti ──────────────────────────────────── -->
                <div class="portal-section" id="section-pagamenti">
                    <div class="pay-summary">
                        <div class="pay-summary-card pay-summary-card--green">
                            <div class="pay-summary-card__label">Totale incassato</div>
                            <div class="pay-summary-card__value">€ <?= number_format($paidTotal, 0, ',', '.') ?></div>
                        </div>
                        <?php if ($pendingTotal > 0): ?>
                        <div class="pay-summary-card pay-summary-card--orange">
                            <div class="pay-summary-card__label">Da incassare</div>
                            <div class="pay-summary-card__value">€ <?= number_format($pendingTotal, 0, ',', '.') ?></div>
                        </div>
                        <?php endif; ?>
                        <div class="pay-summary-card">
                            <div class="pay-summary-card__label">Immobili in gestione</div>
                            <div class="pay-summary-card__value"><?= count($properties) ?></div>
                        </div>
                    </div>

                    <div class="card">
                        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
                            <h3 style="font-size:15px;margin:0">Storico pagamenti</h3>
                            <a href="report.php?year=<?= date('Y') ?>" class="btn btn--sm btn--ghost" target="_blank">📊 Scarica rendiconto</a>
                        </div>
                        <?php if (empty($payments)): ?>
                            <p class="text-muted">Nessun pagamento registrato per i tuoi immobili.</p>
                        <?php else: ?>
                        <div class="table-responsive">
                            <table class="data-table" style="font-size:14px">
                                <thead><tr><th>Scadenza</th><th>Immobile</th><th>Inquilino</th><th>Importo</th><th>Stato</th><th>Pagato il</th></tr></thead>
                                <tbody>
                                <?php foreach ($payments as $pay): ?>
                                    <tr>
                                        <td><?= date('d/m/Y', strtotime($pay['due_date'])) ?></td>
                                        <td class="text-muted"><?= oEsc($pay['property_address'] ?? '—') ?></td>
                                        <td><?= $pay['tenant_name'] ? oEsc($pay['tenant_name'] . ' ' . ($pay['tenant_surname'] ?? '')) : '—' ?></td>
                                        <td><strong>€ <?= number_format((float)$pay['amount'], 2, ',', '.') ?></strong></td>
                                        <td><span class="badge badge--<?= $pay['status'] === 'paid' ? 'success' : ($pay['status'] === 'late' ? 'danger' : 'muted') ?>"><?= oEsc($PAY_STATUS[$pay['status']] ?? $pay['status']) ?></span></td>
                                        <td><?= $pay['paid_date'] ? date('d/m/Y', strtotime($pay['paid_date'])) : '—' ?></td>
                                    </tr>
                                <?php endforeach; ?>
                                </tbody>
                            </table>
                        </div>
                        <?php endif; ?>
                    </div>
                </div>

                <!-- ── TAB: Documenti ──────────────────────────────────── -->
                <div class="portal-section" id="section-documenti">
                    <div class="card">
                        <h3 style="font-size:15px;margin-bottom:12px">Documenti</h3>
                        <?php if (!$documents): ?>
                            <p class="text-muted">Nessun documento disponibile.</p>
                        <?php else: ?>
                        <ul class="doc-list">
                            <?php foreach ($documents as $d): ?>
                            <li class="doc-item">
                                <span>📄</span>
                                <div class="doc-item__name"><?= oEsc($d['title'] ?: $d['original_name']) ?></div>
                                <span class="doc-item__date"><?= date('d/m/Y', strtotime($d['created_at'])) ?></span>
                                <a href="../api/download_document.php?id=<?= (int)$d['id'] ?>" class="btn btn--sm btn--ghost" target="_blank">⬇️</a>
                            </li>
                            <?php endforeach; ?>
                        </ul>
                        <?php endif; ?>
                    </div>
                </div>

                <!-- ── TAB: Comunicazioni ──────────────────────────────── -->
                <div class="portal-section" id="section-comunicazioni">
                    <div class="card">
                        <h3 style="font-size:15px;margin-bottom:12px">Comunicazioni recenti</h3>
                        <?php if (!$communications): ?>
                            <p class="text-muted">Nessuna comunicazione recente.</p>
                        <?php else: ?>
                        <ul style="list-style:none;padding:0;margin:0">
                            <?php foreach ($communications as $cm): ?>
                            <li style="padding:10px 0;border-bottom:1px solid var(--color-border)">
                                <div style="display:flex;align-items:center;gap:8px">
                                    <span><?= $cm['direction'] === 'sent' ? '↗️' : '↙️' ?></span>
                                    <strong style="font-size:14px"><?= oEsc($cm['subject'] ?: '(senza oggetto)') ?></strong>
                                    <span class="text-muted" style="margin-left:auto;font-size:12px"><?= date('d/m/Y', strtotime($cm['created_at'])) ?></span>
                                </div>
                                <?php if ($cm['body']): ?>
                                <p style="margin:4px 0 0 28px;font-size:13px;color:var(--color-text-muted)"><?= oEsc(mb_substr($cm['body'], 0, 120)) ?><?= mb_strlen($cm['body']) > 120 ? '…' : '' ?></p>
                                <?php endif; ?>
                            </li>
                            <?php endforeach; ?>
                        </ul>
                        <?php endif; ?>
                    </div>
                </div>
            </main>
        </div>
    </div>

    <script>
    (function () {
        const sidebar   = document.getElementById('owner-sidebar');
        const toggle    = document.getElementById('owner-sidebar-toggle');
        const backdrop  = document.getElementById('owner-sidebar-backdrop');
        const pageTitle = document.getElementById('owner-page-title');

        const sectionTitles = {
            riepilogo:      'I miei immobili',
            contratti:      'Contratti',
            pagamenti:      'Pagamenti',
            documenti:      'Documenti',
            comunicazioni:  'Comunicazioni',
        };

        function closeSidebar() {
            sidebar.classList.remove('open');
            backdrop.hidden = true;
            document.body.classList.remove('nav-open');
        }

        toggle.addEventListener('click', () => {
            if (sidebar.classList.contains('open')) closeSidebar();
            else { sidebar.classList.add('open'); backdrop.hidden = false; document.body.classList.add('nav-open'); }
        });
        backdrop.addEventListener('click', closeSidebar);

        document.querySelectorAll('.owner-nav-link').forEach(link => {
            link.addEventListener('click', e => {
                e.preventDefault();
                const key = link.dataset.section;
                document.querySelectorAll('.portal-section').forEach(s => s.classList.remove('active'));
                document.querySelectorAll('.owner-nav-link').forEach(l => l.classList.remove('active'));
                const s = document.getElementById('section-' + key);
                if (s) s.classList.add('active');
                link.classList.add('active');
                if (pageTitle) pageTitle.textContent = sectionTitles[key] || key;
                closeSidebar();
            });
        });
    })();
    </script>
</body>
</html>
