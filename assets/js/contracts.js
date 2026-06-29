/**
 * Contracts (Contratti) — CRUD + lifecycle (Phase 10)
 */
(function () {
    'use strict';

    const API            = 'api/contracts.php';
    const PROPERTIES_API = 'api/properties.php';
    const TENANTS_API    = 'api/tenants.php';
    const CLIENTS_API    = 'api/clients.php';
    const ESIGN_API      = 'api/esign.php';

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
    let schedaContractId = null;

    const els = {};

    function init() {
        els.grid           = document.getElementById('contracts-grid');
        els.alert          = document.getElementById('contracts-alert');
        els.search         = document.getElementById('contract-search');
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
            .then(() => {
                // Legacy entry points now redirect to the dedicated contract page.
                const vp = window.App?.viewParams || {};
                if (vp.contractId && window.App) window.App.navigateTo('contract_edit', { contractId: vp.contractId });
                else if (vp.openNew && window.App) window.App.navigateTo('contract_edit', vp.clientId ? { clientId: vp.clientId } : {});
            })
            .catch(err => {
                if (!els.alert?.isConnected) return;
                showAlert('Errore inizializzazione: ' + err.message, 'error');
            });
    }

    function bindEvents() {
        document.getElementById('btn-new-contract').addEventListener('click', () => {
            if (window.App) window.App.navigateTo('contract_edit');
        });

        let searchTimer = null;
        els.search.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => { currentPage = 1; loadContracts(); }, 300);
        });

        [els.propFilter, els.typeFilter].forEach(el => el.addEventListener('change', () => { currentPage = 1; loadContracts(); }));

        // Status filter as horizontal colored pills (includes a dedicated "Scaduti").
        document.querySelectorAll('#contract-status-pills .filter-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                document.querySelectorAll('#contract-status-pills .filter-pill').forEach(p => p.classList.remove('is-active'));
                pill.classList.add('is-active');
                currentPage = 1;
                loadContracts();
            });
        });

        document.getElementById('esign-modal-close').addEventListener('click', closeEsignModal);
        document.getElementById('esign-modal-cancel').addEventListener('click', closeEsignModal);
        document.getElementById('esign-form').addEventListener('submit', generateEsignLink);
        document.getElementById('btn-copy-esign').addEventListener('click', () => {
            const url = document.getElementById('esign-link-url').value;
            navigator.clipboard.writeText(url).then(() => showAlert('Link copiato!', 'success'));
        });

        // Scheda quick-view
        const schedaModal = document.getElementById('contract-scheda-modal');
        document.getElementById('contract-scheda-close').addEventListener('click', closeSchedaModal);
        document.getElementById('scheda-ct-close2').addEventListener('click', closeSchedaModal);
        schedaModal.addEventListener('click', (e) => { if (e.target === schedaModal) closeSchedaModal(); });
        document.getElementById('scheda-ct-edit').addEventListener('click', () => {
            const id = schedaContractId;
            closeSchedaModal();
            if (window.App) window.App.navigateTo('contract_edit', { contractId: id });
        });
        document.getElementById('scheda-ct-esign').addEventListener('click', () => {
            const id = schedaContractId;
            closeSchedaModal();
            openEsignModal(id);
        });
        document.getElementById('scheda-ct-advance').addEventListener('click', () => {
            const id = schedaContractId;
            closeSchedaModal();
            advanceStatus(id);
        });
        document.getElementById('scheda-ct-generate').addEventListener('click', () => {
            const id = schedaContractId;
            closeSchedaModal();
            generatePayments(id);
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
        if (els.propSelect) els.propSelect.innerHTML = '<option value="">— Seleziona immobile —</option>' + opts;
        if (els.propFilter) els.propFilter.innerHTML = '<option value="">Tutti gli immobili</option>' + opts;
    }

    async function loadTenants() {
        tenants = await Pagination.fetchList(TENANTS_API);
        if (els.tenantSelect) els.tenantSelect.innerHTML = '<option value="">— Nessuno —</option>' +
            tenants.map(t => `<option value="${t.id}">${escapeHtml(t.surname)} ${escapeHtml(t.name)}</option>`).join('');
    }

    async function loadClients() {
        clients = await Pagination.fetchList(CLIENTS_API, { status: 'active' });
        if (els.clientSelect) els.clientSelect.innerHTML = '<option value="">— Nessuno —</option>' +
            clients.map(c => `<option value="${c.id}">${escapeHtml(c.surname)} ${escapeHtml(c.name)}</option>`).join('');
    }

    // -------------------------------------------------------------------------
    // List
    // -------------------------------------------------------------------------

    async function loadContracts() {
        const params = new URLSearchParams();
        if (els.search?.value.trim()) params.set('search', els.search.value.trim());
        if (els.propFilter.value)     params.set('property_id', els.propFilter.value);
        if (els.typeFilter.value)     params.set('type', els.typeFilter.value);
        const activeStatus = document.querySelector('#contract-status-pills .filter-pill.is-active')?.dataset.status || '';
        if (activeStatus === '__expired') params.set('expired', '1');
        else if (activeStatus)            params.set('status', activeStatus);
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);

        const url = `${API}?${params}`;
        softLoad(els.grid, '<div class="entity-loading">Caricamento…</div>');

        try {
            const res  = await fetch(url);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const parsed = Pagination.parseResponse(json);
            contracts = parsed.items;
            renderCards();
            Pagination.render(els.pagination, parsed, (p) => { currentPage = p; loadContracts(); });
        } catch (err) {
            els.grid.classList.remove('is-loading');
            els.grid.innerHTML = `<div class="entity-error">${escapeHtml(err.message)}</div>`;
        }
    }

    function renderCards() {
        els.grid.classList.remove('is-loading');
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
            <div class="entity-card contract-card contract-card--${c.status} entity-card--clickable" data-id="${c.id}">
                <div class="entity-card__header">
                    <div class="entity-card__title-group">
                        <div class="entity-card__name">${escapeHtml(c.title)}</div>
                        <div class="contract-card__badges">
                            <span class="badge badge--contract-type badge--contract-type-${c.contract_type}">${TYPE_LABELS[c.contract_type] || c.contract_type}</span>
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
                        ${window.canWrite !== false ? advanceBtn : ''}
                        ${window.canWrite !== false ? `<button class="btn btn--sm btn--ghost btn-esign" data-id="${c.id}" title="Firma digitale">✍️</button>
                        <button class="btn btn--sm btn--ghost btn-edit" data-id="${c.id}" title="Modifica"><i data-lucide="pencil"></i></button>
                        <button class="btn btn--sm btn--ghost btn-delete" data-id="${c.id}" title="Elimina"><i data-lucide="trash-2"></i></button>` : ''}
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
            btn.addEventListener('click', async () => {
                if (await confirmDialog('Vuoi eliminare questo contratto?', { title: 'Elimina contratto' })) deleteContract(btn.dataset.id);
            });
        });

        els.grid.querySelectorAll('.btn-esign').forEach(btn => {
            btn.addEventListener('click', () => openEsignModal(btn.dataset.id));
        });

        els.grid.querySelectorAll('.entity-card--clickable').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('button, a, input')) return;
                const c = contracts.find(x => x.id == card.dataset.id);
                if (c) openSchedaModal(c);
            });
        });
    }

    // -------------------------------------------------------------------------
    // Scheda quick-view
    // -------------------------------------------------------------------------

    function openSchedaModal(c) {
        schedaContractId = c.id;
        const who = c.tenant_surname
            ? `${c.tenant_surname} ${c.tenant_name}`
            : (c.client_surname ? `${c.client_surname} ${c.client_name}` : '—');
        const dateRange = (c.start_date || c.end_date)
            ? `${formatDate(c.start_date)} → ${formatDate(c.end_date)}`
            : '—';

        document.getElementById('scheda-ct-title').textContent = c.title;
        document.getElementById('scheda-ct-badges').innerHTML =
            `<span class="badge badge--contract-type badge--contract-type-${c.contract_type}">${TYPE_LABELS[c.contract_type] || c.contract_type}</span>
             <span class="badge badge--contract-${c.status}">${STATUS_LABELS[c.status] || c.status}</span>`;

        document.getElementById('scheda-ct-body').innerHTML = `
            <div class="scheda-rows">
                <div class="scheda-row"><span class="scheda-row__label">🏢 Immobile</span><span class="scheda-row__value">${escapeHtml(c.property_address)}, ${escapeHtml(c.property_city)}</span></div>
                <div class="scheda-row"><span class="scheda-row__label">👤 Parte</span><span class="scheda-row__value">${escapeHtml(who)}</span></div>
                <div class="scheda-row"><span class="scheda-row__label">📅 Durata</span><span class="scheda-row__value">${escapeHtml(dateRange)}</span></div>
                ${c.monthly_rent != null && c.monthly_rent !== '' ? `<div class="scheda-row"><span class="scheda-row__label">💶 Canone</span><span class="scheda-row__value">€ ${formatPrice(c.monthly_rent)}/mese</span></div>` : ''}
                ${c.deposit ? `<div class="scheda-row"><span class="scheda-row__label">🔐 Deposito</span><span class="scheda-row__value">€ ${formatPrice(c.deposit)}</span></div>` : ''}
                ${c.notes ? `<div class="scheda-row"><span class="scheda-row__label">📝 Note</span><span class="scheda-row__value">${escapeHtml(c.notes)}</span></div>` : ''}
                <div class="scheda-row"><span class="scheda-row__label">📎 Documenti</span><span class="scheda-row__value" id="scheda-ct-docs">Caricamento…</span></div>
            </div>`;

        const advBtn = document.getElementById('scheda-ct-advance');
        const ns = nextStatus(c.status);
        if (ns) {
            advBtn.textContent = `→ ${STATUS_LABELS[ns]}`;
            advBtn.hidden = false;
        } else {
            advBtn.hidden = true;
        }

        const genBtn = document.getElementById('scheda-ct-generate');
        genBtn.hidden = !(c.contract_type === 'locazione' && c.tenant_id && c.monthly_rent && c.start_date && c.end_date);

        document.getElementById('contract-scheda-modal').hidden = false;
        loadContractDocuments(c.id);
    }

    async function loadContractDocuments(contractId) {
        const el = document.getElementById('scheda-ct-docs');
        if (!el) return;
        try {
            const res  = await fetch(`api/documents.php?contract_id=${contractId}&limit=100`);
            const json = await res.json();
            const docs = json.success ? Pagination.parseResponse(json).items.filter(d => d.doc_type !== 'contratto') : [];
            el.innerHTML = docs.length
                ? docs.map(d => `<a href="${d.download_url}" target="_blank" rel="noopener" style="display:inline-block;margin-right:8px">${escapeHtml(d.title || d.original_name)}</a>`).join('')
                : '<span class="text-muted">Nessun documento allegato.</span>';
        } catch (err) {
            el.innerHTML = '<span class="text-muted">—</span>';
        }
    }

    function closeSchedaModal() {
        schedaContractId = null;
        document.getElementById('contract-scheda-modal').hidden = true;
    }

    async function generatePayments(id) {
        const c = contracts.find(x => x.id == id);
        if (!c) return;

        const msPerMonth    = 1000 * 60 * 60 * 24 * 30.44;
        const approxMonths  = Math.ceil((new Date(c.end_date) - new Date(c.start_date)) / msPerMonth);

        if (!await confirmDialog(
            `Verranno creati circa ${approxMonths} pagamenti da € ${formatPrice(c.monthly_rent)}/mese per questo contratto.\n\nProcedere?`,
            { title: 'Genera scadenzario pagamenti', confirmText: 'Genera', danger: false }
        )) return;

        try {
            const res  = await fetch(`${API}?action=generate_payments&id=${id}`, { method: 'POST' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert(`Scadenzario creato: ${json.data.payments_created} pagamenti.`, 'success');
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    // -------------------------------------------------------------------------
    // E-signature
    // -------------------------------------------------------------------------

    function openEsignModal(contractId) {
        document.getElementById('esign-contract-id').value = contractId;
        document.getElementById('esign-name').value = '';
        document.getElementById('esign-email').value = '';
        document.getElementById('esign-link-result').hidden = true;
        document.getElementById('esign-modal-submit').hidden = false;
        document.getElementById('esign-modal').hidden = false;
    }

    function closeEsignModal() {
        document.getElementById('esign-modal').hidden = true;
    }

    async function generateEsignLink(e) {
        e.preventDefault();
        const contractId = document.getElementById('esign-contract-id').value;
        const signerName  = document.getElementById('esign-name').value.trim();
        const signerEmail = document.getElementById('esign-email').value.trim();
        const btn = document.getElementById('esign-modal-submit');
        btn.disabled = true;
        btn.textContent = 'Generazione…';
        try {
            const res  = await fetch(ESIGN_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contract_id: parseInt(contractId, 10), signer_name: signerName, signer_email: signerEmail }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const base = window.location.origin + window.location.pathname.replace(/index\.php.*/, '');
            const signUrl = `${base}sign.php?token=${json.data.token}`;
            document.getElementById('esign-link-url').value = signUrl;
            document.getElementById('esign-link-result').hidden = false;
            btn.hidden = true;
            const emailSent = json.data.email_sent;
            const alertMsg  = emailSent
                ? 'Link di firma generato e email inviata automaticamente al firmatario.'
                : 'Link di firma generato. Copia e invia il link manualmente al firmatario.';
            showAlert(alertMsg, emailSent ? 'success' : 'warning');
            const hintEl = document.getElementById('esign-link-hint');
            if (hintEl) hintEl.textContent = emailSent
                ? '✉️ Email di invito inviata automaticamente al firmatario.'
                : '⚠️ Email non configurata — invia questo link al firmatario via email o WhatsApp.';
        } catch (err) {
            showAlert(err.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Genera link';
        }
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
