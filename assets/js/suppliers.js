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
        els.modal          = document.getElementById('suppliers-modal');
        els.form           = document.getElementById('suppliers-form');
        els.delModal       = document.getElementById('suppliers-delete-modal');

        bindEvents();
        initStarSelector();
        loadSuppliers();
    }

    function bindEvents() {
        document.getElementById('btn-new-supplier').addEventListener('click', () => openModal());
        document.getElementById('suppliers-modal-close').addEventListener('click', closeModal);
        document.getElementById('suppliers-modal-cancel').addEventListener('click', closeModal);
        els.modal.addEventListener('click', e => { if (e.target === els.modal) closeModal(); });
        els.form.addEventListener('submit', handleSubmit);

        document.getElementById('suppliers-delete-close').addEventListener('click', closeDeleteModal);
        document.getElementById('suppliers-delete-cancel').addEventListener('click', closeDeleteModal);
        document.getElementById('suppliers-delete-confirm').addEventListener('click', confirmDelete);
        els.delModal.addEventListener('click', e => { if (e.target === els.delModal) closeDeleteModal(); });

        els.search.addEventListener('input', debounce(() => { currentPage = 1; loadSuppliers(); }, 300));
        els.categoryFilter.addEventListener('change', () => { currentPage = 1; loadSuppliers(); });
    }

    function initStarSelector() {
        const stars      = document.querySelectorAll('#suppliers-star-selector .star');
        const ratingInput = document.getElementById('suppliers-rating');

        function setStars(val) {
            stars.forEach(s => {
                s.textContent = parseInt(s.dataset.value) <= val ? '★' : '☆';
                s.style.color = parseInt(s.dataset.value) <= val ? '#f5a623' : '#ccc';
            });
        }

        stars.forEach(star => {
            star.addEventListener('mouseover', () => setStars(parseInt(star.dataset.value)));
            star.addEventListener('mouseout',  () => setStars(parseInt(ratingInput.value) || 0));
            star.addEventListener('click', () => {
                ratingInput.value = star.dataset.value;
                setStars(parseInt(star.dataset.value));
            });
        });
    }

    function setRatingDisplay(val) {
        const stars = document.querySelectorAll('#suppliers-star-selector .star');
        const v     = parseInt(val) || 0;
        document.getElementById('suppliers-rating').value = v;
        stars.forEach(s => {
            s.textContent = parseInt(s.dataset.value) <= v ? '★' : '☆';
            s.style.color = parseInt(s.dataset.value) <= v ? '#f5a623' : '#ccc';
        });
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
                        ${s.phone && window.WA ? window.WA.buttonHtml(s.phone) : ''}
                        <button class="btn btn--sm btn--ghost btn-s-edit" data-id="${s.id}" title="Modifica"><i data-lucide="pencil"></i></button>
                        <button class="btn btn--sm btn--ghost btn-s-del" data-id="${s.id}" data-name="${esc(s.name)}" title="Elimina"><i data-lucide="trash-2"></i></button>
                    </div>
                </div>
            </div>
        `).join('');

        els.grid.querySelectorAll('.btn-copy').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); copyToClipboard(btn.dataset.copy, btn); });
        });

        els.grid.querySelectorAll('.btn-s-edit').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    const res  = await fetch(`${API}?id=${btn.dataset.id}`);
                    const json = await res.json();
                    if (!json.success) throw new Error(json.error);
                    const item = Array.isArray(json.data) ? json.data[0] : json.data;
                    openModal(item);
                } catch (e) { showAlert(e.message, 'error'); }
            });
        });

        els.grid.querySelectorAll('.btn-s-del').forEach(btn => {
            btn.addEventListener('click', () => {
                deleteTargetId = btn.dataset.id;
                document.getElementById('suppliers-delete-name').textContent = btn.dataset.name;
                els.delModal.hidden = false;
            });
        });
    }

    function openModal(item = null) {
        els.form.reset();
        document.getElementById('suppliers-id').value = '';
        document.getElementById('suppliers-modal-title').textContent = item ? 'Modifica Fornitore' : 'Nuovo Fornitore';
        setRatingDisplay(0);

        if (item) {
            document.getElementById('suppliers-id').value       = item.id;
            document.getElementById('suppliers-name').value     = item.name || '';
            document.getElementById('suppliers-category').value = item.category || '';
            document.getElementById('suppliers-phone').value    = item.phone || '';
            document.getElementById('suppliers-email').value    = item.email || '';
            document.getElementById('suppliers-address').value  = item.address || '';
            document.getElementById('suppliers-notes').value    = item.notes || '';
            setRatingDisplay(item.rating || 0);
        }

        els.modal.hidden = false;
        document.getElementById('suppliers-name').focus();
    }

    function closeModal() { els.modal.hidden = true; }
    function closeDeleteModal() { els.delModal.hidden = true; deleteTargetId = null; }

    async function handleSubmit(e) {
        e.preventDefault();
        const id  = document.getElementById('suppliers-id').value;
        const btn = document.getElementById('suppliers-modal-save');
        btn.disabled = true; btn.textContent = 'Salvataggio…';

        const data = {
            name:     document.getElementById('suppliers-name').value.trim(),
            category: document.getElementById('suppliers-category').value,
            phone:    document.getElementById('suppliers-phone').value.trim(),
            email:    document.getElementById('suppliers-email').value.trim(),
            address:  document.getElementById('suppliers-address').value.trim(),
            notes:    document.getElementById('suppliers-notes').value.trim(),
            rating:   parseInt(document.getElementById('suppliers-rating').value) || 0,
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
            showAlert('Fornitore salvato con successo.', 'success');
            loadSuppliers();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Salva';
        }
    }

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
