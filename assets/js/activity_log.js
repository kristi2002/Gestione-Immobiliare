/**
 * Activity Log (Log Attività) — read-only paginated table (Phase 10)
 */
(function () {
    'use strict';

    const API = 'api/activity_log.php';

    const ACTION_LABELS = {
        create: 'Creazione',
        update: 'Modifica',
        delete: 'Eliminazione',
        login:  'Accesso',
        logout: 'Uscita',
    };

    let currentPage = 1;
    let filterTimer = null;

    const els = {};

    function init() {
        els.tbody        = document.getElementById('log-tbody');
        els.alert        = document.getElementById('log-alert');
        els.actionFilter = document.getElementById('log-action-filter');
        els.entityFilter = document.getElementById('log-entity-filter');
        els.fromFilter   = document.getElementById('log-from-filter');
        els.toFilter     = document.getElementById('log-to-filter');
        els.pagination   = document.getElementById('log-pagination');

        els.actionFilter.addEventListener('change', () => { currentPage = 1; loadLog(); });
        [els.fromFilter, els.toFilter].forEach(el => el.addEventListener('change', () => { currentPage = 1; loadLog(); }));
        els.entityFilter.addEventListener('input', () => {
            clearTimeout(filterTimer);
            filterTimer = setTimeout(() => { currentPage = 1; loadLog(); }, 400);
        });

        loadLog();
    }

    async function loadLog() {
        const params = new URLSearchParams();
        if (els.actionFilter.value)       params.set('action', els.actionFilter.value);
        if (els.entityFilter.value.trim())params.set('entity_type', els.entityFilter.value.trim());
        if (els.fromFilter.value)         params.set('from', els.fromFilter.value);
        if (els.toFilter.value)           params.set('to', els.toFilter.value);
        params.set('page', currentPage);

        softLoad(els.tbody, '<tr><td colspan="6" class="table-empty">Caricamento...</td></tr>');

        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            renderTable(json.data);
        } catch (err) {
            els.tbody.classList.remove('is-loading');
            els.tbody.innerHTML = `<tr><td colspan="6" class="table-empty table-empty--error">${escapeHtml(err.message)}</td></tr>`;
        }
    }

    function renderTable(data) {
        els.tbody.classList.remove('is-loading');
        const items = data.items || [];
        if (items.length === 0) {
            els.tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Nessuna attività registrata.</td></tr>';
            els.pagination.innerHTML = '';
            return;
        }

        els.tbody.innerHTML = items.map(r => `
            <tr>
                <td data-label="Data/Ora">${formatDateTime(r.created_at)}</td>
                <td data-label="Utente">${escapeHtml(r.username || '—')}</td>
                <td data-label="Azione"><span class="badge badge--log-${r.action}">${ACTION_LABELS[r.action] || r.action}</span></td>
                <td data-label="Entità">${escapeHtml(r.entity_type || '—')}${r.entity_id ? ' #' + r.entity_id : ''}</td>
                <td data-label="Descrizione">${escapeHtml(r.description || '—')}</td>
                <td data-label="IP">${escapeHtml(r.ip_address || '—')}</td>
            </tr>
        `).join('');

        renderPagination(data);
    }

    function renderPagination(data) {
        if (data.pages <= 1) {
            els.pagination.innerHTML = '';
            return;
        }
        els.pagination.innerHTML = `
            <button class="btn btn--ghost btn--sm" id="log-prev" ${data.page <= 1 ? 'disabled' : ''}>‹ Precedente</button>
            <span class="log-pagination__info">Pagina ${data.page} di ${data.pages} (${data.total} voci)</span>
            <button class="btn btn--ghost btn--sm" id="log-next" ${data.page >= data.pages ? 'disabled' : ''}>Successiva ›</button>`;

        const prev = document.getElementById('log-prev');
        const next = document.getElementById('log-next');
        if (prev) prev.addEventListener('click', () => { if (currentPage > 1) { currentPage--; loadLog(); } });
        if (next) next.addEventListener('click', () => { if (currentPage < data.pages) { currentPage++; loadLog(); } });
    }

    function formatDateTime(dateStr) {
        if (!dateStr) return '—';
        return new Date(dateStr.replace(' ', 'T')).toLocaleString('it-IT', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
        });
    }

    function escapeHtml(str) {
        if (str == null) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    init();
})();
