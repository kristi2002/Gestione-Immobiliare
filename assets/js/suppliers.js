(function () {
    'use strict';

    const API = 'api/suppliers.php';

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

    function copyToClipboard(text, btn) {
        const done = () => {
            if (!btn) return;
            const old = btn.innerHTML;
            btn.innerHTML = '<i data-lucide="check"></i>';
            if (window.lucide) window.lucide.createIcons();
            setTimeout(() => { btn.innerHTML = old; if (window.lucide) window.lucide.createIcons(); }, 1200);
        };
        if (navigator.clipboard) { navigator.clipboard.writeText(text).then(done).catch(done); }
        else { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (_) {} t.remove(); done(); }
    }
    function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

    let currentPage    = 1;
    const PAGE_LIMIT   = 24;
    let deleteTargetId = null;
    const els          = {};

    function init() {
        els.alert          = document.getElementById('suppliers-alert');
        els.grid           = document.getElementById('suppliers-grid');
        els.pagination     = document.getElementById('suppliers-pagination');
        els.search         = document.getElementById('suppliers-search');
        els.categoryFilter = document.getElementById('suppliers-category-filter');
        els.delModal       = document.getElementById('suppliers-delete-modal');

        bindEvents();
        loadSuppliers();
    }

    function bindEvents() {
        document.getElementById('btn-new-supplier').addEventListener('click', () => openForm());

        document.getElementById('suppliers-delete-close').addEventListener('click', closeDeleteModal);
        document.getElementById('suppliers-delete-cancel').addEventListener('click', closeDeleteModal);
        document.getElementById('suppliers-delete-confirm').addEventListener('click', confirmDelete);
        els.delModal.addEventListener('click', e => { if (e.target === els.delModal) closeDeleteModal(); });

        els.search.addEventListener('input', debounce(() => { currentPage = 1; loadSuppliers(); }, 300));
        els.categoryFilter.addEventListener('change', () => { currentPage = 1; loadSuppliers(); });
    }

    async function loadSuppliers() {
        const params = new URLSearchParams();
        const search = els.search.value.trim();
        const cat    = els.categoryFilter.value;
        if (search) params.set('search', search);
        if (cat)    params.set('category', cat);
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);

        softLoad(els.grid, '<div class="text-muted" style="text-align:center;padding:2rem;grid-column:1/-1;">Caricamento…</div>');

        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const parsed = window.Pagination.parseResponse(json);
            renderCards(parsed.items);
            window.Pagination.render(els.pagination, parsed, p => { currentPage = p; loadSuppliers(); });
        } catch (err) {
            els.grid.classList.remove('is-loading');
            els.grid.innerHTML = `<div style="color:var(--color-danger);padding:2rem;grid-column:1/-1;">${esc(err.message)}</div>`;
        }
    }

    function starsHtml(rating) {
        const v = parseInt(rating) || 0;
        return Array.from({ length: 5 }, (_, i) =>
            `<span style="color:${i < v ? '#f5a623' : '#ccc'}">${i < v ? '★' : '☆'}</span>`
        ).join('');
    }

    function renderCards(items) {
        els.grid.classList.remove('is-loading');
        if (!items.length) {
            els.grid.innerHTML = '<div class="text-muted" style="text-align:center;padding:2rem;grid-column:1/-1;">Nessun fornitore trovato.</div>';
            return;
        }

        els.grid.innerHTML = items.map(s => `
            <div class="entity-card supplier-card">
                <div class="entity-card__header">
                    <div class="entity-card__avatar"><i data-lucide="truck"></i></div>
                    <div class="entity-card__title-group">
                        <div class="entity-card__name">${esc(s.name)}</div>
                        <div class="supplier-card__sub">
                            ${s.category ? `<span class="badge">${esc(s.category)}</span>` : ''}
                            ${s.rating ? `<span class="supplier-card__rating">${starsHtml(s.rating)}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="entity-card__body">
                    ${s.phone ? `<div class="entity-card__info"><span class="entity-card__info-icon"><i data-lucide="phone"></i></span><span style="flex:1;min-width:0">${esc(s.phone)}</span><button class="btn--copy btn-copy" data-copy="${esc(s.phone)}" title="Copia numero"><i data-lucide="copy"></i></button></div>` : ''}
                    ${s.email ? `<div class="entity-card__info"><span class="entity-card__info-icon"><i data-lucide="mail"></i></span><a href="mailto:${esc(s.email)}" style="flex:1;min-width:0">${esc(s.email)}</a><button class="btn--copy btn-copy" data-copy="${esc(s.email)}" title="Copia email"><i data-lucide="copy"></i></button></div>` : ''}
                    ${s.address ? `<div class="entity-card__info"><span class="entity-card__info-icon"><i data-lucide="map-pin"></i></span><span style="flex:1;min-width:0">${esc(s.address)}</span></div>` : ''}
                    ${s.notes ? `<p class="entity-card__desc">${esc(s.notes)}</p>` : ''}
                    ${!s.phone && !s.email && !s.address ? `<div class="entity-card__info text-muted">Nessun contatto registrato</div>` : ''}
                </div>
                <div class="entity-card__footer">
                    <div class="entity-card__actions" style="margin-left:auto;">
                        ${window.RowMenu.button(s.id, 'Azioni fornitore', { name: s.name, phone: s.phone || '' })}
                    </div>
                </div>
            </div>
        `).join('');

        els.grid.querySelectorAll('.btn-copy').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); copyToClipboard(btn.dataset.copy, btn); });
        });

        window.RowMenu.bind(els.grid, btn => {
            const waUrl = btn.dataset.phone && window.WA ? window.WA.link(btn.dataset.phone) : '';
            return [
                waUrl ? { label: 'Scrivi su WhatsApp', html: window.WA.icon, href: waUrl, target: '_blank' } : null,
                { label: 'Modifica', icon: 'pencil', onClick: () => openForm(btn.dataset.id) },
                { sep: true },
                { label: 'Elimina', icon: 'trash-2', danger: true, onClick: () => {
                    deleteTargetId = btn.dataset.id;
                    document.getElementById('suppliers-delete-name').textContent = btn.dataset.name;
                    els.delModal.hidden = false;
                } },
            ];
        });
    }

    /**
     * La scheda fornitore e' una pagina (entity_edit), non piu' una finestra:
     * ha un suo indirizzo, entra nelle briciole di pane e il tasto Indietro del
     * browser ci torna sopra. Il modulo e' descritto in
     * assets/js/entity_edit/schemas/suppliers.js.
     */
    function openForm(id) {
        if (!window.App) return;
        window.App.navigateTo('entity_edit', id ? { entity: 'suppliers', id } : { entity: 'suppliers' });
    }

    function closeDeleteModal() { els.delModal.hidden = true; deleteTargetId = null; }

    async function confirmDelete() {
        if (!deleteTargetId) return;
        const btn = document.getElementById('suppliers-delete-confirm');
        btn.disabled = true;
        try {
            const res  = await fetch(`${API}?id=${deleteTargetId}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeDeleteModal();
            showAlert('Fornitore eliminato.', 'success');
            loadSuppliers();
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
