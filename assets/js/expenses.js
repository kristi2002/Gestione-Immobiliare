/**
 * Expenses (Gestione Spese) — CRUD (Phase 10)
 */
(function () {
    'use strict';

    const API            = 'api/expenses.php';
    const PROPERTIES_API = 'api/properties.php';
    const CLIENTS_API    = 'api/clients.php';
    const SUPPLIERS_API  = 'api/suppliers.php';

    const CATEGORY_LABELS = {
        manutenzione:  'Manutenzione',
        utenze:        'Utenze',
        tasse:         'Tasse',
        assicurazione: 'Assicurazione',
        agenzia:       'Agenzia',
        altro:         'Altro',
    };

    let expenses   = [];
    let properties = [];
    let clients    = [];
    let suppliers  = [];
    let currentPage = 1;
    const PAGE_LIMIT = 25;
    let schedaExpenseId = null;

    const els = {};

    function init() {
        els.grid           = document.getElementById('expenses-grid');
        els.alert          = document.getElementById('expenses-alert');
        els.propFilter     = document.getElementById('expense-property-filter');
        els.clientFilter   = document.getElementById('expense-client-filter');
        els.supplierFilter = document.getElementById('expense-supplier-filter');
        els.categoryFilter = document.getElementById('expense-category-filter');
        els.yearFilter     = document.getElementById('expense-year-filter');
        els.modal          = document.getElementById('expense-modal');
        els.form           = document.getElementById('expense-form');
        els.modalTitle     = document.getElementById('expense-modal-title');
        els.propSelect     = document.getElementById('expense-property');
        els.clientSelect   = document.getElementById('expense-client');
        els.supplierSelect = document.getElementById('expense-supplier');
        els.pagination     = document.getElementById('expenses-pagination');

        bindEvents();
        Promise.all([loadProperties(), loadClients(), loadSuppliers()])
            .then(() => loadExpenses())
            .catch(err => {
                if (!els.alert?.isConnected) return;
                showAlert('Errore inizializzazione: ' + err.message, 'error');
            });
    }

    function bindEvents() {
        document.getElementById('btn-new-expense').addEventListener('click', () => {
            if (window.App) window.App.navigateTo('expense_edit');
        });

        [els.propFilter, els.clientFilter, els.supplierFilter, els.categoryFilter].forEach(el => el.addEventListener('change', () => { currentPage = 1; loadExpenses(); }));
        els.yearFilter.addEventListener('input', () => {
            clearTimeout(els._timer);
            els._timer = setTimeout(() => { currentPage = 1; loadExpenses(); }, 400);
        });

        // Scheda quick-view
        const schedaModal = document.getElementById('expense-scheda-modal');
        document.getElementById('expense-scheda-close').addEventListener('click', closeSchedaModal);
        document.getElementById('scheda-exp-close2').addEventListener('click', closeSchedaModal);
        schedaModal.addEventListener('click', (e) => { if (e.target === schedaModal) closeSchedaModal(); });
        document.getElementById('scheda-exp-edit').addEventListener('click', () => {
            const id = schedaExpenseId;
            closeSchedaModal();
            if (window.App) window.App.navigateTo('expense_edit', { expenseId: id });
        });
    }

    // -------------------------------------------------------------------------
    // Reference data
    // -------------------------------------------------------------------------

    async function loadProperties() {
        properties = await Pagination.fetchList(PROPERTIES_API);
        const opts = properties.map(p =>
            `<option value="${p.id}">${escapeHtml(p.address)}, ${escapeHtml(p.city)}</option>`
        ).join('');
        if (els.propSelect) els.propSelect.innerHTML = '<option value="">— Nessuno —</option>' + opts;
        els.propFilter.innerHTML   = '<option value="">Tutti gli immobili</option>' + opts;
    }

    async function loadClients() {
        clients = await Pagination.fetchList(CLIENTS_API, { status: 'active' });
        const opts = clients.map(c =>
            `<option value="${c.id}">${escapeHtml(c.surname)} ${escapeHtml(c.name)}</option>`
        ).join('');
        if (els.clientSelect) els.clientSelect.innerHTML = '<option value="">— Nessuno —</option>' + opts;
        els.clientFilter.innerHTML = '<option value="">Tutti i proprietari</option>' + opts;
    }

    async function loadSuppliers() {
        suppliers = await Pagination.fetchList(SUPPLIERS_API);
        const opts = suppliers.map(s =>
            `<option value="${s.id}">${escapeHtml(s.name)}</option>`
        ).join('');
        if (els.supplierSelect) els.supplierSelect.innerHTML = '<option value="">— Nessuno —</option>' + opts;
        els.supplierFilter.innerHTML = '<option value="">Tutti i fornitori</option>' + opts;
    }

    // -------------------------------------------------------------------------
    // List
    // -------------------------------------------------------------------------

    async function loadExpenses() {
        const params = new URLSearchParams();
        if (els.propFilter.value)     params.set('property_id', els.propFilter.value);
        if (els.clientFilter.value)   params.set('client_id', els.clientFilter.value);
        if (els.supplierFilter.value) params.set('supplier_id', els.supplierFilter.value);
        if (els.categoryFilter.value) params.set('category', els.categoryFilter.value);
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
            expenses = parsed.items;
            renderCards();
            Pagination.render(els.pagination, parsed, (p) => { currentPage = p; loadExpenses(); });
        } catch (err) {
            els.grid.classList.remove('is-loading');
            els.grid.innerHTML = `<div class="entity-error">${escapeHtml(err.message)}</div>`;
        }
    }

    function renderCards() {
        els.grid.classList.remove('is-loading');
        if (expenses.length === 0) {
            els.grid.innerHTML = '<div class="entity-empty">Nessuna spesa trovata.</div>';
            return;
        }

        els.grid.innerHTML = expenses.map(e => {
            const link = e.property_address
                ? `${escapeHtml(e.property_address)}, ${escapeHtml(e.property_city)}`
                : (e.client_surname ? `${escapeHtml(e.client_surname)} ${escapeHtml(e.client_name)}` : null);

            return `
            <div class="entity-card expense-card expense-card--${e.category} entity-card--clickable" data-id="${e.id}">
                <div class="entity-card__header">
                    <div class="entity-card__title-group">
                        <div class="entity-card__name">€ ${formatPrice(e.amount)}</div>
                        <span class="badge badge--expense badge--expense-${e.category}">${CATEGORY_LABELS[e.category] || e.category}</span>
                    </div>
                </div>
                <div class="entity-card__body">
                    <div class="entity-card__info"><strong>${escapeHtml(e.description)}</strong></div>
                    <div class="entity-card__info"><span class="entity-card__info-icon"><i data-lucide="calendar"></i></span>${formatDate(e.expense_date)}</div>
                    ${link ? `<div class="entity-card__info"><span class="entity-card__info-icon"><i data-lucide="building-2"></i></span>${link}</div>` : ''}
                    ${e.supplier_name ? `<div class="entity-card__info"><span class="entity-card__info-icon"><i data-lucide="wrench"></i></span>${escapeHtml(e.supplier_name)}</div>` : ''}
                    ${e.receipt_url ? `<div class="entity-card__info"><a href="${escapeHtml(e.receipt_url)}" target="_blank" rel="noopener"><i data-lucide="paperclip"></i> Ricevuta</a></div>` : ''}
                </div>
                <div class="entity-card__footer">
                    <div class="entity-card__actions">
                        ${window.canWrite !== false ? `<button class="btn btn--sm btn--ghost btn-edit" data-id="${e.id}" title="Modifica"><i data-lucide="pencil"></i></button>
                        <button class="btn btn--sm btn--ghost btn-delete" data-id="${e.id}" title="Elimina"><i data-lucide="trash-2"></i></button>` : ''}
                    </div>
                </div>
            </div>`;
        }).join('');

        els.grid.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (window.App) window.App.navigateTo('expense_edit', { expenseId: Number(btn.dataset.id) });
            });
        });

        els.grid.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (await confirmDialog('Vuoi eliminare questa spesa?', { title: 'Elimina spesa' })) deleteExpense(btn.dataset.id);
            });
        });

        els.grid.querySelectorAll('.entity-card--clickable').forEach(card => {
            card.addEventListener('click', (ev) => {
                if (ev.target.closest('button, a, input')) return;
                const e = expenses.find(x => x.id == card.dataset.id);
                if (e) openSchedaModal(e);
            });
        });
    }

    // -------------------------------------------------------------------------
    // Scheda quick-view
    // -------------------------------------------------------------------------

    function openSchedaModal(e) {
        schedaExpenseId = e.id;
        document.getElementById('scheda-exp-amount').textContent = '€ ' + formatPrice(e.amount);
        document.getElementById('scheda-exp-badge').innerHTML =
            `<span class="badge badge--expense badge--expense-${e.category}">${CATEGORY_LABELS[e.category] || e.category}</span>`;

        const linked = e.property_address
            ? `<i data-lucide="building-2"></i> ${e.property_address}, ${e.property_city}`
            : (e.client_surname ? `<i data-lucide="user"></i> ${e.client_surname} ${e.client_name}` : null);

        document.getElementById('scheda-exp-body').innerHTML = `
            <div class="scheda-rows">
                <div class="scheda-row"><span class="scheda-row__label"><i data-lucide="file-pen"></i> Descrizione</span><span class="scheda-row__value"><strong>${escapeHtml(e.description)}</strong></span></div>
                <div class="scheda-row"><span class="scheda-row__label"><i data-lucide="calendar"></i> Data</span><span class="scheda-row__value">${formatDate(e.expense_date)}</span></div>
                ${linked ? `<div class="scheda-row"><span class="scheda-row__label">Associato a</span><span class="scheda-row__value">${escapeHtml(linked)}</span></div>` : ''}
                ${e.supplier_name ? `<div class="scheda-row"><span class="scheda-row__label"><i data-lucide="wrench"></i> Fornitore</span><span class="scheda-row__value">${escapeHtml(e.supplier_name)}</span></div>` : ''}
                ${e.receipt_url ? `<div class="scheda-row"><span class="scheda-row__label"><i data-lucide="paperclip"></i> Ricevuta</span><span class="scheda-row__value"><a href="${escapeHtml(e.receipt_url)}" target="_blank" rel="noopener">Apri ricevuta</a></span></div>` : ''}
                ${e.notes ? `<div class="scheda-row"><span class="scheda-row__label"><i data-lucide="file-text"></i> Note</span><span class="scheda-row__value">${escapeHtml(e.notes)}</span></div>` : ''}
            </div>`;

        const editBtn = document.getElementById('scheda-exp-edit');
        if (editBtn) editBtn.hidden = window.canWrite === false;

        document.getElementById('expense-scheda-modal').hidden = false;
    }

    function closeSchedaModal() {
        schedaExpenseId = null;
        document.getElementById('expense-scheda-modal').hidden = true;
    }

    // -------------------------------------------------------------------------
    // Modal
    // -------------------------------------------------------------------------

    // -------------------------------------------------------------------------
    // CRUD
    // -------------------------------------------------------------------------

    async function deleteExpense(id) {
        try {
            const res  = await fetch(`${API}?id=${id}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert('Spesa eliminata.', 'success');
            loadExpenses();
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

    function escapeHtml(str) {
        if (str == null) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    init();
})();
