(function () {
    'use strict';

    const API      = 'api/buildings.php';
    const PROP_API = 'api/properties.php';

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
    function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

    let currentPage    = 1;
    const PAGE_LIMIT   = 25;
    let deleteTargetId = null;
    let expandedId     = null;
    let allProperties  = [];
    const els          = {};

    function init() {
        els.alert      = document.getElementById('buildings-alert');
        els.tbody      = document.getElementById('buildings-tbody');
        els.pagination = document.getElementById('buildings-pagination');
        els.search     = document.getElementById('buildings-search');
        els.modal      = document.getElementById('buildings-modal');
        els.form       = document.getElementById('buildings-form');
        els.delModal   = document.getElementById('buildings-delete-modal');
        els.linkModal  = document.getElementById('buildings-link-modal');

        bindEvents();
        loadProperties();
        loadBuildings();
    }

    function bindEvents() {
        document.getElementById('btn-new-building').addEventListener('click', () => openModal());
        document.getElementById('buildings-modal-close').addEventListener('click', closeModal);
        document.getElementById('buildings-modal-cancel').addEventListener('click', closeModal);
        els.modal.addEventListener('click', e => { if (e.target === els.modal) closeModal(); });
        els.form.addEventListener('submit', handleSubmit);

        document.getElementById('buildings-delete-close').addEventListener('click', closeDeleteModal);
        document.getElementById('buildings-delete-cancel').addEventListener('click', closeDeleteModal);
        document.getElementById('buildings-delete-confirm').addEventListener('click', confirmDelete);
        els.delModal.addEventListener('click', e => { if (e.target === els.delModal) closeDeleteModal(); });

        document.getElementById('buildings-link-close').addEventListener('click', closeLinkModal);
        document.getElementById('buildings-link-cancel').addEventListener('click', closeLinkModal);
        document.getElementById('buildings-link-confirm').addEventListener('click', confirmLink);
        els.linkModal.addEventListener('click', e => { if (e.target === els.linkModal) closeLinkModal(); });

        els.search.addEventListener('input', debounce(() => { currentPage = 1; loadBuildings(); }, 300));
    }

    async function loadProperties() {
        try {
            allProperties = await window.Pagination.fetchList(PROP_API);
            const sel = document.getElementById('buildings-link-property-id');
            allProperties.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.address || p.title || `#${p.id}`;
                sel.appendChild(opt);
            });
        } catch (e) { /* non-critical */ }
    }

    async function loadBuildings() {
        const params = new URLSearchParams();
        const search = els.search.value.trim();
        if (search) params.set('search', search);
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);

        els.tbody.innerHTML = '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:2rem;">Caricamento…</td></tr>';

        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const parsed = window.Pagination.parseResponse(json);
            renderRows(parsed.items);
            window.Pagination.render(els.pagination, parsed, p => { currentPage = p; loadBuildings(); });
        } catch (err) {
            els.tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--color-danger);padding:2rem;">${esc(err.message)}</td></tr>`;
        }
    }

    function renderRows(items) {
        if (!items.length) {
            els.tbody.innerHTML = '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:2rem;">Nessun edificio trovato.</td></tr>';
            return;
        }

        const rows = [];
        items.forEach(b => {
            const isExpanded = expandedId === b.id;
            rows.push(`<tr class="building-row" data-id="${b.id}" style="cursor:pointer;">
                <td style="text-align:center;font-size:0.85rem;">${isExpanded ? '▼' : '▶'}</td>
                <td><strong>${esc(b.name)}</strong></td>
                <td>${esc(b.address || '—')}</td>
                <td>${esc(b.city || '—')}</td>
                <td>${esc(b.total_units ?? '—')}</td>
                <td>${esc(b.occupancy_count ?? '—')}</td>
                <td style="white-space:nowrap;">
                    <button class="btn btn--sm btn--ghost btn-b-edit" data-id="${b.id}" title="Modifica">✏️</button>
                    <button class="btn btn--sm btn--ghost btn-b-del" data-id="${b.id}" data-name="${esc(b.name)}" title="Elimina">🗑️</button>
                </td>
            </tr>`);

            if (isExpanded) {
                rows.push(`<tr class="building-expand-row" data-parent="${b.id}">
                    <td colspan="7" style="background:var(--color-surface-alt,#f8f9fa);padding:0.75rem 1.5rem;">
                        <div id="building-props-${b.id}" class="text-muted">Caricamento immobili…</div>
                        <div style="margin-top:0.5rem;">
                            <button class="btn btn--sm btn--ghost btn-b-link" data-id="${b.id}">+ Collega immobile</button>
                        </div>
                    </td>
                </tr>`);
            }
        });

        els.tbody.innerHTML = rows.join('');

        // Expand toggle
        els.tbody.querySelectorAll('.building-row').forEach(row => {
            row.addEventListener('click', e => {
                if (e.target.closest('button')) return;
                const id = parseInt(row.dataset.id);
                expandedId = expandedId === id ? null : id;
                renderRows(items);
                if (expandedId) loadBuildingProperties(expandedId);
            });
        });

        els.tbody.querySelectorAll('.btn-b-edit').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                try {
                    const res  = await fetch(`${API}?id=${btn.dataset.id}`);
                    const json = await res.json();
                    if (!json.success) throw new Error(json.error);
                    const item = Array.isArray(json.data) ? json.data[0] : json.data;
                    openModal(item);
                } catch (err) { showAlert(err.message, 'error'); }
            });
        });

        els.tbody.querySelectorAll('.btn-b-del').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                deleteTargetId = btn.dataset.id;
                document.getElementById('buildings-delete-name').textContent = btn.dataset.name;
                els.delModal.hidden = false;
            });
        });

        els.tbody.querySelectorAll('.btn-b-link').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                openLinkModal(btn.dataset.id);
            });
        });

        // Load expanded properties after render
        if (expandedId) loadBuildingProperties(expandedId);
    }

    async function loadBuildingProperties(buildingId) {
        const container = document.getElementById(`building-props-${buildingId}`);
        if (!container) return;
        container.textContent = 'Caricamento…';
        try {
            const res  = await fetch(`${API}?id=${buildingId}&include_properties=1`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const building = Array.isArray(json.data) ? json.data[0] : json.data;
            const props    = building.properties || [];

            if (!props.length) {
                container.innerHTML = '<span class="text-muted">Nessun immobile collegato.</span>';
                return;
            }

            container.innerHTML = `<ul style="margin:0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:0.5rem;">
                ${props.map(p => `<li style="background:white;border:1px solid var(--color-border,#e0e0e0);border-radius:6px;padding:0.3rem 0.75rem;font-size:0.875rem;">
                    ${esc(p.address || p.title || `#${p.id}`)}
                    <button class="btn btn--sm" style="margin-left:0.5rem;padding:0 4px;font-size:0.7rem;color:var(--color-danger,#c0392b);background:none;border:none;cursor:pointer;"
                        data-building="${buildingId}" data-prop="${p.id}" title="Scollega">✕</button>
                </li>`).join('')}
            </ul>`;

            container.querySelectorAll('[data-prop]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (!await confirmDialog('Vuoi scollegare questo immobile dall\'edificio?', { title: 'Scollega immobile', confirmText: 'Scollega', danger: false, icon: '🔗' })) return;
                    try {
                        const r = await fetch(`${API}?action=unlink`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ building_id: btn.dataset.building, property_id: btn.dataset.prop }),
                        });
                        const j = await r.json();
                        if (!j.success) throw new Error(j.error);
                        loadBuildingProperties(buildingId);
                    } catch (err) { showAlert(err.message, 'error'); }
                });
            });
        } catch (err) {
            container.textContent = err.message;
        }
    }

    function openLinkModal(buildingId) {
        document.getElementById('buildings-link-building-id').value = buildingId;
        document.getElementById('buildings-link-property-id').value = '';
        els.linkModal.hidden = false;
    }

    function closeLinkModal() { els.linkModal.hidden = true; }

    async function confirmLink() {
        const buildingId = document.getElementById('buildings-link-building-id').value;
        const propertyId = document.getElementById('buildings-link-property-id').value;
        if (!propertyId) { showAlert('Seleziona un immobile.', 'error'); return; }

        const btn = document.getElementById('buildings-link-confirm');
        btn.disabled = true;
        try {
            const res  = await fetch(`${API}?action=link`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ building_id: buildingId, property_id: propertyId }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeLinkModal();
            showAlert('Immobile collegato.', 'success');
            loadBuildingProperties(buildingId);
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    function openModal(item = null) {
        els.form.reset();
        document.getElementById('buildings-id').value = '';
        document.getElementById('buildings-modal-title').textContent = item ? 'Modifica Edificio' : 'Nuovo Edificio';

        if (item) {
            document.getElementById('buildings-id').value          = item.id;
            document.getElementById('buildings-name').value        = item.name || '';
            document.getElementById('buildings-city').value        = item.city || '';
            document.getElementById('buildings-address').value     = item.address || '';
            document.getElementById('buildings-total-units').value = item.total_units || '';
            document.getElementById('buildings-notes').value       = item.notes || '';
        }

        els.modal.hidden = false;
        document.getElementById('buildings-name').focus();
    }

    function closeModal() { els.modal.hidden = true; }
    function closeDeleteModal() { els.delModal.hidden = true; deleteTargetId = null; }

    async function handleSubmit(e) {
        e.preventDefault();
        const id  = document.getElementById('buildings-id').value;
        const btn = document.getElementById('buildings-modal-save');
        btn.disabled = true; btn.textContent = 'Salvataggio…';

        const data = {
            name:        document.getElementById('buildings-name').value.trim(),
            city:        document.getElementById('buildings-city').value.trim(),
            address:     document.getElementById('buildings-address').value.trim(),
            total_units: parseInt(document.getElementById('buildings-total-units').value) || null,
            notes:       document.getElementById('buildings-notes').value.trim(),
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
            showAlert('Edificio salvato con successo.', 'success');
            loadBuildings();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Salva';
        }
    }

    async function confirmDelete() {
        if (!deleteTargetId) return;
        const btn = document.getElementById('buildings-delete-confirm');
        btn.disabled = true;
        try {
            const res  = await fetch(`${API}?id=${deleteTargetId}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeDeleteModal();
            if (expandedId == deleteTargetId) expandedId = null;
            showAlert('Edificio eliminato.', 'success');
            loadBuildings();
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
