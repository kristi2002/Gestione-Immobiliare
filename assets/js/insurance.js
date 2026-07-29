(function () {
    'use strict';

    const API = 'api/insurance.php';

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
    function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

    let currentPage = 1;
    const PAGE_LIMIT = 25;
    let deleteTargetId = null;

    const els = {};

    /**
     * Nuova / modifica polizza vivono nella pagina schema-driven
     * (assets/js/entity_edit/schemas/insurance.js). Qui resta solo la lista.
     */
    function openForm(id) {
        if (!window.App) return;
        window.App.navigateTo('entity_edit', id ? { entity: 'insurance', id } : { entity: 'insurance' });
    }

    function init() {
        els.alert       = document.getElementById('insurance-alert');
        els.tbody       = document.getElementById('insurance-tbody');
        els.pagination  = document.getElementById('insurance-pagination');
        els.search      = document.getElementById('insurance-search');
        els.typeFilter  = document.getElementById('insurance-type-filter');
        els.expiringChk = document.getElementById('insurance-expiring-toggle');
        els.delModal    = document.getElementById('insurance-delete-modal');

        bindEvents();
        loadInsurances();
    }

    function bindEvents() {
        document.getElementById('btn-new-insurance').addEventListener('click', () => openForm());

        document.getElementById('insurance-delete-close').addEventListener('click', closeDeleteModal);
        document.getElementById('insurance-delete-cancel').addEventListener('click', closeDeleteModal);
        document.getElementById('insurance-delete-confirm').addEventListener('click', confirmDelete);
        els.delModal.addEventListener('click', e => { if (e.target === els.delModal) closeDeleteModal(); });

        els.search.addEventListener('input', debounce(() => { currentPage = 1; loadInsurances(); }, 300));
        els.typeFilter.addEventListener('change', () => { currentPage = 1; loadInsurances(); });
        els.expiringChk.addEventListener('change', () => { currentPage = 1; loadInsurances(); });
    }

    async function loadInsurances() {
        const params = new URLSearchParams();
        const search = els.search.value.trim();
        const type   = els.typeFilter.value;
        if (search) params.set('search', search);
        if (type)   params.set('policy_type', type);
        if (els.expiringChk.checked) params.set('expiring_soon', '1');
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);

        softLoad(els.tbody, '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:2rem;">Caricamento…</td></tr>');

        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const parsed = window.Pagination.parseResponse(json);
            renderStats((json.data && json.data.stats) || {});
            renderRows(parsed.items);
            window.Pagination.render(els.pagination, parsed, p => { currentPage = p; loadInsurances(); });
        } catch (err) {
            els.tbody.classList.remove('is-loading');
            els.tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--color-danger);padding:2rem;">${esc(err.message)}</td></tr>`;
        }
    }

    function renderStats(stats) {
        document.getElementById('stat-total-policies').textContent = stats.total ?? '—';
        document.getElementById('stat-expiring-soon').textContent  = stats.expiring_soon ?? '—';
        const cost = stats.annual_cost_total;
        document.getElementById('stat-annual-cost').textContent = cost != null
            ? new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(cost)
            : '—';
    }

    function renderRows(items) {
        els.tbody.classList.remove('is-loading');
        if (!items.length) {
            els.tbody.innerHTML = '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:2rem;">Nessuna polizza trovata.</td></tr>';
            return;
        }
        const today = new Date();
        const warn  = new Date(); warn.setDate(warn.getDate() + 30);

        els.tbody.innerHTML = items.map(p => {
            const endDate    = p.end_date ? new Date(p.end_date) : null;
            const isExpiring = endDate && endDate <= warn && endDate >= today;
            const isExpired  = endDate && endDate < today;
            const rowClass   = (isExpiring || isExpired) ? 'row--warning' : '';
            const dateLabel  = p.end_date ? formatDate(p.end_date) : '—';
            const premium    = p.premium_annual != null
                ? new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(p.premium_annual)
                : '—';

            return `<tr class="${rowClass}">
                <td data-label="Immobile">${esc(p.property_address || p.property_title || `#${p.property_id}`)}</td>
                <td data-label="Proprietario">${esc(p.client_surname && p.client_name ? `${p.client_surname} ${p.client_name}` : (p.client_surname || p.client_name || '—'))}</td>
                <td data-label="Compagnia">${esc(p.insurer_name)}</td>
                <td data-label="N° polizza">${esc(p.policy_number || '—')}</td>
                <td data-label="Tipo"><span class="badge">${esc(p.policy_type || '—')}</span></td>
                <td data-label="Premio annuo">${premium}</td>
                <td data-label="Scadenza">${isExpired ? `<span style="color:var(--color-danger);">${dateLabel}</span>` : isExpiring ? `<strong>${dateLabel}</strong>` : dateLabel}</td>
                <td data-label="Azioni" class="col-actions" style="white-space:nowrap;">
                    <button class="btn btn--sm btn--ghost btn-ins-edit" data-id="${p.id}" title="Modifica"><i data-lucide="pencil"></i></button>
                    <button class="btn btn--sm btn--ghost btn-ins-del" data-id="${p.id}" data-name="${esc(p.policy_number || p.insurer_name)}" title="Elimina"><i data-lucide="trash-2"></i></button>
                </td>
            </tr>`;
        }).join('');

        // Niente fetch preventivo: la scheda si carica il record da sola.
        els.tbody.querySelectorAll('.btn-ins-edit').forEach(btn => {
            btn.addEventListener('click', () => openForm(Number(btn.dataset.id)));
        });

        els.tbody.querySelectorAll('.btn-ins-del').forEach(btn => {
            btn.addEventListener('click', () => {
                deleteTargetId = btn.dataset.id;
                document.getElementById('insurance-delete-name').textContent = btn.dataset.name;
                els.delModal.hidden = false;
            });
        });
    }

    function closeDeleteModal() { els.delModal.hidden = true; deleteTargetId = null; }

    async function confirmDelete() {
        if (!deleteTargetId) return;
        const btn = document.getElementById('insurance-delete-confirm');
        btn.disabled = true;
        try {
            const res  = await fetch(`${API}?id=${deleteTargetId}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeDeleteModal();
            showAlert('Polizza eliminata.', 'success');
            loadInsurances();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    function showAlert(msg, type) {
        els.alert.textContent    = msg;
        els.alert.className      = `alert alert--${type}`;
        els.alert.style.display  = 'block';
        clearTimeout(els.alert._t);
        els.alert._t = setTimeout(() => { els.alert.style.display = 'none'; }, 5000);
    }

    function formatDate(str) { return window.Fmt.date(str); }

    init();
})();
