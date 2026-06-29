/**
 * Payments (Scadenzario Affitti) — CRUD (Phase 10)
 */
(function () {
    'use strict';

    const API            = 'api/payments.php';
    const TENANTS_API    = 'api/tenants.php';
    const PROPERTIES_API = 'api/properties.php';

    const STATUS_LABELS = {
        pending:   'In attesa',
        paid:      'Pagato',
        late:      'In ritardo',
        cancelled: 'Annullato',
    };

    let payments   = [];
    let tenants    = [];
    let properties = [];
    let currentPage = 1;
    const PAGE_LIMIT = 25;
    let schedaPaymentId = null;

    const els = {};

    function init() {
        els.grid         = document.getElementById('payments-grid');
        els.alert        = document.getElementById('payments-alert');
        els.statusFilter = document.getElementById('payment-status-filter');
        els.monthFilter  = document.getElementById('payment-month-filter');
        els.yearFilter   = document.getElementById('payment-year-filter');
        els.modal        = document.getElementById('payment-modal');
        els.form         = document.getElementById('payment-form');
        els.modalTitle   = document.getElementById('payment-modal-title');
        els.tenantSelect = document.getElementById('payment-tenant');
        els.propSelect   = document.getElementById('payment-property');
        els.pagination   = document.getElementById('payments-pagination');

        bindEvents();
        Promise.all([loadTenants(), loadProperties()])
            .then(() => loadPayments())
            .catch(err => {
                if (!els.alert?.isConnected) return;
                showAlert('Errore inizializzazione: ' + err.message, 'error');
            });
    }

    function bindEvents() {
        document.getElementById('btn-new-payment').addEventListener('click', () => {
            if (window.App) window.App.navigateTo('payment_edit');
        });

        [els.statusFilter, els.monthFilter].forEach(el => el.addEventListener('change', () => { currentPage = 1; loadPayments(); }));
        els.yearFilter.addEventListener('input', () => {
            clearTimeout(els._timer);
            els._timer = setTimeout(() => { currentPage = 1; loadPayments(); }, 400);
        });

        // Scheda quick-view
        const schedaModal = document.getElementById('payment-scheda-modal');
        document.getElementById('payment-scheda-close').addEventListener('click', closeSchedaModal);
        document.getElementById('scheda-pay-close2').addEventListener('click', closeSchedaModal);
        schedaModal.addEventListener('click', (e) => { if (e.target === schedaModal) closeSchedaModal(); });
        document.getElementById('scheda-pay-edit').addEventListener('click', () => {
            const id = schedaPaymentId;
            closeSchedaModal();
            if (window.App) window.App.navigateTo('payment_edit', { paymentId: id });
        });
        document.getElementById('scheda-pay-paid').addEventListener('click', () => {
            const id = schedaPaymentId;
            closeSchedaModal();
            markPaid(id);
        });
    }

    // -------------------------------------------------------------------------
    // Reference data
    // -------------------------------------------------------------------------

    async function loadTenants() {
        tenants = await Pagination.fetchList(TENANTS_API);
        if (els.tenantSelect) els.tenantSelect.innerHTML = '<option value="">— Seleziona inquilino —</option>' +
            tenants.map(t =>
                `<option value="${t.id}" data-property="${t.property_id || ''}" data-contract="${t.contract_id || ''}">${escapeHtml(t.surname)} ${escapeHtml(t.name)}</option>`
            ).join('');
    }

    async function loadProperties() {
        properties = await Pagination.fetchList(PROPERTIES_API);
        if (els.propSelect) els.propSelect.innerHTML = '<option value="">— Seleziona immobile —</option>' +
            properties.map(p =>
                `<option value="${p.id}">${escapeHtml(p.address)}, ${escapeHtml(p.city)}</option>`
            ).join('');
    }

    // -------------------------------------------------------------------------
    // List
    // -------------------------------------------------------------------------

    async function loadPayments() {
        const params = new URLSearchParams();
        if (els.statusFilter.value) params.set('status', els.statusFilter.value);
        if (els.monthFilter.value)  params.set('month', els.monthFilter.value);
        if (els.yearFilter.value.trim()) params.set('year', els.yearFilter.value.trim());
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);

        const url = `${API}?${params}`;
        softLoad(els.grid, '<div class="entity-loading">Caricamento…</div>');

        try {
            const res  = await fetch(url);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const parsed = Pagination.parseResponse(json);
            payments = parsed.items;
            renderCards();
            Pagination.render(els.pagination, parsed, (p) => { currentPage = p; loadPayments(); });
        } catch (err) {
            els.grid.classList.remove('is-loading');
            els.grid.innerHTML = `<div class="entity-error">${escapeHtml(err.message)}</div>`;
        }
    }

    function renderCards() {
        els.grid.classList.remove('is-loading');
        if (payments.length === 0) {
            els.grid.innerHTML = '<div class="entity-empty">Nessun pagamento trovato.</div>';
            return;
        }

        els.grid.innerHTML = payments.map(p => {
            const markPaidBtn = window.canWrite !== false && (p.status === 'pending' || p.status === 'late')
                ? `<button class="btn btn--sm btn--ghost btn-paid" data-id="${p.id}" title="Segna come pagato"><i data-lucide="check"></i> Pagato</button>`
                : '';

            return `
            <div class="entity-card payment-card payment-card--${p.status} entity-card--clickable" data-id="${p.id}">
                <div class="entity-card__header">
                    <div class="entity-card__title-group">
                        <div class="entity-card__name">€ ${formatPrice(p.amount)}</div>
                        <span class="badge badge--payment-${p.status}">${STATUS_LABELS[p.status] || p.status}</span>
                    </div>
                </div>
                <div class="entity-card__body">
                    <div class="entity-card__info"><span class="entity-card__info-icon">🔑</span>${escapeHtml(p.tenant_surname)} ${escapeHtml(p.tenant_name)}</div>
                    <div class="entity-card__info"><span class="entity-card__info-icon">🏢</span>${escapeHtml(p.property_address)}, ${escapeHtml(p.property_city)}</div>
                    <div class="entity-card__info"><span class="entity-card__info-icon">📅</span>Scadenza: ${formatDate(p.due_date)}</div>
                    ${p.paid_date ? `<div class="entity-card__info"><span class="entity-card__info-icon">✅</span>Pagato il: ${formatDate(p.paid_date)}</div>` : ''}
                    ${p.notes ? `<div class="entity-card__info text-muted">${escapeHtml(truncate(p.notes, 60))}</div>` : ''}
                </div>
                <div class="entity-card__footer">
                    <div class="entity-card__actions">
                        ${markPaidBtn}
                        ${window.canWrite !== false ? `<button class="btn btn--sm btn--ghost btn-edit" data-id="${p.id}" title="Modifica"><i data-lucide="pencil"></i></button>
                        <button class="btn btn--sm btn--ghost btn-cancel" data-id="${p.id}" title="Annulla"><i data-lucide="x"></i></button>` : ''}
                    </div>
                </div>
            </div>`;
        }).join('');

        els.grid.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (window.App) window.App.navigateTo('payment_edit', { paymentId: Number(btn.dataset.id) });
            });
        });

        els.grid.querySelectorAll('.btn-paid').forEach(btn => {
            btn.addEventListener('click', () => markPaid(btn.dataset.id));
        });

        els.grid.querySelectorAll('.btn-cancel').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (await confirmDialog('Vuoi annullare questo pagamento?', { title: 'Annulla pagamento', confirmText: 'Annulla pagamento', cancelText: 'Indietro' })) cancelPayment(btn.dataset.id);
            });
        });

        els.grid.querySelectorAll('.entity-card--clickable').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('button, a, input')) return;
                const p = payments.find(x => x.id == card.dataset.id);
                if (p) openSchedaModal(p);
            });
        });
    }

    // -------------------------------------------------------------------------
    // Scheda quick-view
    // -------------------------------------------------------------------------

    function openSchedaModal(p) {
        schedaPaymentId = p.id;
        document.getElementById('scheda-pay-amount').textContent = '€ ' + formatPrice(p.amount);
        document.getElementById('scheda-pay-badge').innerHTML =
            `<span class="badge badge--payment-${p.status}">${STATUS_LABELS[p.status] || p.status}</span>`;

        document.getElementById('scheda-pay-body').innerHTML = `
            <div class="scheda-rows">
                <div class="scheda-row"><span class="scheda-row__label">🔑 Inquilino</span><span class="scheda-row__value">${escapeHtml(p.tenant_surname)} ${escapeHtml(p.tenant_name)}</span></div>
                <div class="scheda-row"><span class="scheda-row__label">🏢 Immobile</span><span class="scheda-row__value">${escapeHtml(p.property_address)}, ${escapeHtml(p.property_city)}</span></div>
                <div class="scheda-row"><span class="scheda-row__label">📅 Scadenza</span><span class="scheda-row__value">${formatDate(p.due_date)}</span></div>
                ${p.paid_date ? `<div class="scheda-row"><span class="scheda-row__label">✅ Pagato il</span><span class="scheda-row__value">${formatDate(p.paid_date)}</span></div>` : ''}
                ${p.notes ? `<div class="scheda-row"><span class="scheda-row__label">📝 Note</span><span class="scheda-row__value">${escapeHtml(p.notes)}</span></div>` : ''}
            </div>`;

        const paidBtn = document.getElementById('scheda-pay-paid');
        paidBtn.hidden = !(window.canWrite !== false && (p.status === 'pending' || p.status === 'late'));

        const editBtn = document.getElementById('scheda-pay-edit');
        if (editBtn) editBtn.hidden = window.canWrite === false;

        document.getElementById('payment-scheda-modal').hidden = false;
    }

    function closeSchedaModal() {
        schedaPaymentId = null;
        document.getElementById('payment-scheda-modal').hidden = true;
    }

    // -------------------------------------------------------------------------
    // Modal
    // -------------------------------------------------------------------------

    function openModal(payment = null) {
        els.form.reset();
        document.getElementById('payment-id').value = '';

        if (payment) {
            els.modalTitle.textContent = 'Modifica Pagamento';
            document.getElementById('payment-id').value        = payment.id;
            document.getElementById('payment-tenant').value     = payment.tenant_id;
            document.getElementById('payment-property').value   = payment.property_id;
            const contractInput = document.getElementById('payment-contract-id');
            if (contractInput) contractInput.value = payment.contract_id || '';
            document.getElementById('payment-amount').value     = payment.amount;
            document.getElementById('payment-due-date').value   = payment.due_date;
            document.getElementById('payment-paid-date').value  = payment.paid_date || '';
            document.getElementById('payment-status').value     = payment.status;
            document.getElementById('payment-notes').value      = payment.notes || '';
        } else {
            els.modalTitle.textContent = 'Nuovo Pagamento';
            document.getElementById('payment-status').value = 'pending';
        }

        els.modal.hidden = false;
        document.getElementById('payment-tenant').focus();
    }

    function closeModal() {
        els.modal.hidden = true;
    }

    function onTenantChange() {
        const opt = els.tenantSelect.selectedOptions[0];
        if (opt && opt.dataset.property) {
            els.propSelect.value = opt.dataset.property;
        }
        const contractInput = document.getElementById('payment-contract-id');
        if (contractInput && opt) {
            contractInput.value = opt.dataset.contract || '';
        }
    }

    // -------------------------------------------------------------------------
    // CRUD
    // -------------------------------------------------------------------------

    async function handleFormSubmit(e) {
        e.preventDefault();

        const id   = document.getElementById('payment-id').value;
        const data = {
            tenant_id:   document.getElementById('payment-tenant').value,
            property_id: document.getElementById('payment-property').value,
            contract_id: document.getElementById('payment-contract-id')?.value || null,
            amount:      document.getElementById('payment-amount').value,
            due_date:    document.getElementById('payment-due-date').value,
            paid_date:   document.getElementById('payment-paid-date').value,
            status:      document.getElementById('payment-status').value,
            notes:       document.getElementById('payment-notes').value.trim(),
        };

        const btn = document.getElementById('payment-modal-save');
        btn.disabled = true;
        btn.textContent = 'Salvataggio...';

        try {
            await savePayment(data, id || null);
            closeModal();
            showAlert('Pagamento salvato.', 'success');
            loadPayments();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Salva';
        }
    }

    async function savePayment(data, id) {
        const url    = id ? `${API}?id=${id}` : API;
        const method = id ? 'PUT' : 'POST';
        const res  = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        return json.data;
    }

    async function markPaid(id) {
        const payment = payments.find(p => p.id == id);
        if (!payment) return;

        const data = {
            tenant_id:   payment.tenant_id,
            property_id: payment.property_id,
            contract_id: payment.contract_id || null,
            amount:      payment.amount,
            due_date:    payment.due_date,
            paid_date:   new Date().toISOString().slice(0, 10),
            status:      'paid',
            notes:       payment.notes || '',
        };

        try {
            await savePayment(data, id);
            showAlert('Pagamento segnato come pagato.', 'success');
            loadPayments();
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    async function cancelPayment(id) {
        try {
            const res  = await fetch(`${API}?id=${id}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert('Pagamento annullato.', 'success');
            loadPayments();
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    // -------------------------------------------------------------------------
    // Utilities
    // -------------------------------------------------------------------------

    function showAlert(message, type) {
        els.alert.textContent = message;
        els.alert.className   = `alert alert--${type}`;
        els.alert.style.display = 'block';
        clearTimeout(els.alert._t);
        els.alert._t = setTimeout(() => { els.alert.style.display = 'none'; }, 4000);
    }

    function formatPrice(value) {
        const n = Number(value);
        if (!isFinite(n)) return value;
        return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatDate(dateStr) {
        if (!dateStr) return '—';
        return new Date(dateStr).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    function truncate(str, len) {
        return str.length > len ? str.slice(0, len) + '…' : str;
    }

    function escapeHtml(str) {
        if (str == null) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    init();
    document.getElementById('payment-tenant')?.addEventListener('change', onTenantChange);
})();
