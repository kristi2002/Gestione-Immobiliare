/**
 * Tenant (inquilino) create / edit — dedicated page (replaces the old modal).
 * viewParams: { tenantId } for edit.
 */
(function () {
    'use strict';

    const API      = 'api/tenants.php';
    const PROP_API = 'api/properties.php';
    const PDF_API  = 'api/generate_pdf.php';

    const vp       = window.App?.viewParams || {};
    const tenantId = vp.tenantId || null;
    const isEdit   = !!tenantId;
    let properties = [];

    function $(id) { return document.getElementById(id); }
    function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }

    function showAlert(msg, type) {
        const el = $('tne-alert'); if (!el) return;
        el.textContent = msg; el.className = `alert alert--${type}`; el.style.display = 'block';
        clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
    }
    function showError(m) { const el = $('tne-error'); if (el) { el.textContent = m; el.style.display = 'block'; } }
    function clearError() { const el = $('tne-error'); if (el) el.style.display = 'none'; }

    function goBack() { if (window.App) window.App.navigateTo('tenants'); }

    async function loadProperties() {
        const j = await fetch(`${PROP_API}?limit=500&page=1`).then(r => r.json());
        if (j.success) {
            properties = (window.Pagination ? window.Pagination.parseResponse(j).items : (j.data?.items || j.data || []))
                .filter(p => p.status !== 'archived');
            $('tne-property').innerHTML = '<option value="">— Seleziona —</option>' +
                properties.map(p => `<option value="${p.id}">${esc(p.address)}, ${esc(p.city)}</option>`).join('');
        }
    }

    async function loadTenant() {
        const j = await fetch(`${API}?id=${tenantId}`).then(r => r.json());
        if (!j.success) throw new Error(j.error);
        const t = j.data;
        $('tne-id').value = t.id;
        $('tne-name').value = t.name || '';
        $('tne-surname').value = t.surname || '';
        $('tne-email').value = t.email || '';
        $('tne-phone').value = t.phone || '';
        $('tne-property').value = t.property_id || '';
        $('tne-lease-start').value = t.lease_start || '';
        $('tne-lease-end').value = t.lease_end || '';
        $('tne-rent').value = t.monthly_rent || '';
        $('tne-notes').value = t.notes || '';
        if ($('tne-iban')) $('tne-iban').value = t.iban || '';
        if ($('tne-sdd-ref')) $('tne-sdd-ref').value = t.sdd_mandate_ref || '';
        if ($('tne-sdd-date')) $('tne-sdd-date').value = t.sdd_mandate_date ? String(t.sdd_mandate_date).substring(0, 10) : '';
    }

    async function save(e) {
        e.preventDefault();
        clearError();
        const id = $('tne-id').value;
        const payload = {
            name:            $('tne-name').value,
            surname:         $('tne-surname').value,
            email:           $('tne-email').value,
            phone:           $('tne-phone').value,
            property_id:     $('tne-property').value,
            lease_start:     $('tne-lease-start').value || null,
            lease_end:       $('tne-lease-end').value || null,
            monthly_rent:    $('tne-rent').value || null,
            notes:           $('tne-notes').value,
            iban:            $('tne-iban') ? $('tne-iban').value.trim() : '',
            sdd_mandate_ref: $('tne-sdd-ref') ? $('tne-sdd-ref').value.trim() : '',
            sdd_mandate_date:$('tne-sdd-date') ? ($('tne-sdd-date').value || null) : null,
            portal_password: $('tne-portal-pass').value,
        };
        const btn = $('tne-save');
        btn.disabled = true; btn.textContent = 'Salvataggio...';
        try {
            const res = await fetch(id ? `${API}?id=${id}` : API, {
                method: id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const j = await res.json();
            if (!j.success) throw new Error(j.error);
            goBack();
        } catch (err) {
            showError(err.message);
            btn.disabled = false; btn.textContent = 'Salva';
        }
    }

    async function generatePdf() {
        const propertyId = $('tne-property').value;
        if (!propertyId) { showAlert('Seleziona un immobile.', 'error'); return; }
        const prop = properties.find(p => p.id == propertyId);
        const payload = {
            type: 'contract',
            property_id: parseInt(propertyId, 10),
            client_id: prop?.client_id,
            tenant_id: $('tne-id').value || null,
            tenant_name: $('tne-name').value + ' ' + $('tne-surname').value,
            tenant_email: $('tne-email').value,
            monthly_rent: $('tne-rent').value,
            lease_start: $('tne-lease-start').value,
            lease_end: $('tne-lease-end').value,
        };
        try {
            const j = await fetch(PDF_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json());
            if (j.success) { window.open(j.data.download, '_blank'); showAlert('Contratto PDF generato.', 'success'); }
            else showAlert(j.error || 'Errore generazione PDF', 'error');
        } catch (err) { showAlert(err.message, 'error'); }
    }

    async function init() {
        $('tne-back').addEventListener('click', goBack);
        $('tne-cancel').addEventListener('click', goBack);
        $('tne-form').addEventListener('submit', save);
        $('tne-pdf').addEventListener('click', generatePdf);

        try { await loadProperties(); }
        catch (err) { showAlert('Errore caricamento immobili: ' + err.message, 'error'); }

        if (isEdit) {
            $('tne-title').textContent = 'Modifica inquilino';
            try { await loadTenant(); }
            catch (err) { showAlert('Impossibile caricare l\'inquilino: ' + err.message, 'error'); }
        } else {
            $('tne-title').textContent = 'Nuovo inquilino';
            $('tne-name').focus();
        }
    }

    init();
})();
