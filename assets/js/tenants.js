(function () {
    'use strict';

    const API = 'api/tenants.php';
    let tenants = [];
    let currentPage = 1;
    const PAGE_LIMIT = 25;
    const els = {};
    let selectedIds = new Set();

    init();

    async function init() {
        els.pagination = document.getElementById('tenants-pagination');
        await loadTenants();
        document.getElementById('btn-new-tenant').addEventListener('click', () => {
            if (window.App) window.App.navigateTo('tenant_edit');
        });
        document.getElementById('tenant-search').addEventListener('input', debounce(() => { currentPage = 1; loadTenants(); }, 300));
        document.getElementById('tenants-select-all').addEventListener('change', e => {
            document.querySelectorAll('.tenant-checkbox').forEach(cb => {
                cb.checked = e.target.checked;
                if (e.target.checked) selectedIds.add(Number(cb.dataset.id));
                else selectedIds.delete(Number(cb.dataset.id));
            });
            updateBulkToolbar();
        });
        document.getElementById('bulk-archive-tenants').addEventListener('click', bulkArchive);
        document.getElementById('bulk-export-tenants').addEventListener('click', bulkExport);
        document.getElementById('wa-send-modal-close').addEventListener('click', closeWaModal);
        document.getElementById('wa-send-modal-cancel').addEventListener('click', closeWaModal);
        document.getElementById('wa-send-form').addEventListener('submit', sendWhatsApp);
        bindRail();
        bindRowMenu();
    }

    async function loadTenants() {
        const params = new URLSearchParams();
        const q = document.getElementById('tenant-search').value.trim();
        if (q) params.set('search', q);
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);
        const res = await fetch(`${API}?${params}`);
        const json = await res.json();
        if (!json.success) return;
        const parsed = Pagination.parseResponse(json);
        tenants = parsed.items;
        renderTable();
        Pagination.render(els.pagination, parsed, (p) => { currentPage = p; loadTenants(); });
    }

    function renderTable() {
        const tbody = document.getElementById('tenants-tbody');
        if (!tenants.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:40px 16px;">Nessun inquilino.</td></tr>';
            return;
        }
        tbody.innerHTML = tenants.map(t => {
            const checked = selectedIds.has(Number(t.id)) ? 'checked' : '';
            return `
            <tr class="tenant-row" data-id="${t.id}" style="cursor:pointer;">
                <td><input type="checkbox" class="tenant-checkbox entity-card__select" data-id="${t.id}" ${checked}></td>
                <td data-label="Nome">${esc(t.name)} ${esc(t.surname)}</td>
                <td data-label="Email">${esc(t.email)}</td>
                <td data-label="Immobile">${esc(t.property_address)}, ${esc(t.property_city)}</td>
                <td data-label="Canone">${t.monthly_rent ? '€ ' + Number(t.monthly_rent).toFixed(2) : '—'}</td>
                <td data-label="Contratto">${fmtDate(t.lease_start)} → ${fmtDate(t.lease_end)}</td>
                <td data-label="Portale">${t.has_portal_access ? '<i data-lucide="check-circle"></i>' : '—'}</td>
                <td class="lt-actions" data-label="Azioni">
                    <button class="btn btn--sm btn--ghost btn-rail" data-id="${t.id}" title="Azioni" aria-label="Azioni inquilino" aria-haspopup="menu"><i data-lucide="more-vertical"></i></button>
                </td>
            </tr>`;
        }).join('');
        tbody.querySelectorAll('.tenant-row').forEach(row => {
            row.addEventListener('click', (e) => {
                if (!e.target.closest('button, input, a')) openRail(Number(row.dataset.id));
            });
        });
        tbody.querySelectorAll('.btn-rail').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const t = tenants.find(x => x.id === Number(btn.dataset.id));
                if (t) openRowMenu(btn, t);
            });
        });
        tbody.querySelectorAll('.tenant-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                e.stopPropagation();
                if (cb.checked) selectedIds.add(Number(cb.dataset.id));
                else selectedIds.delete(Number(cb.dataset.id));
                updateBulkToolbar();
            });
            cb.addEventListener('click', (e) => e.stopPropagation());
        });
        if (window.lucide) window.lucide.createIcons();
    }

    // ── Row kebab menu (Visualizzazione completa / Modifica / WhatsApp / Archivia) ──

    let rowMenuEl = null;

    function bindRowMenu() {
        const tbody = document.getElementById('tenants-tbody');
        const gone = () => !document.body.contains(tbody);
        function cleanup() {
            closeRowMenu();
            document.removeEventListener('click', onDocClick);
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('scroll', onAnyMove, true);
            window.removeEventListener('resize', onAnyMove);
        }
        function onDocClick(e) {
            if (gone()) { cleanup(); return; }
            if (rowMenuEl && !rowMenuEl.contains(e.target)) closeRowMenu();
        }
        function onKey(e) {
            if (gone()) { cleanup(); return; }
            if (e.key === 'Escape') closeRowMenu();
        }
        function onAnyMove() {
            if (gone()) { cleanup(); return; }
            closeRowMenu();
        }
        document.addEventListener('click', onDocClick);
        document.addEventListener('keydown', onKey);
        window.addEventListener('scroll', onAnyMove, true);
        window.addEventListener('resize', onAnyMove);
    }

    function closeRowMenu() {
        if (rowMenuEl) { rowMenuEl.remove(); rowMenuEl = null; }
    }

    function openRowMenu(btn, tenant) {
        if (rowMenuEl && Number(rowMenuEl.dataset.id) === tenant.id) { closeRowMenu(); return; }
        closeRowMenu();

        const menu = document.createElement('div');
        menu.className = 'lt-menu';
        menu.dataset.id = tenant.id;
        menu.setAttribute('role', 'menu');
        menu.innerHTML = `
            <button type="button" class="lt-menu__item" data-act="view" role="menuitem">
                <i data-lucide="eye"></i> Visualizzazione completa
            </button>
            <button type="button" class="lt-menu__item" data-act="edit" role="menuitem">
                <i data-lucide="pencil"></i> Modifica
            </button>
            <button type="button" class="lt-menu__item" data-act="wa" role="menuitem" ${tenant.phone ? '' : 'disabled title="Nessun numero registrato"'}>
                <svg class="icon-brand-whatsapp" aria-hidden="true" focusable="false"><use href="#icon-whatsapp"></use></svg> Invia WhatsApp
            </button>
            <div class="lt-menu__sep"></div>
            <button type="button" class="lt-menu__item lt-menu__item--danger" data-act="archive" role="menuitem">
                <i data-lucide="archive"></i> Archivia
            </button>`;
        document.body.appendChild(menu);

        const r  = btn.getBoundingClientRect();
        const mw = menu.offsetWidth;
        const mh = menu.offsetHeight;
        let left = Math.min(r.right - mw, window.innerWidth - mw - 8);
        let top  = r.bottom + 6;
        if (top + mh > window.innerHeight - 8) top = r.top - mh - 6;
        menu.style.left = Math.max(8, left) + 'px';
        menu.style.top  = Math.max(8, top) + 'px';

        menu.querySelector('[data-act="view"]').addEventListener('click', () => {
            closeRowMenu();
            if (window.App) window.App.navigateTo('tenant_profile', { tenantId: tenant.id });
        });
        menu.querySelector('[data-act="edit"]').addEventListener('click', () => {
            closeRowMenu();
            if (window.App) window.App.navigateTo('tenant_edit', { tenantId: tenant.id });
        });
        const waBtn = menu.querySelector('[data-act="wa"]');
        if (waBtn && !waBtn.disabled) waBtn.addEventListener('click', () => { closeRowMenu(); openWaModal(tenant); });
        menu.querySelector('[data-act="archive"]').addEventListener('click', async () => {
            closeRowMenu();
            if (!await confirmDialog(`Archiviare ${tenant.name} ${tenant.surname}?`, { title: 'Archivia inquilino', confirmText: 'Archivia' })) return;
            const res = await fetch(`${API}?id=${tenant.id}`, { method: 'DELETE' });
            const json = await res.json();
            if (json.success) { closeRail(); await loadTenants(); showAlert('Inquilino archiviato.', 'success'); }
            else showAlert(json.error || 'Errore archiviazione.', 'error');
        });

        if (window.lucide) window.lucide.createIcons();
        rowMenuEl = menu;
    }

    // ── Detail rail (right-hand sidebar drawer) ──────────────────────

    let railTenantId = null;

    function bindRail() {
        const rail = document.getElementById('tenant-rail');
        if (!rail) return;
        document.getElementById('tenant-rail-close')?.addEventListener('click', closeRail);
        document.getElementById('tenant-rail-open-full')?.addEventListener('click', () => {
            const id = railTenantId;
            if (id && window.App) {
                closeRail();
                window.App.navigateTo('tenant_profile', { tenantId: id });
            }
        });
        document.addEventListener('keydown', function onEsc(e) {
            if (e.key === 'Escape' && !rail.hidden) closeRail();
            if (!document.body.contains(rail)) document.removeEventListener('keydown', onEsc);
        });
    }

    function closeRail() {
        const rail = document.getElementById('tenant-rail');
        if (rail) rail.hidden = true;
        railTenantId = null;
        document.querySelectorAll('.tenant-row.is-active').forEach(r => r.classList.remove('is-active'));
    }

    function openRail(id) {
        const t = tenants.find(x => Number(x.id) === id);
        if (!t) return;
        railTenantId = id;

        document.querySelectorAll('.tenant-row').forEach(r => r.classList.toggle('is-active', Number(r.dataset.id) === id));

        const initials = ((t.name || '')[0] || '') + ((t.surname || '')[0] || '');
        document.getElementById('tenant-rail-avatar').textContent = initials.toUpperCase();
        document.getElementById('tenant-rail-name').textContent = `${t.name} ${t.surname}`;

        const chips = [];
        if (t.property_address) chips.push(`<span class="badge"><i data-lucide="building-2"></i> ${esc(t.property_address)}</span>`);
        if (t.has_portal_access) chips.push('<span class="badge badge--active">Accesso portale</span>');
        document.getElementById('tenant-rail-chips').innerHTML = chips.join('');

        const contacts = [];
        if (t.phone) contacts.push(`<div class="rail-doc"><i data-lucide="phone"></i> <a href="tel:${esc(t.phone)}">${esc(t.phone)}</a></div>`);
        if (t.email) contacts.push(`<div class="rail-doc"><i data-lucide="mail"></i> <a href="mailto:${esc(t.email)}">${esc(t.email)}</a></div>`);
        if (t.codice_fiscale) contacts.push(`<div class="rail-doc"><i data-lucide="id-card"></i> ${esc(t.codice_fiscale)}</div>`);
        document.getElementById('tenant-rail-contacts').innerHTML = contacts.join('') || '<p class="text-muted detail-rail__empty">—</p>';

        const propsEl = document.getElementById('tenant-rail-props');
        if (t.property_address) {
            const rent = t.monthly_rent ? `€ ${Number(t.monthly_rent).toLocaleString('it-IT')}/mese` : '';
            const period = [fmtDate(t.lease_start), fmtDate(t.lease_end)].filter(d => d !== '—').join(' → ');
            propsEl.innerHTML = `
                <div class="rail-prop" data-prop-id="${t.property_id || ''}" style="cursor:${t.property_id ? 'pointer' : 'default'};">
                    <div class="rail-prop__img"><i data-lucide="building-2"></i></div>
                    <div class="rail-prop__txt">
                        <b>${esc(t.property_address)}, ${esc(t.property_city || '')}</b>
                        <span>${[rent, period].filter(Boolean).join(' · ')}</span>
                    </div>
                </div>`;
            const propEl = propsEl.querySelector('[data-prop-id]');
            if (propEl && t.property_id) {
                propEl.addEventListener('click', () => {
                    closeRail();
                    if (window.App) window.App.navigateTo('property_profile', { propertyId: Number(t.property_id) });
                });
            }
        } else {
            propsEl.innerHTML = '<p class="text-muted detail-rail__empty">Nessuna locazione attiva.</p>';
        }

        document.getElementById('tenant-rail').hidden = false;
        if (window.lucide) window.lucide.createIcons();
    }

    function updateBulkToolbar() {
        const toolbar = document.getElementById('tenants-bulk-toolbar');
        const count = document.getElementById('tenants-bulk-count');
        toolbar.hidden = selectedIds.size === 0;
        count.textContent = selectedIds.size + ' selezionat' + (selectedIds.size === 1 ? 'o' : 'i');
    }

    async function bulkArchive() {
        if (!selectedIds.size) return;
        if (!await confirmDialog(`Vuoi archiviare ${selectedIds.size} inquilin${selectedIds.size === 1 ? 'o' : 'i'}?`, { title: 'Archivia inquilini', confirmText: 'Archivia' })) return;
        await Promise.all([...selectedIds].map(id =>
            fetch(`${API}?id=${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } })
        ));
        selectedIds.clear();
        updateBulkToolbar();
        await loadTenants();
        showAlert('Inquilini archiviati.', 'success');
    }

    function bulkExport() {
        if (!selectedIds.size) return;
        const ids = [...selectedIds];
        const rows = tenants.filter(t => ids.includes(Number(t.id)));
        const header = 'Nome,Cognome,Email,Telefono,Indirizzo,Canone,Inizio contratto,Fine contratto';
        const csv = [header, ...rows.map(t =>
            [t.name, t.surname, t.email, t.phone || '',
             `${t.property_address} ${t.property_city}`,
             t.monthly_rent || '', t.lease_start || '', t.lease_end || '']
            .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
        )].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'inquilini.csv'; a.click();
        URL.revokeObjectURL(url);
    }

    function openWaModal(tenant) {
        document.getElementById('wa-send-modal').hidden = false;
        document.getElementById('wa-send-tenant-id').value = tenant.id;
        document.getElementById('wa-send-phone').value = tenant.phone || '';
        document.getElementById('wa-send-message').value =
            `Gentile ${tenant.name} ${tenant.surname},\n\n`;
    }

    function closeWaModal() {
        document.getElementById('wa-send-modal').hidden = true;
    }

    async function sendWhatsApp(e) {
        e.preventDefault();
        const tenantId = document.getElementById('wa-send-tenant-id').value;
        const phone = document.getElementById('wa-send-phone').value.trim();
        const message = document.getElementById('wa-send-message').value.trim();
        const res = await fetch('api/whatsapp_send.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, message, tenant_id: parseInt(tenantId, 10) }),
        });
        const json = await res.json();
        if (json.success) {
            closeWaModal();
            showAlert('Messaggio WhatsApp inviato.', 'success');
        } else {
            showAlert(json.error || 'Errore invio WhatsApp.', 'error');
        }
    }

    function showAlert(msg, type) {
        const el = document.getElementById('tenants-alert');
        el.textContent = msg;
        el.className = 'alert alert--' + type;
        el.style.display = 'block';
    }

    function fmtDate(d) { return window.Fmt.date(d); }
    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
    function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
})();
