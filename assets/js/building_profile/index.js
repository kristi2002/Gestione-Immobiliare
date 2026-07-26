/**
 * Scheda Edificio — dedicated building profile view
 */
(function () {
    'use strict';

    const API      = 'api/buildings.php';
    const PROP_API = 'api/properties.php';

    const PROP_STATUS = { available: 'Disponibile', rented: 'Affittato', sold: 'Venduto', maintenance: 'Manutenzione', archived: 'Archiviato' };
    const PROP_COLOR  = { available: '#16a34a', rented: '#2563eb', sold: '#7c3aed', maintenance: '#d97706', archived: '#94a3b8' };

    function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
    function mediaUrl(path) {
        if (!path) return '';
        if (/^https?:\/\//i.test(path) || path.startsWith('/')) return path;
        return '/' + String(path).replace(/^\.\//, '');
    }

    let building   = null;
    let buildingId = null;

    function init() {
        buildingId = window.App?.viewParams?.buildingId;
        if (!buildingId) {
            showAlert('ID edificio non specificato. Torna all\'elenco e riprova.', 'error');
            return;
        }
        bindEvents();
        loadBuilding();
    }

    function bindEvents() {
        document.getElementById('btn-back-to-buildings').addEventListener('click', () => {
            if (window.App) window.App.navigateTo('buildings');
        });
        document.getElementById('btn-profile-edit').addEventListener('click', () => openModal(building));
        document.getElementById('btn-profile-link').addEventListener('click', () => openLinkModal());

        document.getElementById('buildings-modal-close').addEventListener('click', closeModal);
        document.getElementById('buildings-modal-cancel').addEventListener('click', closeModal);
        document.getElementById('buildings-modal').addEventListener('click', e => {
            if (e.target === document.getElementById('buildings-modal')) closeModal();
        });
        document.getElementById('buildings-form').addEventListener('submit', saveBuilding);

        document.getElementById('buildings-link-close').addEventListener('click', closeLinkModal);
        document.getElementById('buildings-link-cancel').addEventListener('click', closeLinkModal);
        document.getElementById('buildings-link-confirm').addEventListener('click', confirmLink);
        document.getElementById('buildings-link-modal').addEventListener('click', e => {
            if (e.target === document.getElementById('buildings-link-modal')) closeLinkModal();
        });
    }

    async function loadBuilding() {
        try {
            const res  = await fetch(`${API}?id=${buildingId}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            building = json.data;
            renderHero();
            renderProperties();
        } catch (err) {
            showAlert('Impossibile caricare l\'edificio: ' + err.message, 'error');
        }
    }

    function renderHero() {
        document.getElementById('profile-name').textContent = building.name;

        const meta = [];
        if (building.address) meta.push(`<span><i data-lucide="map-pin"></i> ${esc(building.address)}, ${esc(building.city || '')}</span>`);
        meta.push(`<span><i data-lucide="door-open"></i> ${esc(building.unit_count ?? 0)} unità</span>`);
        if (building.occupancy_count != null) meta.push(`<span><i data-lucide="badge-check"></i> ${esc(building.occupancy_count)} occupate</span>`);
        document.getElementById('profile-meta').innerHTML = meta.join('');

        const notesEl = document.getElementById('profile-notes');
        if (building.notes && building.notes.trim()) {
            document.getElementById('profile-notes-text').textContent = building.notes;
            notesEl.hidden = false;
        } else {
            notesEl.hidden = true;
        }

        const adminCard = document.getElementById('profile-admin-card');
        const admin = [];
        if (building.administrator_name) admin.push(`<span><i data-lucide="user"></i> ${esc(building.administrator_name)}</span>`);
        if (building.administrator_phone) admin.push(`<span><i data-lucide="phone"></i> <a href="tel:${esc(building.administrator_phone)}">${esc(building.administrator_phone)}</a></span>`);
        if (building.administrator_email) admin.push(`<span><i data-lucide="mail"></i> <a href="mailto:${esc(building.administrator_email)}">${esc(building.administrator_email)}</a></span>`);
        if (admin.length) {
            document.getElementById('profile-admin-box').innerHTML = admin.join('');
            adminCard.hidden = false;
        } else {
            adminCard.hidden = true;
        }

        if (window.lucide) window.lucide.createIcons();
    }

    function renderProperties() {
        const grid = document.getElementById('profile-props-grid');
        const props = building.properties || [];
        document.getElementById('profile-props-count').textContent =
            props.length ? `${props.length} immobil${props.length === 1 ? 'e' : 'i'} collegat${props.length === 1 ? 'o' : 'i'}` : '';

        if (!props.length) {
            grid.innerHTML = '<div class="entity-empty">Nessun immobile collegato a questo edificio. Usa "Collega immobile" per aggiungerne uno.</div>';
            return;
        }

        grid.innerHTML = props.map(p => {
            const photo = p.cover_url
                ? `<img src="${esc(mediaUrl(p.cover_url))}" class="prop-card-thumb" alt="" loading="lazy" onerror="this.onerror=null;this.outerHTML='<div class=&quot;prop-card-thumb prop-card-thumb--empty&quot;>&#x1F3E2;</div>'">`
                : `<div class="prop-card-thumb prop-card-thumb--empty"><i data-lucide="building-2"></i></div>`;
            const color = PROP_COLOR[p.status] || '#94a3b8';
            const price = p.price ? `<span class="profile-prop-rent">€ ${Number(p.price).toLocaleString('it-IT')}${p.price_type === 'affitto' ? '/mese' : ''}</span>` : '';
            const owner = p.client_name ? `<span class="text-muted" style="font-size:12px;">${esc(p.client_name)} ${esc(p.client_surname || '')}</span>` : '';
            return `
            <div class="entity-card profile-prop-card entity-card--clickable" data-prop-id="${p.id}" style="cursor:pointer;">
                <div class="prop-card-thumb-wrap">${photo}</div>
                <div class="entity-card__body">
                    <div class="entity-card__name" style="font-size:14px;">${esc(p.address)}, ${esc(p.city)}</div>
                    <div class="profile-prop-meta">
                        <span class="badge" style="background:${color}20;color:${color};border:1px solid ${color}40;">${PROP_STATUS[p.status] || p.status}</span>
                        ${p.sqm ? `<span class="text-muted" style="font-size:12px;">${esc(p.sqm)} m²</span>` : ''}
                        ${price}
                    </div>
                    ${owner ? `<div style="margin-top:4px;">${owner}</div>` : ''}
                </div>
            </div>`;
        }).join('');

        grid.querySelectorAll('[data-prop-id]').forEach(card => {
            card.addEventListener('click', () => {
                if (window.App) window.App.navigateTo('property_profile', { propertyId: parseInt(card.dataset.propId, 10) });
            });
        });
        if (window.lucide) window.lucide.createIcons();
    }

    // ── Edit building modal ───────────────────────────────────────────

    function openModal(item) {
        const form = document.getElementById('buildings-form');
        form.reset();
        document.getElementById('buildings-id').value          = item.id;
        document.getElementById('buildings-name').value        = item.name || '';
        document.getElementById('buildings-city').value        = item.city || '';
        document.getElementById('buildings-address').value     = item.address || '';
        document.getElementById('buildings-total-units').value = item.total_units || '';
        document.getElementById('buildings-admin-name').value  = item.administrator_name || '';
        document.getElementById('buildings-admin-phone').value = item.administrator_phone || '';
        document.getElementById('buildings-admin-email').value = item.administrator_email || '';
        document.getElementById('buildings-notes').value       = item.notes || '';
        document.getElementById('buildings-modal').hidden = false;
        document.getElementById('buildings-name').focus();
    }

    function closeModal() { document.getElementById('buildings-modal').hidden = true; }

    async function saveBuilding(e) {
        e.preventDefault();
        const btn = document.getElementById('buildings-modal-save');
        btn.disabled = true; btn.textContent = 'Salvataggio…';

        const data = {
            name:                document.getElementById('buildings-name').value.trim(),
            city:                document.getElementById('buildings-city').value.trim(),
            address:             document.getElementById('buildings-address').value.trim(),
            total_units:         parseInt(document.getElementById('buildings-total-units').value) || null,
            administrator_name:  document.getElementById('buildings-admin-name').value.trim(),
            administrator_phone: document.getElementById('buildings-admin-phone').value.trim(),
            administrator_email: document.getElementById('buildings-admin-email').value.trim(),
            notes:               document.getElementById('buildings-notes').value.trim(),
        };

        try {
            const res  = await fetch(`${API}?id=${buildingId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeModal();
            showAlert('Edificio aggiornato.', 'success');
            await loadBuilding();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Salva';
        }
    }

    // ── Link property modal ───────────────────────────────────────────

    async function openLinkModal() {
        const sel = document.getElementById('buildings-link-property-id');
        sel.innerHTML = '<option value="">— Seleziona —</option>';
        try {
            const props = await (window.Pagination?.fetchList ? window.Pagination.fetchList(PROP_API) : fetch(PROP_API).then(r => r.json()).then(j => j.data?.items || []));
            props.forEach(p => {
                if (p.building_id && Number(p.building_id) === Number(buildingId)) return; // already linked here
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.address || p.title || `#${p.id}`;
                sel.appendChild(opt);
            });
        } catch (_) { /* non-critical */ }
        document.getElementById('buildings-link-building-id').value = buildingId;
        document.getElementById('buildings-link-modal').hidden = false;
    }

    function closeLinkModal() { document.getElementById('buildings-link-modal').hidden = true; }

    async function confirmLink() {
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
            await loadBuilding();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    // ── Utilities ────────────────────────────────────────────────────

    function showAlert(msg, type) {
        const el = document.getElementById('profile-alert');
        el.textContent = msg;
        el.className   = `alert alert--${type}`;
        el.style.display = 'block';
        clearTimeout(el._t);
        el._t = setTimeout(() => { el.style.display = 'none'; }, 4500);
    }

    init();
})();
