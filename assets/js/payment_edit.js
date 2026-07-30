/**
 * Payment (pagamento) create / edit — dedicated page (replaces the old modal).
 * viewParams: { paymentId } for edit; { tenantId } to preselect on create.
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

    function backTarget() {
        if (vp.tenantId) return ['tenant_profile', { tenantId: vp.tenantId }];
        return ['payments', {}];
    }
    function goBack() { if (window.App) { const [v, p] = backTarget(); window.App.navigateTo(v, p); } }
    function leave()  { if (window.App) { const [v, p] = backTarget(); window.App.back(v, p); } }

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
        // tenants.php resolves each tenant's current contract (see currentContractJoinSql)
        // and already returns monthly_rent + lease dates alongside property/contract —
        // carry them onto the option so picking a tenant can prefill the whole form.
        $('pye-tenant').innerHTML = '<option value="">— Seleziona inquilino —</option>' +
            tenants.map(t => `<option value="${t.id}" data-property="${t.property_id || ''}" data-contract="${t.contract_id || ''}" data-rent="${t.monthly_rent ?? ''}" data-lease-start="${(t.lease_start || '').substring(0, 10)}" data-lease-end="${(t.lease_end || '').substring(0, 10)}">${esc(t.surname)} ${esc(t.name)}</option>`).join('');
        $('pye-property').innerHTML = '<option value="">— Seleziona immobile —</option>' +
            props.map(p => `<option value="${p.id}">${esc(p.address)}, ${esc(p.city)}</option>`).join('');
    }

    // Values written by the last autofill. Re-picking a tenant replaces them, but a
    // figure the agent typed themselves is never overwritten.
    const autofilled = { amount: null, dueDate: null };

    function ymd(d) {
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    /**
     * Next rent due date on the lease's day-of-month anchor.
     *
     * Clamps the anchor to each month's length, the same way the server-side
     * scadenzario does (contracts.php generatePayments), so a lease starting the
     * 31st lands on the 28th/30th instead of overflowing into the next month.
     * Returns '' when the lease has no start date or has already ended.
     */
    function nextDueDate(leaseStart, leaseEnd) {
        if (!leaseStart) return '';
        const start = new Date(leaseStart + 'T00:00:00');
        if (isNaN(start)) return '';

        const anchorDay = start.getDate();
        const today = new Date(); today.setHours(0, 0, 0, 0);

        // This month's occurrence; if it has already passed, take next month's.
        let y = today.getFullYear(), m = today.getMonth();
        const atMonth = (yy, mm) => new Date(yy, mm, Math.min(anchorDay, new Date(yy, mm + 1, 0).getDate()));
        let due = atMonth(y, m);
        if (due < today) due = atMonth(y, m + 1);

        if (due < start) due = start;
        if (leaseEnd) {
            const end = new Date(leaseEnd + 'T00:00:00');
            if (!isNaN(end) && due > end) return '';  // lease is over — no sensible default
        }
        return ymd(due);
    }

    function onTenantChange() {
        const opt = $('pye-tenant').selectedOptions[0];
        if (!opt) return;
        if (opt.dataset.property) $('pye-property').value = opt.dataset.property;
        $('pye-contract-id').value = opt.dataset.contract || '';

        // On an existing payment the stored figures win — never overwrite them.
        if (isEdit) return;

        const rent = opt.dataset.rent;
        if (rent && ($('pye-amount').value === '' || $('pye-amount').value === autofilled.amount)) {
            $('pye-amount').value = rent;
            autofilled.amount = rent;
        }

        const due = nextDueDate(opt.dataset.leaseStart, opt.dataset.leaseEnd);
        if (due && ($('pye-due-date').value === '' || $('pye-due-date').value === autofilled.dueDate)) {
            $('pye-due-date').value = due;
            autofilled.dueDate = due;
        }
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
        $('pye-cancel').addEventListener('click', leave);
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
            if (vp.tenantId) { $('pye-tenant').value = String(vp.tenantId); onTenantChange(); }
            $('pye-tenant').focus();
        }
    }

    init();
})();
