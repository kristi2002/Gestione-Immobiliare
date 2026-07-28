(function () {
    'use strict';

    const API       = 'api/inventory.php';
    const SNAP_API  = 'api/inventory_snapshots.php';
    const DOCS_API  = 'api/documents.php';
    const PROP_API  = 'api/properties.php';

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

    const CONDITION_LABELS = { 1: 'Pessima', 2: 'Scarsa', 3: 'Discreta', 4: 'Buona', 5: 'Ottima' };

    const PHASE_LABELS = { check_in: 'Check-in', check_out: 'Check-out' };

    let currentPage      = 1;
    const PAGE_LIMIT     = 25;
    let deleteTargetId   = null;
    let selectedProperty = null;
    let categories       = [];
    let editingItemId    = null;   // articolo aperto nel modal (serve per le foto)
    let currentSnapshot  = null;   // verbale aperto nel modal
    let lockTargetId     = null;
    const els            = {};

    function init() {
        els.alert       = document.getElementById('inventory-alert');
        els.tbody       = document.getElementById('inventory-tbody');
        els.pagination  = document.getElementById('inventory-pagination');
        els.propSelect  = document.getElementById('inventory-property-select');
        els.categoryFilter  = document.getElementById('inventory-category-filter');
        els.conditionFilter = document.getElementById('inventory-condition-filter');
        els.placeholder = document.getElementById('inventory-placeholder');
        els.content     = document.getElementById('inventory-content');
        els.modal       = document.getElementById('inventory-modal');
        els.form        = document.getElementById('inventory-form');
        els.delModal    = document.getElementById('inventory-delete-modal');
        els.contractsTbody = document.getElementById('inventory-contracts-tbody');
        els.snapModal   = document.getElementById('snapshot-modal');
        els.lockModal   = document.getElementById('snapshot-lock-modal');
        els.compModal   = document.getElementById('comparison-modal');

        bindEvents();
        initStarSelector('inventory-condition-stars', 'inventory-condition');
        loadCategories();
        loadProperties();
    }

    function bindEvents() {
        els.propSelect.addEventListener('change', () => {
            selectedProperty = els.propSelect.value || null;
            if (selectedProperty) {
                els.placeholder.style.display = 'none';
                els.content.style.display     = 'block';
                document.getElementById('btn-new-item').style.display    = '';
                document.getElementById('btn-print-inventory').style.display = '';
                currentPage = 1;
                loadItems();
                loadContracts();
            } else {
                els.placeholder.style.display = '';
                els.content.style.display     = 'none';
                document.getElementById('btn-new-item').style.display    = 'none';
                document.getElementById('btn-print-inventory').style.display = 'none';
            }
        });

        els.categoryFilter.addEventListener('change', () => { currentPage = 1; loadItems(); });
        els.conditionFilter.addEventListener('change', () => { currentPage = 1; loadItems(); });

        document.getElementById('btn-new-item').addEventListener('click', () => openModal());
        document.getElementById('btn-print-inventory').addEventListener('click', printReport);

        document.getElementById('inventory-modal-close').addEventListener('click', closeModal);
        document.getElementById('inventory-modal-cancel').addEventListener('click', closeModal);
        els.modal.addEventListener('click', e => { if (e.target === els.modal) closeModal(); });
        els.form.addEventListener('submit', handleSubmit);

        document.getElementById('inventory-photo-upload-btn').addEventListener('click', uploadPhoto);

        document.getElementById('inventory-delete-close').addEventListener('click', closeDeleteModal);
        document.getElementById('inventory-delete-cancel').addEventListener('click', closeDeleteModal);
        document.getElementById('inventory-delete-confirm').addEventListener('click', confirmDelete);
        els.delModal.addEventListener('click', e => { if (e.target === els.delModal) closeDeleteModal(); });

        // Verbali
        document.getElementById('snapshot-modal-close').addEventListener('click', closeSnapshotModal);
        document.getElementById('snapshot-modal-cancel').addEventListener('click', closeSnapshotModal);
        els.snapModal.addEventListener('click', e => { if (e.target === els.snapModal) closeSnapshotModal(); });
        document.getElementById('snapshot-lock-btn').addEventListener('click', () => openLockModal(currentSnapshot));
        document.getElementById('snapshot-download-btn').addEventListener('click', () => {
            if (currentSnapshot && currentSnapshot.document_id) {
                window.open('api/download_document.php?id=' + currentSnapshot.document_id, '_blank', 'noopener');
            }
        });

        document.getElementById('snapshot-lock-close').addEventListener('click', closeLockModal);
        document.getElementById('snapshot-lock-cancel').addEventListener('click', closeLockModal);
        document.getElementById('snapshot-lock-confirm').addEventListener('click', confirmLock);
        els.lockModal.addEventListener('click', e => { if (e.target === els.lockModal) closeLockModal(); });

        document.getElementById('comparison-close').addEventListener('click', closeComparison);
        document.getElementById('comparison-cancel').addEventListener('click', closeComparison);
        els.compModal.addEventListener('click', e => { if (e.target === els.compModal) closeComparison(); });
    }

    function initStarSelector(containerId, inputId) {
        const stars = document.querySelectorAll(`#${containerId} .star`);
        const input = document.getElementById(inputId);

        function setStars(val) {
            stars.forEach(s => {
                const active = parseInt(s.dataset.value) <= val;
                s.textContent  = active ? '★' : '☆';
                s.style.color  = active ? '#f5a623' : '#ccc';
            });
        }

        setStars(parseInt(input.value) || 3);

        stars.forEach(star => {
            star.addEventListener('mouseover', () => setStars(parseInt(star.dataset.value)));
            star.addEventListener('mouseout',  () => setStars(parseInt(input.value) || 0));
            star.addEventListener('click', () => {
                input.value = star.dataset.value;
                setStars(parseInt(star.dataset.value));
            });
        });

        // expose setter
        input._setDisplay = setStars;
    }

    // ---- Categorie: la lista vive nel database ----------------------------
    async function loadCategories() {
        try {
            const res  = await fetch(`${API}?action=categories`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            categories = Array.isArray(json.data) ? json.data : [];
        } catch (e) {
            categories = [];
        }

        const formSelect = document.getElementById('inventory-category');
        categories.forEach(c => {
            els.categoryFilter.appendChild(new Option(c.label, c.slug));
            formSelect.appendChild(new Option(c.label, c.slug));
        });
    }

    function categoryLabel(slug) {
        const c = categories.find(x => x.slug === slug);
        return c ? c.label : (slug || '');
    }

    async function loadProperties() {
        try {
            const items = await window.Pagination.fetchList(PROP_API);
            items.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.address || p.title || `#${p.id}`;
                els.propSelect.appendChild(opt);
            });
        } catch (e) { /* non-critical */ }
    }

    async function loadItems() {
        if (!selectedProperty) return;
        const params = new URLSearchParams({ property_id: selectedProperty, page: currentPage, limit: PAGE_LIMIT });
        if (els.categoryFilter.value) params.set('category', els.categoryFilter.value);
        if (els.conditionFilter.value) params.set('min_condition', els.conditionFilter.value);

        softLoad(els.tbody, '<tr><td colspan="9" class="text-muted" style="text-align:center;padding:2rem;">Caricamento…</td></tr>');

        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const parsed = window.Pagination.parseResponse(json);
            renderRows(parsed.items);
            window.Pagination.render(els.pagination, parsed, p => { currentPage = p; loadItems(); });
        } catch (err) {
            els.tbody.classList.remove('is-loading');
            els.tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--color-danger);padding:2rem;">${esc(err.message)}</td></tr>`;
        }
    }

    function starsHtml(rating) {
        const v = parseInt(rating) || 0;
        return Array.from({ length: 5 }, (_, i) =>
            `<span style="color:${i < v ? '#f5a623' : '#ccc'}">${i < v ? '★' : '☆'}</span>`
        ).join('');
    }

    function money(value) {
        if (value === null || value === undefined || value === '') return '—';
        return '€ ' + Number(value).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function renderRows(items) {
        els.tbody.classList.remove('is-loading');
        if (!items.length) {
            els.tbody.innerHTML = '<tr><td colspan="9" class="text-muted" style="text-align:center;padding:2rem;">Nessun articolo in inventario.</td></tr>';
            return;
        }

        els.tbody.innerHTML = items.map(item => {
            const asset = [item.brand, item.model].filter(Boolean).join(' ');
            const photos = parseInt(item.photo_count) || 0;
            return `<tr>
            <td data-label="Articolo">${esc(item.item_name)}</td>
            <td data-label="Categoria">${item.category ? `<span class="badge">${esc(item.category_label || categoryLabel(item.category))}</span>` : '<span class="text-muted">—</span>'}</td>
            <td data-label="Marca / Modello" title="${item.serial_number ? 'Matricola: ' + esc(item.serial_number) : ''}">
                ${asset ? esc(asset) : '<span class="text-muted">—</span>'}
                ${item.serial_number ? `<div class="text-muted" style="font-size:0.75rem;">S/N ${esc(item.serial_number)}</div>` : ''}
            </td>
            <td data-label="Valore">${item.estimated_value !== null && item.estimated_value !== undefined ? money(item.estimated_value) : '<span class="text-muted">—</span>'}</td>
            <td data-label="Quantità">${esc(item.quantity ?? 1)}</td>
            <td data-label="Condizione" title="${esc(CONDITION_LABELS[item.condition_rating] || '')}">${starsHtml(item.condition_rating)}</td>
            <td data-label="Foto">${photos
                ? `<span class="badge" title="${photos} foto allegate"><i data-lucide="camera"></i> ${photos}</span>`
                : '<span class="text-muted">—</span>'}</td>
            <td data-label="Note">${esc(item.notes || '—')}</td>
            <td data-label="Azioni" class="col-actions" style="white-space:nowrap;">
                <button class="btn btn--sm btn--ghost btn-inv-edit" data-id="${item.id}" title="Modifica"><i data-lucide="pencil"></i></button>
                <button class="btn btn--sm btn--ghost btn-inv-del" data-id="${item.id}" data-name="${esc(item.item_name)}" title="Elimina"><i data-lucide="trash-2"></i></button>
            </td>
        </tr>`;
        }).join('');

        if (window.lucide) window.lucide.createIcons();

        els.tbody.querySelectorAll('.btn-inv-edit').forEach(btn => {
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

        els.tbody.querySelectorAll('.btn-inv-del').forEach(btn => {
            btn.addEventListener('click', () => {
                deleteTargetId = btn.dataset.id;
                document.getElementById('inventory-delete-name').textContent = btn.dataset.name;
                els.delModal.hidden = false;
            });
        });
    }

    function openModal(item = null) {
        els.form.reset();
        document.getElementById('inventory-id').value = '';
        document.getElementById('inventory-modal-title').textContent = item ? 'Modifica Articolo' : 'Aggiungi Articolo';

        const condInput = document.getElementById('inventory-condition');
        condInput.value = 3;
        if (condInput._setDisplay) condInput._setDisplay(3);

        if (!item) {
            document.getElementById('inventory-check-in-date').value = new Date().toISOString().substring(0, 10);
            document.getElementById('inventory-quantity').value = 1;
        }

        editingItemId = item ? item.id : null;

        if (item) {
            document.getElementById('inventory-id').value            = item.id;
            document.getElementById('inventory-item-name').value     = item.item_name || '';
            document.getElementById('inventory-category').value      = item.category || '';
            document.getElementById('inventory-quantity').value      = item.quantity || 1;
            document.getElementById('inventory-check-in-date').value = item.check_in_date ? item.check_in_date.substring(0, 10) : '';
            document.getElementById('inventory-notes').value         = item.notes || '';
            document.getElementById('inventory-brand').value         = item.brand || '';
            document.getElementById('inventory-model').value         = item.model || '';
            document.getElementById('inventory-serial').value        = item.serial_number || '';
            document.getElementById('inventory-value').value         = item.estimated_value ?? '';
            document.getElementById('inventory-warranty').value      = item.warranty_until ? item.warranty_until.substring(0, 10) : '';
            const rating = parseInt(item.condition_rating) || 3;
            condInput.value = rating;
            if (condInput._setDisplay) condInput._setDisplay(rating);
        }

        renderPhotos(item ? (item.photos || []) : []);

        els.modal.hidden = false;
        document.getElementById('inventory-item-name').focus();
    }

    // ---- Foto del bene -----------------------------------------------------
    function renderPhotos(photos) {
        const list     = document.getElementById('inventory-photos-list');
        const uploader = document.getElementById('inventory-photos-upload');
        const empty    = document.getElementById('inventory-photos-empty');

        // Senza id non c'è a cosa allegare la foto: si carica dopo il salvataggio.
        uploader.style.display = editingItemId ? '' : 'none';
        empty.style.display    = editingItemId ? 'none' : '';
        document.getElementById('inventory-photo-file').value = '';

        if (!editingItemId || !photos.length) {
            list.innerHTML = editingItemId
                ? '<span class="text-muted" style="font-size:0.85rem;">Nessuna foto allegata.</span>'
                : '';
            return;
        }

        list.innerHTML = photos.map(p => `
            <span class="badge" style="display:inline-flex;align-items:center;gap:6px;">
                <a href="${p.download_url}" target="_blank" rel="noopener">${esc(p.original_name)}</a>
                <button type="button" class="btn-photo-del" data-id="${p.id}" title="Elimina foto"
                        style="border:none;background:none;cursor:pointer;color:var(--color-danger,#c0392b);">&times;</button>
            </span>`).join('');

        list.querySelectorAll('.btn-photo-del').forEach(btn => {
            btn.addEventListener('click', () => deletePhoto(btn.dataset.id));
        });
    }

    async function refreshPhotos() {
        if (!editingItemId) return;
        try {
            const res  = await fetch(`${API}?id=${editingItemId}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const item = Array.isArray(json.data) ? json.data[0] : json.data;
            renderPhotos(item.photos || []);
        } catch (e) { showAlert(e.message, 'error'); }
    }

    async function uploadPhoto() {
        const input = document.getElementById('inventory-photo-file');
        if (!editingItemId || !input.files.length) {
            showAlert('Seleziona un file da caricare.', 'error');
            return;
        }

        const btn = document.getElementById('inventory-photo-upload-btn');
        btn.disabled = true;

        const fd = new FormData();
        fd.append('file', input.files[0]);
        fd.append('doc_type', 'inventario');
        fd.append('inventory_item_id', editingItemId);
        fd.append('property_id', selectedProperty);
        fd.append('title', 'Foto inventario');

        try {
            const res  = await fetch(DOCS_API, { method: 'POST', body: fd });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert('Foto caricata.', 'success');
            await refreshPhotos();
            loadItems();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    async function deletePhoto(photoId) {
        try {
            const res  = await fetch(`${DOCS_API}?id=${photoId}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            await refreshPhotos();
            loadItems();
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    function closeModal() { els.modal.hidden = true; editingItemId = null; }
    function closeDeleteModal() { els.delModal.hidden = true; deleteTargetId = null; }

    async function handleSubmit(e) {
        e.preventDefault();
        const id  = document.getElementById('inventory-id').value;
        const btn = document.getElementById('inventory-modal-save');
        btn.disabled = true; btn.textContent = 'Salvataggio…';

        const value = document.getElementById('inventory-value').value;

        const data = {
            property_id:      selectedProperty,
            item_name:        document.getElementById('inventory-item-name').value.trim(),
            category:         document.getElementById('inventory-category').value,
            quantity:         parseInt(document.getElementById('inventory-quantity').value) || 1,
            condition_rating: parseInt(document.getElementById('inventory-condition').value) || 3,
            check_in_date:    document.getElementById('inventory-check-in-date').value || null,
            notes:            document.getElementById('inventory-notes').value.trim(),
            brand:            document.getElementById('inventory-brand').value.trim(),
            model:            document.getElementById('inventory-model').value.trim(),
            serial_number:    document.getElementById('inventory-serial').value.trim(),
            estimated_value:  value === '' ? null : parseFloat(value),
            warranty_until:   document.getElementById('inventory-warranty').value || null,
        };

        try {
            const res  = await fetch(id ? `${API}?id=${id}` : API, {
                method: id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const saved = Array.isArray(json.data) ? json.data[0] : json.data;
            showAlert('Articolo salvato con successo.', 'success');
            loadItems();

            // Articolo nuovo: resta aperto sul record appena creato, così le foto
            // si allegano subito invece di dover riaprire la scheda.
            if (!id && saved && saved.id) {
                document.getElementById('inventory-id').value = saved.id;
                document.getElementById('inventory-modal-title').textContent = 'Modifica Articolo';
                editingItemId = saved.id;
                renderPhotos([]);
            } else {
                closeModal();
            }
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Salva';
        }
    }

    async function confirmDelete() {
        if (!deleteTargetId) return;
        const btn = document.getElementById('inventory-delete-confirm');
        btn.disabled = true;
        try {
            const res  = await fetch(`${API}?id=${deleteTargetId}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeDeleteModal();
            showAlert('Articolo eliminato.', 'success');
            loadItems();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    // ---- Verbali di consegna ----------------------------------------------
    async function loadContracts() {
        if (!selectedProperty) return;
        softLoad(els.contractsTbody, '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:1.5rem;">Caricamento…</td></tr>');

        try {
            const res  = await fetch(`${SNAP_API}?action=contracts&property_id=${selectedProperty}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            renderContracts(json.data || []);
        } catch (err) {
            els.contractsTbody.classList.remove('is-loading');
            els.contractsTbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--color-danger);padding:1.5rem;">${esc(err.message)}</td></tr>`;
        }
    }

    function snapshotCell(id, status, date) {
        if (!id) return '<span class="text-muted">—</span>';
        const label = status === 'locked' ? 'Chiuso' : 'Bozza';
        const color = status === 'locked' ? 'var(--color-success,#22c55e)' : 'var(--color-warning,#e67e22)';
        return `<span style="color:${color};font-weight:600;">${label}</span>`
             + (date ? `<div class="text-muted" style="font-size:0.75rem;">${formatDate(date)}</div>` : '');
    }

    function renderContracts(rows) {
        els.contractsTbody.classList.remove('is-loading');

        if (!rows.length) {
            els.contractsTbody.innerHTML = '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:1.5rem;">'
                + 'Nessun contratto di locazione su questo immobile: il verbale si aggancia al contratto.</td></tr>';
            return;
        }

        els.contractsTbody.innerHTML = rows.map(r => {
            const period = [r.start_date, r.end_date].filter(Boolean).map(formatDate).join(' → ') || '—';
            const actions = [];

            actions.push(r.check_in_id
                ? `<button class="btn btn--sm btn--ghost btn-open-snap" data-id="${r.check_in_id}">Check-in</button>`
                : `<button class="btn btn--sm btn--ghost btn-new-snap" data-contract="${r.id}" data-phase="check_in">+ Check-in</button>`);

            if (r.check_in_id) {
                actions.push(r.check_out_id
                    ? `<button class="btn btn--sm btn--ghost btn-open-snap" data-id="${r.check_out_id}">Check-out</button>`
                    : `<button class="btn btn--sm btn--ghost btn-new-snap" data-contract="${r.id}" data-phase="check_out">+ Check-out</button>`);
            }

            if (r.check_in_id && r.check_out_id) {
                actions.push(`<button class="btn btn--sm btn--primary btn-compare" data-contract="${r.id}">Confronto</button>`);
            }

            return `<tr>
                <td data-label="Contratto">${esc(r.title || `#${r.id}`)}</td>
                <td data-label="Inquilino">${esc(r.tenant_name || '—')}</td>
                <td data-label="Periodo">${period}</td>
                <td data-label="Check-in">${snapshotCell(r.check_in_id, r.check_in_status, r.check_in_date)}</td>
                <td data-label="Check-out">${snapshotCell(r.check_out_id, r.check_out_status, r.check_out_date)}</td>
                <td data-label="Azioni" class="col-actions" style="white-space:nowrap;">${actions.join(' ')}</td>
            </tr>`;
        }).join('');

        els.contractsTbody.querySelectorAll('.btn-new-snap').forEach(btn => {
            btn.addEventListener('click', () => createSnapshot(btn.dataset.contract, btn.dataset.phase));
        });
        els.contractsTbody.querySelectorAll('.btn-open-snap').forEach(btn => {
            btn.addEventListener('click', () => openSnapshot(btn.dataset.id));
        });
        els.contractsTbody.querySelectorAll('.btn-compare').forEach(btn => {
            btn.addEventListener('click', () => openComparison(btn.dataset.contract));
        });
    }

    async function createSnapshot(contractId, phase) {
        try {
            const res  = await fetch(SNAP_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contract_id: contractId, phase }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert(`Verbale ${PHASE_LABELS[phase]} creato con ${(json.data.items || []).length} righe.`, 'success');
            loadContracts();
            renderSnapshot(json.data);
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    async function openSnapshot(id) {
        try {
            const res  = await fetch(`${SNAP_API}?id=${id}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            renderSnapshot(json.data);
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    function renderSnapshot(snapshot) {
        currentSnapshot = snapshot;
        const locked = snapshot.status === 'locked';

        document.getElementById('snapshot-modal-title').textContent =
            (snapshot.phase === 'check_in' ? 'Verbale di consegna' : 'Verbale di riconsegna')
            + ' — ' + (snapshot.property_address || '');

        document.getElementById('snapshot-meta').innerHTML =
            `Contratto: <strong>${esc(snapshot.contract_title || '#' + snapshot.contract_id)}</strong> · `
            + `Data: ${formatDate(snapshot.snapshot_date)}`
            + (snapshot.tenant_name ? ` · Inquilino: ${esc(snapshot.tenant_name)} ${esc(snapshot.tenant_surname || '')}` : '');

        const banner = document.getElementById('snapshot-locked-banner');
        if (locked) {
            banner.style.display = 'block';
            banner.innerHTML = `Verbale chiuso il ${formatDate(snapshot.locked_at)}. `
                + `Impronta SHA-256: <code>${esc((snapshot.content_hash || '').substring(0, 24))}…</code>`
                + (snapshot.signature_status ? ` · Firma: <strong>${esc(snapshot.signature_status)}</strong>` : '');
        } else {
            banner.style.display = 'none';
        }

        document.getElementById('snapshot-lock-btn').style.display     = locked ? 'none' : '';
        document.getElementById('snapshot-download-btn').style.display = snapshot.document_id ? '' : 'none';

        const tbody = document.getElementById('snapshot-items-tbody');
        const items = snapshot.items || [];

        tbody.innerHTML = items.map(i => {
            const asset = [i.brand, i.model].filter(Boolean).join(' ');
            const options = [1, 2, 3, 4, 5].map(v =>
                `<option value="${v}" ${String(i.condition_rating) === String(v) ? 'selected' : ''}>${v} — ${CONDITION_LABELS[v]}</option>`
            ).join('');

            return `<tr data-item="${i.id}">
                <td data-label="Articolo">${esc(i.item_name)}
                    ${i.category ? `<div class="text-muted" style="font-size:0.75rem;">${esc(i.category_label || categoryLabel(i.category))}</div>` : ''}
                </td>
                <td data-label="Marca / Modello">${asset ? esc(asset) : '<span class="text-muted">—</span>'}
                    ${i.serial_number ? `<div class="text-muted" style="font-size:0.75rem;">S/N ${esc(i.serial_number)}</div>` : ''}
                </td>
                <td data-label="Qtà">
                    <input type="number" class="form-input snap-qty" min="0" value="${i.quantity}" style="max-width:80px;" ${locked ? 'disabled' : ''}>
                </td>
                <td data-label="Condizione">
                    <select class="form-select snap-rating" style="max-width:170px;" ${locked ? 'disabled' : ''}>
                        <option value="">— da compilare —</option>${options}
                    </select>
                </td>
                <td data-label="Note">
                    <input type="text" class="form-input snap-notes" maxlength="255" value="${esc(i.notes || '')}" ${locked ? 'disabled' : ''}>
                </td>
            </tr>`;
        }).join('');

        if (!locked) {
            tbody.querySelectorAll('tr').forEach(tr => {
                const save = () => saveSnapshotItem(tr);
                tr.querySelector('.snap-qty').addEventListener('change', save);
                tr.querySelector('.snap-rating').addEventListener('change', save);
                tr.querySelector('.snap-notes').addEventListener('change', save);
            });
        }

        if (window.lucide) window.lucide.createIcons();
        els.snapModal.hidden = false;
    }

    async function saveSnapshotItem(tr) {
        const payload = {
            quantity:         tr.querySelector('.snap-qty').value,
            condition_rating: tr.querySelector('.snap-rating').value || null,
            notes:            tr.querySelector('.snap-notes').value.trim(),
        };

        try {
            const res  = await fetch(`${SNAP_API}?item_id=${tr.dataset.item}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            tr.style.background = 'rgba(34,197,94,0.08)';
            setTimeout(() => { tr.style.background = ''; }, 600);
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    function closeSnapshotModal() { els.snapModal.hidden = true; currentSnapshot = null; }

    function openLockModal(snapshot) {
        if (!snapshot) return;
        lockTargetId = snapshot.id;
        const full = [snapshot.tenant_name, snapshot.tenant_surname].filter(Boolean).join(' ');
        document.getElementById('snapshot-signer-name').value  = full;
        document.getElementById('snapshot-signer-email').value = snapshot.tenant_email || '';
        els.lockModal.hidden = false;
    }

    function closeLockModal() { els.lockModal.hidden = true; lockTargetId = null; }

    async function confirmLock() {
        if (!lockTargetId) return;
        const btn = document.getElementById('snapshot-lock-confirm');
        btn.disabled = true; btn.textContent = 'Chiusura…';

        try {
            const res  = await fetch(`${SNAP_API}?action=lock&id=${lockTargetId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    signer_name:  document.getElementById('snapshot-signer-name').value.trim(),
                    signer_email: document.getElementById('snapshot-signer-email').value.trim(),
                }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            closeLockModal();
            showAlert(json.data.sign_link
                ? 'Verbale chiuso e richiesta di firma inviata.'
                : 'Verbale chiuso: PDF generato e righe bloccate.', 'success');
            loadContracts();
            openSnapshot(json.data.id);
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Chiudi verbale';
        }
    }

    // ---- Confronto ---------------------------------------------------------
    async function openComparison(contractId) {
        try {
            const res  = await fetch(`${SNAP_API}?action=comparison&contract_id=${contractId}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            renderComparison(json.data);
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    function renderComparison(data) {
        const s = data.summary || {};
        document.getElementById('comparison-summary').innerHTML = `
            <div style="display:flex;gap:1.5rem;flex-wrap:wrap;">
                <div><div class="text-muted" style="font-size:0.8rem;">Righe</div><strong>${s.items || 0}</strong></div>
                <div><div class="text-muted" style="font-size:0.8rem;">Peggiorati</div><strong style="color:var(--color-warning,#e67e22);">${s.worsened || 0}</strong></div>
                <div><div class="text-muted" style="font-size:0.8rem;">Mancanti</div><strong style="color:var(--color-danger,#c0392b);">${s.missing || 0}</strong></div>
                <div><div class="text-muted" style="font-size:0.8rem;">Stima danno totale</div><strong>${money(s.suggested_deduction || 0)}</strong></div>
            </div>`;

        document.getElementById('comparison-tbody').innerHTML = (data.rows || []).map(r => {
            const delta = r.delta === null || r.delta === undefined
                ? '<span class="text-muted">—</span>'
                : `<strong style="color:${r.delta < 0 ? 'var(--color-danger,#c0392b)' : 'var(--color-success,#22c55e)'};">${r.delta > 0 ? '+' : ''}${r.delta}</strong>`;

            const outCell = r.missing
                ? '<strong style="color:var(--color-danger,#c0392b);">MANCANTE</strong>'
                : (r.check_out_rating ? starsHtml(r.check_out_rating) : '<span class="text-muted">da compilare</span>');

            return `<tr>
                <td data-label="Articolo">${esc(r.item_name)}
                    ${r.added_after_check_in ? '<div class="text-muted" style="font-size:0.75rem;">aggiunto dopo la consegna</div>' : ''}
                    ${[r.brand, r.model].filter(Boolean).length ? `<div class="text-muted" style="font-size:0.75rem;">${esc([r.brand, r.model].filter(Boolean).join(' '))}</div>` : ''}
                </td>
                <td data-label="Valore">${money(r.estimated_value)}</td>
                <td data-label="Ingresso">${r.check_in_rating ? starsHtml(r.check_in_rating) : '<span class="text-muted">—</span>'}</td>
                <td data-label="Uscita">${outCell}</td>
                <td data-label="Δ">${delta}</td>
                <td data-label="Stima danno">${r.suggested_deduction === null || r.suggested_deduction === undefined ? '<span class="text-muted">—</span>' : money(r.suggested_deduction)}</td>
                <td data-label="Note uscita">${esc(r.check_out_notes || '—')}</td>
            </tr>`;
        }).join('');

        els.compModal.hidden = false;
    }

    function closeComparison() { els.compModal.hidden = true; }

    function printReport() {
        if (!selectedProperty) return;
        const propLabel = els.propSelect.options[els.propSelect.selectedIndex]?.text || '';
        // Gather current rows from the table
        const rows = Array.from(els.tbody.querySelectorAll('tr')).map(tr => {
            const cells = tr.querySelectorAll('td');
            if (!cells.length) return null;
            return {
                item:      cells[0]?.textContent?.trim() || '',
                category:  cells[1]?.textContent?.trim() || '',
                asset:     cells[2]?.textContent?.trim() || '',
                value:     cells[3]?.textContent?.trim() || '',
                qty:       cells[4]?.textContent?.trim() || '',
                condition: cells[5]?.textContent?.trim() || '',
                notes:     cells[7]?.textContent?.trim() || '',
            };
        }).filter(Boolean);

        const win = window.open('', '_blank');
        win.document.write(`<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8">
            <title>Report Check-in — ${propLabel}</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 2rem; }
                h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
                p  { color: #666; margin-bottom: 1.5rem; }
                table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
                th, td { border: 1px solid #ccc; padding: 0.5rem 0.75rem; text-align: left; }
                th { background: #f4f4f4; font-weight: 600; }
                tr:nth-child(even) { background: #fafafa; }
                .footer { margin-top: 3rem; display: flex; justify-content: space-between; }
                .sig { border-top: 1px solid #333; padding-top: 0.5rem; width: 220px; text-align: center; }
                @media print { button { display: none; } }
            </style></head><body>
            <h1>Report Check-in Inventario</h1>
            <p>Immobile: <strong>${propLabel}</strong> &mdash; Data: ${new Date().toLocaleDateString('it-IT')}</p>
            <table>
                <thead><tr><th>Articolo</th><th>Categoria</th><th>Marca/Modello</th><th>Valore</th><th>Qtà</th><th>Condizione</th><th>Note</th></tr></thead>
                <tbody>${rows.map(r => `<tr>
                    <td>${r.item}</td><td>${r.category}</td><td>${r.asset}</td><td>${r.value}</td><td>${r.qty}</td><td>${r.condition}</td><td>${r.notes}</td>
                </tr>`).join('')}</tbody>
            </table>
            <div class="footer">
                <div class="sig">Firma proprietario</div>
                <div class="sig">Firma inquilino</div>
            </div>
            <script>window.onload = () => window.print();<\/script>
        </body></html>`);
        win.document.close();
    }

    function formatDate(str) {
        if (!str) return '—';
        const d = new Date(str);
        return isNaN(d) ? str : d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
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
