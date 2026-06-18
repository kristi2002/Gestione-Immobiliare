(function () {
    'use strict';

    // Maintenance requests come from api/reminders.php filtered by type='maintenance'
    const API           = 'api/reminders.php';
    const SUPPLIERS_API = 'api/suppliers.php';
    const PROP_API      = 'api/properties.php';

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
    function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

    const STATUS_LABELS = {
        aperta:        'Aperta',
        in_lavorazione: 'In lavorazione',
        completata:    'Completata',
        chiusa:        'Chiusa',
    };
    const STATUS_COLORS = {
        aperta:        '#3b82f6',
        in_lavorazione: '#f59e0b',
        completata:    '#22c55e',
        chiusa:        '#6b7280',
    };
    const PRIORITY_COLORS = {
        urgente: 'var(--color-danger,#c0392b)',
        alta:    'var(--color-warning,#e67e22)',
        normale: 'inherit',
        bassa:   '#999',
    };

    let currentPage  = 1;
    const PAGE_LIMIT = 25;
    let currentView  = 'table'; // 'table' | 'kanban'
    let allItems     = [];
    let suppliers    = [];
    const els        = {};

    function init() {
        els.alert          = document.getElementById('maintenance-workflow-alert');
        els.tbody          = document.getElementById('mw-tbody');
        els.pagination     = document.getElementById('mw-pagination');
        els.propFilter     = document.getElementById('mw-property-filter');
        els.statusFilter   = document.getElementById('mw-status-filter');
        els.priorityFilter = document.getElementById('mw-priority-filter');
        els.tableView      = document.getElementById('mw-table-view');
        els.kanbanView     = document.getElementById('mw-kanban-view');
        els.supplierModal  = document.getElementById('mw-supplier-modal');
        els.statusModal    = document.getElementById('mw-status-modal');

        bindEvents();
        loadProperties();
        loadSuppliers();
        loadRequests();
    }

    function bindEvents() {
        document.querySelectorAll('.mw-view-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.mw-view-toggle').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentView = btn.dataset.view;
                els.tableView.style.display  = currentView === 'table'  ? '' : 'none';
                els.kanbanView.style.display = currentView === 'kanban' ? '' : 'none';
                if (currentView === 'kanban') renderKanban(allItems);
            });
        });

        els.propFilter.addEventListener('change', () => { currentPage = 1; loadRequests(); });
        els.statusFilter.addEventListener('change', () => { currentPage = 1; loadRequests(); });
        els.priorityFilter.addEventListener('change', () => { currentPage = 1; loadRequests(); });

        // Supplier modal
        document.getElementById('mw-supplier-close').addEventListener('click', closeSupplierModal);
        document.getElementById('mw-supplier-cancel').addEventListener('click', closeSupplierModal);
        els.supplierModal.addEventListener('click', e => { if (e.target === els.supplierModal) closeSupplierModal(); });
        document.getElementById('mw-supplier-confirm').addEventListener('click', confirmAssignSupplier);

        // Status modal
        document.getElementById('mw-status-close').addEventListener('click', closeStatusModal);
        document.getElementById('mw-status-cancel').addEventListener('click', closeStatusModal);
        els.statusModal.addEventListener('click', e => { if (e.target === els.statusModal) closeStatusModal(); });
        document.getElementById('mw-status-confirm').addEventListener('click', confirmChangeStatus);
    }

    async function loadProperties() {
        try {
            const items = await window.Pagination.fetchList(PROP_API);
            items.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.address || p.title || `#${p.id}`;
                els.propFilter.appendChild(opt);
            });
        } catch (e) { /* non-critical */ }
    }

    async function loadSuppliers() {
        try {
            suppliers = await window.Pagination.fetchList(SUPPLIERS_API);
            const sel = document.getElementById('mw-supplier-select');
            suppliers.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = `${s.name}${s.category ? ` (${s.category})` : ''}`;
                sel.appendChild(opt);
            });
        } catch (e) { /* non-critical */ }
    }

    async function loadRequests() {
        const params = new URLSearchParams();
        params.set('type', 'maintenance');

        const prop     = els.propFilter.value;
        const status   = els.statusFilter.value;
        const priority = els.priorityFilter.value;

        if (prop)     params.set('property_id', prop);
        if (status)   params.set('maintenance_status', status);
        if (priority) params.set('priority', priority);
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);

        softLoad(els.tbody, '<tr><td colspan="9" class="text-muted" style="text-align:center;padding:2rem;">Caricamento…</td></tr>');

        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const parsed = window.Pagination.parseResponse(json);
            allItems = parsed.items;

            if (currentView === 'table') {
                renderTable(parsed.items);
                window.Pagination.render(els.pagination, parsed, p => { currentPage = p; loadRequests(); });
            } else {
                els.tbody.classList.remove('is-loading');
                renderKanban(parsed.items);
            }
        } catch (err) {
            els.tbody.classList.remove('is-loading');
            els.tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--color-danger);padding:2rem;">${esc(err.message)}</td></tr>`;
        }
    }

    function renderTable(items) {
        els.tbody.classList.remove('is-loading');
        if (!items.length) {
            els.tbody.innerHTML = '<tr><td colspan="9" class="text-muted" style="text-align:center;padding:2rem;">Nessuna richiesta di manutenzione trovata.</td></tr>';
            return;
        }

        els.tbody.innerHTML = items.map(r => {
            const status       = r.maintenance_status || 'aperta';
            const statusLabel  = STATUS_LABELS[status] || status;
            const statusColor  = STATUS_COLORS[status] || '#333';
            const priority     = r.priority || 'normale';
            const priorityColor = PRIORITY_COLORS[priority] || 'inherit';
            const supplierName = r.supplier_name || r.assigned_supplier || '—';
            const tenantName   = r.tenant_name || extractTenantFromNote(r.description) || '—';

            return `<tr>
                <td>${esc(tenantName)}</td>
                <td>${esc(r.property_address || `#${r.property_id}` || '—')}</td>
                <td title="${esc(r.note || '')}">${esc(r.title || (r.note ? r.note.substring(0, 50) : '—'))}</td>
                <td>${esc(r.request_type || r.category || '—')}</td>
                <td><span style="color:${priorityColor};font-weight:600;">${esc(priority)}</span></td>
                <td><span style="color:${statusColor};font-weight:600;">${esc(statusLabel)}</span></td>
                <td>${supplierName !== '—'
                    ? `<a href="#" class="btn-view-supplier text-muted" style="font-size:0.85rem;" data-supplier-id="${esc(r.supplier_id || '')}">${esc(supplierName)}</a>`
                    : '<span class="text-muted">—</span>'}</td>
                <td>${formatDate(r.created_at || r.due_date)}</td>
                <td style="white-space:nowrap;">
                    <button class="btn btn--sm btn--ghost btn-mw-supplier" data-id="${r.id}" data-supplier="${esc(r.supplier_id || '')}" title="Assegna fornitore">🔧 Fornitore</button>
                    <button class="btn btn--sm btn--ghost btn-mw-status" data-id="${r.id}" data-status="${esc(r.maintenance_status || 'aperta')}" title="Cambia stato">↻ Stato</button>
                </td>
            </tr>`;
        }).join('');

        els.tbody.querySelectorAll('.btn-mw-supplier').forEach(btn => {
            btn.addEventListener('click', () => openSupplierModal(btn.dataset.id, btn.dataset.supplier));
        });

        els.tbody.querySelectorAll('.btn-mw-status').forEach(btn => {
            btn.addEventListener('click', () => openStatusModal(btn.dataset.id, btn.dataset.status));
        });
    }

    function renderKanban(items) {
        const cols = ['aperta', 'in_lavorazione', 'completata', 'chiusa'];

        cols.forEach(status => {
            const colItems = items.filter(r => (r.maintenance_status || 'aperta') === status);
            const container = document.getElementById(`kanban-${status}`);
            const countEl   = document.getElementById(`col-count-${status}`);
            if (countEl) countEl.textContent = colItems.length;
            if (!container) return;

            if (!colItems.length) {
                container.innerHTML = '<div style="color:#bbb;font-size:0.85rem;text-align:center;padding:1rem;">Nessuna richiesta</div>';
                return;
            }

            container.innerHTML = colItems.map(r => {
                const priority     = r.priority || 'normale';
                const priorityColor = PRIORITY_COLORS[priority] || 'inherit';
                const tenantName   = r.tenant_name || extractTenantFromNote(r.description) || '—';
                const title        = r.title || (r.description ? r.description.substring(0, 60) : '—');

                return `<div class="card" style="padding:0.75rem;font-size:0.85rem;cursor:default;" data-id="${r.id}">
                    <div style="font-weight:600;margin-bottom:4px;">${esc(title)}</div>
                    <div class="text-muted" style="margin-bottom:6px;">👤 ${esc(tenantName)}</div>
                    ${r.property_address ? `<div class="text-muted" style="margin-bottom:6px;">🏠 ${esc(r.property_address)}</div>` : ''}
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;">
                        <span style="color:${priorityColor};font-weight:600;font-size:0.75rem;">${esc(priority.toUpperCase())}</span>
                        <div style="display:flex;gap:4px;">
                            <button class="btn btn--sm btn--ghost btn-k-supplier" data-id="${r.id}" data-supplier="${esc(r.supplier_id || '')}" style="font-size:0.7rem;padding:2px 6px;" title="Fornitore">🔧</button>
                            <button class="btn btn--sm btn--ghost btn-k-status" data-id="${r.id}" data-status="${esc(r.maintenance_status || 'aperta')}" style="font-size:0.7rem;padding:2px 6px;" title="Stato">↻</button>
                        </div>
                    </div>
                </div>`;
            }).join('');

            container.querySelectorAll('.btn-k-supplier').forEach(btn => {
                btn.addEventListener('click', e => { e.stopPropagation(); openSupplierModal(btn.dataset.id, btn.dataset.supplier); });
            });
            container.querySelectorAll('.btn-k-status').forEach(btn => {
                btn.addEventListener('click', e => { e.stopPropagation(); openStatusModal(btn.dataset.id, btn.dataset.status); });
            });
        });
    }

    function extractTenantFromNote(note) {
        if (!note) return null;
        // Tenant portal may prefix note with "[Inquilino: NAME]"
        const m = note.match(/\[Inquilino:\s*([^\]]+)\]/);
        return m ? m[1].trim() : null;
    }

    function openSupplierModal(requestId, currentSupplierId) {
        document.getElementById('mw-supplier-request-id').value = requestId;
        document.getElementById('mw-supplier-select').value     = currentSupplierId || '';
        els.supplierModal.hidden = false;
    }

    function closeSupplierModal() { els.supplierModal.hidden = true; }

    async function confirmAssignSupplier() {
        const requestId  = document.getElementById('mw-supplier-request-id').value;
        const supplierId = document.getElementById('mw-supplier-select').value;
        const btn = document.getElementById('mw-supplier-confirm');
        btn.disabled = true; btn.textContent = 'Salvataggio…';

        const supplier = suppliers.find(s => String(s.id) === String(supplierId));

        try {
            const res  = await fetch(`${API}?id=${requestId}&action=assign_supplier`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    supplier_id:   supplierId || null,
                    supplier_name: supplier ? supplier.name : null,
                }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeSupplierModal();
            showAlert('Fornitore assegnato.', 'success');
            loadRequests();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Assegna';
        }
    }

    function openStatusModal(requestId, currentStatus) {
        document.getElementById('mw-status-request-id').value = requestId;
        document.getElementById('mw-new-status').value        = currentStatus || 'aperta';
        els.statusModal.hidden = false;
    }

    function closeStatusModal() { els.statusModal.hidden = true; }

    async function confirmChangeStatus() {
        const requestId = document.getElementById('mw-status-request-id').value;
        const newStatus = document.getElementById('mw-new-status').value;
        const btn = document.getElementById('mw-status-confirm');
        btn.disabled = true; btn.textContent = 'Salvataggio…';

        try {
            const res  = await fetch(`${API}?id=${requestId}&action=maintenance_status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeStatusModal();
            showAlert(`Stato aggiornato: ${STATUS_LABELS[newStatus] || newStatus}.`, 'success');
            loadRequests();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Salva';
        }
    }

    function showAlert(msg, type) {
        els.alert.textContent   = msg;
        els.alert.className     = `alert alert--${type}`;
        els.alert.style.display = 'block';
        clearTimeout(els.alert._t);
        els.alert._t = setTimeout(() => { els.alert.style.display = 'none'; }, 5000);
    }

    function formatDate(str) {
        if (!str) return '—';
        return new Date(str).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    init();
})();
