(function () {
    'use strict';

    const API = 'api/tenants.php';
    const PROP_API = 'api/properties.php';
    const PDF_API = 'api/generate_pdf.php';
    let tenants = [];
    let properties = [];

    init();

    async function init() {
        await loadProperties();
        await loadTenants();
        document.getElementById('btn-new-tenant').addEventListener('click', () => openModal());
        document.getElementById('tenant-modal-close').addEventListener('click', closeModal);
        document.getElementById('tenant-modal-cancel').addEventListener('click', closeModal);
        document.getElementById('tenant-form').addEventListener('submit', saveTenant);
        document.getElementById('btn-pdf-contract').addEventListener('click', generateContract);
        document.getElementById('tenant-search').addEventListener('input', debounce(loadTenants, 300));
    }

    async function loadProperties() {
        const res = await fetch(PROP_API);
        const json = await res.json();
        if (json.success) {
            properties = json.data.filter(p => p.status !== 'archived');
            const sel = document.getElementById('tenant-property');
            sel.innerHTML = '<option value="">— Seleziona —</option>' +
                properties.map(p => `<option value="${p.id}">${esc(p.address)}, ${esc(p.city)}</option>`).join('');
        }
    }

    async function loadTenants() {
        const q = document.getElementById('tenant-search').value.trim();
        const res = await fetch(API + (q ? '?search=' + encodeURIComponent(q) : ''));
        const json = await res.json();
        if (!json.success) return;
        tenants = json.data;
        renderTable();
    }

    function renderTable() {
        const tbody = document.getElementById('tenants-tbody');
        if (!tenants.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-muted">Nessun inquilino.</td></tr>';
            return;
        }
        tbody.innerHTML = tenants.map(t => `
            <tr>
                <td data-label="Nome">${esc(t.name)} ${esc(t.surname)}</td>
                <td data-label="Email">${esc(t.email)}</td>
                <td data-label="Immobile">${esc(t.property_address)}, ${esc(t.property_city)}</td>
                <td data-label="Canone">${t.monthly_rent ? '€ ' + Number(t.monthly_rent).toFixed(2) : '—'}</td>
                <td data-label="Contratto">${fmtDate(t.lease_start)} → ${fmtDate(t.lease_end)}</td>
                <td data-label="Portale">${t.has_portal_access ? '✅' : '—'}</td>
                <td class="col-actions" data-label="Azioni"><button class="btn btn--sm btn--ghost" data-edit="${t.id}">✏️</button></td>
            </tr>`).join('');
        tbody.querySelectorAll('[data-edit]').forEach(btn => {
            btn.addEventListener('click', () => openModal(tenants.find(x => x.id == btn.dataset.edit)));
        });
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
