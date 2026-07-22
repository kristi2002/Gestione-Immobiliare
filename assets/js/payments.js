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

        bindSddExport();

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
                    <div class="entity-card__info"><span class="entity-card__info-icon"><i data-lucide="key"></i></span>${escapeHtml(p.tenant_surname)} ${escapeHtml(p.tenant_name)}</div>
                    <div class="entity-card__info"><span class="entity-card__info-icon"><i data-lucide="building-2"></i></span>${escapeHtml(p.property_address)}, ${escapeHtml(p.property_city)}</div>
                    <div class="entity-card__info"><span class="entity-card__info-icon"><i data-lucide="calendar"></i></span>Scadenza: ${formatDate(p.due_date)}</div>
                    ${p.paid_date ? `<div class="entity-card__info"><span class="entity-card__info-icon"><i data-lucide="check-circle"></i></span>Pagato il: ${formatDate(p.paid_date)}</div>` : ''}
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
                <div class="scheda-row"><span class="scheda-row__label"><i data-lucide="key"></i> Inquilino</span><span class="scheda-row__value">${escapeHtml(p.tenant_surname)} ${escapeHtml(p.tenant_name)}</span></div>
                <div class="scheda-row"><span class="scheda-row__label"><i data-lucide="building-2"></i> Immobile</span><span class="scheda-row__value">${escapeHtml(p.property_address)}, ${escapeHtml(p.property_city)}</span></div>
                <div class="scheda-row"><span class="scheda-row__label"><i data-lucide="calendar"></i> Scadenza</span><span class="scheda-row__value">${formatDate(p.due_date)}</span></div>
                ${p.paid_date ? `<div class="scheda-row"><span class="scheda-row__label"><i data-lucide="check-circle"></i> Pagato il</span><span class="scheda-row__value">${formatDate(p.paid_date)}</span></div>` : ''}
                ${p.notes ? `<div class="scheda-row"><span class="scheda-row__label"><i data-lucide="file-pen"></i> Note</span><span class="scheda-row__value">${escapeHtml(p.notes)}</span></div>` : ''}
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

    // -------------------------------------------------------------------------
    // CRUD
    // -------------------------------------------------------------------------

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

    // ── SEPA SDD export ───────────────────────────────────────────────────────
    function bindSddExport() {
        const openBtn = document.getElementById('btn-export-sdd');
        const modal   = document.getElementById('sdd-modal');
        if (!openBtn || !modal) return;
        const monthInput = document.getElementById('sdd-month');
        const preview    = document.getElementById('sdd-preview');
        const dlBtn      = document.getElementById('sdd-download');

        function close() { modal.hidden = true; }
        openBtn.addEventListener('click', () => {
            monthInput.value = new Date().toISOString().slice(0, 7);
            preview.textContent = '';
            dlBtn.disabled = true;
            modal.hidden = false;
            checkSdd();
        });
        document.getElementById('sdd-modal-close').addEventListener('click', close);
        document.getElementById('sdd-modal-cancel').addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) close(); });
        monthInput.addEventListener('change', checkSdd);
        dlBtn.addEventListener('click', () => {
            if (monthInput.value) window.location.href = `api/generate_sdd.php?month=${monthInput.value}`;
        });

        async function checkSdd() {
            const month = monthInput.value;
            if (!month) return;
            preview.textContent = 'Verifica…';
            dlBtn.disabled = true;
            try {
                const res  = await fetch(`api/generate_sdd.php?month=${month}&check=1`);
                const json = await res.json();
                if (!json.success) throw new Error(json.error);
                const d = json.data;
                const eur = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n || 0);
                let msg = `${d.count} addebiti idonei · totale ${eur(d.total)}.`;
                if (d.missing && d.missing.length) msg += ` ⚠ Configura: ${d.missing.join(', ')}.`;
                if (d.skipped && d.skipped.length) msg += ` Esclusi (mandato/IBAN mancante): ${d.skipped.length}.`;
                preview.textContent = msg;
                dlBtn.disabled = !d.ready;
            } catch (err) {
                preview.textContent = err.message;
                dlBtn.disabled = true;
            }
        }
    }

    init();
})();
