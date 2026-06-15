/**
 * Properties (Immobili) — CRUD + multimedia gallery (Phase 3)
 */
(function () {
    'use strict';

    const API         = 'api/properties.php';
    const CLIENTS_API = 'api/clients.php';
    const MEDIA_API   = 'api/property_media.php';

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

        bindEvents();
        loadClients().then(() => {
            loadProperties();
        });
    }

    function bindEvents() {
        document.getElementById('btn-new-property').addEventListener('click', () => openModal());
        document.getElementById('property-modal-close').addEventListener('click', closeModal);
        document.getElementById('property-modal-cancel').addEventListener('click', closeModal);
        document.getElementById('property-delete-close').addEventListener('click', closeDeleteModal);
        document.getElementById('property-delete-cancel').addEventListener('click', closeDeleteModal);
        document.getElementById('property-delete-confirm').addEventListener('click', confirmDelete);
        document.getElementById('btn-upload-media').addEventListener('click', uploadMedia);

        els.form.addEventListener('submit', handleFormSubmit);

        els.search.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(loadProperties, 300);
        });

        els.clientFilter.addEventListener('change', loadProperties);
        els.statusFilter.addEventListener('change', loadProperties);

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
            const res  = await fetch(`${CLIENTS_API}?status=active`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            clients = json.data;
            populateClientSelects();
        } catch (err) {
            showAlert('Errore caricamento proprietari: ' + err.message, 'error');
        }
    }

    function populateClientSelects() {
        const options = clients.map(c =>
            `<option value="${c.id}">${escapeHtml(c.surname)} ${escapeHtml(c.name)}</option>`
        ).join('');

        els.clientSelect.innerHTML = '<option value="">— Seleziona proprietario —</option>' + options;
        els.clientFilter.innerHTML = '<option value="">Tutti i proprietari</option>' + options;
    }

    async function loadProperties() {
        const params = new URLSearchParams();
        const search   = els.search.value.trim();
        const clientId = els.clientFilter.value;
        const status   = els.statusFilter.value;

        if (search)   params.set('search', search);
        if (clientId) params.set('client_id', clientId);
        if (status)   params.set('status', status);

        const url = params.toString() ? `${API}?${params}` : API;
        els.grid.innerHTML = '<div class="entity-loading">Caricamento…</div>';

        try {
            const res  = await fetch(url);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            properties = json.data;
            renderCards();
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
            const mediaLabel = (p.media_count || 0) === 1 ? '1 foto' : `${p.media_count || 0} foto`;

            return `
            <div class="entity-card entity-card--property">
                <div class="entity-card__prop-header">
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
                        <button class="btn btn--sm btn--ghost btn-pdf" data-id="${p.id}" title="Scheda PDF">📄</button>
                        <button class="btn btn--sm btn--ghost btn-edit" data-id="${p.id}" title="Modifica">✏️</button>
                        <button class="btn btn--sm btn--ghost btn-delete" data-id="${p.id}" title="Archivia">🗑️</button>
                    </div>
                </div>
            </div>`;
        }).join('');

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

    function openModal(property = null) {
        els.form.reset();
        document.getElementById('property-id').value = '';
        editingId = null;
        currentMedia = [];

        if (property) {
            editingId = property.id;
            els.modalTitle.textContent = 'Modifica Immobile';
            document.getElementById('property-id').value          = property.id;
            document.getElementById('property-client').value      = property.client_id;
            document.getElementById('property-status').value    = property.status;
            document.getElementById('property-address').value   = property.address;
            document.getElementById('property-city').value      = property.city;
            document.getElementById('property-cap').value       = property.cap || '';
            document.getElementById('property-floor').value     = property.floor || '';
            document.getElementById('property-sqm').value       = property.sqm ?? '';
            document.getElementById('property-rooms').value     = property.rooms ?? '';
            document.getElementById('property-bathrooms').value = property.bathrooms ?? '';
            document.getElementById('property-description').value = property.description || '';
            document.getElementById('property-features').value  = property.additional_features || '';
            document.getElementById('property-notes').value     = property.internal_notes || '';

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

    async function handleFormSubmit(e) {
        e.preventDefault();

        const id   = document.getElementById('property-id').value;
        const data = collectFormData();
        const saveBtn = document.getElementById('property-modal-save');

        saveBtn.disabled = true;
        saveBtn.textContent = 'Salvataggio...';

        try {
            const saved = await saveProperty(data, id || null);

            if (!id) {
                showAlert('Immobile creato. Puoi ora caricare la galleria multimediale.', 'success');
                openModal(saved);
            } else {
                closeModal();
                showAlert('Immobile salvato con successo.', 'success');
            }

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
            floor:               document.getElementById('property-floor').value.trim(),
            sqm:                 document.getElementById('property-sqm').value,
            rooms:               document.getElementById('property-rooms').value,
            bathrooms:           document.getElementById('property-bathrooms').value,
            description:         document.getElementById('property-description').value.trim(),
            additional_features: document.getElementById('property-features').value.trim(),
            internal_notes:      document.getElementById('property-notes').value.trim(),
            status:              document.getElementById('property-status').value,
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

    init();
})();
