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
        document.getElementById('btn-profile-generate').addEventListener('click', () => {
            if (building) window.BuildingAdmin.openGenerateModal(building);
        });

        window.BuildingAdmin.loadAdministrators();
        window.BuildingAdmin.bindAdminFields();
        window.BuildingAdmin.bindGenerateModal(() => building, () => loadBuilding());

        bindMillesimi();
        bindDistribute();
        bindDocuments();

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
            loadMillesimi();
            loadDocuments();
        } catch (err) {
            showAlert('Impossibile caricare l\'edificio: ' + err.message, 'error');
        }
    }

    function renderHero() {
        document.getElementById('profile-name').textContent = building.name;

        const meta = [];
        if (building.address) meta.push(`<span><i data-lucide="map-pin"></i> ${esc(building.address)}, ${esc(building.city || '')}${building.cap ? ' — ' + esc(building.cap) : ''}</span>`);
        meta.push(`<span><i data-lucide="door-open"></i> ${esc(building.unit_count ?? 0)} unità in anagrafica su ${esc(building.total_units ?? 0)} dichiarate</span>`);
        if (building.units_missing > 0) {
            meta.push(`<span class="badge badge--warning"><i data-lucide="alert-triangle"></i> ${esc(building.units_missing)} da creare</span>`);
        }
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
        if (building.administrator_name) {
            const src = building.administrator_source === 'supplier'
                ? '<span class="badge">in rubrica</span>'
                : '<span class="badge badge--warning" title="Testo libero: non si aggiorna insieme agli altri edifici che amministra">testo libero</span>';
            admin.push(`<span><i data-lucide="user"></i> ${esc(building.administrator_name)} ${src}</span>`);
        }
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
        document.getElementById('buildings-cap').value         = item.cap || '';
        document.getElementById('buildings-province').value    = item.province || '';
        document.getElementById('buildings-total-units').value = item.total_units || '';
        document.getElementById('buildings-notes').value       = item.notes || '';
        window.BuildingAdmin.fillAdminFields(item);
        document.getElementById('buildings-modal').hidden = false;
        document.getElementById('buildings-name').focus();
    }

    function closeModal() { document.getElementById('buildings-modal').hidden = true; }

    async function saveBuilding(e) {
        e.preventDefault();
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

    // ── Tabelle millesimali ──────────────────────────────────────────

    const MILLESIMI_LABELS = {
        proprieta: 'Proprietà', riscaldamento: 'Riscaldamento', ascensore: 'Ascensore',
        scale: 'Scale', acqua: 'Acqua', altro: 'Altro',
    };

    function currentTable() {
        return document.getElementById('millesimi-table-type').value || 'proprieta';
    }

    function bindMillesimi() {
        document.getElementById('millesimi-table-type').addEventListener('change', loadMillesimi);
        document.getElementById('btn-millesimi-save').addEventListener('click', saveMillesimi);
        document.getElementById('btn-millesimi-split').addEventListener('click', splitEqually);
    }

    async function loadMillesimi() {
        const body = document.getElementById('millesimi-body');
        body.innerHTML = '<p class="text-muted">Caricamento…</p>';
        try {
            const res  = await fetch(`${API}?id=${buildingId}&action=millesimi&table_type=${encodeURIComponent(currentTable())}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            renderMillesimi(Array.isArray(json.data) ? json.data[0] : json.data);
        } catch (err) {
            body.innerHTML = `<p class="text-muted">${esc(err.message)}</p>`;
        }
    }

    function renderMillesimi(data) {
        const body = document.getElementById('millesimi-body');
        const rows = data.rows || [];

        if (!rows.length) {
            body.innerHTML = '<p class="text-muted">Nessuna unità collegata: crea o collega gli immobili prima di compilare i millesimi.</p>';
            document.getElementById('millesimi-total').textContent = '—';
            return;
        }

        body.innerHTML = `
            <div class="table-wrapper">
                <table class="data-table">
                    <thead><tr><th>Unità</th><th style="width:180px;">Millesimi</th></tr></thead>
                    <tbody>
                        ${rows.map(r => `<tr>
                            <td>${esc(r.address)}${r.city ? ', ' + esc(r.city) : ''}</td>
                            <td><input type="number" class="form-input millesimi-input" data-property-id="${r.property_id}"
                                       min="0" max="1000" step="0.0001" value="${r.quota > 0 ? Number(r.quota) : ''}" placeholder="0"></td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;

        body.querySelectorAll('.millesimi-input').forEach(inp => inp.addEventListener('input', updateMillesimiTotal));
        updateMillesimiTotal();
    }

    function readMillesimiRows() {
        return Array.from(document.querySelectorAll('.millesimi-input')).map(inp => ({
            property_id: parseInt(inp.dataset.propertyId, 10),
            quota: parseFloat(inp.value) || 0,
        }));
    }

    function updateMillesimiTotal() {
        const rows  = readMillesimiRows();
        const total = rows.reduce((s, r) => s + r.quota, 0);
        const el    = document.getElementById('millesimi-total');
        // Il totale si legge sempre su 1000: e' l'unico modo per accorgersi al
        // volo che manca l'unita' dimenticata, prima di ripartire una spesa.
        const rounded = Math.round(total * 10000) / 10000;
        el.textContent = `Totale tabella "${MILLESIMI_LABELS[currentTable()]}": ${rounded} / 1000`;
        el.style.color = Math.abs(total - 1000) < 0.01 || total === 0 ? '' : 'var(--color-warning, #d97706)';
    }

    function splitEqually() {
        const inputs = Array.from(document.querySelectorAll('.millesimi-input'));
        if (!inputs.length) return;
        // Divisione a 4 decimali con il resto sull'ultima riga: 1000/3 non e'
        // rappresentabile, e tre volte 333,3333 fanno 999,9999 — non 1000.
        const each = Math.floor((1000 / inputs.length) * 10000) / 10000;
        inputs.forEach((inp, i) => {
            inp.value = i === inputs.length - 1
                ? Math.round((1000 - each * (inputs.length - 1)) * 10000) / 10000
                : each;
        });
        updateMillesimiTotal();
    }

    async function saveMillesimi() {
        const btn = document.getElementById('btn-millesimi-save');
        btn.disabled = true;
        try {
            const res = await fetch(`${API}?id=${buildingId}&action=millesimi`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ table_type: currentTable(), rows: readMillesimiRows() }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert('Tabella millesimale salvata.', 'success');
            renderMillesimi(Array.isArray(json.data) ? json.data[0] : json.data);
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    // ── Ripartizione spesa ───────────────────────────────────────────

    function bindDistribute() {
        const modal = document.getElementById('distribute-modal');
        const close = () => { modal.hidden = true; };

        document.getElementById('btn-distribute-open').addEventListener('click', () => {
            document.getElementById('distribute-table').value = currentTable();
            document.getElementById('distribute-date').value  = window.Fmt.today();
            document.getElementById('distribute-result').innerHTML = '';
            updateDistributePreview();
            modal.hidden = false;
        });
        document.getElementById('distribute-close').addEventListener('click', close);
        document.getElementById('distribute-cancel').addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) close(); });

        ['distribute-amount', 'distribute-table'].forEach(id =>
            document.getElementById(id).addEventListener('input', updateDistributePreview));
        document.getElementById('distribute-table').addEventListener('change', updateDistributePreview);
        document.getElementById('distribute-confirm').addEventListener('click', confirmDistribute);
    }

    function updateDistributePreview() {
        const amount = parseFloat(document.getElementById('distribute-amount').value) || 0;
        const el = document.getElementById('distribute-preview');
        el.textContent = amount > 0
            ? `€ ${amount.toLocaleString('it-IT', { minimumFractionDigits: 2 })} verranno divisi fra le unità con quota nella tabella scelta. La spesa resta una sola: le quote sono la sua imputazione per unità.`
            : '';
    }

    async function confirmDistribute() {
        const description = document.getElementById('distribute-description').value.trim();
        const amount      = parseFloat(document.getElementById('distribute-amount').value);
        const date        = document.getElementById('distribute-date').value;

        if (!description)         { showAlert('Inserisci la descrizione della spesa.', 'error'); return; }
        if (!amount || amount <= 0) { showAlert('Inserisci un importo valido.', 'error'); return; }
        if (!date)                { showAlert('Inserisci la data della spesa.', 'error'); return; }

        const btn = document.getElementById('distribute-confirm');
        btn.disabled = true; btn.textContent = 'Ripartizione…';
        try {
            const res = await fetch(`${API}?id=${buildingId}&action=distribute_expense`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    description,
                    amount,
                    expense_date: date,
                    category:     document.getElementById('distribute-category').value,
                    table_type:   document.getElementById('distribute-table').value,
                }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const data = Array.isArray(json.data) ? json.data[0] : json.data;

            document.getElementById('distribute-result').innerHTML = `
                <div class="alert alert--success" style="display:block;">${esc(data.message)}</div>
                <div class="table-wrapper"><table class="data-table">
                    <thead><tr><th>Unità</th><th>Millesimi</th><th>Quota</th></tr></thead>
                    <tbody>${(data.allocated || []).map(a => `<tr>
                        <td>${esc(a.address)}</td>
                        <td>${esc(a.quota)}</td>
                        <td>€ ${Number(a.amount).toLocaleString('it-IT', { minimumFractionDigits: 2 })}</td>
                    </tr>`).join('')}</tbody>
                    <tfoot><tr><th>Totale ripartito</th><th></th>
                        <th>€ ${Number(data.allocated_total).toLocaleString('it-IT', { minimumFractionDigits: 2 })}</th></tr></tfoot>
                </table></div>`;
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Ripartisci';
        }
    }

    // ── Documenti condominiali ───────────────────────────────────────

    const DOC_LABELS = {
        regolamento: 'Regolamento', planimetria: 'Planimetria', verbale: 'Verbale assemblea',
        invoice: 'Fattura', contract: 'Contratto', preventivo: 'Preventivo', other: 'Altro',
    };

    function bindDocuments() {
        const modal = document.getElementById('building-doc-modal');
        const close = () => { modal.hidden = true; };
        document.getElementById('btn-doc-upload').addEventListener('click', () => {
            document.getElementById('building-doc-form').reset();
            modal.hidden = false;
        });
        document.getElementById('building-doc-close').addEventListener('click', close);
        document.getElementById('building-doc-cancel').addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) close(); });
        document.getElementById('building-doc-form').addEventListener('submit', uploadDocument);
    }

    async function loadDocuments() {
        const list = document.getElementById('profile-docs-list');
        try {
            const res  = await fetch(`${API}?id=${buildingId}&action=documents`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const data  = Array.isArray(json.data) ? json.data[0] : json.data;
            const items = data.items || [];

            list.innerHTML = items.length
                ? `<div class="table-wrapper"><table class="data-table">
                       <thead><tr><th>Tipo</th><th>Documento</th><th>Data</th><th class="col-actions">Azioni</th></tr></thead>
                       <tbody>${items.map(d => `<tr>
                           <td><span class="badge">${esc(DOC_LABELS[d.doc_type] || d.doc_type)}</span></td>
                           <td>${esc(d.title || d.original_name)}</td>
                           <td>${esc((d.created_at || '').slice(0, 10))}</td>
                           <td class="lt-actions">
                               <a class="btn btn--sm btn--ghost" href="${esc(d.download_url)}" target="_blank" rel="noopener">Scarica</a>
                               <button class="btn btn--sm btn--ghost btn-doc-del" data-id="${d.id}">Elimina</button>
                           </td></tr>`).join('')}</tbody>
                   </table></div>`
                : '<p class="text-muted">Nessun documento condominiale. Caricando qui il regolamento o le planimetrie, tutte le unità collegate li vedranno senza doverli ricaricare.</p>';

            list.querySelectorAll('.btn-doc-del').forEach(btn =>
                btn.addEventListener('click', () => deleteDocument(btn.dataset.id)));
        } catch (err) {
            list.innerHTML = `<p class="text-muted">${esc(err.message)}</p>`;
        }
    }

    async function uploadDocument(e) {
        e.preventDefault();
        const fileInput = document.getElementById('building-doc-file');
        if (!fileInput.files.length) { showAlert('Seleziona un file.', 'error'); return; }

        const fd = new FormData();
        fd.append('building_id', buildingId);
        fd.append('doc_type', document.getElementById('building-doc-type').value);
        fd.append('title',    document.getElementById('building-doc-title-input').value.trim());
        fd.append('notes',    document.getElementById('building-doc-notes').value.trim());
        fd.append('file',     fileInput.files[0]);

        const btn = document.getElementById('building-doc-save');
        btn.disabled = true; btn.textContent = 'Caricamento…';
        try {
            const res  = await fetch('api/documents.php', { method: 'POST', body: fd });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            document.getElementById('building-doc-modal').hidden = true;
            showAlert('Documento caricato: ora è visibile da tutte le unità dell\'edificio.', 'success');
            loadDocuments();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Carica';
        }
    }

    async function deleteDocument(id) {
        if (!window.confirm('Eliminare questo documento? Non sarà più visibile da nessuna unità dell\'edificio.')) return;
        try {
            const res  = await fetch(`api/documents.php?id=${id}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert('Documento eliminato.', 'success');
            loadDocuments();
        } catch (err) {
            showAlert(err.message, 'error');
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
