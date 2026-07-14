/**
 * Leads (Potenziali clienti) — CRUD, matching, conversion (Phase 11)
 */
(function () {
    'use strict';

    const API = 'api/leads.php';

    const STATUS_LABELS = {
        new: 'Nuovo', contacted: 'Contattato', interested: 'Interessato',
        negotiating: 'In trattativa', converted: 'Convertito', lost: 'Perso',
    };
    // Pipeline column order for the kanban board.
    const KANBAN_ORDER = ['new', 'contacted', 'interested', 'negotiating', 'converted', 'lost'];
    let viewMode = 'kanban'; // 'kanban' | 'grid'
    const INTEREST_LABELS = { affitto: 'Affitto', acquisto: 'Acquisto', entrambi: 'Entrambi' };
    const SOURCE_LABELS = {
        telefono: 'Telefono', email: 'Email', web: 'Web',
        passaparola: 'Passaparola', social: 'Social', altro: 'Altro',
    };

    let leads = [];
    let agents = [];
    let searchTimer = null;
    let currentPage = 1;
    const PAGE_LIMIT = 25;
    let selectedIds = new Set();
    const els = {};

    function init() {
        els.grid          = document.getElementById('leads-grid');
        els.kanban        = document.getElementById('leads-kanban');
        els.statsbar      = document.getElementById('leads-statsbar');
        els.viewKanbanBtn = document.getElementById('lead-view-kanban');
        els.viewGridBtn   = document.getElementById('lead-view-grid');
        els.search        = document.getElementById('lead-search');
        els.statusFilter  = document.getElementById('lead-status-filter');
        els.interestFilter = document.getElementById('lead-interest-filter');
        els.alert         = document.getElementById('leads-alert');
        els.modal         = document.getElementById('lead-modal');
        els.form          = document.getElementById('lead-form');
        els.modalTitle    = document.getElementById('lead-modal-title');
        els.assigned      = document.getElementById('lead-assigned');
        els.matchModal    = document.getElementById('lead-match-modal');
        els.matchList     = document.getElementById('lead-match-list');
        els.matchTitle    = document.getElementById('lead-match-title');
        els.pagination    = document.getElementById('leads-pagination');
        els.bulkToolbar   = document.getElementById('leads-bulk-toolbar');
        els.bulkCount     = document.getElementById('leads-bulk-count');
        els.selectAll     = document.getElementById('leads-select-all');
        els.bulkAssignAgent = document.getElementById('bulk-assign-agent');
        els.tenantModal    = document.getElementById('lead-tenant-modal');
        els.tenantPropSel  = document.getElementById('lead-tenant-property');

        // Kanban is the default view: hide grid-only controls up front.
        if (viewMode === 'kanban') {
            if (els.grid) els.grid.hidden = true;
            if (els.statsbar) els.statsbar.hidden = false;
            if (els.statusFilter) els.statusFilter.style.display = 'none';
        }

        bindEvents();
        loadAgents().then(loadLeads);
        loadPropertiesForTenantModal();
    }

    function bindEvents() {
        document.getElementById('btn-new-lead').addEventListener('click', () => {
            if (window.App) window.App.navigateTo('lead_edit');
        });
        document.getElementById('lead-match-close').addEventListener('click', closeMatchModal);
        document.getElementById('lead-match-ok').addEventListener('click', closeMatchModal);

        document.getElementById('bulk-archive-leads').addEventListener('click', () => bulkAction('archive'));
        document.getElementById('bulk-assign-leads').addEventListener('click', () => bulkAction('assign'));
        els.selectAll.addEventListener('change', toggleSelectAll);

        els.search.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => { currentPage = 1; loadLeads(); }, 300);
        });
        els.statusFilter.addEventListener('change', () => { currentPage = 1; loadLeads(); });
        els.interestFilter.addEventListener('change', () => { currentPage = 1; loadLeads(); });

        if (els.viewKanbanBtn) els.viewKanbanBtn.addEventListener('click', () => setViewMode('kanban'));
        if (els.viewGridBtn)   els.viewGridBtn.addEventListener('click', () => setViewMode('grid'));

        els.matchModal.addEventListener('click', (e) => { if (e.target === els.matchModal) closeMatchModal(); });

        document.getElementById('lead-tenant-modal-close').addEventListener('click', closeTenantModal);
        document.getElementById('lead-tenant-modal-cancel').addEventListener('click', closeTenantModal);
        document.getElementById('lead-tenant-modal-save').addEventListener('click', submitConvertToTenant);
        els.tenantModal.addEventListener('click', (e) => { if (e.target === els.tenantModal) closeTenantModal(); });
    }

    async function loadAgents() {
        try {
            const res = await fetch(`${API}?action=agents`);
            const json = await res.json();
            if (json.success) {
                agents = json.data;
                if (els.assigned) els.assigned.innerHTML = '<option value="">— Nessuno —</option>' +
                    agents.map(a => `<option value="${a.id}">${escapeHtml(a.username)}</option>`).join('');
                els.bulkAssignAgent.innerHTML = '<option value="">— Agente —</option>' +
                    agents.map(a => `<option value="${a.id}">${escapeHtml(a.username)}</option>`).join('');
            }
        } catch (err) { /* non blocking */ }
    }

    async function loadPropertiesForTenantModal() {
        try {
            const res  = await fetch('api/properties.php?limit=500');
            const json = await res.json();
            if (json.success) {
                const props = json.data.items || [];
                els.tenantPropSel.innerHTML = '<option value="">— Seleziona immobile —</option>' +
                    props.map(p => `<option value="${p.id}">${escapeHtml(p.address)}, ${escapeHtml(p.city)}</option>`).join('');
            }
        } catch (_) { /* non blocking */ }
    }

    async function loadLeads() {
        const kanban = viewMode === 'kanban';
        const params = new URLSearchParams();
        if (els.search.value.trim()) params.set('search', els.search.value.trim());
        // Kanban shows every stage as a column, so the single-status filter is ignored there.
        if (!kanban && els.statusFilter.value) params.set('status', els.statusFilter.value);
        if (els.interestFilter.value) params.set('interest_type', els.interestFilter.value);
        params.set('page', kanban ? 1 : currentPage);
        params.set('limit', kanban ? 500 : PAGE_LIMIT);

        const url = `${API}?${params}`;
        if (kanban) els.kanban.innerHTML = '<div class="entity-loading">Caricamento…</div>';
        else softLoad(els.grid, '<div class="entity-loading">Caricamento…</div>');

        try {
            const res = await fetch(url);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const parsed = Pagination.parseResponse(json);
            leads = parsed.items;
            if (kanban) {
                renderKanban();
                els.pagination.innerHTML = '';
            } else {
                renderCards();
                Pagination.render(els.pagination, parsed, (p) => { currentPage = p; loadLeads(); });
            }
        } catch (err) {
            const target = kanban ? els.kanban : els.grid;
            target.classList.remove('is-loading');
            target.innerHTML = `<div class="entity-error">${escapeHtml(err.message)}</div>`;
        }
    }

    function setViewMode(mode) {
        if (mode === viewMode) return;
        viewMode = mode;
        const kanban = mode === 'kanban';
        els.kanban.hidden = !kanban;
        els.statsbar.hidden = !kanban;
        els.grid.hidden = kanban;
        els.pagination.style.display = kanban ? 'none' : '';
        if (els.viewKanbanBtn) els.viewKanbanBtn.classList.toggle('active', kanban);
        if (els.viewGridBtn) els.viewGridBtn.classList.toggle('active', !kanban);
        // Status filter is meaningless in kanban mode.
        if (els.statusFilter) els.statusFilter.style.display = kanban ? 'none' : '';
        currentPage = 1;
        loadLeads();
    }

    function renderKanban() {
        const groups = {};
        KANBAN_ORDER.forEach(s => { groups[s] = []; });
        leads.forEach(l => { (groups[l.status] || (groups[l.status] = [])).push(l); });

        els.kanban.innerHTML = KANBAN_ORDER.map(status => {
            const items = groups[status] || [];
            const cards = items.length ? items.map(l => {
                const initials = ((l.name && l.name[0]) || '') + ((l.surname && l.surname[0]) || '');
                const budget = formatBudget(l.budget_min, l.budget_max);
                const interest = INTEREST_LABELS[l.interest_type] || l.interest_type || '';
                return `
                <div class="kcard" data-id="${l.id}">
                    <div class="kcard__top">
                        <div class="kcard__name">${escapeHtml(l.surname || '')} ${escapeHtml(l.name || '')}</div>
                        <span class="kcard__avatar">${escapeHtml(initials.toUpperCase())}</span>
                    </div>
                    ${interest ? `<div class="kcard__interest"><i data-lucide="tag"></i> ${escapeHtml(interest)}</div>` : ''}
                    ${budget ? `<div class="kcard__budget">${escapeHtml(budget)}</div>` : ''}
                    <div class="kcard__foot">
                        <span class="badge badge--lead-${status}">${STATUS_LABELS[status] || status}</span>
                        ${l.agent_name ? `<span class="kcard__agent">${escapeHtml(l.agent_name)}</span>` : ''}
                    </div>
                </div>`;
            }).join('') : '<div class="kanban__empty">Nessun lead</div>';
            return `
            <div class="kanban__col kanban__col--${status}">
                <div class="kanban__head">${STATUS_LABELS[status] || status}<span class="kanban__count">${items.length}</span></div>
                <div class="kanban__body">${cards}</div>
            </div>`;
        }).join('');

        els.kanban.querySelectorAll('.kcard').forEach(c => c.addEventListener('click', () => {
            if (window.App) window.App.navigateTo('lead_edit', { leadId: Number(c.dataset.id) });
        }));

        renderStatsBar();
        if (window.lucide) window.lucide.createIcons();
    }

    function renderStatsBar() {
        const total = leads.length;
        const converted = leads.filter(l => l.status === 'converted').length;
        const active = leads.filter(l => l.status !== 'converted' && l.status !== 'lost').length;
        const convRate = total ? Math.round((converted / total) * 100) : 0;
        // Pipeline value = sum of the upper budget (fallback lower) of still-active leads.
        const pipeline = leads
            .filter(l => l.status !== 'converted' && l.status !== 'lost')
            .reduce((sum, l) => sum + (Number(l.budget_max) || Number(l.budget_min) || 0), 0);
        const fmtEur = n => {
            if (n >= 1e6) return '€' + (n / 1e6).toFixed(1).replace('.0', '') + 'M';
            if (n >= 1e3) return '€' + Math.round(n / 1e3) + 'k';
            return '€' + n;
        };
        els.statsbar.innerHTML = `
            <div class="stat"><b>${convRate}%</b><span>Tasso di conversione</span><div class="bar"><i style="width:${convRate}%"></i></div></div>
            <div class="stat"><b>${active}</b><span>Lead attivi in pipeline</span></div>
            <div class="stat"><b>${fmtEur(pipeline)}</b><span>Valore stimato pipeline</span></div>
            <div class="stat"><b>${total}</b><span>Lead totali (pagina)</span></div>`;
    }

    function renderCards() {
        els.grid.classList.remove('is-loading');
        if (leads.length === 0) {
            els.grid.innerHTML = '<div class="entity-empty">Nessun lead trovato.</div>';
            return;
        }

        els.grid.innerHTML = leads.map(l => {
            const initials = (l.name[0] || '') + (l.surname[0] || '');
            const budget = formatBudget(l.budget_min, l.budget_max);
            return `
            <div class="entity-card lead-card lead-card--${l.status}" data-id="${l.id}">
                <div class="lead-card__header">
                    <label class="entity-card__select"><input type="checkbox" class="lead-bulk-cb" data-id="${l.id}" ${selectedIds.has(l.id) ? 'checked' : ''}></label>
                    <span class="lead-avatar">${escapeHtml(initials.toUpperCase())}</span>
                    <div class="lead-card__name">
                        <strong>${escapeHtml(l.surname)} ${escapeHtml(l.name)}</strong>
                        <span class="badge badge--lead-${l.status}">${STATUS_LABELS[l.status] || l.status}</span>
                    </div>
                </div>
                <div class="lead-card__body">
                    <div class="lead-meta"><span class="badge badge--interest">${INTEREST_LABELS[l.interest_type] || l.interest_type}</span>
                        ${budget ? `<span class="prop-chip"><i data-lucide="euro"></i> ${escapeHtml(budget)}</span>` : ''}</div>
                    ${l.codice_fiscale ? `<div class="entity-card__info"><i data-lucide="id-card"></i> <span style="font-family:monospace;font-size:12px">${escapeHtml(l.codice_fiscale)}</span></div>` : ''}
                    ${l.phone ? `<div class="entity-card__info"><i data-lucide="phone"></i> ${escapeHtml(l.phone)}</div>` : ''}
                    ${l.email ? `<div class="entity-card__info"><i data-lucide="mail"></i> ${escapeHtml(l.email)}</div>` : ''}
                    <div class="entity-card__info text-muted">Fonte: ${SOURCE_LABELS[l.source] || l.source}${l.agent_name ? ' · Agente: ' + escapeHtml(l.agent_name) : ''}</div>
                </div>
                <div class="entity-card__footer">
                    <button class="btn btn--sm btn--ghost btn-match" data-id="${l.id}"><i data-lucide="search"></i> Trova immobili compatibili</button>
                    <div class="entity-card__actions">
                        ${l.phone && window.WA ? window.WA.buttonHtml(l.phone) : ''}
                        <button class="btn btn--sm btn--ghost btn-edit" data-id="${l.id}" title="Modifica"><i data-lucide="pencil"></i></button>
                        ${(l.interest_type === 'acquisto' || l.interest_type === 'entrambi')
                            ? `<button class="btn btn--sm btn--ghost btn-convert" data-id="${l.id}" title="Converti in proprietario"><i data-lucide="user-round"></i></button>`
                            : ''}
                        ${(l.interest_type === 'affitto' || l.interest_type === 'entrambi')
                            ? `<button class="btn btn--sm btn--ghost btn-convert-tenant" data-id="${l.id}" title="Converti in inquilino"><i data-lucide="key-round"></i></button>`
                            : ''}
                        <button class="btn btn--sm btn--ghost btn-delete" data-id="${l.id}" title="Archivia"><i data-lucide="archive"></i></button>
                    </div>
                </div>
            </div>`;
        }).join('');

        els.grid.querySelectorAll('.lead-bulk-cb').forEach(cb => {
            cb.addEventListener('change', () => {
                const id = parseInt(cb.dataset.id, 10);
                if (cb.checked) selectedIds.add(id);
                else selectedIds.delete(id);
                updateBulkToolbar();
            });
        });

        els.grid.querySelectorAll('.btn-edit').forEach(b => b.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.App) window.App.navigateTo('lead_edit', { leadId: Number(b.dataset.id) });
        }));
        els.grid.querySelectorAll('.btn-match').forEach(b => b.addEventListener('click', () => showMatches(b.dataset.id)));
        els.grid.querySelectorAll('.btn-convert').forEach(b => b.addEventListener('click', () => convertLead(b.dataset.id)));
        els.grid.querySelectorAll('.btn-convert-tenant').forEach(b => b.addEventListener('click', () => {
            const l = leads.find(x => x.id == b.dataset.id);
            if (l) openTenantModal(l);
        }));
        els.grid.querySelectorAll('.btn-delete').forEach(b => b.addEventListener('click', () => archiveLead(b.dataset.id)));
        updateBulkToolbar();
    }

    function updateBulkToolbar() {
        const count = selectedIds.size;
        els.bulkCount.textContent = `${count} selezionat${count === 1 ? 'o' : 'i'}`;
        els.bulkToolbar.hidden = count === 0;
        const pageIds = leads.map(l => l.id);
        els.selectAll.checked = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
        els.selectAll.indeterminate = pageIds.some(id => selectedIds.has(id)) && !els.selectAll.checked;
    }

    function toggleSelectAll() {
        leads.forEach(l => {
            if (els.selectAll.checked) selectedIds.add(l.id);
            else selectedIds.delete(l.id);
        });
        renderCards();
    }

    async function bulkAction(operation) {
        const ids = [...selectedIds];
        if (!ids.length) return;
        if (operation === 'archive' && !await confirmDialog(`Vuoi archiviare ${ids.length} lead?`, { title: 'Archivia lead', confirmText: 'Archivia' })) return;

        const body = { action: 'bulk', operation, ids };
        if (operation === 'assign') {
            const assignedTo = els.bulkAssignAgent.value;
            if (!assignedTo) { showAlert('Seleziona un agente.', 'error'); return; }
            body.assigned_to = parseInt(assignedTo, 10);
        }

        try {
            const res = await fetch(`${API}?action=bulk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            selectedIds.clear();
            showAlert(`Operazione completata (${json.data.updated} aggiornati).`, 'success');
            loadLeads();
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    function openModal(lead = null) {
        els.form.reset();
        document.getElementById('lead-id').value = '';
        clearLeadModalError();
        if (lead) {
            els.modalTitle.textContent = 'Modifica Lead';
            document.getElementById('lead-id').value = lead.id;
            document.getElementById('lead-name').value = lead.name;
            document.getElementById('lead-surname').value = lead.surname;
            document.getElementById('lead-cf').value = lead.codice_fiscale || '';
            document.getElementById('lead-phone').value = lead.phone || '';
            document.getElementById('lead-email').value = lead.email || '';
            document.getElementById('lead-interest').value = lead.interest_type;
            document.getElementById('lead-budget-min').value = lead.budget_min ?? '';
            document.getElementById('lead-budget-max').value = lead.budget_max ?? '';
            document.getElementById('lead-city').value = lead.preferred_city || '';
            document.getElementById('lead-type').value = lead.preferred_type || '';
            document.getElementById('lead-min-rooms').value = lead.min_rooms ?? '';
            document.getElementById('lead-min-sqm').value = lead.min_sqm ?? '';
            document.getElementById('lead-status').value = lead.status;
            document.getElementById('lead-source').value = lead.source;
            document.getElementById('lead-assigned').value = lead.assigned_to || '';
            document.getElementById('lead-notes').value = lead.notes || '';
        } else {
            els.modalTitle.textContent = 'Nuovo Lead';
        }
        els.modal.hidden = false;
        document.getElementById('lead-name').focus();
    }

    function closeModal() { els.modal.hidden = true; }
    function closeMatchModal() { els.matchModal.hidden = true; }

    function showLeadModalError(message) {
        const el = document.getElementById('lead-modal-error');
        if (!el) return;
        el.textContent = message;
        el.style.display = 'block';
    }

    function clearLeadModalError() {
        const el = document.getElementById('lead-modal-error');
        if (el) el.style.display = 'none';
    }

    async function handleFormSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('lead-id').value;
        const data = {
            name: document.getElementById('lead-name').value.trim(),
            surname: document.getElementById('lead-surname').value.trim(),
            codice_fiscale: document.getElementById('lead-cf').value.trim().toUpperCase() || null,
            phone: document.getElementById('lead-phone').value.trim(),
            email: document.getElementById('lead-email').value.trim(),
            interest_type: document.getElementById('lead-interest').value,
            budget_min: document.getElementById('lead-budget-min').value,
            budget_max: document.getElementById('lead-budget-max').value,
            preferred_city: document.getElementById('lead-city').value.trim(),
            preferred_type: document.getElementById('lead-type').value,
            min_rooms: document.getElementById('lead-min-rooms').value,
            min_sqm: document.getElementById('lead-min-sqm').value,
            status: document.getElementById('lead-status').value,
            source: document.getElementById('lead-source').value,
            assigned_to: document.getElementById('lead-assigned').value || null,
            notes: document.getElementById('lead-notes').value.trim(),
        };
        const btn = document.getElementById('lead-modal-save');
        btn.disabled = true; btn.textContent = 'Salvataggio...';
        try {
            const url = id ? `${API}?id=${id}` : API;
            const res = await fetch(url, {
                method: id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeModal();
            showAlert('Lead salvato.', 'success');
            loadLeads();
        } catch (err) {
            showLeadModalError(err.message);
        } finally {
            btn.disabled = false; btn.textContent = 'Salva';
        }
    }

    async function showMatches(id) {
        const lead = leads.find(x => x.id == id);
        els.matchTitle.textContent = 'Immobili compatibili — ' + (lead ? `${lead.surname} ${lead.name}` : '');
        els.matchList.innerHTML = '<div class="entity-loading">Ricerca…</div>';
        els.matchModal.hidden = false;
        try {
            const res = await fetch(`${API}?action=match&lead_id=${id}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const props = json.data.properties;
            if (!props.length) {
                els.matchList.innerHTML = '<p class="text-muted">Nessun immobile compatibile.</p>';
                return;
            }
            els.matchList.innerHTML = props.map(p => `
                <div class="match-item">
                    <div>
                        <strong>${escapeHtml(p.address)}</strong>, ${escapeHtml(p.city)}<br>
                        <small class="text-muted">${p.rooms != null ? p.rooms + ' stanze · ' : ''}${p.sqm != null ? p.sqm + ' mq · ' : ''}${p.price != null ? '€ ' + p.price + ' (' + escapeHtml(p.price_type) + ')' : 'prezzo n.d.'}</small>
                    </div>
                    <button class="btn btn--sm btn--ghost btn-open-prop" data-prop-id="${p.id}">Apri</button>
                </div>`).join('');
            els.matchList.querySelectorAll('.btn-open-prop').forEach((b) => {
                b.addEventListener('click', () => {
                    closeMatchModal();
                    window.App.navigateTo('property_profile', { propertyId: parseInt(b.dataset.propId, 10) });
                });
            });
        } catch (err) {
            els.matchList.innerHTML = `<div class="entity-error">${escapeHtml(err.message)}</div>`;
        }
    }

    async function convertLead(id) {
        if (!await confirmDialog('Vuoi convertire questo lead in proprietario?', { title: 'Converti lead', confirmText: 'Converti', danger: false, icon: 'user' })) return;
        try {
            const res = await fetch(`${API}?action=convert&id=${id}`, { method: 'POST' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert('Lead convertito in proprietario.', 'success');
            loadLeads();
        } catch (err) { showAlert(err.message, 'error'); }
    }

    async function archiveLead(id) {
        if (!await confirmDialog('Vuoi archiviare questo lead (segnandolo come perso)?', { title: 'Archivia lead', confirmText: 'Archivia' })) return;
        try {
            const res = await fetch(`${API}?id=${id}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert('Lead archiviato.', 'success');
            loadLeads();
        } catch (err) { showAlert(err.message, 'error'); }
    }

    function openTenantModal(lead) {
        document.getElementById('lead-tenant-lead-id').value = lead.id;
        document.getElementById('lead-tenant-email').value   = lead.email || '';
        document.getElementById('lead-tenant-start').value   = '';
        document.getElementById('lead-tenant-end').value     = '';
        document.getElementById('lead-tenant-rent').value    = '';
        document.getElementById('lead-tenant-error').style.display = 'none';
        els.tenantModal.hidden = false;
    }

    function closeTenantModal() { els.tenantModal.hidden = true; }

    async function submitConvertToTenant() {
        const leadId = document.getElementById('lead-tenant-lead-id').value;
        const email  = document.getElementById('lead-tenant-email').value.trim();
        const propId = document.getElementById('lead-tenant-property').value;
        const start  = document.getElementById('lead-tenant-start').value;
        const end    = document.getElementById('lead-tenant-end').value;
        const rent   = document.getElementById('lead-tenant-rent').value;
        const errEl  = document.getElementById('lead-tenant-error');

        if (!email)  { errEl.textContent = 'L\'email è obbligatoria.'; errEl.style.display = 'block'; return; }
        if (!propId) { errEl.textContent = 'Seleziona un immobile.';   errEl.style.display = 'block'; return; }
        if (!start)  { errEl.textContent = 'Inserisci la data di inizio locazione.'; errEl.style.display = 'block'; return; }
        errEl.style.display = 'none';

        const btn = document.getElementById('lead-tenant-modal-save');
        btn.disabled = true; btn.textContent = 'Conversione...';

        try {
            const res  = await fetch(`${API}?action=convert_tenant&id=${leadId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email,
                    property_id:  parseInt(propId, 10),
                    lease_start:  start,
                    lease_end:    end   || null,
                    monthly_rent: rent  || null,
                }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeTenantModal();
            showAlert('Lead convertito in inquilino.', 'success');
            loadLeads();
        } catch (err) {
            errEl.textContent = err.message;
            errEl.style.display = 'block';
        } finally {
            btn.disabled = false; btn.textContent = 'Converti in Inquilino';
        }
    }

    function formatBudget(min, max) {
        if (min == null && max == null) return '';
        const f = n => Number(n).toLocaleString('it-IT');
        if (min != null && max != null) return `${f(min)} – ${f(max)} €`;
        if (min != null) return `da ${f(min)} €`;
        return `fino a ${f(max)} €`;
    }

    function showAlert(message, type) {
        els.alert.textContent = message;
        els.alert.className = `alert alert--${type}`;
        els.alert.style.display = 'block';
        clearTimeout(els.alert._timer);
        els.alert._timer = setTimeout(() => { els.alert.style.display = 'none'; }, 4000);
    }

    function escapeHtml(str) {
        if (str == null) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    init();
})();
