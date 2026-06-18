(function () {
    'use strict';

    const API = 'api/suppliers.php';

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
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
            <div class="card" style="display:flex;flex-direction:column;gap:0.5rem;padding:1.25rem;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;">
                    <div style="font-weight:600;font-size:1.05rem;">${esc(s.name)}</div>
                    <span class="badge" style="flex-shrink:0;">${esc(s.category || '—')}</span>
                </div>
                <div style="font-size:1.1rem;">${starsHtml(s.rating)}</div>
                ${s.phone ? `<div class="text-muted" style="font-size:0.9rem;">📞 ${esc(s.phone)}</div>` : ''}
                ${s.email ? `<div class="text-muted" style="font-size:0.9rem;">✉️ <a href="mailto:${esc(s.email)}">${esc(s.email)}</a></div>` : ''}
                ${s.address ? `<div class="text-muted" style="font-size:0.85rem;">📍 ${esc(s.address)}</div>` : ''}
                ${s.notes ? `<div style="font-size:0.85rem;color:var(--color-text-muted,#888);margin-top:0.25rem;">${esc(s.notes)}</div>` : ''}
                <div style="display:flex;gap:0.5rem;margin-top:auto;padding-top:0.5rem;border-top:1px solid var(--color-border,#eee);">
                    <button class="btn btn--sm btn--ghost btn-s-edit" data-id="${s.id}" title="Modifica">✏️ Modifica</button>
                    <button class="btn btn--sm btn--ghost btn-s-del" data-id="${s.id}" data-name="${esc(s.name)}" title="Elimina">🗑️</button>
                </div>
            </div>
        `).join('');

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
