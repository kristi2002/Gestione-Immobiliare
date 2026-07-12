/**
 * Payment (pagamento) create / edit — dedicated page (replaces the old modal).
 * viewParams: { paymentId } for edit.
 */
(function () {
    'use strict';

    const API         = 'api/payments.php';
    const TENANTS_API = 'api/tenants.php';
    const PROPS_API   = 'api/properties.php';

    const vp        = window.App?.viewParams || {};
    const paymentId = vp.paymentId || null;
    const isEdit    = !!paymentId;

    function $(id) { return document.getElementById(id); }
    function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }

    function showAlert(msg, type) {
        const el = $('pye-alert'); if (!el) return;
        el.textContent = msg; el.className = `alert alert--${type}`; el.style.display = 'block';
        clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
    }
    function showError(m) { const el = $('pye-error'); if (el) { el.textContent = m; el.style.display = 'block'; } }
    function clearError() { const el = $('pye-error'); if (el) el.style.display = 'none'; }

    function goBack() { if (window.App) window.App.navigateTo('payments'); }

    async function fetchList(url, params) {
        if (window.Pagination?.fetchList) return window.Pagination.fetchList(url, params || {});
        const qs = new URLSearchParams(params || {}); qs.set('limit', '1000');
        const j = await fetch(`${url}?${qs}`).then(r => r.json());
        return j.data?.items || j.data || [];
    }

    async function loadDropdowns() {
        const [tenants, props] = await Promise.all([
            fetchList(TENANTS_API, {}).catch(() => []),
            fetchList(PROPS_API, {}).catch(() => []),
        ]);
        $('pye-tenant').innerHTML = '<option value="">— Seleziona inquilino —</option>' +
            tenants.map(t => `<option value="${t.id}" data-property="${t.property_id || ''}" data-contract="${t.contract_id || ''}">${esc(t.surname)} ${esc(t.name)}</option>`).join('');
        $('pye-property').innerHTML = '<option value="">— Seleziona immobile —</option>' +
            props.map(p => `<option value="${p.id}">${esc(p.address)}, ${esc(p.city)}</option>`).join('');
    }

    function onTenantChange() {
        const opt = $('pye-tenant').selectedOptions[0];
        if (opt && opt.dataset.property) $('pye-property').value = opt.dataset.property;
        if (opt) $('pye-contract-id').value = opt.dataset.contract || '';
    }

    async function loadPayment() {
        const j = await fetch(`${API}?id=${paymentId}`).then(r => r.json());
        if (!j.success) throw new Error(j.error);
        const p = j.data;
        $('pye-id').value = p.id;
        $('pye-tenant').value = p.tenant_id || '';
        $('pye-property').value = p.property_id || '';
        $('pye-contract-id').value = p.contract_id || '';
        $('pye-amount').value = p.amount ?? '';
        $('pye-due-date').value = p.due_date || '';
        $('pye-paid-date').value = p.paid_date || '';
        $('pye-status').value = p.status || 'pending';
        if ($('pye-method')) $('pye-method').value = p.method || 'bonifico';
        $('pye-notes').value = p.notes || '';
    }

    function collect() {
        return {
            tenant_id:   $('pye-tenant').value,
            property_id: $('pye-property').value,
            contract_id: $('pye-contract-id').value || null,
            amount:      $('pye-amount').value,
            due_date:    $('pye-due-date').value,
            paid_date:   $('pye-paid-date').value,
            status:      $('pye-status').value,
            method:      $('pye-method') ? $('pye-method').value : 'bonifico',
            notes:       $('pye-notes').value.trim(),
        };
    }

    async function save(e) {
        e.preventDefault();
        clearError();
        const id = $('pye-id').value;
        const btn = $('pye-save');
        btn.disabled = true; btn.textContent = 'Salvataggio...';
        try {
            const res = await fetch(id ? `${API}?id=${id}` : API, {
                method: id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(collect()),
            });
            const j = await res.json();
            if (!j.success) throw new Error(j.error);
            goBack();
        } catch (err) {
            showError(err.message);
            btn.disabled = false; btn.textContent = 'Salva';
        }
    }

    async function init() {
        $('pye-back').addEventListener('click', goBack);
        $('pye-cancel').addEventListener('click', goBack);
        $('pye-form').addEventListener('submit', save);
        $('pye-tenant').addEventListener('change', onTenantChange);

        try { await loadDropdowns(); }
        catch (err) { showAlert('Errore caricamento elenchi: ' + err.message, 'error'); }

        if (isEdit) {
            $('pye-title').textContent = 'Modifica Pagamento';
            try { await loadPayment(); }
            catch (err) { showAlert('Impossibile caricare il pagamento: ' + err.message, 'error'); }
        } else {
            $('pye-title').textContent = 'Nuovo Pagamento';
            $('pye-status').value = 'pending';
            $('pye-tenant').focus();
        }
    }

    init();
})();
