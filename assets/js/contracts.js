/**
 * Contracts (Contratti) — CRUD + lifecycle (Phase 10)
 */
(function () {
    'use strict';

    const API            = 'api/contracts.php';
    const PROPERTIES_API = 'api/properties.php';
    const TENANTS_API    = 'api/tenants.php';
    const CLIENTS_API    = 'api/clients.php';

    const TYPE_LABELS = {
        locazione:     'Locazione',
        compravendita: 'Compravendita',
        preliminare:   'Preliminare',
        mandato:       'Mandato',
        altro:         'Altro',
    };

    const STATUS_LABELS = {
        draft:     'Bozza',
        sent:      'Inviato',
        signed:    'Firmato',
        expired:   'Scaduto',
        cancelled: 'Annullato',
    };

    const STATUS_FLOW = ['draft', 'sent', 'signed'];

    let contracts  = [];
    let properties = [];
    let tenants    = [];
    let clients    = [];
    let currentPage = 1;
    const PAGE_LIMIT = 25;

    const els = {};

    function init() {
        els.grid           = document.getElementById('contracts-grid');
        els.alert          = document.getElementById('contracts-alert');
        els.propFilter     = document.getElementById('contract-property-filter');
        els.typeFilter     = document.getElementById('contract-type-filter');
        els.statusFilter   = document.getElementById('contract-status-filter');
        els.modal          = document.getElementById('contract-modal');
        els.form           = document.getElementById('contract-form');
        els.modalTitle     = document.getElementById('contract-modal-title');
        els.propSelect     = document.getElementById('contract-property');
        els.tenantSelect   = document.getElementById('contract-tenant');
        els.clientSelect   = document.getElementById('contract-client');
        els.pagination     = document.getElementById('contracts-pagination');

        bindEvents();
        Promise.all([loadProperties(), loadTenants(), loadClients()])
            .then(() => loadContracts())
            .catch(err => {
                if (!els.alert?.isConnected) return;
                showAlert('Errore inizializzazione: ' + err.message, 'error');
            });
    }

    function bindEvents() {
        document.getElementById('btn-new-contract').addEventListener('click', () => openModal());
        document.getElementById('contract-modal-close').addEventListener('click', closeModal);
        document.getElementById('contract-modal-cancel').addEventListener('click', closeModal);

        els.form.addEventListener('submit', handleFormSubmit);

        [els.propFilter, els.typeFilter, els.statusFilter].forEach(el => el.addEventListener('change', () => { currentPage = 1; loadContracts(); }));

        els.modal.addEventListener('click', (e) => {
            if (e.target === els.modal) closeModal();
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
        els.propSelect.innerHTML = '<option value="">— Seleziona immobile —</option>' + opts;
        els.propFilter.innerHTML = '<option value="">Tutti gli immobili</option>' + opts;
    }

    async function loadTenants() {
        tenants = await Pagination.fetchList(TENANTS_API);
        els.tenantSelect.innerHTML = '<option value="">— Nessuno —</option>' +
            tenants.map(t => `<option value="${t.id}">${escapeHtml(t.surname)} ${escapeHtml(t.name)}</option>`).join('');
    }

    async function loadClients() {
        clients = await Pagination.fetchList(CLIENTS_API, { status: 'active' });
        els.clientSelect.innerHTML = '<option value="">— Nessuno —</option>' +
            clients.map(c => `<option value="${c.id}">${escapeHtml(c.surname)} ${escapeHtml(c.name)}</option>`).join('');
    }

    // -------------------------------------------------------------------------
    // List
    // -------------------------------------------------------------------------

    async function loadContracts() {
        const params = new URLSearchParams();
        if (els.propFilter.value)   params.set('property_id', els.propFilter.value);
        if (els.typeFilter.value)   params.set('type', els.typeFilter.value);
        if (els.statusFilter.value) params.set('status', els.statusFilter.value);
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);

        const url = `${API}?${params}`;
        els.grid.innerHTML = '<div class="entity-loading">Caricamento…</div>';

        try {
            const res  = await fetch(url);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const parsed = Pagination.parseResponse(json);
            contracts = parsed.items;
            renderCards();
            Pagination.render(els.pagination, parsed, (p) => { currentPage = p; loadContracts(); });
        } catch (err) {
            els.grid.innerHTML = `<div class="entity-error">${escapeHtml(err.message)}</div>`;
        }
    }

    function renderCards() {
        if (contracts.length === 0) {
            els.grid.innerHTML = '<div class="entity-empty">Nessun contratto trovato.</div>';
            return;
        }

        els.grid.innerHTML = contracts.map(c => {
            const who = c.tenant_surname
                ? `${escapeHtml(c.tenant_surname)} ${escapeHtml(c.tenant_name)}`
                : (c.client_surname ? `${escapeHtml(c.client_surname)} ${escapeHtml(c.client_name)}` : null);

            const dateRange = (c.start_date || c.end_date)
                ? `${formatDate(c.start_date)} → ${formatDate(c.end_date)}`
                : null;

            const advanceBtn = nextStatus(c.status)
                ? `<button class="btn btn--sm btn--ghost btn-advance" data-id="${c.id}" title="Avanza stato">→ ${STATUS_LABELS[nextStatus(c.status)]}</button>`
                : '';

            return `
            <div class="entity-card contract-card contract-card--${c.status}">
                <div class="entity-card__header">
                    <div class="entity-card__title-group">
                        <div class="entity-card__name">${escapeHtml(c.title)}</div>
                        <div class="contract-card__badges">
                            <span class="badge badge--contract-type">${TYPE_LABELS[c.contract_type] || c.contract_type}</span>
                            <span class="badge badge--contract-${c.status}">${STATUS_LABELS[c.status] || c.status}</span>
                        </div>
                    </div>
                </div>
                <div class="entity-card__body">
                    <div class="entity-card__info"><span class="entity-card__info-icon">🏢</span>${escapeHtml(c.property_address)}, ${escapeHtml(c.property_city)}</div>
                    ${who ? `<div class="entity-card__info"><span class="entity-card__info-icon">👤</span>${who}</div>` : ''}
                    ${dateRange ? `<div class="entity-card__info"><span class="entity-card__info-icon">📅</span>${dateRange}</div>` : ''}
                    ${c.monthly_rent != null && c.monthly_rent !== '' ? `<div class="entity-card__info"><span class="entity-card__info-icon">💶</span>€ ${formatPrice(c.monthly_rent)}/mese</div>` : ''}
                </div>
                <div class="entity-card__footer">
                    <div class="entity-card__actions">
                        ${advanceBtn}
                        <button class="btn btn--sm btn--ghost btn-edit" data-id="${c.id}" title="Modifica">✏️</button>
                        <button class="btn btn--sm btn--ghost btn-delete" data-id="${c.id}" title="Elimina">🗑️</button>
                    </div>
                </div>
            </div>`;
        }).join('');

        els.grid.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', () => {
                const c = contracts.find(x => x.id == btn.dataset.id);
                if (c) openModal(c);
            });
        });

        els.grid.querySelectorAll('.btn-advance').forEach(btn => {
            btn.addEventListener('click', () => advanceStatus(btn.dataset.id));
        });

        els.grid.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', () => {
                if (confirm('Eliminare questo contratto?')) deleteContract(btn.dataset.id);
            });
        });
    }

    function nextStatus(status) {
        const idx = STATUS_FLOW.indexOf(status);
        return idx >= 0 && idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx + 1] : null;
    }

    // -------------------------------------------------------------------------
    // Modal
    // -------------------------------------------------------------------------

    function openModal(contract = null) {
        els.form.reset();
        document.getElementById('contract-id').value = '';

        if (contract) {
            els.modalTitle.textContent = 'Modifica Contratto';
            document.getElementById('contract-id').value       = contract.id;
            document.getElementById('contract-title').value     = contract.title;
            document.getElementById('contract-type').value      = contract.contract_type;
            document.getElementById('contract-status').value    = contract.status;
            document.getElementById('contract-property').value  = contract.property_id;
            document.getElementById('contract-tenant').value    = contract.tenant_id || '';
            document.getElementById('contract-client').value    = contract.client_id || '';
            document.getElementById('contract-start').value     = contract.start_date || '';
            document.getElementById('contract-end').value       = contract.end_date || '';
            document.getElementById('contract-rent').value      = contract.monthly_rent ?? '';
            document.getElementById('contract-deposit').value   = contract.deposit ?? '';
            document.getElementById('contract-notes').value     = contract.notes || '';
        } else {
            els.modalTitle.textContent = 'Nuovo Contratto';
            document.getElementById('contract-type').value = 'locazione';
            document.getElementById('contract-status').value = 'draft';
        }

        els.modal.hidden = false;
        document.getElementById('contract-title').focus();
    }

    function closeModal() {
        els.modal.hidden = true;
    }

    // -------------------------------------------------------------------------
    // CRUD
    // -------------------------------------------------------------------------

    function collectFormData() {
        return {
            title:         document.getElementById('contract-title').value.trim(),
            contract_type: document.getElementById('contract-type').value,
            status:        document.getElementById('contract-status').value,
            property_id:   document.getElementById('contract-property').value,
            tenant_id:     document.getElementById('contract-tenant').value || null,
            client_id:     document.getElementById('contract-client').value || null,
            start_date:    document.getElementById('contract-start').value || null,
            end_date:      document.getElementById('contract-end').value || null,
            monthly_rent:  document.getElementById('contract-rent').value,
            deposit:       document.getElementById('contract-deposit').value,
            notes:         document.getElementById('contract-notes').value.trim(),
        };
    }

    async function handleFormSubmit(e) {
        e.preventDefault();
        const id   = document.getElementById('contract-id').value;
        const data = collectFormData();

        const btn = document.getElementById('contract-modal-save');
        btn.disabled = true;
        btn.textContent = 'Salvataggio...';

        try {
            await saveContract(data, id || null);
            closeModal();
            showAlert('Contratto salvato.', 'success');
            loadContracts();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Salva';
        }
    }

    async function saveContract(data, id) {
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

    async function advanceStatus(id) {
        const c = contracts.find(x => x.id == id);
        if (!c) return;
        const next = nextStatus(c.status);
        if (!next) return;

        const data = {
            title:         c.title,
            contract_type: c.contract_type,
            status:        next,
            property_id:   c.property_id,
            tenant_id:     c.tenant_id || null,
            client_id:     c.client_id || null,
            start_date:    c.start_date || null,
            end_date:      c.end_date || null,
            monthly_rent:  c.monthly_rent ?? '',
            deposit:       c.deposit ?? '',
            notes:         c.notes || '',
        };

        try {
            await saveContract(data, id);
            showAlert('Stato aggiornato a: ' + STATUS_LABELS[next], 'success');
            loadContracts();
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    async function deleteContract(id) {
        try {
            const res  = await fetch(`${API}?id=${id}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert('Contratto eliminato.', 'success');
            loadContracts();
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
