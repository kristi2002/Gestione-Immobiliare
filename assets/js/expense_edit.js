/**
 * Expense (spesa) create / edit — dedicated page (replaces the old modal).
 * viewParams: { expenseId } for edit; { propertyId } / { clientId } to preselect on create.
 */
(function () {
    'use strict';

    const API           = 'api/expenses.php';
    const PROPS_API     = 'api/properties.php';
    const CLIENTS_API   = 'api/clients.php';
    const SUPPLIERS_API = 'api/suppliers.php';

    const vp        = window.App?.viewParams || {};
    const expenseId = vp.expenseId || null;
    const isEdit    = !!expenseId;

    function $(id) { return document.getElementById(id); }
    function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }

    function showAlert(msg, type) {
        const el = $('exe-alert'); if (!el) return;
        el.textContent = msg; el.className = `alert alert--${type}`; el.style.display = 'block';
        clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
    }
    function showError(m) { const el = $('exe-error'); if (el) { el.textContent = m; el.style.display = 'block'; } }
    function clearError() { const el = $('exe-error'); if (el) el.style.display = 'none'; }

    function goBack() {
        if (!window.App) return;
        if (vp.propertyId) window.App.navigateTo('property_profile', { propertyId: vp.propertyId });
        else if (vp.clientId) window.App.navigateTo('client_profile', { clientId: vp.clientId });
        else window.App.navigateTo('expenses');
    }

    async function fetchList(url, params) {
        if (window.Pagination?.fetchList) return window.Pagination.fetchList(url, params || {});
        const qs = new URLSearchParams(params || {}); qs.set('limit', '1000');
        const j = await fetch(`${url}?${qs}`).then(r => r.json());
        return j.data?.items || j.data || [];
    }

    async function loadDropdowns() {
        const [props, clients, suppliers] = await Promise.all([
            fetchList(PROPS_API, {}).catch(() => []),
            fetchList(CLIENTS_API, { status: 'active' }).catch(() => []),
            fetchList(SUPPLIERS_API, {}).catch(() => []),
        ]);
        $('exe-property').innerHTML = '<option value="">— Nessuno —</option>' +
            props.map(p => `<option value="${p.id}">${esc(p.address)}, ${esc(p.city)}</option>`).join('');
        $('exe-client').innerHTML = '<option value="">— Nessuno —</option>' +
            clients.map(c => `<option value="${c.id}">${esc(c.surname)} ${esc(c.name)}</option>`).join('');
        $('exe-supplier').innerHTML = '<option value="">— Nessuno —</option>' +
            suppliers.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    }

    async function loadExpense() {
        const j = await fetch(`${API}?id=${expenseId}`).then(r => r.json());
        if (!j.success) throw new Error(j.error);
        const x = j.data;
        $('exe-id').value = x.id;
        $('exe-category').value = x.category || 'altro';
        $('exe-amount').value = x.amount ?? '';
        $('exe-description').value = x.description || '';
        $('exe-date').value = x.expense_date || '';
        $('exe-property').value = x.property_id || '';
        $('exe-client').value = x.client_id || '';
        $('exe-supplier').value = x.supplier_id || '';
        $('exe-receipt').value = x.receipt_url || '';
        $('exe-notes').value = x.notes || '';
    }

    function collect() {
        return {
            category:     $('exe-category').value,
            amount:       $('exe-amount').value,
            description:  $('exe-description').value.trim(),
            expense_date: $('exe-date').value,
            property_id:  $('exe-property').value || null,
            client_id:    $('exe-client').value || null,
            supplier_id:  $('exe-supplier').value || null,
            receipt_url:  $('exe-receipt').value.trim(),
            notes:        $('exe-notes').value.trim(),
        };
    }

    async function save(e) {
        e.preventDefault();
        clearError();
        const id = $('exe-id').value;
        const btn = $('exe-save');
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
        $('exe-back').addEventListener('click', goBack);
        $('exe-cancel').addEventListener('click', goBack);
        $('exe-form').addEventListener('submit', save);

        try { await loadDropdowns(); }
        catch (err) { showAlert('Errore caricamento elenchi: ' + err.message, 'error'); }

        if (isEdit) {
            $('exe-title').textContent = 'Modifica Spesa';
            try { await loadExpense(); }
            catch (err) { showAlert('Impossibile caricare la spesa: ' + err.message, 'error'); }
        } else {
            $('exe-title').textContent = 'Nuova Spesa';
            $('exe-category').value = 'altro';
            $('exe-date').value = new Date().toISOString().slice(0, 10);
            if (vp.propertyId) $('exe-property').value = String(vp.propertyId);
            if (vp.clientId) $('exe-client').value = String(vp.clientId);
            $('exe-description').focus();
        }
    }

    init();
})();
