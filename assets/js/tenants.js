(function () {
    'use strict';

    const API = 'api/tenants.php';
    const PROP_API = 'api/properties.php';
    const PDF_API = 'api/generate_pdf.php';
    let tenants = [];
    let properties = [];
    let currentPage = 1;
    const PAGE_LIMIT = 25;
    const els = {};
    let selectedIds = new Set();

    init();

    async function init() {
        els.pagination = document.getElementById('tenants-pagination');
        await loadProperties();
        await loadTenants();
        document.getElementById('btn-new-tenant').addEventListener('click', () => openModal());
        document.getElementById('tenant-modal-close').addEventListener('click', closeModal);
        document.getElementById('tenant-modal-cancel').addEventListener('click', closeModal);
        document.getElementById('tenant-form').addEventListener('submit', saveTenant);
        document.getElementById('btn-pdf-contract').addEventListener('click', generateContract);
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
    }

    async function loadProperties() {
        const res = await fetch(`${PROP_API}?limit=500&page=1`);
        const json = await res.json();
        if (json.success) {
            properties = Pagination.parseResponse(json).items.filter(p => p.status !== 'archived');
            const sel = document.getElementById('tenant-property');
            sel.innerHTML = '<option value="">— Seleziona —</option>' +
                properties.map(p => `<option value="${p.id}">${esc(p.address)}, ${esc(p.city)}</option>`).join('');
        }
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
            <tr>
                <td><input type="checkbox" class="tenant-checkbox entity-card__select" data-id="${t.id}" ${checked}></td>
                <td data-label="Nome">${esc(t.name)} ${esc(t.surname)}</td>
                <td data-label="Email">${esc(t.email)}</td>
                <td data-label="Immobile">${esc(t.property_address)}, ${esc(t.property_city)}</td>
                <td data-label="Canone">${t.monthly_rent ? '€ ' + Number(t.monthly_rent).toFixed(2) : '—'}</td>
                <td data-label="Contratto">${fmtDate(t.lease_start)} → ${fmtDate(t.lease_end)}</td>
                <td data-label="Portale">${t.has_portal_access ? '✅' : '—'}</td>
                <td class="col-actions" data-label="Azioni">
                    <button class="btn btn--sm btn--ghost" data-edit="${t.id}">✏️</button>
                    <button class="btn btn--sm btn--ghost" data-wa="${t.id}" title="Invia WhatsApp">📱</button>
                </td>
            </tr>`;
        }).join('');
        tbody.querySelectorAll('[data-edit]').forEach(btn => {
            btn.addEventListener('click', () => openModal(tenants.find(x => x.id == btn.dataset.edit)));
        });
        tbody.querySelectorAll('[data-wa]').forEach(btn => {
            btn.addEventListener('click', () => {
                const t = tenants.find(x => x.id == btn.dataset.wa);
                if (t) openWaModal(t);
            });
        });
        tbody.querySelectorAll('.tenant-checkbox').forEach(cb => {
            cb.addEventListener('change', () => {
                if (cb.checked) selectedIds.add(Number(cb.dataset.id));
                else selectedIds.delete(Number(cb.dataset.id));
                updateBulkToolbar();
            });
        });
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

    function openModal(tenant = null) {
        document.getElementById('tenant-modal').hidden = false;
        document.getElementById('tenant-id').value = tenant?.id || '';
        document.getElementById('tenant-name').value = tenant?.name || '';
        document.getElementById('tenant-surname').value = tenant?.surname || '';
        document.getElementById('tenant-email').value = tenant?.email || '';
        document.getElementById('tenant-phone').value = tenant?.phone || '';
        document.getElementById('tenant-property').value = tenant?.property_id || '';
        document.getElementById('tenant-lease-start').value = tenant?.lease_start || '';
        document.getElementById('tenant-lease-end').value = tenant?.lease_end || '';
        document.getElementById('tenant-rent').value = tenant?.monthly_rent || '';
        document.getElementById('tenant-notes').value = tenant?.notes || '';
        document.getElementById('tenant-portal-pass').value = '';
        document.getElementById('tenant-modal-title').textContent = tenant ? 'Modifica inquilino' : 'Nuovo inquilino';
    }

    function closeModal() {
        document.getElementById('tenant-modal').hidden = true;
    }

    async function saveTenant(e) {
        e.preventDefault();
        const id = document.getElementById('tenant-id').value;
        const payload = {
            name: document.getElementById('tenant-name').value,
            surname: document.getElementById('tenant-surname').value,
            email: document.getElementById('tenant-email').value,
            phone: document.getElementById('tenant-phone').value,
            property_id: document.getElementById('tenant-property').value,
            lease_start: document.getElementById('tenant-lease-start').value || null,
            lease_end: document.getElementById('tenant-lease-end').value || null,
            monthly_rent: document.getElementById('tenant-rent').value || null,
            notes: document.getElementById('tenant-notes').value,
            portal_password: document.getElementById('tenant-portal-pass').value,
        };
        const url = id ? `${API}?id=${id}` : API;
        const res = await fetch(url, {
            method: id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (json.success) {
            closeModal();
            await loadTenants();
            showAlert('Inquilino salvato.', 'success');
        } else {
            showAlert(json.error, 'error');
        }
    }

    async function generateContract() {
        const propertyId = document.getElementById('tenant-property').value;
        const prop = properties.find(p => p.id == propertyId);
        const payload = {
            type: 'contract',
            property_id: parseInt(propertyId, 10),
            client_id: prop?.client_id,
            tenant_id: document.getElementById('tenant-id').value || null,
            tenant_name: document.getElementById('tenant-name').value + ' ' + document.getElementById('tenant-surname').value,
            tenant_email: document.getElementById('tenant-email').value,
            monthly_rent: document.getElementById('tenant-rent').value,
            lease_start: document.getElementById('tenant-lease-start').value,
            lease_end: document.getElementById('tenant-lease-end').value,
        };
        const res = await fetch(PDF_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (json.success) {
            window.open(json.data.download, '_blank');
            showAlert('Contratto PDF generato.', 'success');
        } else {
            showAlert(json.error, 'error');
        }
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

    function fmtDate(d) { return d ? new Date(d).toLocaleDateString('it-IT') : '—'; }
    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
    function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
})();
