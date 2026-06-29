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
        house_map:  'Cartina casa',
        attachment: 'Allegato',
    };

    const MEDIA_ACCEPT = {
        photo:      'image/jpeg,image/png,image/webp,image/gif',
        video:      'video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov',
        floor_plan: 'image/jpeg,image/png,image/webp',
        house_map:  'image/jpeg,image/png,image/webp',
    };

    const COVER_MEDIA_TYPES = new Set(['photo', 'floor_plan', 'house_map']);

    let properties     = [];
    let clients        = [];
    let currentMedia   = [];
    let editingId      = null;
    let deleteTargetId = null;
    let searchTimer    = null;
    let currentPage    = 1;
    const PAGE_LIMIT   = 16;
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

        if (!els.grid || !els.form) return;

        ensureCompareBar();
        ensureLightbox();
        bindEvents();
        loadClients().then(() => {
            loadProperties();
        });
    }

    function bindClick(id, handler) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', handler);
    }

    function bindChange(id, handler) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', handler);
    }

    function ensureCompareBar() {
        if (!document.getElementById('compare-float-bar')) {
            const bar = document.createElement('div');
            bar.id = 'compare-float-bar';
            bar.className = 'compare-float-bar';
            bar.hidden = true;
            bar.innerHTML = `
                <div class="compare-float-bar__chips" id="compare-float-chips"></div>
                <div class="compare-float-bar__actions">
                    <button type="button" class="btn btn--sm compare-float-clear" id="compare-float-clear">✕ Cancella selezione</button>
                    <button type="button" class="btn btn--sm compare-float-go" id="compare-float-go">📊 Confronta (<span id="compare-float-count">0</span>)</button>
                </div>`;
            document.body.appendChild(bar);
        }

        // Always rebind to the current closure — the SPA re-runs this script on
        // every navigation, so the old bar would otherwise keep stale handlers.
        const goBtn = document.getElementById('compare-float-go');
        const clearBtn = document.getElementById('compare-float-clear');
        const freshGo = goBtn.cloneNode(true);
        const freshClear = clearBtn.cloneNode(true);
        goBtn.replaceWith(freshGo);
        clearBtn.replaceWith(freshClear);

        freshGo.addEventListener('click', openCompareModal);
        freshClear.addEventListener('click', () => {
            compareIds.clear();
            renderCards();
            updateCompareButton();
        });
    }

    function ensureLightbox() {
        if (document.getElementById('media-lightbox')) return;

        const box = document.createElement('div');
        box.className = 'media-lightbox';
        box.id = 'media-lightbox';
        box.hidden = true;
        box.innerHTML = `
            <button type="button" class="media-lightbox__close" id="media-lightbox-close" aria-label="Chiudi">&times;</button>
            <div class="media-lightbox__content" id="media-lightbox-content"></div>
            <p class="media-lightbox__caption" id="media-lightbox-caption"></p>`;
        document.body.appendChild(box);
    }

    function bindEvents() {
        // "Nuovo Immobile" now opens a dedicated page (not a modal).
        bindClick('btn-new-property', () => { if (window.App) window.App.navigateTo('property_edit'); });

        // Column-count toggle (#12) — remembers the choice across sessions.
        (function setupColumnToggle() {
            const grid = document.getElementById('properties-grid');
            const toggle = document.getElementById('property-cols-toggle');
            if (!grid || !toggle) return;
            let cols = '2';
            try { cols = localStorage.getItem('propertyCols') || '2'; } catch (e) {}
            const apply = (n) => {
                grid.classList.remove('entity-grid--cols-2', 'entity-grid--cols-3', 'entity-grid--cols-4');
                grid.classList.add('entity-grid--cols-' + n);
                toggle.querySelectorAll('.view-cols-btn').forEach(b => b.classList.toggle('active', b.dataset.cols === String(n)));
                try { localStorage.setItem('propertyCols', String(n)); } catch (e) {}
            };
            toggle.querySelectorAll('.view-cols-btn').forEach(b => b.addEventListener('click', () => apply(b.dataset.cols)));
            apply(cols);
        })();
        bindClick('property-modal-close', closeModal);
        bindClick('property-modal-cancel', closeModal);
        bindClick('btn-property-mandato', generateMandato);
        bindClick('property-delete-close', closeDeleteModal);
        bindClick('property-delete-cancel', closeDeleteModal);
        bindClick('property-delete-confirm', confirmDelete);
        bindClick('btn-upload-media', uploadMedia);
        bindChange('media-type', updateMediaFileAccept);
        bindClick('media-lightbox-close', closeLightbox);
        const lightbox = document.getElementById('media-lightbox');
        if (lightbox) {
            lightbox.addEventListener('click', (e) => {
                if (e.target.id === 'media-lightbox') closeLightbox();
            });
        }

        bindClick('btn-property-geocode', geocodeFromForm);

        els.form.addEventListener('submit', handleFormSubmit);

        // Social post modal (#13)
        bindClick('social-modal-close', closeSocialModal);
        bindClick('social-modal-cancel', closeSocialModal);
        const socialModal = document.getElementById('social-modal');
        if (socialModal) socialModal.addEventListener('click', (e) => { if (e.target === socialModal) closeSocialModal(); });
        document.querySelectorAll('input[name="social-when"]').forEach(r => {
            r.addEventListener('change', () => {
                const later = document.querySelector('input[name="social-when"]:checked')?.value === 'later';
                document.getElementById('social-schedule-group').hidden = !later;
                document.getElementById('social-modal-save').textContent = later ? 'Programma' : 'Pubblica ora';
            });
        });
        const socialForm = document.getElementById('social-form');
        if (socialForm) socialForm.addEventListener('submit', submitSocialPost);

        // CSV export / import
        bindClick('btn-export-properties', () => {
            window.open(`${API}?format=csv`, '_blank');
        });
        bindClick('btn-portal-export', () => {
            document.getElementById('portal-export-modal').hidden = false;
        });
        bindClick('portal-export-close', () => {
            document.getElementById('portal-export-modal').hidden = true;
        });
        document.getElementById('portal-export-modal')?.addEventListener('click', e => {
            if (e.target.id === 'portal-export-modal') e.target.hidden = true;
        });
        bindClick('portal-export-json', () => {
            document.getElementById('portal-export-modal').hidden = true;
            window.open(`${EXPORT_API}?format=json`, '_blank');
        });
        bindClick('portal-export-xml', () => {
            document.getElementById('portal-export-modal').hidden = true;
            window.open(`${EXPORT_API}?format=xml`, '_blank');
        });
        bindClick('btn-compare-properties', openCompareModal);
        bindClick('property-qr-close', () => {
            const modal = document.getElementById('property-qr-modal');
            if (modal) modal.hidden = true;
        });
        bindClick('property-compare-close', () => {
            const modal = document.getElementById('property-compare-modal');
            if (modal) modal.hidden = true;
        });
        bindClick('btn-copy-qr-url', () => {
            const url = document.getElementById('qr-url')?.value;
            if (url) navigator.clipboard.writeText(url).then(() => showAlert('Link copiato!', 'success'));
        });
        bindClick('btn-import-properties', () => {
            document.getElementById('import-properties-file')?.click();
        });
        bindChange('import-properties-file', handleImportFile);
        bindClick('import-modal-close', closeImportModal);
        bindClick('import-modal-cancel', closeImportModal);
        bindClick('import-confirm', confirmImport);

        // Appraisal modal
        bindClick('appraisal-modal-close', closeAppraisalModal);
        bindClick('appraisal-modal-cancel', closeAppraisalModal);
        const appraisalForm = document.getElementById('appraisal-form');
        if (appraisalForm) appraisalForm.addEventListener('submit', saveAppraisal);

        bindClick('bulk-archive-properties', () => bulkAction('archive'));
        bindClick('bulk-assign-properties', () => bulkAction('assign'));
        bindClick('bulk-export-properties', bulkExport);
        if (els.selectAll) els.selectAll.addEventListener('change', toggleSelectAll);

        if (els.search) {
            els.search.addEventListener('input', () => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => { currentPage = 1; loadProperties(); }, 300);
            });
        }

        if (els.clientFilter) {
            els.clientFilter.addEventListener('change', () => { currentPage = 1; loadProperties(); });
        }
        if (els.statusFilter) {
            els.statusFilter.addEventListener('change', () => { currentPage = 1; loadProperties(); });
        }

        if (els.modal) {
            els.modal.addEventListener('click', (e) => {
                if (e.target === els.modal) closeModal();
            });
        }
        if (els.deleteModal) {
            els.deleteModal.addEventListener('click', (e) => {
                if (e.target === els.deleteModal) closeDeleteModal();
            });
        }
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
        softLoad(els.grid, '<div class="entity-loading">Caricamento…</div>');

        try {
            const res  = await fetch(url);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const parsed = Pagination.parseResponse(json);
            properties = parsed.items;
            renderCards();
            Pagination.render(els.pagination, parsed, (p) => { currentPage = p; loadProperties(); });
        } catch (err) {
            els.grid.classList.remove('is-loading');
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
        els.grid.classList.remove('is-loading');
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
            const photoCount = parseInt(p.photo_count, 10) || 0;
            const mediaTotal = parseInt(p.media_count, 10) || 0;
            const mediaLabel = photoCount === 1
                ? '1 foto'
                : `${photoCount} foto`;
            const filesLabel = mediaTotal > photoCount
                ? ` · ${mediaTotal} file totali`
                : '';
            const inCompare = compareIds.has(p.id);
            const coverHtml = p.cover_url
                ? `<img src="${escapeHtml(mediaUrl(p.cover_url))}" alt="Anteprima ${escapeHtml(p.address)}" class="entity-card__cover-img" loading="lazy" onerror="this.onerror=null;this.outerHTML='<div class=&quot;entity-card__cover-placeholder&quot; aria-hidden=&quot;true&quot;><span class=&quot;entity-card__cover-icon&quot;>&#x1F3E0;</span><span>Nessuna foto</span></div>'">`
                : `<div class="entity-card__cover-placeholder" aria-hidden="true"><span class="entity-card__cover-icon">🏠</span><span>Nessuna foto</span></div>`;

            return `
            <div class="entity-card entity-card--property entity-card--clickable" data-id="${p.id}" tabindex="0" role="button" aria-label="Apri scheda ${escapeHtml(p.address)}">
                <div class="entity-card__cover">
                    ${coverHtml}
                    <label class="entity-card__cover-select" title="Seleziona"><input type="checkbox" class="prop-bulk-cb" data-id="${p.id}" ${selectedIds.has(p.id) ? 'checked' : ''}></label>
                    <span class="badge badge--${p.status} entity-card__cover-badge">${STATUS_LABELS[p.status] || p.status}</span>
                </div>
                <div class="entity-card__prop-header">
                    <div class="entity-card__address">
                        <div class="entity-card__street">${escapeHtml(p.address)}</div>
                        <div class="entity-card__city text-muted">${escapeHtml(p.city)}${p.cap ? ' · ' + escapeHtml(p.cap) : ''}</div>
                    </div>
                </div>
                <div class="entity-card__body">
                    <div class="entity-card__info"><span class="entity-card__info-icon">👤</span>${escapeHtml(p.client_surname)} ${escapeHtml(p.client_name)}</div>
                    ${chips.length ? `<div class="prop-chips">${chips.join('')}</div>` : ''}
                </div>
                <div class="entity-card__footer">
                    <div class="entity-card__stat">
                        <span class="entity-card__stat-icon">📷</span>
                        <span class="entity-card__stat-label">${mediaLabel}${filesLabel}</span>
                    </div>
                    <div class="entity-card__actions">
                        <button class="btn btn--sm btn--ghost btn-qr" data-id="${p.id}" data-address="${escapeHtml(p.address)}" title="Link pubblico & QR">🔗</button>
                        <button class="btn btn--sm ${inCompare ? 'btn--primary' : 'btn--ghost'} btn-compare-add" data-id="${p.id}" title="Aggiungi al confronto">📊</button>
                        <button class="btn btn--sm btn--ghost btn-pdf" data-id="${p.id}" title="Scheda PDF">📄</button>
                        ${window.canWrite !== false ? `<button class="btn btn--sm btn--ghost btn-appraisal" data-id="${p.id}" title="Valutazione">📋</button>
                        <button class="btn btn--sm btn--ghost btn-delete" data-id="${p.id}" title="Archivia">🗑️</button>
                        <button class="btn btn--sm btn--ghost btn-social" data-id="${p.id}" title="Crea post social">📣</button>` : ''}
                    </div>
                </div>
            </div>`;
        }).join('');

        els.grid.querySelectorAll('.prop-bulk-cb').forEach(cb => {
            cb.addEventListener('click', (e) => e.stopPropagation());
            cb.addEventListener('change', () => {
                const id = parseInt(cb.dataset.id, 10);
                if (cb.checked) selectedIds.add(id);
                else selectedIds.delete(id);
                updateBulkToolbar();
            });
        });

        els.grid.querySelectorAll('.entity-card--property').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('button, input, label, a')) return;
                if (window.App) window.App.navigateTo('property_profile', { propertyId: parseInt(card.dataset.id, 10) });
            });
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (window.App) window.App.navigateTo('property_profile', { propertyId: parseInt(card.dataset.id, 10) });
                }
            });
        });

        els.grid.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const prop = properties.find(p => p.id == btn.dataset.id);
                if (prop) openModal(prop);
            });
        });

        els.grid.querySelectorAll('.btn-pdf').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
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
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const prop = properties.find(p => p.id == btn.dataset.id);
                if (prop) openDeleteModal(prop.id, `${prop.address}, ${prop.city}`);
            });
        });

        els.grid.querySelectorAll('.btn-appraisal').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openAppraisalModal(btn.dataset.id);
            });
        });

        els.grid.querySelectorAll('.btn-social').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const prop = properties.find(p => p.id == btn.dataset.id);
                if (prop) openSocialModal(prop);
            });
        });

        els.grid.querySelectorAll('.btn-qr').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openQrModal(parseInt(btn.dataset.id, 10), btn.dataset.address);
            });
        });

        els.grid.querySelectorAll('.btn-compare-add').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
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
        ensureCompareBar();
        const count = compareIds.size;
        const show  = count >= 2;

        // toolbar button
        const btn = document.getElementById('btn-compare-properties');
        btn.hidden = !show;
        document.getElementById('compare-count').textContent = count;

        // floating bar
        const bar = document.getElementById('compare-float-bar');
        if (!bar) return;
        bar.hidden = !show;
        const countEl = document.getElementById('compare-float-count');
        if (countEl) countEl.textContent = count;

        // chips: show addresses of currently-visible selected properties
        const chips = document.getElementById('compare-float-chips');
        if (chips) {
            const visible = properties.filter(p => compareIds.has(p.id));
            const hiddenCount = count - visible.length;
            chips.innerHTML = visible.map(p =>
                `<span class="compare-chip">${escapeHtml(p.address)}</span>`
            ).join('') + (hiddenCount > 0
                ? `<span class="compare-chip compare-chip--more">+${hiddenCount} altre pagine</span>`
                : '');
        }
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
        const floatBar = document.getElementById('compare-float-bar');
        if (floatBar) floatBar.hidden = true;
        const wrapper = document.getElementById('compare-table-wrapper');
        wrapper.innerHTML = '<p class="text-muted">Caricamento confronto…</p>';
        try {
            const ids = [...compareIds].join(',');
            const res  = await fetch(`${COMPARE_API}?ids=${ids}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const props = Array.isArray(json.data) ? json.data : (json.data?.properties || []);
            if (!props.length) throw new Error('Nessun immobile da confrontare.');
            const propTypeLabels = { appartamento: 'Appartamento', villa: 'Villa', ufficio: 'Ufficio', negozio: 'Negozio', box: 'Box / Garage', terreno: 'Terreno', altro: 'Altro' };
            const statusLabels   = { available: 'Disponibile', rented: 'Affittato', sold: 'Venduto', archived: 'Archiviato' };
            const priceLabel     = props.every(p => p.price_type === 'vendita') ? 'Prezzo vendita'
                                 : props.every(p => p.price_type === 'affitto') ? 'Canone listino'
                                 : 'Prezzo';
            const rows = [
                ['Indirizzo',        p => `${p.address}, ${p.city}`],
                ['Tipo',             p => propTypeLabels[p.property_type] || p.property_type || '—'],
                ['Superficie',       p => p.size_sqm ? p.size_sqm + ' mq' : '—'],
                ['Stanze',           p => p.rooms ?? '—'],
                ['Bagni',            p => p.bathrooms ?? '—'],
                ['Piano',            p => p.floor ?? '—'],
                ['Anno costruzione', p => p.year_built ?? '—'],
                [priceLabel,         p => p.price ? '€ ' + Number(p.price).toLocaleString('it-IT') : '—'],
                ['Valore stimato',   p => p.current_value ? '€ ' + Number(p.current_value).toLocaleString('it-IT') : '—'],
                ['Canone mensile',   p => p.monthly_rent ? '€ ' + Number(p.monthly_rent).toLocaleString('it-IT') : '—'],
                ['Reddito 12m',      p => p.total_income_12m != null ? '€ ' + Number(p.total_income_12m).toLocaleString('it-IT') : '—'],
                ['ROI lordo',        p => {
                    if (!p.monthly_rent) return '—';
                    const base = (p.price_type === 'vendita' && p.price) ? p.price
                               : (p.current_value || null);
                    return base ? ((p.monthly_rent * 12 / base) * 100).toFixed(1) + '%' : '—';
                }],
                ['Stato',            p => statusLabels[p.status] || p.status || '—'],
                ['Occupato',         p => p.occupancy_status === 'occupied' ? 'Sì' : 'No'],
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
        if (operation === 'archive' && !await confirmDialog(`Vuoi archiviare ${ids.length} immobil${ids.length === 1 ? 'e' : 'i'}?`, { title: 'Archivia immobili', confirmText: 'Archivia' })) return;

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

    function mediaUrl(path) {
        if (!path) return '';
        if (/^https?:\/\//i.test(path) || path.startsWith('/')) return path;
        return '/' + String(path).replace(/^\.\//, '');
    }

    function isVideoMedia(m) {
        return (m.mime_type && m.mime_type.startsWith('video/')) || m.media_type === 'video';
    }

    function isImageMedia(m) {
        return (m.mime_type && m.mime_type.startsWith('image/'))
            || ['photo', 'floor_plan', 'house_map'].includes(m.media_type);
    }

    function renderGallery() {
        if (currentMedia.length === 0) {
            els.galleryGrid.innerHTML = '<p class="text-muted gallery-empty">Nessun file caricato. Usa il form sopra per aggiungere foto, video, planimetrie, cartine o allegati.</p>';
            return;
        }

        const groups = {};
        currentMedia.forEach(m => {
            const key = m.media_type || 'attachment';
            if (!groups[key]) groups[key] = [];
            groups[key].push(m);
        });

        const order = ['photo', 'video', 'floor_plan', 'house_map', 'attachment'];
        els.galleryGrid.innerHTML = order.filter(t => groups[t]?.length).map(type => `
            <div class="gallery-section">
                <h4 class="gallery-section__title">${escapeHtml(MEDIA_LABELS[type] || type)} (${groups[type].length})</h4>
                <div class="gallery-section__grid">
                    ${groups[type].map(m => renderGalleryItem(m)).join('')}
                </div>
            </div>
        `).join('');

        els.galleryGrid.querySelectorAll('.btn-delete-media').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteMedia(btn.dataset.id);
            });
        });

        els.galleryGrid.querySelectorAll('.btn-set-cover').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                setCoverMedia(btn.dataset.id);
            });
        });

        els.galleryGrid.querySelectorAll('.gallery-item__preview').forEach(el => {
            el.addEventListener('click', () => {
                const item = currentMedia.find(m => m.id == el.closest('.gallery-item')?.dataset.id);
                if (item) openLightbox(item);
            });
        });
    }

    function renderGalleryItem(m) {
        const url = mediaUrl(m.url);
        const isImage = isImageMedia(m) && m.mime_type !== 'application/pdf';
        const isVideo = isVideoMedia(m);
        const isPdf   = m.mime_type === 'application/pdf';
        const canCover = COVER_MEDIA_TYPES.has(m.media_type) && isImage && !isVideo;

        let preview;
        if (isVideo) {
            preview = `<video src="${escapeHtml(url)}" class="gallery-item__video" muted playsinline preload="metadata"></video><span class="gallery-item__play">▶</span>`;
        } else if (isImage) {
            preview = `<img src="${escapeHtml(url)}" alt="${escapeHtml(m.original_name)}" class="gallery-item__img">`;
        } else if (isPdf) {
            preview = `<div class="gallery-item__doc">📄 PDF</div>`;
        } else {
            preview = `<div class="gallery-item__doc">📎 File</div>`;
        }

        return `
            <div class="gallery-item${m.is_cover ? ' gallery-item--cover' : ''}" data-id="${m.id}">
                <div class="gallery-item__preview" role="button" tabindex="0" title="Visualizza">
                    ${preview}
                    ${m.is_cover ? '<span class="gallery-item__cover-badge">Anteprima</span>' : ''}
                </div>
                <div class="gallery-item__meta">
                    <span class="gallery-item__type">${MEDIA_LABELS[m.media_type] || m.media_type}</span>
                    <span class="gallery-item__name" title="${escapeHtml(m.original_name)}">${escapeHtml(truncate(m.original_name, 22))}</span>
                </div>
                <div class="gallery-item__actions">
                    ${canCover && !m.is_cover ? `<button type="button" class="btn btn--xs btn--ghost btn-set-cover" data-id="${m.id}" title="Usa come anteprima card">⭐ Anteprima</button>` : ''}
                    ${isVideo || isPdf || (!isImage && !isVideo) ? `<a href="${escapeHtml(url)}" class="btn btn--xs btn--ghost" target="_blank" rel="noopener"${isVideo || isPdf ? ' download' : ''}>${isVideo ? 'Apri' : 'Scarica'}</a>` : ''}
                    <button type="button" class="gallery-item__delete btn-delete-media" data-id="${m.id}" title="Elimina">&times;</button>
                </div>
            </div>`;
    }

    function updateMediaFileAccept() {
        const type = document.getElementById('media-type').value;
        document.getElementById('media-file').accept = MEDIA_ACCEPT[type] || '';
    }

    function openLightbox(item) {
        ensureLightbox();
        const box = document.getElementById('media-lightbox');
        const content = document.getElementById('media-lightbox-content');
        const caption = document.getElementById('media-lightbox-caption');
        const url = mediaUrl(item.url);
        const isImage = isImageMedia(item) && item.mime_type !== 'application/pdf';
        const isVideo = isVideoMedia(item);

        if (isVideo) {
            const type = item.mime_type || 'video/mp4';
            content.innerHTML = `<video src="${escapeHtml(url)}" controls autoplay playsinline preload="metadata"><source src="${escapeHtml(url)}" type="${escapeHtml(type)}"></video>`;
        } else if (isImage) {
            content.innerHTML = `<img src="${escapeHtml(url)}" alt="${escapeHtml(item.original_name)}">`;
        } else if (item.mime_type === 'application/pdf') {
            content.innerHTML = `<iframe src="${escapeHtml(url)}" title="${escapeHtml(item.original_name)}"></iframe>`;
        } else {
            content.innerHTML = `<p class="text-muted">Anteprima non disponibile. <a href="${escapeHtml(url)}" target="_blank" rel="noopener">Apri il file</a></p>`;
        }

        caption.textContent = `${MEDIA_LABELS[item.media_type] || item.media_type} — ${item.original_name}`;
        box.hidden = false;
        document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
        const box = document.getElementById('media-lightbox');
        if (!box) return;
        box.hidden = true;
        const content = document.getElementById('media-lightbox-content');
        if (content) content.innerHTML = '';
        document.body.style.overflow = '';
    }

    async function setCoverMedia(mediaId) {
        if (!editingId) return;

        try {
            const res = await fetch(`${MEDIA_API}?action=set_cover`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ property_id: editingId, media_id: parseInt(mediaId, 10) }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            await loadMedia(editingId);
            loadProperties();
            showAlert('Anteprima card aggiornata.', 'success');
        } catch (err) {
            showAlert(err.message, 'error');
        }
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
            document.getElementById('property-floor').value      = property.floor || '';
            document.getElementById('property-type').value       = property.property_type || 'appartamento';
            document.getElementById('property-year-built').value = property.year_built ?? '';
            document.getElementById('property-sqm').value        = property.sqm ?? '';
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
            updateMediaFileAccept();
            loadMedia(property.id);
        } else {
            els.modalTitle.textContent = 'Nuovo Immobile';
            document.getElementById('property-status').value = 'available';
            els.gallerySection.hidden = true;
            els.galleryHint.hidden    = false;
            els.galleryGrid.innerHTML = '';
            updateMediaFileAccept();
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
        closeLightbox();
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
        const valueEl = document.getElementById('property-geo-confidence-value');
        if (valueEl) valueEl.value = confidence || '';

        // The confidence note is intentionally not shown in the form.
        const el = document.getElementById('property-geo-confidence');
        if (el) {
            el.textContent = '';
            el.style.display = 'none';
        }
    }

    // ── Social post modal (#13) ───────────────────────────────────────────────
    function buildSocialCaption(p) {
        const TYPE = { appartamento:'Appartamento', villa:'Villa', ufficio:'Ufficio', negozio:'Negozio', box:'Box/Garage', terreno:'Terreno', altro:'Immobile' };
        const lines = [];
        const head = `${TYPE[p.property_type] || 'Immobile'} in ${p.price_type === 'vendita' ? 'vendita' : 'affitto'}`;
        lines.push(`✨ ${head}${p.city ? ' — ' + p.city : ''}`);
        lines.push('');
        if (p.address) lines.push(`📍 ${p.address}${p.city ? ', ' + p.city : ''}`);
        const specs = [];
        if (p.sqm) specs.push(`${p.sqm} m²`);
        if (p.locali) specs.push(`${p.locali} locali`);
        if (p.rooms) specs.push(`${p.rooms} camere`);
        if (p.bathrooms) specs.push(`${p.bathrooms} bagni`);
        if (specs.length) lines.push(`🏠 ${specs.join(' · ')}`);
        if (p.price) lines.push(`💶 € ${Number(p.price).toLocaleString('it-IT')}${p.price_type === 'affitto' ? '/mese' : ''}`);
        if (p.description) { lines.push(''); lines.push(p.description); }
        lines.push('');
        lines.push('📞 Contattaci per maggiori informazioni!');
        return lines.join('\n');
    }

    function loadSocialMedia(propertyId) {
        const picker = document.getElementById('social-media-picker');
        fetch(`api/property_media.php?property_id=${propertyId}`)
            .then(r => r.json())
            .then(json => {
                const media = (Array.isArray(json.data) ? json.data : (json.data?.items || []))
                    .filter(m => (m.mime_type || '').startsWith('image/') || ['photo','image'].includes(m.media_type));
                if (!media.length) {
                    picker.innerHTML = '<p class="text-muted" style="font-size:13px;margin:0;">Nessuna foto disponibile. Carica foto nella scheda immobile.</p>';
                    document.getElementById('social-media-id').value = '';
                    return;
                }
                picker.innerHTML = media.map((m, i) =>
                    `<button type="button" class="social-thumb${i === 0 ? ' selected' : ''}" data-media-id="${m.id}"><img src="${escapeHtml(m.file_path)}" alt=""></button>`
                ).join('');
                document.getElementById('social-media-id').value = media[0].id;
                picker.querySelectorAll('.social-thumb').forEach(btn => {
                    btn.addEventListener('click', () => {
                        picker.querySelectorAll('.social-thumb').forEach(b => b.classList.remove('selected'));
                        btn.classList.add('selected');
                        document.getElementById('social-media-id').value = btn.dataset.mediaId;
                    });
                });
            })
            .catch(() => { picker.innerHTML = '<p class="text-muted" style="font-size:13px;margin:0;">Impossibile caricare le foto.</p>'; });
    }

    function openSocialModal(property) {
        document.getElementById('social-property-id').value = property.id;
        document.getElementById('social-media-id').value = '';
        document.getElementById('social-property-label').textContent = `${property.address || ''}${property.city ? ', ' + property.city : ''}`;
        document.getElementById('social-platform').value = 'both';
        document.getElementById('social-caption').value = buildSocialCaption(property);
        const nowRadio = document.querySelector('input[name="social-when"][value="now"]');
        if (nowRadio) nowRadio.checked = true;
        document.getElementById('social-schedule-group').hidden = true;
        document.getElementById('social-modal-save').textContent = 'Pubblica ora';
        const err = document.getElementById('social-modal-error');
        if (err) err.style.display = 'none';
        loadSocialMedia(property.id);
        document.getElementById('social-modal').hidden = false;
    }

    function closeSocialModal() {
        const m = document.getElementById('social-modal');
        if (m) m.hidden = true;
    }

    function pad2(n) { return String(n).padStart(2, '0'); }
    function nowLocalDatetime() {
        const d = new Date();
        return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    }

    async function submitSocialPost(e) {
        e.preventDefault();
        const errEl = document.getElementById('social-modal-error');
        errEl.style.display = 'none';
        const platform   = document.getElementById('social-platform').value;
        const caption    = document.getElementById('social-caption').value.trim();
        const mediaId    = document.getElementById('social-media-id').value;
        const when       = document.querySelector('input[name="social-when"]:checked')?.value || 'now';
        const propertyId = document.getElementById('social-property-id').value;

        if (!caption) { errEl.textContent = 'Inserisci il testo del post.'; errEl.style.display = 'block'; return; }
        if ((platform === 'instagram' || platform === 'both') && !mediaId) {
            errEl.textContent = 'Instagram richiede un\'immagine: seleziona o carica una foto nella scheda immobile.'; errEl.style.display = 'block'; return;
        }
        let scheduledAt;
        if (when === 'later') {
            scheduledAt = document.getElementById('social-scheduled').value;
            if (!scheduledAt) { errEl.textContent = 'Scegli data e ora di pubblicazione.'; errEl.style.display = 'block'; return; }
        } else {
            scheduledAt = nowLocalDatetime();
        }

        const saveBtn = document.getElementById('social-modal-save');
        saveBtn.disabled = true; saveBtn.textContent = 'Invio...';
        try {
            const fd = new FormData();
            fd.append('platform', platform);
            fd.append('property_id', propertyId);
            fd.append('caption', caption);
            fd.append('scheduled_at', scheduledAt);
            fd.append('status', 'scheduled');
            if (mediaId) fd.append('property_media_id', mediaId);

            const res = await fetch('api/social_posts.php', { method: 'POST', body: fd });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Errore creazione post.');

            if (when === 'now' && json.data?.id) {
                const pubRes = await fetch(`api/social_posts.php?id=${json.data.id}&action=publish`, { method: 'PATCH' });
                const pubJson = await pubRes.json();
                if (!pubJson.success) throw new Error(pubJson.error || 'Post creato ma pubblicazione non riuscita.');
            }
            closeSocialModal();
            showAlert(when === 'now' ? 'Post inviato.' : 'Post programmato.', 'success');
        } catch (err) {
            errEl.textContent = err.message; errEl.style.display = 'block';
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = when === 'later' ? 'Programma' : 'Pubblica ora';
        }
    }

    async function handleFormSubmit(e) {
        e.preventDefault();

        const id   = document.getElementById('property-id').value;
        const data = collectFormData();
        const saveBtn = document.getElementById('property-modal-save');

        saveBtn.disabled = true;
        saveBtn.textContent = 'Salvataggio...';

        try {
            const saved = await saveProperty(data, id || null);
            const wasNew = !id;

            closeModal();
            showAlert(wasNew ? 'Immobile creato con successo.' : 'Immobile salvato con successo.', 'success');
            loadProperties();
            if (wasNew && window.App) {
                window.App.navigateTo('property_profile', { propertyId: saved.id });
            }
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
            property_type:       document.getElementById('property-type').value,
            year_built:          document.getElementById('property-year-built').value,
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
        if (!await confirmDialog('Vuoi eliminare questo file dalla galleria?', { title: 'Elimina file' })) return;

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
            const items = Array.isArray(json.data) ? json.data : (json.data?.items || []);
            if (!items.length) {
                container.innerHTML = '<p class="text-muted">Nessuna valutazione registrata.</p>';
                return;
            }
            container.innerHTML = items.map(a => `
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
        if (!await confirmDialog('Vuoi eliminare questa valutazione?', { title: 'Elimina valutazione' })) return;
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
