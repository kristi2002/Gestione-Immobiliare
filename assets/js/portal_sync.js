(function () {
    'use strict';

    const API      = 'api/portal_sync.php';
    const PROP_API = 'api/properties.php';

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
    function fmtDateTime(str) { return str ? new Date(str.replace(' ', 'T')).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }

    const PORTAL_LABEL = { immobiliare: 'Immobiliare.it', idealista: 'Idealista', casa: 'Casa.it', subito: 'Subito', sito_agenzia: 'Sito agenzia', altro: 'Altro' };
    const STATUS_LABEL = { draft: 'Bozza', publishing: 'In pubblicazione', published: 'Pubblicato', error: 'Errore', removed: 'Rimosso' };
    const STATUS_BADGE = { draft: 'badge', publishing: 'badge--warning', published: 'badge--success', error: 'badge--danger', removed: 'badge' };

    let currentPage = 1;
    const PAGE_LIMIT = 25;
    let deleteTargetId = null;

    const els = {};

    function init() {
        els.alert      = document.getElementById('portal-alert');
        els.tbody      = document.getElementById('portal-tbody');
        els.pagination = document.getElementById('portal-pagination');
        els.portalF    = document.getElementById('portal-portal-filter');
        els.statusF    = document.getElementById('portal-status-filter');
        els.modal      = document.getElementById('portal-modal');
        els.form       = document.getElementById('portal-form');
        els.delModal   = document.getElementById('portal-delete-modal');

        bindEvents();
        loadProperties();
        loadList();
    }

    function bindEvents() {
        document.getElementById('btn-new-portal').addEventListener('click', () => openModal());
        document.getElementById('portal-modal-close').addEventListener('click', closeModal);
        document.getElementById('portal-modal-cancel').addEventListener('click', closeModal);
        els.modal.addEventListener('click', e => { if (e.target === els.modal) closeModal(); });
        els.form.addEventListener('submit', handleSubmit);

        document.getElementById('portal-delete-close').addEventListener('click', closeDeleteModal);
        document.getElementById('portal-delete-cancel').addEventListener('click', closeDeleteModal);
        document.getElementById('portal-delete-confirm').addEventListener('click', confirmDelete);
        els.delModal.addEventListener('click', e => { if (e.target === els.delModal) closeDeleteModal(); });

        els.portalF.addEventListener('change', () => { currentPage = 1; loadList(); });
        els.statusF.addEventListener('change', () => { currentPage = 1; loadList(); });
    }

    async function loadProperties() {
        try {
            const items = await window.Pagination.fetchList(PROP_API);
            const sel = document.getElementById('portal-property');
            items.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.address || `#${p.id}`;
                sel.appendChild(opt);
            });
        } catch (e) { /* non-critical */ }
    }

    async function loadList() {
        const params = new URLSearchParams();
        if (els.portalF.value) params.set('portal', els.portalF.value);
        if (els.statusF.value) params.set('status', els.statusF.value);
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);

        softLoad(els.tbody, '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:2rem;">Caricamento…</td></tr>');
        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const parsed = window.Pagination.parseResponse(json);
            renderStats((json.data && json.data.stats) || {});
            renderRows(parsed.items);
            window.Pagination.render(els.pagination, parsed, p => { currentPage = p; loadList(); });
        } catch (err) {
            els.tbody.classList.remove('is-loading');
            els.tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--color-danger);padding:2rem;">${esc(err.message)}</td></tr>`;
        }
    }

    function renderStats(s) {
        document.getElementById('stat-portal-total').textContent     = s.total ?? '—';
        document.getElementById('stat-portal-published').textContent = s.published ?? '—';
        document.getElementById('stat-portal-pending').textContent   = s.pending ?? '—';
        document.getElementById('stat-portal-errors').textContent    = s.errors ?? '—';
    }

    function renderRows(items) {
        els.tbody.classList.remove('is-loading');
        if (!items.length) {
            els.tbody.innerHTML = '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:2rem;">Nessuna pubblicazione. Aggiungine una per tracciare lo stato sui portali.</td></tr>';
            return;
        }
        els.tbody.innerHTML = items.map(l => {
            const idCell = l.external_url
                ? `<a href="${esc(l.external_url)}" target="_blank" rel="noopener">${esc(l.external_id || 'apri')}</a>`
                : esc(l.external_id || '—');
            return `<tr>
                <td data-label="Immobile">${esc(l.property_address || `#${l.property_id}`)}<br><small class="text-muted">${esc(l.property_city || '')}</small></td>
                <td data-label="Portale">${esc(PORTAL_LABEL[l.portal] || l.portal)}</td>
                <td data-label="Stato"><span class="badge ${STATUS_BADGE[l.status] || 'badge'}">${esc(STATUS_LABEL[l.status] || l.status)}</span>${l.status === 'error' && l.error_message ? `<br><small class="text-muted">${esc(l.error_message)}</small>` : ''}</td>
                <td data-label="ID annuncio">${idCell}</td>
                <td data-label="Ultimo sync">${fmtDateTime(l.last_synced_at)}</td>
                <td data-label="Azioni" class="col-actions" style="white-space:nowrap;">
                    <button class="btn btn--sm btn--ghost btn-portal-edit" data-id="${l.id}" title="Modifica"><i data-lucide="pencil"></i></button>
                    <button class="btn btn--sm btn--ghost btn-portal-del" data-id="${l.id}" title="Elimina"><i data-lucide="trash-2"></i></button>
                </td>
            </tr>`;
        }).join('');

        els.tbody.querySelectorAll('.btn-portal-edit').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    const res  = await fetch(`${API}?id=${btn.dataset.id}`);
                    const json = await res.json();
                    if (!json.success) throw new Error(json.error);
                    openModal(Array.isArray(json.data) ? json.data[0] : json.data);
                } catch (e) { showAlert(e.message, 'error'); }
            });
        });
        els.tbody.querySelectorAll('.btn-portal-del').forEach(btn => {
            btn.addEventListener('click', () => { deleteTargetId = btn.dataset.id; els.delModal.hidden = false; });
        });
    }

    function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v ?? ''; }

    function openModal(item = null) {
        els.form.reset();
        setVal('portal-id', '');
        document.getElementById('portal-modal-title').textContent = item ? 'Modifica pubblicazione' : 'Nuova pubblicazione';
        if (item) {
            setVal('portal-id', item.id);
            setVal('portal-property', item.property_id || '');
            setVal('portal-portal', item.portal || 'immobiliare');
            setVal('portal-status', item.status || 'draft');
            setVal('portal-external-id', item.external_id);
            setVal('portal-external-url', item.external_url);
            setVal('portal-error', item.error_message);
            setVal('portal-notes', item.notes);
        }
        els.modal.hidden = false;
    }

    function closeModal() { els.modal.hidden = true; }
    function closeDeleteModal() { els.delModal.hidden = true; deleteTargetId = null; }

    async function handleSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('portal-id').value;
        const btn = document.getElementById('portal-modal-save');
        btn.disabled = true; btn.textContent = 'Salvataggio…';
        const data = {
            property_id:  document.getElementById('portal-property').value,
            portal:       document.getElementById('portal-portal').value,
            status:       document.getElementById('portal-status').value,
            external_id:  document.getElementById('portal-external-id').value.trim(),
            external_url: document.getElementById('portal-external-url').value.trim(),
            error_message: document.getElementById('portal-error').value.trim(),
            notes:        document.getElementById('portal-notes').value.trim(),
        };
        try {
            const res  = await fetch(id ? `${API}?id=${id}` : API, {
                method: id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeModal();
            showAlert('Pubblicazione salvata.', 'success');
            loadList();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Salva';
        }
    }

    async function confirmDelete() {
        if (!deleteTargetId) return;
        const btn = document.getElementById('portal-delete-confirm');
        btn.disabled = true;
        try {
            const res  = await fetch(`${API}?id=${deleteTargetId}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeDeleteModal();
            showAlert('Pubblicazione eliminata.', 'success');
            loadList();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    function showAlert(msg, type) {
        els.alert.textContent   = msg;
        els.alert.className     = `alert alert--${type}`;
        els.alert.style.display = 'block';
        clearTimeout(els.alert._t);
        els.alert._t = setTimeout(() => { els.alert.style.display = 'none'; }, 5000);
    }

    init();
})();
