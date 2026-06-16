/**
 * Properties (Immobili) — CRUD + multimedia gallery (Phase 3)
 */
(function () {
    'use strict';

    const API           = 'api/properties.php';
    const CLIENTS_API   = 'api/clients.php';
    const MEDIA_API     = 'api/property_media.php';
    const APPRAISAL_API = 'api/property_appraisals.php';
    const COMPARE_API   = 'api/property_comparison.php';
    const EXPORT_API    = 'api/property_export.php';

    const RATING_LABELS = {
        ottimo: 'Ottimo', buono: 'Buono', discreto: 'Discreto', da_ristrutturare: 'Da ristrutturare',
    };
    let importRows = [];

    const STATUS_LABELS = {
        available: 'Disponibile',
        rented:    'Affittato',
        sold:      'Venduto',
        archived:  'Archiviato',
    };

    const MEDIA_LABELS = {
        photo:      'Foto',
        video:      'Video',
        floor_plan: 'Planimetria',
    };

    let properties     = [];
    let clients        = [];
    let currentMedia   = [];
    let editingId      = null;
    let deleteTargetId = null;
    let searchTimer    = null;
    let currentPage    = 1;
    const PAGE_LIMIT   = 25;
    let selectedIds    = new Set();
    let compareIds     = new Set();

    const els = {};

    function init() {
        els.grid           = document.getElementById('properties-grid');
        els.search         = document.getElementById('property-search');
        els.clientFilter   = document.getElementById('property-client-filter');
        els.statusFilter   = document.getElementById('property-status-filter');
        els.alert          = document.getElementById('properties-alert');
        els.modal          = document.getElementById('property-modal');
        els.deleteModal    = document.getElementById('property-delete-modal');
        els.form           = document.getElementById('property-form');
        els.modalTitle     = document.getElementById('property-modal-title');
        els.clientSelect   = document.getElementById('property-client');
        els.gallerySection = document.getElementById('gallery-section');
        els.galleryHint    = document.getElementById('gallery-hint');
        els.galleryGrid    = document.getElementById('gallery-grid');
        els.pagination     = document.getElementById('properties-pagination');
        els.bulkToolbar    = document.getElementById('properties-bulk-toolbar');
        els.bulkCount      = document.getElementById('properties-bulk-count');
        els.selectAll      = document.getElementById('properties-select-all');
        els.bulkAssignClient = document.getElementById('bulk-assign-client');

        bindEvents();
        loadClients().then(() => {
            loadProperties();
        });
    }

    function bindEvents() {
        document.getElementById('btn-new-property').addEventListener('click', () => openModal());
        document.getElementById('property-modal-close').addEventListener('click', closeModal);
        document.getElementById('property-modal-cancel').addEventListener('click', closeModal);
        document.getElementById('btn-property-mandato').addEventListener('click', generateMandato);
        document.getElementById('property-delete-close').addEventListener('click', closeDeleteModal);
        document.getElementById('property-delete-cancel').addEventListener('click', closeDeleteModal);
        document.getElementById('property-delete-confirm').addEventListener('click', confirmDelete);
        document.getElementById('btn-upload-media').addEventListener('click', uploadMedia);

        document.getElementById('btn-property-geocode').addEventListener('click', geocodeFromForm);

        els.form.addEventListener('submit', handleFormSubmit);

        // CSV export / import
        document.getElementById('btn-export-properties').addEventListener('click', () => {
            window.open(`${API}?format=csv`, '_blank');
        });
        document.getElementById('btn-portal-export').addEventListener('click', () => {
            const fmt = prompt('Formato esportazione portali:\n1 = JSON (Immobiliare.it)\n2 = XML (feed MLS)\nInserisci 1 o 2:', '1');
            if (fmt === '1') window.open(`${EXPORT_API}?format=json`, '_blank');
            else if (fmt === '2') window.open(`${EXPORT_API}?format=xml`, '_blank');
        });
        document.getElementById('btn-compare-properties').addEventListener('click', openCompareModal);
        document.getElementById('property-qr-close').addEventListener('click', () => {
            document.getElementById('property-qr-modal').hidden = true;
        });
        document.getElementById('property-compare-close').addEventListener('click', () => {
            document.getElementById('property-compare-modal').hidden = true;
        });
        document.getElementById('btn-copy-qr-url').addEventListener('click', () => {
            const url = document.getElementById('qr-url').value;
            navigator.clipboard.writeText(url).then(() => showAlert('Link copiato!', 'success'));
        });
        document.getElementById('btn-import-properties').addEventListener('click', () => {
            document.getElementById('import-properties-file').click();
        });
        document.getElementById('import-properties-file').addEventListener('change', handleImportFile);
        document.getElementById('import-modal-close').addEventListener('click', closeImportModal);
        document.getElementById('import-modal-cancel').addEventListener('click', closeImportModal);
        document.getElementById('import-confirm').addEventListener('click', confirmImport);

        // Appraisal modal
        document.getElementById('appraisal-modal-close').addEventListener('click', closeAppraisalModal);
        document.getElementById('appraisal-modal-cancel').addEventListener('click', closeAppraisalModal);
        document.getElementById('appraisal-form').addEventListener('submit', saveAppraisal);

        document.getElementById('bulk-archive-properties').addEventListener('click', () => bulkAction('archive'));
        document.getElementById('bulk-assign-properties').addEventListener('click', () => bulkAction('assign'));
        document.getElementById('bulk-export-properties').addEventListener('click', bulkExport);
        els.selectAll.addEventListener('change', toggleSelectAll);

        els.search.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => { currentPage = 1; loadProperties(); }, 300);
        });

        els.clientFilter.addEventListener('change', () => { currentPage = 1; loadProperties(); });
        els.statusFilter.addEventListener('change', () => { currentPage = 1; loadProperties(); });

        els.modal.addEventListener('click', (e) => {
            if (e.target === els.modal) closeModal();
        });
        els.deleteModal.addEventListener('click', (e) => {
            if (e.target === els.deleteModal) closeDeleteModal();
        });
    }

    // -------------------------------------------------------------------------
    // Data loading
    // -------------------------------------------------------------------------

    async function loadClients() {
        try {
            clients = await Pagination.fetchList(CLIENTS_API, { status: 'active' });
            populateClientSelects();
        } catch (err) {
            if (!els.alert?.isConnected) return;
            showAlert('Errore caricamento proprietari: ' + err.message, 'error');
        }
    }

    function populateClientSelects() {
        const options = clients.map(c =>
            `<option value="${c.id}">${escapeHtml(c.surname)} ${escapeHtml(c.name)}</option>`
        ).join('');

        els.clientSelect.innerHTML = '<option value="">— Seleziona proprietario —</option>' + options;
        els.clientFilter.innerHTML = '<option value="">Tutti i proprietari</option>' + options;
        els.bulkAssignClient.innerHTML = '<option value="">— Proprietario —</option>' + options;
    }

    async function loadProperties() {
        const params = new URLSearchParams();
        const search   = els.search.value.trim();
        const clientId = els.clientFilter.value;
        const status   = els.statusFilter.value;

        if (search)   params.set('search', search);
        if (clientId) params.set('client_id', clientId);
        if (status)   params.set('status', status);
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);

        const url = `${API}?${params}`;
        els.grid.innerHTML = '<div class="entity-loading">Caricamento…</div>';

        try {
            const res  = await fetch(url);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const parsed = Pagination.parseResponse(json);
            properties = parsed.items;
            renderCards();
            Pagination.render(els.pagination, parsed, (p) => { currentPage = p; loadProperties(); });
        } catch (err) {
            els.grid.innerHTML = `<div class="entity-error">${escapeHtml(err.message)}</div>`;
        }
    }

    async function loadMedia(propertyId) {
        try {
            const res  = await fetch(`${MEDIA_API}?property_id=${propertyId}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            currentMedia = json.data;
            renderGallery();
        } catch (err) {
            els.galleryGrid.innerHTML = `<p class="text-muted gallery-empty">${escapeHtml(err.message)}</p>`;
        }
    }

    // -------------------------------------------------------------------------
    // Rendering
    // -------------------------------------------------------------------------

    function renderCards() {
        if (properties.length === 0) {
            els.grid.innerHTML = '<div class="entity-empty">Nessun immobile trovato.</div>';
            return;
        }

        els.grid.innerHTML = properties.map(p => {
            const chips = [];
            if (p.sqm != null)      chips.push(`<span class="prop-chip">📐 ${p.sqm} mq</span>`);
            if (p.rooms != null)     chips.push(`<span class="prop-chip">🛏 ${p.rooms} stanze</span>`);
            if (p.bathrooms != null) chips.push(`<span class="prop-chip">🚿 ${p.bathrooms} bagni</span>`);
            const roi = (p.price && p.price > 0 && p.monthly_rent)
                ? ((parseFloat(p.monthly_rent) * 12 / parseFloat(p.price)) * 100).toFixed(1)
                : null;
            if (roi) chips.push(`<span class="prop-chip prop-chip--roi" title="ROI lordo annuo">📈 ${roi}% ROI</span>`);
            const mediaLabel = (p.media_count || 0) === 1 ? '1 foto' : `${p.media_count || 0} foto`;
            const inCompare = compareIds.has(p.id);

            return `
            <div class="entity-card entity-card--property" data-id="${p.id}">
                <div class="entity-card__prop-header">
                    <label class="entity-card__select"><input type="checkbox" class="prop-bulk-cb" data-id="${p.id}" ${selectedIds.has(p.id) ? 'checked' : ''}></label>
                    <div class="entity-card__address">
                        <div class="entity-card__street">${escapeHtml(p.address)}</div>
                        <div class="entity-card__city text-muted">${escapeHtml(p.city)}${p.cap ? ' · ' + escapeHtml(p.cap) : ''}</div>
                    </div>
                    <span class="badge badge--${p.status}">${STATUS_LABELS[p.status] || p.status}</span>
                </div>
                <div class="entity-card__body">
                    <div class="entity-card__info"><span class="entity-card__info-icon">👤</span>${escapeHtml(p.client_surname)} ${escapeHtml(p.client_name)}</div>
                    ${chips.length ? `<div class="prop-chips">${chips.join('')}</div>` : ''}
                </div>
                <div class="entity-card__footer">
                    <div class="entity-card__stat">
                        <span class="entity-card__stat-icon">📷</span>
                        <span class="entity-card__stat-label">${mediaLabel}</span>
                    </div>
                    <div class="entity-card__actions">
                        <button class="btn btn--sm btn--ghost btn-qr" data-id="${p.id}" data-address="${escapeHtml(p.address)}" title="Link pubblico & QR">🔗</button>
                        <button class="btn btn--sm ${inCompare ? 'btn--primary' : 'btn--ghost'} btn-compare-add" data-id="${p.id}" title="Aggiungi al confronto">📊</button>
                        <button class="btn btn--sm btn--ghost btn-pdf" data-id="${p.id}" title="Scheda PDF">📄</button>
                        <button class="btn btn--sm btn--ghost btn-appraisal" data-id="${p.id}" title="Valutazione">📋</button>
                        <button class="btn btn--sm btn--ghost btn-edit" data-id="${p.id}" title="Modifica">✏️</button>
                        <button class="btn btn--sm btn--ghost btn-delete" data-id="${p.id}" title="Archivia">🗑️</button>
                    </div>
                </div>
            </div>`;
        }).join('');

        els.grid.querySelectorAll('.prop-bulk-cb').forEach(cb => {
            cb.addEventListener('change', () => {
                const id = parseInt(cb.dataset.id, 10);
                if (cb.checked) selectedIds.add(id);
                else selectedIds.delete(id);
                updateBulkToolbar();
            });
        });

        els.grid.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', () => {
                const prop = properties.find(p => p.id == btn.dataset.id);
                if (prop) openModal(prop);
            });
        });

        els.grid.querySelectorAll('.btn-pdf').forEach(btn => {
            btn.addEventListener('click', async () => {
                const res = await fetch('api/generate_pdf.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'report', property_id: parseInt(btn.dataset.id, 10) }),
                });
                const json = await res.json();
                if (json.success) window.open(json.data.download, '_blank');
                else alert(json.error || 'Errore PDF');
            });
        });

        els.grid.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', () => {
                const prop = properties.find(p => p.id == btn.dataset.id);
                if (prop) openDeleteModal(prop.id, `${prop.address}, ${prop.city}`);
            });
        });

        els.grid.querySelectorAll('.btn-appraisal').forEach(btn => {
            btn.addEventListener('click', () => openAppraisalModal(btn.dataset.id));
        });

        els.grid.querySelectorAll('.btn-qr').forEach(btn => {
            btn.addEventListener('click', () => openQrModal(parseInt(btn.dataset.id, 10), btn.dataset.address));
        });

        els.grid.querySelectorAll('.btn-compare-add').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.dataset.id, 10);
                if (compareIds.has(id)) {
                    compareIds.delete(id);
                    btn.classList.replace('btn--primary', 'btn--ghost');
                } else if (compareIds.size < 4) {
                    compareIds.add(id);
                    btn.classList.replace('btn--ghost', 'btn--primary');
                } else {
                    showAlert('Puoi confrontare al massimo 4 immobili.', 'error');
                    return;
                }
                updateCompareButton();
            });
        });

        updateBulkToolbar();
    }

    function updateCompareButton() {
        const btn = document.getElementById('btn-compare-properties');
        btn.hidden = compareIds.size < 2;
        document.getElementById('compare-count').textContent = compareIds.size;
    }

    function openQrModal(propertyId, address) {
        const base = window.location.origin + window.location.pathname.replace(/index\.php.*/, '');
        const url  = `${base}apply.php?property_id=${propertyId}`;
        document.getElementById('qr-url').value = url;
        document.getElementById('qr-property-label').textContent = address;
        const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}`;
        document.getElementById('qr-img').src = qrSrc;
        document.getElementById('qr-download').href = qrSrc;
        document.getElementById('property-qr-modal').hidden = false;
    }

    async function openCompareModal() {
        if (compareIds.size < 2) return;
        document.getElementById('property-compare-modal').hidden = false;
        const wrapper = document.getElementById('compare-table-wrapper');
        wrapper.innerHTML = '<p class="text-muted">Caricamento confronto…</p>';
        try {
            const ids = [...compareIds].join(',');
            const res  = await fetch(`${COMPARE_API}?ids=${ids}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const props = json.data;
            const rows = [
                ['Indirizzo',         p => `${p.address}, ${p.city}`],
                ['Tipo',              p => p.property_type || '—'],
                ['Superficie',        p => p.size_sqm ? p.size_sqm + ' mq' : '—'],
                ['Stanze',            p => p.rooms ?? '—'],
                ['Bagni',             p => p.bathrooms ?? '—'],
                ['Piano',             p => p.floor ?? '—'],
                ['Anno costruzione',  p => p.year_built ?? '—'],
                ['Prezzo acquisto',   p => p.purchase_price ? '€ ' + Number(p.purchase_price).toLocaleString('it-IT') : '—'],
                ['Valore attuale',    p => p.current_value ? '€ ' + Number(p.current_value).toLocaleString('it-IT') : '—'],
                ['Canone mensile',    p => p.monthly_rent ? '€ ' + Number(p.monthly_rent).toFixed(2) : '—'],
                ['Reddito 12m',       p => p.total_income_12m ? '€ ' + Number(p.total_income_12m).toLocaleString('it-IT') : '—'],
                ['ROI lordo',         p => (p.purchase_price && p.monthly_rent) ? ((p.monthly_rent*12/p.purchase_price)*100).toFixed(1)+'%' : '—'],
                ['Stato',             p => p.status ?? '—'],
                ['Occupato',          p => p.occupancy_status ? 'Sì' : 'No'],
            ];
            const headerCells = props.map(p => `<th>${escapeHtml(p.address)}</th>`).join('');
            const bodyRows = rows.map(([label, fn]) =>
                `<tr><td><strong>${label}</strong></td>${props.map(p => `<td>${escapeHtml(String(fn(p)))}</td>`).join('')}</tr>`
            ).join('');
            wrapper.innerHTML = `
                <table class="data-table">
                    <thead><tr><th>Caratteristica</th>${headerCells}</tr></thead>
                    <tbody>${bodyRows}</tbody>
                </table>`;
        } catch (err) {
            wrapper.innerHTML = `<p class="alert alert--error">${escapeHtml(err.message)}</p>`;
        }
    }

    function updateBulkToolbar() {
        const count = selectedIds.size;
        els.bulkCount.textContent = `${count} selezionat${count === 1 ? 'o' : 'i'}`;
        els.bulkToolbar.hidden = count === 0;
        const pageIds = properties.map(p => p.id);
        els.selectAll.checked = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
        els.selectAll.indeterminate = pageIds.some(id => selectedIds.has(id)) && !els.selectAll.checked;
    }

    function toggleSelectAll() {
        properties.forEach(p => {
            if (els.selectAll.checked) selectedIds.add(p.id);
            else selectedIds.delete(p.id);
        });
        renderCards();
    }

    async function bulkAction(operation) {
        const ids = [...selectedIds];
        if (!ids.length) return;
        if (operation === 'archive' && !confirm(`Archiviare ${ids.length} immobil${ids.length === 1 ? 'e' : 'i'}?`)) return;

        const body = { action: 'bulk', operation, ids };
        if (operation === 'assign') {
            const clientId = els.bulkAssignClient.value;
            if (!clientId) { showAlert('Seleziona un proprietario.', 'error'); return; }
            body.client_id = parseInt(clientId, 10);
        }

        try {
            const res = await fetch(`${API}?action=bulk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            selectedIds.clear();
            showAlert(`Operazione completata (${json.data.updated} aggiornati).`, 'success');
            loadProperties();
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    function bulkExport() {
        const ids = [...selectedIds];
        if (!ids.length) return;
        const rows = properties.filter(p => ids.includes(p.id));
        const header = ['indirizzo', 'citta', 'cap', 'mq', 'stanze', 'bagni', 'prezzo', 'tipo_prezzo', 'stato', 'proprietario'];
        const lines = [header.join(',')];
        rows.forEach(p => {
            lines.push([
                csvCell(p.address), csvCell(p.city), csvCell(p.cap || ''),
                p.sqm ?? '', p.rooms ?? '', p.bathrooms ?? '',
                p.price ?? '', csvCell(p.price_type || ''), csvCell(p.status),
                csvCell(`${p.client_surname} ${p.client_name}`),
            ].join(','));
        });
        const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `immobili_selezionati_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    function csvCell(val) {
        const s = String(val ?? '');
        return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    }

    async function generateMandato() {
        const propertyId = parseInt(document.getElementById('property-id').value, 10);
        const clientId = parseInt(document.getElementById('property-client').value, 10);
        if (!propertyId || !clientId) {
            alert('Salva prima l\'immobile con un proprietario associato.');
            return;
        }
        const res = await fetch('api/generate_pdf.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'mandato', property_id: propertyId, client_id: clientId }),
        });
        const json = await res.json();
        if (json.success) window.open(json.data.download, '_blank');
        else alert(json.error || 'Errore generazione mandato');
    }

    function renderGallery() {
        if (currentMedia.length === 0) {
            els.galleryGrid.innerHTML = '<p class="text-muted gallery-empty">Nessun file caricato.</p>';
            return;
        }

        els.galleryGrid.innerHTML = currentMedia.map(m => {
            const isImage = m.mime_type && m.mime_type.startsWith('image/');
            const isVideo = m.mime_type && m.mime_type.startsWith('video/');
            const isPdf   = m.mime_type === 'application/pdf';

            let preview;
            if (isImage) {
                preview = `<img src="${escapeHtml(m.url)}" alt="${escapeHtml(m.original_name)}" class="gallery-item__img">`;
            } else if (isVideo) {
                preview = `<video src="${escapeHtml(m.url)}" class="gallery-item__video" controls></video>`;
            } else if (isPdf) {
                preview = `<div class="gallery-item__doc">📄 PDF</div>`;
            } else {
                preview = `<div class="gallery-item__doc">📎 File</div>`;
            }

            return `
                <div class="gallery-item" data-id="${m.id}">
                    ${preview}
                    <div class="gallery-item__meta">
                        <span class="gallery-item__type">${MEDIA_LABELS[m.media_type] || m.media_type}</span>
                        <span class="gallery-item__name" title="${escapeHtml(m.original_name)}">${escapeHtml(truncate(m.original_name, 20))}</span>
                    </div>
                    <button type="button" class="gallery-item__delete btn-delete-media" data-id="${m.id}" title="Elimina">&times;</button>
                </div>`;
        }).join('');

        els.galleryGrid.querySelectorAll('.btn-delete-media').forEach(btn => {
            btn.addEventListener('click', () => deleteMedia(btn.dataset.id));
        });
    }

    // -------------------------------------------------------------------------
    // Modal
    // -------------------------------------------------------------------------

    async function openModal(property = null) {
        els.form.reset();
        document.getElementById('property-id').value = '';
        editingId = null;
        currentMedia = [];
        document.getElementById('property-geo-confidence').style.display = 'none';
        document.getElementById('property-geo-confidence-value').value = '';
        document.getElementById('property-price-history-section').hidden = true;
        document.getElementById('property-price-history').innerHTML = 'Nessuna variazione registrata.';
        document.getElementById('btn-property-mandato').hidden = true;

        if (property) {
            try {
                const res = await fetch(`${API}?id=${property.id}`);
                const json = await res.json();
                if (json.success) property = json.data;
            } catch (_) { /* use list data */ }

            editingId = property.id;
            els.modalTitle.textContent = 'Modifica Immobile';
            document.getElementById('property-id').value          = property.id;
            document.getElementById('property-client').value      = property.client_id;
            document.getElementById('property-status').value    = property.status;
            document.getElementById('property-address').value   = property.address;
            document.getElementById('property-city').value      = property.city;
            document.getElementById('property-cap').value       = property.cap || '';
            document.getElementById('property-province').value  = property.province || '';
            document.getElementById('property-floor').value     = property.floor || '';
            document.getElementById('property-sqm').value       = property.sqm ?? '';
            document.getElementById('property-rooms').value     = property.rooms ?? '';
            document.getElementById('property-bathrooms').value = property.bathrooms ?? '';
            document.getElementById('property-description').value = property.description || '';
            document.getElementById('property-features').value  = property.additional_features || '';
            document.getElementById('property-notes').value     = property.internal_notes || '';
            document.getElementById('property-price').value     = property.price ?? '';
            document.getElementById('property-price-type').value = property.price_type || 'affitto';
            document.getElementById('property-latitude').value  = property.latitude ?? '';
            document.getElementById('property-longitude').value = property.longitude ?? '';
            showGeoConfidence(property.geo_confidence);
            document.getElementById('property-geo-confidence-value').value = property.geo_confidence || '';

            renderPriceHistory(property.price_history || []);
            document.getElementById('btn-property-mandato').hidden = false;

            els.gallerySection.hidden = false;
            els.galleryHint.hidden    = true;
            loadMedia(property.id);
        } else {
            els.modalTitle.textContent = 'Nuovo Immobile';
            document.getElementById('property-status').value = 'available';
            els.gallerySection.hidden = true;
            els.galleryHint.hidden    = false;
            els.galleryGrid.innerHTML = '';
        }

        els.modal.hidden = false;
        document.getElementById('property-address').focus();
    }

    function renderPriceHistory(history) {
        const section = document.getElementById('property-price-history-section');
        const container = document.getElementById('property-price-history');
        if (!history.length) {
            section.hidden = true;
            return;
        }
        section.hidden = false;
        const typeLabels = { affitto: 'Affitto', vendita: 'Vendita' };
        container.innerHTML = history.map(h => {
            const oldP = h.old_price != null ? `€ ${Number(h.old_price).toLocaleString('it-IT')}` : '—';
            const newP = h.new_price != null ? `€ ${Number(h.new_price).toLocaleString('it-IT')}` : '—';
            const oldT = h.old_price_type ? typeLabels[h.old_price_type] || h.old_price_type : '';
            const newT = h.new_price_type ? typeLabels[h.new_price_type] || h.new_price_type : '';
            const date = new Date(h.changed_at).toLocaleString('it-IT', {
                day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
            });
            return `<div class="price-history-item">${date}: ${oldP}${oldT ? ' (' + escapeHtml(oldT) + ')' : ''} → <strong>${newP}</strong>${newT ? ' (' + escapeHtml(newT) + ')' : ''}${h.changed_by_name ? ' · ' + escapeHtml(h.changed_by_name) : ''}</div>`;
        }).join('');
    }

    function closeModal() {
        els.modal.hidden = true;
        editingId = null;
    }

    function openDeleteModal(id, label) {
        deleteTargetId = id;
        document.getElementById('delete-property-label').textContent = label;
        els.deleteModal.hidden = false;
    }

    function closeDeleteModal() {
        deleteTargetId = null;
        els.deleteModal.hidden = true;
    }

    // -------------------------------------------------------------------------
    // CRUD actions
    // -------------------------------------------------------------------------

    async function geocodeFromForm() {
        const btn = document.getElementById('btn-property-geocode');
        const property = {
            address: document.getElementById('property-address').value.trim(),
            city: document.getElementById('property-city').value.trim(),
            cap: document.getElementById('property-cap').value.trim(),
            province: document.getElementById('property-province').value.trim(),
        };

        btn.disabled = true;
        btn.textContent = '…';

        try {
            if (typeof Geocode === 'undefined') throw new Error('Modulo geocodifica non caricato.');
            const hit = await Geocode.resolve(property);
            if (!hit) {
                showAlert('Indirizzo ambiguo o non trovato. Controlla Via/CAP/Città o inserisci Lat/Lng da Google Maps.', 'error');
                return;
            }
            document.getElementById('property-latitude').value = hit.lat;
            document.getElementById('property-longitude').value = hit.lng;
            if (hit.suggested_province && !property.province) {
                document.getElementById('property-province').value = hit.suggested_province.replace(/^Provincia di\s+/i, '').slice(0, 10);
            }
            showGeoConfidence(hit.confidence, hit.source);
            const conf = Geocode.CONFIDENCE_LABELS[hit.confidence] || '';
            showAlert(`${conf} (${hit.source}): ${hit.label}`, hit.confidence === 'exact' ? 'success' : 'info');
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '📍 Trova';
        }
    }

    function showGeoConfidence(confidence, source = '') {
        const el = document.getElementById('property-geo-confidence');
        if (!el) return;
        if (!confidence) {
            el.style.display = 'none';
            document.getElementById('property-geo-confidence-value').value = '';
            return;
        }
        const label = (typeof Geocode !== 'undefined' && Geocode.CONFIDENCE_LABELS[confidence]) || confidence;
        el.textContent = source ? `${label} · fonte: ${source}` : label;
        el.style.display = 'block';
        document.getElementById('property-geo-confidence-value').value = confidence;
    }

    async function handleFormSubmit(e) {
        e.preventDefault();

        const id   = document.getElementById('property-id').value;
        const data = collectFormData();
        const saveBtn = document.getElementById('property-modal-save');

        saveBtn.disabled = true;
        saveBtn.textContent = 'Salvataggio...';

        try {
            await saveProperty(data, id || null);

            closeModal();
            showAlert(
                id ? 'Immobile salvato con successo.' : 'Immobile creato. Modificalo per caricare foto e documenti.',
                'success'
            );

            loadProperties();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Salva';
        }
    }

    function collectFormData() {
        return {
            client_id:           document.getElementById('property-client').value,
            address:             document.getElementById('property-address').value.trim(),
            city:                document.getElementById('property-city').value.trim(),
            cap:                 document.getElementById('property-cap').value.trim(),
            province:            document.getElementById('property-province').value.trim(),
            floor:               document.getElementById('property-floor').value.trim(),
            sqm:                 document.getElementById('property-sqm').value,
            rooms:               document.getElementById('property-rooms').value,
            bathrooms:           document.getElementById('property-bathrooms').value,
            description:         document.getElementById('property-description').value.trim(),
            additional_features: document.getElementById('property-features').value.trim(),
            internal_notes:      document.getElementById('property-notes').value.trim(),
            status:              document.getElementById('property-status').value,
            price:               document.getElementById('property-price').value,
            price_type:          document.getElementById('property-price-type').value,
            latitude:            document.getElementById('property-latitude').value,
            longitude:           document.getElementById('property-longitude').value,
            geo_confidence:      document.getElementById('property-geo-confidence-value').value || null,
        };
    }

    async function saveProperty(data, id) {
        const url    = id ? `${API}?id=${id}` : API;
        const method = id ? 'PUT' : 'POST';

        const res  = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        return json.data;
    }

    async function confirmDelete() {
        if (!deleteTargetId) return;

        const btn = document.getElementById('property-delete-confirm');
        btn.disabled = true;

        try {
            const res  = await fetch(`${API}?id=${deleteTargetId}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            closeDeleteModal();
            showAlert('Immobile archiviato.', 'success');
            loadProperties();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    // -------------------------------------------------------------------------
    // Gallery
    // -------------------------------------------------------------------------

    async function uploadMedia() {
        if (!editingId) {
            showAlert('Salva prima l\'immobile.', 'error');
            return;
        }

        const fileInput = document.getElementById('media-file');
        const mediaType = document.getElementById('media-type').value;

        if (!fileInput.files.length) {
            showAlert('Seleziona un file da caricare.', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('property_id', editingId);
        formData.append('media_type', mediaType);
        formData.append('file', fileInput.files[0]);

        const btn = document.getElementById('btn-upload-media');
        btn.disabled = true;
        btn.textContent = 'Caricamento...';

        try {
            const res  = await fetch(MEDIA_API, { method: 'POST', body: formData });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            fileInput.value = '';
            await loadMedia(editingId);
            loadProperties();
            showAlert('File caricato con successo.', 'success');
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Carica file';
        }
    }

    async function deleteMedia(mediaId) {
        if (!confirm('Eliminare questo file?')) return;

        try {
            const res  = await fetch(`${MEDIA_API}?id=${mediaId}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            await loadMedia(editingId);
            loadProperties();
            showAlert('File eliminato.', 'success');
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    // -------------------------------------------------------------------------
    // Utilities
    // -------------------------------------------------------------------------

    function showAlert(message, type) {
        els.alert.textContent = message;
        els.alert.className   = `alert alert--${type}`;
        els.alert.style.display = 'block';

        clearTimeout(els.alert._timer);
        els.alert._timer = setTimeout(() => {
            els.alert.style.display = 'none';
        }, 4000);
    }

    function truncate(str, len) {
        return str.length > len ? str.slice(0, len) + '…' : str;
    }

    function escapeHtml(str) {
        if (str == null) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    // -------------------------------------------------------------------------
    // Appraisals
    // -------------------------------------------------------------------------

    function openAppraisalModal(propertyId) {
        document.getElementById('appraisal-form').reset();
        document.getElementById('appraisal-property-id').value = propertyId;
        document.getElementById('appraisal-date').value = new Date().toISOString().slice(0, 10);
        document.getElementById('appraisal-modal').hidden = false;
        loadAppraisals(propertyId);
    }

    function closeAppraisalModal() {
        document.getElementById('appraisal-modal').hidden = true;
    }

    async function loadAppraisals(propertyId) {
        const container = document.getElementById('appraisal-history');
        container.innerHTML = 'Caricamento…';
        try {
            const res = await fetch(`${APPRAISAL_API}?property_id=${propertyId}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            if (!json.data.length) {
                container.innerHTML = '<p class="text-muted">Nessuna valutazione registrata.</p>';
                return;
            }
            container.innerHTML = json.data.map(a => `
                <div class="appraisal-item">
                    <div><strong>€ ${Number(a.estimated_value).toLocaleString('it-IT')}</strong>
                        ${a.estimated_rent ? ` · canone € ${Number(a.estimated_rent).toLocaleString('it-IT')}` : ''}
                        <span class="badge">${escapeHtml(RATING_LABELS[a.condition_rating] || a.condition_rating)}</span></div>
                    <div class="text-muted">${new Date(a.appraisal_date).toLocaleDateString('it-IT')}${a.appraiser_name ? ' · ' + escapeHtml(a.appraiser_name) : ''}</div>
                    ${a.notes ? `<div class="text-muted">${escapeHtml(a.notes)}</div>` : ''}
                    <button class="btn btn--sm btn--ghost btn-del-appraisal" data-id="${a.id}" data-prop="${propertyId}">Elimina</button>
                </div>`).join('');
            container.querySelectorAll('.btn-del-appraisal').forEach(b => {
                b.addEventListener('click', () => deleteAppraisal(b.dataset.id, b.dataset.prop));
            });
        } catch (err) {
            container.innerHTML = `<div class="entity-error">${escapeHtml(err.message)}</div>`;
        }
    }

    async function saveAppraisal(e) {
        e.preventDefault();
        const propertyId = document.getElementById('appraisal-property-id').value;
        const data = {
            property_id: propertyId,
            estimated_value: document.getElementById('appraisal-value').value,
            estimated_rent: document.getElementById('appraisal-rent').value,
            condition_rating: document.getElementById('appraisal-condition').value,
            appraisal_date: document.getElementById('appraisal-date').value,
            comparable_1_address: document.getElementById('appraisal-c1-addr').value.trim(),
            comparable_1_price: document.getElementById('appraisal-c1-price').value,
            comparable_2_address: document.getElementById('appraisal-c2-addr').value.trim(),
            comparable_2_price: document.getElementById('appraisal-c2-price').value,
            notes: document.getElementById('appraisal-notes').value.trim(),
        };
        const btn = document.getElementById('appraisal-modal-save');
        btn.disabled = true; btn.textContent = 'Salvataggio...';
        try {
            const res = await fetch(APPRAISAL_API, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            document.getElementById('appraisal-form').reset();
            document.getElementById('appraisal-property-id').value = propertyId;
            document.getElementById('appraisal-date').value = new Date().toISOString().slice(0, 10);
            showAlert('Valutazione salvata.', 'success');
            loadAppraisals(propertyId);
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Salva valutazione';
        }
    }

    async function deleteAppraisal(id, propertyId) {
        if (!confirm('Eliminare questa valutazione?')) return;
        try {
            const res = await fetch(`${APPRAISAL_API}?id=${id}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            loadAppraisals(propertyId);
        } catch (err) { showAlert(err.message, 'error'); }
    }

    // -------------------------------------------------------------------------
    // CSV import
    // -------------------------------------------------------------------------

    function handleImportFile(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            importRows = parseCsv(ev.target.result);
            e.target.value = '';
            openImportModal();
        };
        reader.readAsText(file);
    }

    function openImportModal() {
        const select = document.getElementById('import-client');
        select.innerHTML = '<option value="">— Seleziona —</option>' +
            clients.map(c => `<option value="${c.id}">${escapeHtml(c.surname)} ${escapeHtml(c.name)}</option>`).join('');
        document.getElementById('import-count').textContent = importRows.length;
        document.getElementById('import-progress').textContent = '';
        renderImportPreview();
        document.getElementById('import-modal').hidden = false;
    }

    function closeImportModal() {
        document.getElementById('import-modal').hidden = true;
        importRows = [];
    }

    function renderImportPreview() {
        const container = document.getElementById('import-preview');
        if (!importRows.length) {
            container.innerHTML = '<p class="text-muted">Nessuna riga valida nel file.</p>';
            return;
        }
        const cols = Object.keys(importRows[0]);
        const head = cols.map(c => `<th>${escapeHtml(c)}</th>`).join('');
        const rows = importRows.slice(0, 5).map(r =>
            `<tr>${cols.map(c => `<td>${escapeHtml(r[c] || '')}</td>`).join('')}</tr>`).join('');
        container.innerHTML = `<table class="data-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    }

    async function confirmImport() {
        const clientId = document.getElementById('import-client').value;
        if (!clientId) { showAlert('Seleziona un proprietario.', 'error'); return; }
        if (!importRows.length) { showAlert('Nessuna riga da importare.', 'error'); return; }

        const btn = document.getElementById('import-confirm');
        const progress = document.getElementById('import-progress');
        btn.disabled = true;
        progress.textContent = 'Importazione in corso…';
        try {
            const res = await fetch(`${API}?action=import`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ client_id: clientId, rows: importRows }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            progress.textContent = `Importati ${json.data.imported} immobili.` +
                (json.data.errors.length ? ` ${json.data.errors.length} errori.` : '');
            showAlert(`Importati ${json.data.imported} immobili.`, 'success');
            loadProperties();
            setTimeout(closeImportModal, 1500);
        } catch (err) {
            progress.textContent = '';
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    function parseCsv(text) {
        const rows = [];
        const lines = splitCsvLines(text);
        if (!lines.length) return rows;
        const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '') continue;
            const values = parseCsvLine(lines[i]);
            const obj = {};
            headers.forEach((h, idx) => { obj[h] = (values[idx] || '').trim(); });
            rows.push(obj);
        }
        return rows;
    }

    function splitCsvLines(text) {
        text = text.replace(/^﻿/, '');
        const lines = [];
        let cur = '', inQuotes = false;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (ch === '"') inQuotes = !inQuotes;
            if ((ch === '\n' || ch === '\r') && !inQuotes) {
                if (ch === '\r' && text[i + 1] === '\n') i++;
                lines.push(cur); cur = '';
            } else { cur += ch; }
        }
        if (cur !== '') lines.push(cur);
        return lines;
    }

    function parseCsvLine(line) {
        const out = [];
        let cur = '', inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
                else inQuotes = !inQuotes;
            } else if (ch === ',' && !inQuotes) {
                out.push(cur); cur = '';
            } else { cur += ch; }
        }
        out.push(cur);
        return out;
    }

    init();
})();
