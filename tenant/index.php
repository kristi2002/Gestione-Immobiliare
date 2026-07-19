<?php
require_once __DIR__ . '/../config/bootstrap.php';
initTenantSession();
requireTenantAuthWeb();

// Ensure THIS (tenant) session carries a CSRF token — bootstrap only seeded the
// admin session's token. Exposed to the page so portal writes can send it back.
initCsrfToken();
$csrfToken = getCsrfToken();

require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/settings.php';

$tenantId = getCurrentTenantId();
$db = getDB();

// Tenant + property info — property/lease come from the tenant's current
// contract (see getTenantCurrentContract in config/db.php), not a fixed
// column on the tenant, since the same person can be re-rented over time.
$stmt = $db->prepare("SELECT * FROM tenants WHERE id = :id");
$stmt->execute(['id' => $tenantId]);
$tenant = $stmt->fetch(PDO::FETCH_ASSOC);

$contract = $tenant ? getTenantCurrentContract($db, $tenantId) : null;
if ($tenant) {
    $tenant['property_id']  = $contract['property_id'] ?? null;
    $tenant['address']      = $contract['address'] ?? null;
    $tenant['city']         = $contract['city'] ?? null;
    $tenant['cap']          = $contract['cap'] ?? null;
    $tenant['sqm']          = $contract['sqm'] ?? null;
    $tenant['rooms']        = $contract['rooms'] ?? null;
    $tenant['description']  = $contract['description'] ?? null;
    $tenant['lease_start']  = $contract['lease_start'] ?? null;
    $tenant['lease_end']    = $contract['lease_end'] ?? null;
    $tenant['monthly_rent'] = $contract['monthly_rent'] ?? null;
}

// Payments history
$payStmt = $db->prepare(
    "SELECT id, amount, due_date, paid_date, status, notes
     FROM payments WHERE tenant_id = :tid ORDER BY due_date DESC LIMIT 36"
);
$payStmt->execute(['tid' => $tenantId]);
$payments = $payStmt->fetchAll(PDO::FETCH_ASSOC);

// Upcoming payments
$upcomingStmt = $db->prepare(
    "SELECT id, amount, due_date, status
     FROM payments
     WHERE tenant_id = :tid AND status IN ('pending','late') AND due_date >= CURDATE()
     ORDER BY due_date ASC LIMIT 3"
);
$upcomingStmt->execute(['tid' => $tenantId]);
$upcoming = $upcomingStmt->fetchAll(PDO::FETCH_ASSOC);

// Documents strictly scoped to THIS tenant's lease: the rented property or their
// own contract. Deliberately NOT the property owner's client record — filtering by
// `client_id = owner` exposed the landlord's personal/ID documents and every other
// property's paperwork to any tenant. Property/contract scope is the right boundary.
$tenantContractId = (int) ($contract['contract_id'] ?? 0);
$docsStmt = $db->prepare(
    "SELECT id, title, original_name, mime_type AS file_type, file_size, created_at
     FROM documents
     WHERE (property_id IS NOT NULL AND property_id = :pid)
        OR (contract_id IS NOT NULL AND contract_id = :cid)
     ORDER BY created_at DESC LIMIT 30"
);
$docsStmt->execute([
    'pid' => (int) ($tenant['property_id'] ?? 0),
    'cid' => $tenantContractId,
]);
$documents = $docsStmt->fetchAll(PDO::FETCH_ASSOC);

// Payment totals
$paidTotal   = array_sum(array_column(array_filter($payments, fn($p) => $p['status'] === 'paid'),   'amount'));
$lateTotal   = array_sum(array_column(array_filter($payments, fn($p) => $p['status'] === 'late'),   'amount'));

$PAY_STATUS = [
    'pending'   => 'In attesa',
    'paid'      => 'Pagato',
    'late'      => 'In ritardo',
    'cancelled' => 'Annullato',
];

$branding    = getPublicBranding();
$name        = $_SESSION['tenant_name'] ?? 'Inquilino';
$agencyPhone = getSetting('agency_phone');
$agencyEmail = getSetting('agency_email');

function tEsc($v): string { return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8'); }
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Portale Inquilino — <?= tEsc($branding['agency_name']) ?></title>
    <link rel="stylesheet" href="../assets/css/style.css">
    <link rel="stylesheet" href="../branding.css.php">
    <style>
        .portal-tabs { display:flex; gap:4px; border-bottom:2px solid var(--color-border); margin-bottom:20px; overflow-x:auto; }
        .portal-tab  { background:none; border:none; padding:10px 18px; font-size:14px; font-weight:600; color:var(--color-text-muted); cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-2px; white-space:nowrap; transition:color var(--transition); }
        .portal-tab.active, .portal-tab:hover { color:var(--color-primary); border-bottom-color:var(--color-primary); }
        .portal-section { display:none; } .portal-section.active { display:block; }
        .pay-summary { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:20px; }
        .pay-summary-card { flex:1; min-width:120px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--radius); padding:14px 16px; }
        .pay-summary-card__label { font-size:12px; color:var(--color-text-muted); }
        .pay-summary-card__value { font-size:20px; font-weight:700; margin-top:4px; }
        .pay-summary-card--green .pay-summary-card__value { color:var(--color-success); }
        .pay-summary-card--red   .pay-summary-card__value { color:var(--color-danger); }
        .doc-list { list-style:none; padding:0; margin:0; }
        .doc-item { display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid var(--color-border); }
        .doc-item:last-child { border-bottom:none; }
        .doc-item__icon { font-size:20px; }
        .doc-item__name { flex:1; font-size:14px; font-weight:500; }
        .doc-item__date { font-size:12px; color:var(--color-text-muted); }
        .maintenance-form .form-group { margin-bottom:14px; }
        .request-type-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:8px; margin-bottom:16px; }
        .request-type-btn { border:2px solid var(--color-border); background:none; border-radius:var(--radius); padding:10px; font-size:13px; cursor:pointer; text-align:center; transition:all var(--transition); }
        .request-type-btn.selected { border-color:var(--color-primary); background:var(--color-primary-light); color:var(--color-primary); font-weight:600; }
    </style>
</head>
<body>
    <div class="sidebar-backdrop" id="tenant-sidebar-backdrop" hidden aria-hidden="true"></div>
    <div class="app-layout tenant-layout">
        <aside class="sidebar" id="tenant-sidebar">
            <div class="sidebar-header">
                <div class="logo">
                    <?php if ($branding['logo_path']): ?>
                        <img src="../<?= tEsc($branding['logo_path']) ?>" alt="Logo" class="logo-img" style="max-height:36px;max-width:120px">
                    <?php else: ?>
                        <span class="logo-icon">🏠</span>
                    <?php endif; ?>
                    <span class="logo-text"><?= tEsc($branding['agency_name']) ?></span>
                </div>
            </div>
            <nav class="sidebar-nav">
                <ul>
                    <li><a href="#immobile" class="nav-link portal-nav-link active" data-section="immobile"><span class="nav-icon">🏢</span><span class="nav-label">Il mio immobile</span></a></li>
                    <li><a href="#pagamenti" class="nav-link portal-nav-link" data-section="pagamenti"><span class="nav-icon">💶</span><span class="nav-label">Pagamenti</span></a></li>
                    <li><a href="#documenti" class="nav-link portal-nav-link" data-section="documenti"><span class="nav-icon">📄</span><span class="nav-label">Documenti</span></a></li>
                    <li><a href="#assistenza" class="nav-link portal-nav-link" data-section="assistenza"><span class="nav-icon">🛠️</span><span class="nav-label">Assistenza</span></a></li>
                </ul>
            </nav>
            <div class="sidebar-footer">
                <div class="user-info">
                    <span class="user-avatar"><?= strtoupper(substr($name, 0, 1)) ?></span>
                    <span class="user-name"><?= tEsc($name) ?></span>
                </div>
                <a href="logout.php" class="btn btn--ghost btn--sm" style="margin-top:10px;width:100%">Esci</a>
            </div>
        </aside>

        <div class="main-wrapper">
            <header class="topbar">
                <button class="sidebar-toggle" id="tenant-sidebar-toggle" aria-label="Menu"><span></span><span></span><span></span></button>
                <h1 class="page-title" id="portal-page-title">Il mio immobile</h1>
            </header>

            <main class="app-content">
                <!-- ── TAB: Immobile ───────────────────────────────────── -->
                <div class="portal-section active" id="section-immobile">
                    <div class="tenant-cards">
                        <div class="card">
                            <h2 style="font-size:18px;margin-bottom:4px"><?= tEsc($tenant['address']) ?></h2>
                            <p class="text-muted" style="margin:0"><?= tEsc($tenant['city']) ?><?= $tenant['cap'] ? ' · CAP ' . tEsc($tenant['cap']) : '' ?></p>
                            <div class="tenant-info-grid" style="margin-top:16px">
                                <div class="tenant-info-item">
                                    <span class="tenant-info-item__label">Superficie</span>
                                    <span class="tenant-info-item__value"><?= tEsc($tenant['sqm'] ?? '—') ?> mq</span>
                                </div>
                                <div class="tenant-info-item">
                                    <span class="tenant-info-item__label">Locali</span>
                                    <span class="tenant-info-item__value"><?= tEsc($tenant['rooms'] ?? '—') ?></span>
                                </div>
                                <div class="tenant-info-item">
                                    <span class="tenant-info-item__label">Canone mensile</span>
                                    <span class="tenant-info-item__value">€ <?= number_format((float)($tenant['monthly_rent'] ?? 0), 2, ',', '.') ?></span>
                                </div>
                                <div class="tenant-info-item">
                                    <span class="tenant-info-item__label">Contratto</span>
                                    <span class="tenant-info-item__value">
                                        <?= $tenant['lease_start'] ? date('d/m/Y', strtotime($tenant['lease_start'])) : '—' ?>
                                        <?= $tenant['lease_end'] ? ' → ' . date('d/m/Y', strtotime($tenant['lease_end'])) : '' ?>
                                    </span>
                                </div>
                            </div>
                            <?php if ($tenant['description']): ?>
                                <p style="margin-top:16px;line-height:1.6;color:var(--color-text-muted)"><?= nl2br(tEsc($tenant['description'])) ?></p>
                            <?php endif; ?>
                        </div>

                        <?php if (!empty($upcoming)): ?>
                        <div class="card" style="border-color:#fecaca;background:#fff8f8">
                            <h3 style="font-size:15px;margin-bottom:12px">⚠️ Prossime scadenze</h3>
                            <ul style="list-style:none;padding:0;margin:0">
                                <?php foreach ($upcoming as $u): ?>
                                <li style="padding:8px 0;border-bottom:1px solid var(--color-border);display:flex;align-items:center;justify-content:space-between">
                                    <span><strong>€ <?= number_format((float)$u['amount'], 2, ',', '.') ?></strong> — <?= date('d/m/Y', strtotime($u['due_date'])) ?></span>
                                    <span class="badge badge--<?= $u['status'] === 'late' ? 'danger' : 'muted' ?>"><?= tEsc($PAY_STATUS[$u['status']] ?? $u['status']) ?></span>
                                </li>
                                <?php endforeach; ?>
                            </ul>
                        </div>
                        <?php endif; ?>

                        <?php if ($agencyPhone || $agencyEmail): ?>
                        <div class="card" style="background:var(--color-primary-light)">
                            <p style="margin:0;font-size:14px;font-weight:600">Contatti dell'agenzia</p>
                            <?php if ($agencyPhone): ?><p style="margin:4px 0 0;font-size:14px">📞 <?= tEsc($agencyPhone) ?></p><?php endif; ?>
                            <?php if ($agencyEmail): ?><p style="margin:4px 0 0;font-size:14px">✉️ <a href="mailto:<?= tEsc($agencyEmail) ?>"><?= tEsc($agencyEmail) ?></a></p><?php endif; ?>
                        </div>
                        <?php endif; ?>
                    </div>
                </div>

                <!-- ── TAB: Pagamenti ──────────────────────────────────── -->
                <div class="portal-section" id="section-pagamenti">
                    <div class="pay-summary">
                        <div class="pay-summary-card pay-summary-card--green">
                            <div class="pay-summary-card__label">Totale pagato</div>
                            <div class="pay-summary-card__value">€ <?= number_format($paidTotal, 0, ',', '.') ?></div>
                        </div>
                        <?php if ($lateTotal > 0): ?>
                        <div class="pay-summary-card pay-summary-card--red">
                            <div class="pay-summary-card__label">In ritardo</div>
                            <div class="pay-summary-card__value">€ <?= number_format($lateTotal, 0, ',', '.') ?></div>
                        </div>
                        <?php endif; ?>
                        <div class="pay-summary-card">
                            <div class="pay-summary-card__label">Canone mensile</div>
                            <div class="pay-summary-card__value">€ <?= number_format((float)($tenant['monthly_rent'] ?? 0), 0, ',', '.') ?></div>
                        </div>
                    </div>

                    <div class="card">
                        <h3 style="font-size:15px;margin-bottom:12px">Storico pagamenti</h3>
                        <?php if (empty($payments)): ?>
                            <p class="text-muted">Nessun pagamento registrato.</p>
                        <?php else: ?>
                        <div class="table-responsive">
                            <table class="data-table" style="width:100%;font-size:14px">
                                <thead>
                                    <tr><th>Scadenza</th><th>Importo</th><th>Stato</th><th>Pagato il</th><th>Note</th></tr>
                                </thead>
                                <tbody>
                                    <?php foreach ($payments as $pay): ?>
                                    <tr>
                                        <td><?= date('d/m/Y', strtotime($pay['due_date'])) ?></td>
                                        <td><strong>€ <?= number_format((float)$pay['amount'], 2, ',', '.') ?></strong></td>
                                        <td>
                                            <span class="badge badge--<?= $pay['status'] === 'paid' ? 'success' : ($pay['status'] === 'late' ? 'danger' : 'muted') ?>">
                                                <?= tEsc($PAY_STATUS[$pay['status']] ?? $pay['status']) ?>
                                            </span>
                                        </td>
                                        <td><?= $pay['paid_date'] ? date('d/m/Y', strtotime($pay['paid_date'])) : '—' ?></td>
                                        <td class="text-muted" style="font-size:12px"><?= tEsc($pay['notes'] ?? '') ?></td>
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
                        <h3 style="font-size:15px;margin-bottom:12px">I miei documenti</h3>
                        <?php if (empty($documents)): ?>
                            <p class="text-muted">Nessun documento disponibile.</p>
                        <?php else: ?>
                        <ul class="doc-list">
                            <?php foreach ($documents as $d): ?>
                            <li class="doc-item">
                                <span class="doc-item__icon">
                                    <?php
                                    $ext = strtolower(pathinfo($d['original_name'] ?? '', PATHINFO_EXTENSION));
                                    echo match($ext) {
                                        'pdf' => '📕', 'doc','docx' => '📘', 'xls','xlsx' => '📗',
                                        'jpg','jpeg','png','webp' => '🖼️', default => '📄'
                                    };
                                    ?>
                                </span>
                                <div class="doc-item__name">
                                    <?= tEsc($d['title'] ?: $d['original_name']) ?>
                                    <?php if ($d['original_name'] && $d['title']): ?>
                                        <small class="text-muted"> (<?= tEsc($d['original_name']) ?>)</small>
                                    <?php endif; ?>
                                </div>
                                <span class="doc-item__date"><?= date('d/m/Y', strtotime($d['created_at'])) ?></span>
                                <a href="../api/download_document.php?id=<?= (int)$d['id'] ?>" class="btn btn--sm btn--ghost" target="_blank" title="Scarica">⬇️</a>
                            </li>
                            <?php endforeach; ?>
                        </ul>
                        <?php endif; ?>
                    </div>
                </div>

                <!-- ── TAB: Assistenza ─────────────────────────────────── -->
                <div class="portal-section" id="section-assistenza">
                    <div class="card">
                        <h3 style="font-size:15px;margin-bottom:4px">Invia una richiesta</h3>
                        <p class="text-muted" style="margin:0 0 16px">Segnala un problema, richiedi un documento o contatta l'agenzia.</p>

                        <div id="maintenance-alert" class="alert" style="display:none;margin-bottom:16px"></div>

                        <div class="request-type-grid">
                            <button type="button" class="request-type-btn selected" data-type="maintenance">🔧 Manutenzione</button>
                            <button type="button" class="request-type-btn" data-type="document">📄 Richiesta documento</button>
                            <button type="button" class="request-type-btn" data-type="info">ℹ️ Informazioni</button>
                            <button type="button" class="request-type-btn" data-type="other">💬 Altro</button>
                        </div>

                        <form class="maintenance-form" id="maintenance-form">
                            <input type="hidden" id="req-type" value="maintenance">
                            <div class="form-group">
                                <label>Oggetto *</label>
                                <input type="text" id="req-subject" class="form-input" placeholder="Es. Perdita d'acqua, richiesta attestato…" required>
                            </div>
                            <div class="form-group">
                                <label>Messaggio *</label>
                                <textarea id="req-message" class="form-textarea" rows="5" placeholder="Descrivi il problema o la richiesta in dettaglio…" required></textarea>
                            </div>
                            <button type="submit" class="btn btn--primary" id="btn-send-request">Invia richiesta</button>
                        </form>
                    </div>

                    <?php if ($agencyPhone || $agencyEmail): ?>
                    <div class="card" style="margin-top:16px">
                        <h3 style="font-size:15px;margin-bottom:8px">Contatti diretti</h3>
                        <?php if ($agencyPhone): ?>
                        <p style="margin:4px 0;font-size:14px">📞 <a href="tel:<?= tEsc($agencyPhone) ?>"><?= tEsc($agencyPhone) ?></a></p>
                        <?php endif; ?>
                        <?php if ($agencyEmail): ?>
                        <p style="margin:4px 0;font-size:14px">✉️ <a href="mailto:<?= tEsc($agencyEmail) ?>"><?= tEsc($agencyEmail) ?></a></p>
                        <?php endif; ?>
                    </div>
                    <?php endif; ?>
                </div>
            </main>
        </div>
    </div>

    <script>
    (function () {
        // Sidebar toggle
        const sidebar  = document.getElementById('tenant-sidebar');
        const toggle   = document.getElementById('tenant-sidebar-toggle');
        const backdrop = document.getElementById('tenant-sidebar-backdrop');
        const pageTitle = document.getElementById('portal-page-title');

        const sectionTitles = {
            immobile:  'Il mio immobile',
            pagamenti: 'Pagamenti',
            documenti: 'Documenti',
            assistenza: 'Assistenza',
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

        // Tab switching
        function showSection(key) {
            document.querySelectorAll('.portal-section').forEach(s => s.classList.remove('active'));
            document.querySelectorAll('.portal-nav-link').forEach(l => l.classList.remove('active'));
            const s = document.getElementById('section-' + key);
            if (s) s.classList.add('active');
            const l = document.querySelector(`.portal-nav-link[data-section="${key}"]`);
            if (l) l.classList.add('active');
            if (pageTitle) pageTitle.textContent = sectionTitles[key] || key;
            closeSidebar();
        }

        document.querySelectorAll('.portal-nav-link').forEach(link => {
            link.addEventListener('click', e => {
                e.preventDefault();
                showSection(link.dataset.section);
            });
        });

        // Request type selector
        let selectedType = 'maintenance';
        document.querySelectorAll('.request-type-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.request-type-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                selectedType = btn.dataset.type;
                document.getElementById('req-type').value = selectedType;
            });
        });

        // Maintenance form submit
        document.getElementById('maintenance-form').addEventListener('submit', async function (e) {
            e.preventDefault();
            const alertEl = document.getElementById('maintenance-alert');
            const btn     = document.getElementById('btn-send-request');
            const subject = document.getElementById('req-subject').value.trim();
            const message = document.getElementById('req-message').value.trim();

            btn.disabled = true;
            btn.textContent = 'Invio in corso…';

            try {
                const res  = await fetch('api_maintenance.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': '<?= $csrfToken ?>' },
                    body: JSON.stringify({ subject, message, type: selectedType }),
                });
                const json = await res.json();
                alertEl.className = 'alert alert--' + (json.success ? 'success' : 'error');
                alertEl.textContent = json.success ? json.data.message : (json.error || 'Errore.');
                alertEl.style.display = 'block';
                if (json.success) {
                    this.reset();
                    document.querySelectorAll('.request-type-btn').forEach(b => b.classList.remove('selected'));
                    document.querySelector('.request-type-btn[data-type="maintenance"]').classList.add('selected');
                    selectedType = 'maintenance';
                }
            } catch (err) {
                alertEl.className = 'alert alert--error';
                alertEl.textContent = 'Errore di rete. Riprova.';
                alertEl.style.display = 'block';
            } finally {
                btn.disabled = false;
                btn.textContent = 'Invia richiesta';
            }
        });


        // NOTE: the tenant-facing "Paga online" button was removed. It POSTed to
        // api/stripe_checkout.php, which requires an ADMIN session, so a tenant
        // click always failed with 401 — a dead payment UI. Re-enabling online
        // rent payment needs a dedicated tenant-authenticated checkout endpoint
        // (create a Stripe Checkout Session scoped to the tenant's own payment),
        // not the admin endpoint. Tracked as future work.

        <?php if (isset($_GET['paid'])): ?>
        (function () {
            const msg = document.createElement('div');
            msg.className = 'alert alert--success';
            msg.textContent = '✅ Pagamento ricevuto con successo. Grazie!';
            msg.style.cssText = 'position:fixed;top:16px;right:16px;z-index:9999;max-width:320px';
            document.body.appendChild(msg);
            setTimeout(() => msg.remove(), 6000);
        })();
        <?php endif; ?>
    })();
    </script>
    <script src="../assets/js/cookie_consent.js"></script>
</body>
</html>
