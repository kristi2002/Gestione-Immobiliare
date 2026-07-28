(function () {
    'use strict';

    const API      = 'api/buildings.php';
    const PROP_API = 'api/properties.php';
    const SUPP_API = 'api/suppliers.php';
    const CLIENT_API = 'api/clients.php';

    const PROP_STATUS = { available: 'Disponibile', rented: 'Affittato', sold: 'Venduto', maintenance: 'Manutenzione', archived: 'Archiviato' };
    const PROP_COLOR  = { available: '#16a34a', rented: '#2563eb', sold: '#7c3aed', maintenance: '#d97706', archived: '#94a3b8' };

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
    function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
    function mediaUrl(path) {
        if (!path) return '';
        if (/^https?:\/\//i.test(path) || path.startsWith('/')) return path;
        return '/' + String(path).replace(/^\.\//, '');
    }

    let currentPage    = 1;
    const PAGE_LIMIT   = 25;
    let deleteTargetId = null;
    let allProperties  = [];
    let buildings      = [];
    let railBuildingId = null;
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
        els.genModal   = document.getElementById('buildings-generate-modal');

        bindEvents();
        bindRail();
        bindRowMenu();
        loadProperties();
        window.BuildingAdmin.loadAdministrators();
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

        window.BuildingAdmin.bindAdminFields();
        // getBuilding(): l'anteprima degli indirizzi generati ha bisogno
        // dell'edificio su cui si sta lavorando, non di quello selezionato
        // nella lista — sono la stessa cosa solo finche' non si cambia riga.
        window.BuildingAdmin.bindGenerateModal(
            () => buildings.find(b => b.id === Number(document.getElementById('buildings-generate-building-id').value)),
            () => { loadBuildings(); refreshRailIfOpen(railBuildingId); }
        );
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

        softLoad(els.tbody, '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:2rem;">Caricamento…</td></tr>');

        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const parsed = window.Pagination.parseResponse(json);
            buildings = parsed.items;
            renderRows(buildings);
            window.Pagination.render(els.pagination, parsed, p => { currentPage = p; loadBuildings(); });
        } catch (err) {
            els.tbody.classList.remove('is-loading');
            els.tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--color-danger);padding:2rem;">${esc(err.message)}</td></tr>`;
        }
    }

    function renderRows(items) {
        els.tbody.classList.remove('is-loading');
        if (!items.length) {
            els.tbody.innerHTML = '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:2rem;">Nessun edificio trovato.</td></tr>';
            return;
        }

        els.tbody.innerHTML = items.map(b => {
            // Dichiarate vs realmente in anagrafica: "56" da solo lasciava
            // credere che le unita' esistessero, mentre non ne era stata creata
            // nessuna — ed e' la ragione per cui "Occupate" leggeva 0.
            const declared = parseInt(b.total_units, 10) || 0;
            const linked   = parseInt(b.unit_count, 10) || 0;
            const unitsCell = declared || linked
                ? `<strong>${linked}</strong><span class="text-muted"> / ${declared || linked}</span>`
                  + (linked < declared ? ` <span class="badge badge--warning" title="${declared - linked} unità dichiarate ma non ancora create">${declared - linked} da creare</span>` : '')
                : '—';
            return `<tr class="building-row" data-id="${b.id}" style="cursor:pointer;">
                <td data-label="Nome"><strong>${esc(b.name)}</strong></td>
                <td data-label="Indirizzo">${esc(b.address || '—')}</td>
                <td data-label="Città">${esc(b.city || '—')}</td>
                <td data-label="Unità (in anagrafica / dichiarate)">${unitsCell}</td>
                <td data-label="Occupate">${esc(b.occupancy_count ?? '—')}</td>
                <td data-label="Azioni" class="lt-actions">
                    <button class="btn btn--sm btn--ghost btn-rail" data-id="${b.id}" title="Azioni" aria-label="Azioni edificio" aria-haspopup="menu"><i data-lucide="more-vertical"></i></button>
                </td>
            </tr>`;
        }).join('');

        els.tbody.querySelectorAll('.building-row').forEach(row => {
            row.addEventListener('click', e => {
                if (e.target.closest('button, input, a')) return;
                openRail(parseInt(row.dataset.id, 10));
            });
        });
        els.tbody.querySelectorAll('.btn-rail').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const b = items.find(x => x.id === Number(btn.dataset.id));
                if (b) openRowMenu(btn, b);
            });
        });

        if (window.lucide) window.lucide.createIcons();
    }

    // ── Row kebab menu (Visualizzazione completa / Modifica / Collega immobile / Elimina) ──

    let rowMenuEl = null;

    function bindRowMenu() {
        const gone = () => !document.body.contains(els.tbody);
        function cleanup() {
            closeRowMenu();
            document.removeEventListener('click', onDocClick);
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('scroll', onAnyMove, true);
            window.removeEventListener('resize', onAnyMove);
        }
        function onDocClick(e) {
            if (gone()) { cleanup(); return; }
            if (rowMenuEl && !rowMenuEl.contains(e.target)) closeRowMenu();
        }
        function onKey(e) {
            if (gone()) { cleanup(); return; }
            if (e.key === 'Escape') closeRowMenu();
        }
        function onAnyMove() {
            if (gone()) { cleanup(); return; }
            closeRowMenu();
        }
        document.addEventListener('click', onDocClick);
        document.addEventListener('keydown', onKey);
        window.addEventListener('scroll', onAnyMove, true);
        window.addEventListener('resize', onAnyMove);
    }

    function closeRowMenu() {
        if (rowMenuEl) { rowMenuEl.remove(); rowMenuEl = null; }
    }

    function openRowMenu(btn, building) {
        if (rowMenuEl && Number(rowMenuEl.dataset.id) === building.id) { closeRowMenu(); return; }
        closeRowMenu();

        const menu = document.createElement('div');
        menu.className = 'lt-menu';
        menu.dataset.id = building.id;
        menu.setAttribute('role', 'menu');
        menu.innerHTML = `
            <button type="button" class="lt-menu__item" data-act="view" role="menuitem">
                <i data-lucide="eye"></i> Visualizzazione completa
            </button>
            <button type="button" class="lt-menu__item" data-act="edit" role="menuitem">
                <i data-lucide="pencil"></i> Modifica
            </button>
            <button type="button" class="lt-menu__item" data-act="link" role="menuitem">
                <i data-lucide="link"></i> Collega immobile
            </button>
            <button type="button" class="lt-menu__item" data-act="generate" role="menuitem">
                <i data-lucide="copy-plus"></i> Genera unità
            </button>
            <div class="lt-menu__sep"></div>
            <button type="button" class="lt-menu__item lt-menu__item--danger" data-act="delete" role="menuitem">
                <i data-lucide="trash-2"></i> Elimina
            </button>`;
        document.body.appendChild(menu);

        const r  = btn.getBoundingClientRect();
        const mw = menu.offsetWidth;
        const mh = menu.offsetHeight;
        let left = Math.min(r.right - mw, window.innerWidth - mw - 8);
        let top  = r.bottom + 6;
        if (top + mh > window.innerHeight - 8) top = r.top - mh - 6;
        menu.style.left = Math.max(8, left) + 'px';
        menu.style.top  = Math.max(8, top) + 'px';

        menu.querySelector('[data-act="view"]').addEventListener('click', () => {
            closeRowMenu();
            if (window.App) window.App.navigateTo('building_profile', { buildingId: building.id });
        });
        menu.querySelector('[data-act="edit"]').addEventListener('click', async () => {
            closeRowMenu();
            try {
                const res  = await fetch(`${API}?id=${building.id}`);
                const json = await res.json();
                if (!json.success) throw new Error(json.error);
                openModal(json.data);
            } catch (err) { showAlert(err.message, 'error'); }
        });
        menu.querySelector('[data-act="link"]').addEventListener('click', () => {
            closeRowMenu();
            openLinkModal(building.id);
        });
        menu.querySelector('[data-act="generate"]').addEventListener('click', () => {
            closeRowMenu();
            window.BuildingAdmin.openGenerateModal(building);
        });
        menu.querySelector('[data-act="delete"]').addEventListener('click', () => {
            closeRowMenu();
            deleteTargetId = building.id;
            document.getElementById('buildings-delete-name').textContent = building.name;
            els.delModal.hidden = false;
        });

        if (window.lucide) window.lucide.createIcons();
        rowMenuEl = menu;
    }

    // ── Detail rail (right-hand sidebar drawer) ──────────────────────

    function bindRail() {
        const rail = document.getElementById('building-rail');
        if (!rail) return;
        document.getElementById('building-rail-close')?.addEventListener('click', closeRail);
        document.getElementById('building-rail-open-full')?.addEventListener('click', () => {
            const id = railBuildingId;
            if (id && window.App) {
                closeRail();
                window.App.navigateTo('building_profile', { buildingId: id });
            }
        });
        document.addEventListener('keydown', function onEsc(e) {
            if (e.key === 'Escape' && !rail.hidden) closeRail();
            if (!document.body.contains(rail)) document.removeEventListener('keydown', onEsc);
        });
    }

    function closeRail() {
        const rail = document.getElementById('building-rail');
        if (rail) rail.hidden = true;
        railBuildingId = null;
        document.querySelectorAll('.building-row.is-active').forEach(r => r.classList.remove('is-active'));
    }

    async function openRail(id) {
        railBuildingId = id;
        document.querySelectorAll('.building-row').forEach(r => r.classList.toggle('is-active', Number(r.dataset.id) === id));

        const rail = document.getElementById('building-rail');
        rail.hidden = false;
        document.getElementById('building-rail-name').textContent = 'Caricamento…';
        document.getElementById('building-rail-chips').innerHTML = '';
        document.getElementById('building-rail-admin').innerHTML = '<p class="text-muted detail-rail__empty">—</p>';
        document.getElementById('building-rail-props').innerHTML = '<p class="text-muted detail-rail__empty">Caricamento…</p>';

        try {
            const res  = await fetch(`${API}?id=${id}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const b = json.data;
            if (railBuildingId !== id) return; // user moved on before this resolved

            document.getElementById('building-rail-name').textContent = b.name;

            const chips = [];
            if (b.city) chips.push(`<span class="badge"><i data-lucide="map-pin"></i> ${esc(b.city)}</span>`);
            chips.push(`<span class="badge">${esc(b.unit_count ?? 0)} unità</span>`);
            if (b.occupancy_count != null) chips.push(`<span class="badge badge--active">${esc(b.occupancy_count)} occupate</span>`);
            document.getElementById('building-rail-chips').innerHTML = chips.join('');

            const admin = [];
            if (b.administrator_name) {
                // administrator_source dice se il contatto viene dalla rubrica
                // (e quindi si aggiorna in un posto solo) o e' testo di questa riga.
                const badge = b.administrator_source === 'supplier'
                    ? ' <span class="badge">in rubrica</span>'
                    : ' <span class="badge badge--warning" title="Testo libero: non si aggiorna insieme agli altri edifici">testo libero</span>';
                admin.push(`<div class="rail-doc"><i data-lucide="user"></i> ${esc(b.administrator_name)}${badge}</div>`);
            }
            if (b.administrator_phone) admin.push(`<div class="rail-doc"><i data-lucide="phone"></i> <a href="tel:${esc(b.administrator_phone)}">${esc(b.administrator_phone)}</a></div>`);
            if (b.administrator_email) admin.push(`<div class="rail-doc"><i data-lucide="mail"></i> <a href="mailto:${esc(b.administrator_email)}">${esc(b.administrator_email)}</a></div>`);
            document.getElementById('building-rail-admin').innerHTML = admin.join('') || '<p class="text-muted detail-rail__empty">Nessun amministratore registrato.</p>';

            const propsEl = document.getElementById('building-rail-props');
            const props = b.properties || [];
            if (!props.length) {
                propsEl.innerHTML = '<p class="text-muted detail-rail__empty">Nessun immobile collegato.</p>';
            } else {
                propsEl.innerHTML = props.slice(0, 6).map(p => {
                    const thumb = p.cover_url
                        ? `<img src="${esc(mediaUrl(p.cover_url))}" alt="" loading="lazy">`
                        : '<i data-lucide="building-2"></i>';
                    return `<div class="rail-prop" data-prop-id="${p.id}" style="cursor:pointer;">
                        <div class="rail-prop__img">${thumb}</div>
                        <div class="rail-prop__txt">
                            <b>${esc(p.address)}, ${esc(p.city)}</b>
                            <span>${PROP_STATUS[p.status] || p.status || ''}${p.sqm ? ' · ' + esc(p.sqm) + ' m²' : ''}</span>
                        </div>
                    </div>`;
                }).join('') + (props.length > 6 ? `<p class="text-muted detail-rail__empty">+${props.length - 6} altri — vedi scheda completa</p>` : '');
                propsEl.querySelectorAll('[data-prop-id]').forEach(el => {
                    el.addEventListener('click', () => {
                        closeRail();
                        if (window.App) window.App.navigateTo('property_profile', { propertyId: parseInt(el.dataset.propId, 10) });
                    });
                });
            }
            if (window.lucide) window.lucide.createIcons();
        } catch (err) {
            const fallback = buildings.find(x => x.id === id);
            document.getElementById('building-rail-name').textContent = fallback?.name || '—';
            document.getElementById('building-rail-props').innerHTML = `<p class="text-muted detail-rail__empty">${esc(err.message)}</p>`;
        }
    }

    function refreshRailIfOpen(id) {
        if (railBuildingId === id) openRail(id);
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
            const res  = await fetch(`${API}?id=${buildingId}&action=link_property`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ property_id: propertyId }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeLinkModal();
            showAlert('Immobile collegato.', 'success');
            loadBuildings();
            refreshRailIfOpen(Number(buildingId));
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
            document.getElementById('buildings-cap').value         = item.cap || '';
            document.getElementById('buildings-province').value    = item.province || '';
            document.getElementById('buildings-total-units').value = item.total_units || '';
            document.getElementById('buildings-notes').value       = item.notes || '';
        }
        window.BuildingAdmin.fillAdminFields(item);

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

        const data = Object.assign({
            name:        document.getElementById('buildings-name').value.trim(),
            city:        document.getElementById('buildings-city').value.trim(),
            address:     document.getElementById('buildings-address').value.trim(),
            cap:         document.getElementById('buildings-cap').value.trim(),
            province:    document.getElementById('buildings-province').value.trim().toUpperCase(),
            total_units: parseInt(document.getElementById('buildings-total-units').value) || null,
            notes:       document.getElementById('buildings-notes').value.trim(),
        }, window.BuildingAdmin.readAdminFields());

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
            const saved = Array.isArray(json.data) ? json.data[0] : json.data;
            loadBuildings();
            if (id && saved && saved.id) refreshRailIfOpen(Number(saved.id));
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
            if (railBuildingId == deleteTargetId) closeRail();
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
