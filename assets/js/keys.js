/**
 * Gestione chiavi — property key tracking
 */
(function () {
    'use strict';

    const API = 'api/property_keys.php';
    const PROP_API = 'api/properties.php';
    const LEADS_API = 'api/leads.php';

    const STATUS_LABELS = { out: 'In possesso', in_office: 'In ufficio', lost: 'Smarrite' };

    let keys = [];
    let properties = [];
    let agents = [];
    let currentPage = 1;
    const PAGE_LIMIT = 25;
    let searchTimer = null;
    const els = {};

    function init() {
        els.grid = document.getElementById('keys-grid');
        els.pagination = document.getElementById('keys-pagination');
        els.search = document.getElementById('key-search');
        els.statusFilter = document.getElementById('key-status-filter');
        els.alert = document.getElementById('keys-alert');
        els.modal = document.getElementById('key-modal');
        els.form = document.getElementById('key-form');

        bindEvents();
        Promise.all([loadProperties(), loadAgents()]).then(() => loadKeys());
    }

    function bindEvents() {
        document.getElementById('btn-new-key').addEventListener('click', () => openModal());
        document.getElementById('key-modal-close').addEventListener('click', closeModal);
        document.getElementById('key-modal-cancel').addEventListener('click', closeModal);
        els.form.addEventListener('submit', handleSubmit);
        els.search.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => { currentPage = 1; loadKeys(); }, 300);
        });
        els.statusFilter.addEventListener('change', () => { currentPage = 1; loadKeys(); });
        els.modal.addEventListener('click', e => { if (e.target === els.modal) closeModal(); });
    }

    async function loadProperties() {
        properties = await Pagination.fetchList(PROP_API);
        const sel = document.getElementById('key-property');
        sel.innerHTML = '<option value="">— Seleziona —</option>' +
            properties.map(p => `<option value="${p.id}">${escapeHtml(p.address)}, ${escapeHtml(p.city)}</option>`).join('');
    }

    async function loadAgents() {
        const res = await fetch(`${LEADS_API}?action=agents`);
        const json = await res.json();
        if (json.success) {
            agents = json.data;
            const sel = document.getElementById('key-holder');
            sel.innerHTML = '<option value="">— Nessuno —</option>' +
                agents.map(a => `<option value="${a.id}">${escapeHtml(a.username)}</option>`).join('');
        }
    }

    async function loadKeys() {
        const params = new URLSearchParams();
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);
        if (els.search.value.trim()) params.set('search', els.search.value.trim());
        if (els.statusFilter.value) params.set('status', els.statusFilter.value);

        softLoad(els.grid, '<div class="entity-loading">Caricamento…</div>');
        try {
            const res = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const parsed = Pagination.parseResponse(json);
            keys = parsed.items;
            renderCards();
            Pagination.render(els.pagination, parsed, p => { currentPage = p; loadKeys(); });
        } catch (err) {
            els.grid.classList.remove('is-loading');
            els.grid.innerHTML = `<div class="entity-error">${escapeHtml(err.message)}</div>`;
        }
    }

    function renderCards() {
        els.grid.classList.remove('is-loading');
        if (!keys.length) {
            els.grid.innerHTML = '<div class="entity-empty">Nessun registro chiavi.</div>';
            return;
        }
        els.grid.innerHTML = keys.map(k => `
            <div class="entity-card">
                <div class="entity-card__header">
                    <strong><i data-lucide="key"></i> ${escapeHtml(k.address)}, ${escapeHtml(k.city)}</strong>
                    <span class="badge badge--key-${k.status}">${STATUS_LABELS[k.status] || k.status}</span>
                </div>
                <div class="entity-card__body">
                    <div class="entity-card__info">Detentore: ${escapeHtml(k.holder_username || k.holder_name || '—')}</div>
                    ${k.location ? `<div class="entity-card__info text-muted"><i data-lucide="map-pin"></i> ${escapeHtml(k.location)}</div>` : ''}
                    ${k.handed_at ? `<div class="entity-card__info text-muted">Consegnate: ${formatDate(k.handed_at)}</div>` : ''}
                </div>
                <div class="entity-card__footer">
                    <button class="btn btn--sm btn--ghost btn-edit-key" data-id="${k.id}">Modifica</button>
                </div>
            </div>`).join('');

        els.grid.querySelectorAll('.btn-edit-key').forEach(btn => {
            btn.addEventListener('click', () => {
                const item = keys.find(x => x.id == btn.dataset.id);
                if (item) openModal(item);
            });
        });
    }

    function openModal(item = null) {
        document.getElementById('key-modal-title').textContent = item ? 'Modifica chiavi' : 'Registra chiavi';
        document.getElementById('key-id').value = item?.id || '';
        document.getElementById('key-property').value = item?.property_id || '';
        document.getElementById('key-holder').value = item?.holder_id || '';
        document.getElementById('key-holder-name').value = item?.holder_name || '';
        document.getElementById('key-status').value = item?.status || 'in_office';
        document.getElementById('key-location').value = item?.location || '';
        document.getElementById('key-handed').value = item?.handed_at || '';
        document.getElementById('key-returned').value = item?.returned_at || '';
        document.getElementById('key-notes').value = item?.notes || '';
        els.modal.hidden = false;
    }

    function closeModal() { els.modal.hidden = true; }

    async function handleSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('key-id').value;
        const payload = {
            property_id: parseInt(document.getElementById('key-property').value, 10),
            holder_id: document.getElementById('key-holder').value || null,
            holder_name: document.getElementById('key-holder-name').value.trim() || null,
            status: document.getElementById('key-status').value,
            location: document.getElementById('key-location').value.trim() || null,
            handed_at: document.getElementById('key-handed').value || null,
            returned_at: document.getElementById('key-returned').value || null,
            notes: document.getElementById('key-notes').value.trim() || null,
        };
        const url = id ? `${API}?id=${id}` : API;
        const method = id ? 'PUT' : 'POST';
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!json.success) { showAlert(json.error, 'error'); return; }
        closeModal();
        loadKeys();
    }

    function showAlert(msg, type) {
        els.alert.textContent = msg;
        els.alert.className = `alert alert--${type}`;
        els.alert.style.display = 'block';
        setTimeout(() => { els.alert.style.display = 'none'; }, 4000);
    }

    function formatDate(d) {
        if (!d) return '—';
        const p = d.split('-');
        return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d;
    }

    function escapeHtml(s) {
        if (!s) return '';
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    init();
})();
