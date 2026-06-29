/**
 * Invoice create / edit — dedicated page (replaces the old modal).
 * viewParams: { invoiceId } for edit; { clientId } to preselect on create.
 */
(function () {
    'use strict';

    const API         = 'api/invoices.php';
    const CLIENTS_API = 'api/clients.php';
    const LEADS_API   = 'api/leads.php';

    const vp        = window.App?.viewParams || {};
    const invoiceId = vp.invoiceId || null;
    const isEdit    = !!invoiceId;

    function $(id) { return document.getElementById(id); }
    function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }

    function showAlert(msg, type) {
        const el = $('ive-alert'); if (!el) return;
        el.textContent = msg; el.className = `alert alert--${type}`; el.style.display = 'block';
        clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
    }
    function showError(m) { const el = $('ive-error'); if (el) { el.textContent = m; el.style.display = 'block'; } }
    function clearError() { const el = $('ive-error'); if (el) el.style.display = 'none'; }

    function backTarget() {
        if (vp.clientId) return ['client_profile', { clientId: vp.clientId }];
        return ['invoices', {}];
    }
    function goBack() { if (window.App) { const [v, p] = backTarget(); window.App.navigateTo(v, p); } }

    async function fetchList(url, params) {
        if (window.Pagination?.fetchList) return window.Pagination.fetchList(url, params || {});
        const qs = new URLSearchParams(params || {}); qs.set('limit', '1000');
        const j = await fetch(`${url}?${qs}`).then(r => r.json());
        return j.data?.items || j.data || [];
    }

    async function loadDropdowns() {
        const [clients, leads] = await Promise.all([
            fetchList(CLIENTS_API, { status: 'active' }).catch(() => []),
            fetchList(LEADS_API, {}).catch(() => []),
        ]);
        $('ive-client').innerHTML = '<option value="">— Nessuno —</option>' +
            clients.map(c => `<option value="${c.id}">${esc(c.surname)} ${esc(c.name)}</option>`).join('');
        $('ive-lead').innerHTML = '<option value="">— Nessuno —</option>' +
            leads.map(l => `<option value="${l.id}">${esc(l.surname)} ${esc(l.name)}</option>`).join('');
    }

    async function loadInvoice() {
        const j = await fetch(`${API}?id=${invoiceId}`).then(r => r.json());
        if (!j.success) throw new Error(j.error);
        const i = j.data;
        $('ive-id').value = i.id;
        $('ive-client').value = i.client_id || '';
        $('ive-lead').value = i.lead_id || '';
        $('ive-description').value = i.description || '';
        $('ive-amount').value = i.amount ?? '';
        $('ive-vat').value = i.vat_rate ?? 22;
        $('ive-status').value = i.status || 'draft';
        $('ive-issue').value = i.issue_date || '';
        $('ive-due').value = i.due_date || '';
        $('ive-paid').value = i.paid_date || '';
        $('ive-notes').value = i.notes || '';
        $('ive-title').textContent = 'Modifica Fattura ' + (i.invoice_number || '');
    }

    function collect() {
        return {
            client_id:   $('ive-client').value || null,
            lead_id:     $('ive-lead').value || null,
            description: $('ive-description').value.trim(),
            amount:      $('ive-amount').value,
            vat_rate:    $('ive-vat').value,
            status:      $('ive-status').value,
            issue_date:  $('ive-issue').value,
            due_date:    $('ive-due').value,
            paid_date:   $('ive-paid').value,
            notes:       $('ive-notes').value.trim(),
        };
    }

    async function save(e) {
        e.preventDefault();
        clearError();
        const id = $('ive-id').value;
        const btn = $('ive-save');
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
        $('ive-back').addEventListener('click', goBack);
        $('ive-cancel').addEventListener('click', goBack);
        $('ive-form').addEventListener('submit', save);

        try { await loadDropdowns(); }
        catch (err) { showAlert('Errore caricamento elenchi: ' + err.message, 'error'); }

        if (isEdit) {
            try { await loadInvoice(); }
            catch (err) { showAlert('Impossibile caricare la fattura: ' + err.message, 'error'); }
        } else {
            $('ive-title').textContent = 'Nuova Fattura';
            $('ive-issue').value = new Date().toISOString().slice(0, 10);
            if (vp.clientId) $('ive-client').value = String(vp.clientId);
            $('ive-description').focus();
        }
    }

    init();
})();
