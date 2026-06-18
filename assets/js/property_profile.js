(function () {
    'use strict';

    const propertyId = window.App?.viewParams?.propertyId;
    let currentProperty = null;
    let allMedia = [];
    let lightboxIndex = 0;

    // ── Bootstrap ────────────────────────────────────────────────────────────

    function init() {
        if (!propertyId) {
            showAlert('ID immobile non specificato. Torna all\'elenco e riprova.', 'error');
            return;
        }
        bindStaticEvents();
        loadProperty();
    }

    // ── Data loading ─────────────────────────────────────────────────────────

    function loadProperty() {
        fetch('api/properties.php?id=' + propertyId)
            .then(r => r.json())
            .then(json => {
                if (!json.success) throw new Error(json.error || 'Errore caricamento');
                currentProperty = json.data;
                renderTitle(currentProperty);
                renderGalleryHero([]);   // show placeholder while media loads
                renderInfoSection(currentProperty);
                document.getElementById('property-profile-tabs').hidden = false;
                switchTab('media');
                loadMedia();
                renderPriceHistory(currentProperty.price_history || []);
            })
            .catch(err => showAlert('Impossibile caricare l\'immobile: ' + err.message, 'error'));
    }

    function loadMedia() {
        fetch('api/property_media.php?property_id=' + propertyId)
            .then(r => r.json())
            .then(json => {
                if (!json.success) throw new Error(json.error || 'Errore');
                allMedia = Array.isArray(json.data) ? json.data : (json.data?.items || []);
                renderGalleryHero(allMedia);
                renderGalleryGrid(allMedia);
                document.getElementById('pp-media-count').textContent = allMedia.length + ' file caricati';
            })
            .catch(() => {
                renderGalleryHero([]);
            });
    }

    // ── Title section ─────────────────────────────────────────────────────────

    function renderTitle(p) {
        const sec = document.getElementById('pp-title-section');
        document.getElementById('pp-address-heading').textContent = p.address || 'Immobile senza indirizzo';

        const badge = document.getElementById('pp-status-badge');
        const statusMap = { available: ['Disponibile', 'badge--success'], rented: ['Affittato', 'badge--warning'], sold: ['Venduto', 'badge--error'], archived: ['Archiviato', 'badge--neutral'] };
        const [label, cls] = statusMap[p.status] || ['—', ''];
        badge.textContent = label;
        badge.className = 'badge ' + cls;

        const loc = [p.city, p.province ? '(' + p.province + ')' : ''].filter(Boolean).join(' ');
        document.getElementById('pp-title-meta').textContent = loc;
        sec.hidden = false;
    }

    // ── Booking.com gallery ───────────────────────────────────────────────────

    function renderGalleryHero(media) {
        const photos = media.filter(m => !m.media_type || m.media_type === 'photo' || m.media_type === 'image');
        const container = document.getElementById('pp-gallery');
        container.className = 'pp-gallery';
        container.innerHTML = buildGalleryHtml(photos);
        container.querySelectorAll('[data-lightbox]').forEach(el => {
            el.addEventListener('click', () => openLightbox(parseInt(el.dataset.lightbox, 10)));
        });
        container.querySelector('[data-lightbox-all]')?.addEventListener('click', () => openLightbox(0));
    }

    function buildGalleryHtml(photos) {
        if (photos.length === 0) {
            return '<div class="pp-gallery-placeholder"><span class="pp-gallery-placeholder__icon">🏠</span><span>Nessuna foto disponibile</span></div>';
        }

        const coverIdx = photos.findIndex(p => p.is_cover == 1 || p.is_cover === true);
        const mainIdx = coverIdx >= 0 ? coverIdx : 0;
        const main = photos[mainIdx];
        const rest = photos.filter((_, i) => i !== mainIdx);

        if (photos.length === 1) {
            return `<div class="pp-gallery-single">
                <div class="pp-gallery-main-wrap" data-lightbox="0">
                    <img src="${esc(main.file_path)}" alt="Foto principale" class="pp-gallery-main-img">
                    <button class="pp-gallery-btn-all" data-lightbox-all="1">🔍 Visualizza foto</button>
                </div>
            </div>`;
        }

        // show up to 4 thumbnails on right side
        const showCount = Math.min(rest.length, 4);
        const remaining = photos.length - 1 - showCount;

        let thumbsHtml = '';
        rest.slice(0, showCount).forEach((photo, i) => {
            const realIndex = photos.indexOf(photo);
            const isLast = i === showCount - 1;
            const overlay = isLast && remaining > 0
                ? `<div class="pp-gallery-thumb-overlay">+${remaining} foto</div>`
                : '';
            thumbsHtml += `<div class="pp-gallery-thumb" data-lightbox="${realIndex}">${overlay}<img src="${esc(photo.file_path)}" alt="Foto ${i + 2}"></div>`;
        });

        const gridClass = showCount <= 2 ? 'pp-gallery-thumbs--col' : 'pp-gallery-thumbs--grid';

        return `<div class="pp-gallery-split">
            <div class="pp-gallery-main-wrap" data-lightbox="0">
                <img src="${esc(main.file_path)}" alt="Foto principale" class="pp-gallery-main-img">
                <button class="pp-gallery-btn-all" data-lightbox-all="1">🔍 Tutte le foto (${photos.length})</button>
            </div>
            <div class="pp-gallery-thumbs ${gridClass}">
                ${thumbsHtml}
            </div>
        </div>`;
    }

    // ── Info section (below gallery) ──────────────────────────────────────────

    function renderInfoSection(p) {
        const sec = document.getElementById('pp-info-section');

        const ownerName = p.client_name || p.owner_name || '—';
        const ownerId = p.client_id || p.owner_id;
        const priceFormatted = p.price ? '€ ' + parseFloat(p.price).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : null;
        const priceTypeLabel = p.price_type === 'affitto' ? '/ mese' : ' vendita';

        const chips = buildChips(p);
        const chipsHtml = chips.length ? `<div class="pp-info-chips">${chips.map(c => `<span class="chip">${c}</span>`).join('')}</div>` : '';

        sec.innerHTML = `
        <div class="pp-info-card">
            <div class="pp-info-main">
                <div class="pp-info-left">
                    ${priceFormatted ? `<div class="pp-info-price">${priceFormatted}<span class="pp-info-price-type">${priceTypeLabel}</span></div>` : ''}
                    ${chipsHtml}
                    ${p.description ? `<p class="pp-info-description">${esc(p.description)}</p>` : ''}
                    ${p.notes ? `<p class="pp-info-notes"><strong>Note interne:</strong> ${esc(p.notes)}</p>` : ''}
                </div>
                <div class="pp-info-right">
                    <div class="pp-info-detail-block">
                        <span class="pp-info-detail-label">Proprietario</span>
                        ${ownerId
                            ? `<button class="btn-link pp-info-owner-btn" data-owner-id="${ownerId}">${esc(ownerName)}</button>`
                            : `<span>${esc(ownerName)}</span>`
                        }
                    </div>
                    ${p.floor ? `<div class="pp-info-detail-block"><span class="pp-info-detail-label">Piano</span><span>${esc(p.floor)}</span></div>` : ''}
                    ${p.cap ? `<div class="pp-info-detail-block"><span class="pp-info-detail-label">CAP</span><span>${esc(p.cap)}</span></div>` : ''}
                </div>
            </div>
            <div class="pp-info-actions">
                <button class="btn btn--primary" id="btn-pp-edit">✏️ Modifica</button>
                <button class="btn btn--ghost" id="btn-pp-pdf">📄 Scheda PDF</button>
                <button class="btn btn--ghost" id="btn-pp-qr">🔗 QR Code</button>
                <button class="btn btn--danger" id="btn-pp-archive">📦 Archivia</button>
            </div>
        </div>`;

        sec.hidden = false;

        if (ownerId) {
            sec.querySelector('.pp-info-owner-btn')?.addEventListener('click', () => {
                if (window.App) window.App.navigateTo('client_profile', { clientId: ownerId });
            });
        }
        document.getElementById('btn-pp-edit')?.addEventListener('click', openEditModal);
        document.getElementById('btn-pp-pdf')?.addEventListener('click', generatePdf);
        document.getElementById('btn-pp-qr')?.addEventListener('click', openQrModal);
        document.getElementById('btn-pp-archive')?.addEventListener('click', () => { document.getElementById('pp-archive-modal').hidden = false; });
    }

    function buildChips(p) {
        const chips = [];
        if (p.sqm) chips.push('📐 ' + p.sqm + ' mq');
        if (p.rooms) chips.push('🛏 ' + p.rooms + ' stanze');
        if (p.bathrooms) chips.push('🚿 ' + p.bathrooms + ' bagni');
        if (p.features) p.features.split(',').map(f => f.trim()).filter(Boolean).forEach(f => chips.push(f));
        return chips;
    }

    // ── Gallery grid (management tab) ─────────────────────────────────────────

    function renderGalleryGrid(media) {
        const grid = document.getElementById('pp-gallery-grid');
        if (!media.length) {
            grid.innerHTML = '<p class="text-muted" style="padding:16px;">Nessun file caricato.</p>';
            return;
        }
        grid.innerHTML = media.map((m, i) => {
            const isPhoto = !m.media_type || m.media_type === 'photo' || m.media_type === 'image';
            const thumb = isPhoto ? `<img src="${esc(m.file_path)}" alt="">` : `<div class="gallery-item-icon">📄</div>`;
            const coverBadge = m.is_cover ? '<span class="gallery-cover-badge">Copertina</span>' : '';
            return `<div class="gallery-item" data-id="${m.id}">
                <div class="gallery-item-thumb" data-lightbox="${i}">${thumb}${coverBadge}</div>
                <div class="gallery-item-info">
                    <span class="gallery-item-name">${esc(m.original_name || m.file_name || '')}</span>
                    <div class="gallery-item-actions">
                        ${isPhoto && !m.is_cover ? `<button class="btn btn--xs btn--ghost" data-action="cover" data-id="${m.id}">Copertina</button>` : ''}
                        <button class="btn btn--xs btn--danger" data-action="delete" data-id="${m.id}">🗑</button>
                    </div>
                </div>
            </div>`;
        }).join('');

        grid.querySelectorAll('[data-lightbox]').forEach(el => {
            el.addEventListener('click', e => {
                if (e.target.closest('button')) return;
                openLightbox(parseInt(el.dataset.lightbox, 10));
            });
        });
        grid.querySelectorAll('[data-action="cover"]').forEach(btn => btn.addEventListener('click', () => setCover(btn.dataset.id)));
        grid.querySelectorAll('[data-action="delete"]').forEach(btn => btn.addEventListener('click', () => deleteMedia(btn.dataset.id)));
    }

    // ── Lightbox ──────────────────────────────────────────────────────────────

    function openLightbox(index) {
        const photos = allMedia.filter(m => !m.media_type || m.media_type === 'photo' || m.media_type === 'image');
        if (!photos.length) return;
        lightboxIndex = ((index % photos.length) + photos.length) % photos.length;

        let lb = document.getElementById('pp-lightbox');
        if (!lb) {
            lb = document.createElement('div');
            lb.id = 'pp-lightbox';
            lb.className = 'pp-lightbox';
            lb.innerHTML = `
                <div class="pp-lightbox-backdrop"></div>
                <button class="pp-lightbox-close" aria-label="Chiudi">✕</button>
                <button class="pp-lightbox-nav pp-lightbox-prev" aria-label="Precedente">‹</button>
                <div class="pp-lightbox-img-wrap">
                    <img class="pp-lightbox-img" src="" alt="">
                    <div class="pp-lightbox-counter"></div>
                </div>
                <button class="pp-lightbox-nav pp-lightbox-next" aria-label="Successiva">›</button>`;
            document.body.appendChild(lb);
            lb.querySelector('.pp-lightbox-backdrop').addEventListener('click', closeLightbox);
            lb.querySelector('.pp-lightbox-close').addEventListener('click', closeLightbox);
            lb.querySelector('.pp-lightbox-prev').addEventListener('click', () => setLightboxIndex(lightboxIndex - 1));
            lb.querySelector('.pp-lightbox-next').addEventListener('click', () => setLightboxIndex(lightboxIndex + 1));
            document.addEventListener('keydown', onLightboxKey);
        }

        setLightboxIndex(lightboxIndex, photos);
        lb.style.display = 'flex';
    }

    function setLightboxIndex(idx, photos) {
        const ph = photos || allMedia.filter(m => !m.media_type || m.media_type === 'photo' || m.media_type === 'image');
        lightboxIndex = ((idx % ph.length) + ph.length) % ph.length;
        const lb = document.getElementById('pp-lightbox');
        if (!lb) return;
        lb.querySelector('.pp-lightbox-img').src = ph[lightboxIndex].file_path;
        lb.querySelector('.pp-lightbox-counter').textContent = (lightboxIndex + 1) + ' / ' + ph.length;
        const multi = ph.length > 1;
        lb.querySelector('.pp-lightbox-prev').style.display = multi ? '' : 'none';
        lb.querySelector('.pp-lightbox-next').style.display = multi ? '' : 'none';
    }

    function closeLightbox() {
        const lb = document.getElementById('pp-lightbox');
        if (lb) lb.style.display = 'none';
    }

    function onLightboxKey(e) {
        const lb = document.getElementById('pp-lightbox');
        if (!lb || lb.style.display === 'none') return;
        if (e.key === 'Escape') closeLightbox();
        else if (e.key === 'ArrowLeft') setLightboxIndex(lightboxIndex - 1);
        else if (e.key === 'ArrowRight') setLightboxIndex(lightboxIndex + 1);
    }

    // ── Media management ──────────────────────────────────────────────────────

    function uploadMedia(files) {
        const type = document.getElementById('pp-media-type').value;
        const uploads = Array.from(files).map(file => {
            const fd = new FormData();
            fd.append('property_id', propertyId);
            fd.append('media_type', type);
            fd.append('file', file);
            return fetch('api/property_media.php', { method: 'POST', body: fd }).then(r => r.json());
        });
        Promise.all(uploads).then(() => loadMedia()).catch(() => showAlert('Errore durante il caricamento.', 'error'));
    }

    let _pendingDeleteId = null;

    function deleteMedia(id) {
        const media = allMedia.find(m => String(m.id) === String(id));
        const overlay = document.getElementById('pp-delete-media-modal');
        const preview = document.getElementById('pp-delete-media-preview');
        const nameEl  = document.getElementById('pp-delete-media-name');

        const isPhoto = media && (!media.media_type || media.media_type === 'photo' || media.media_type === 'image');
        if (isPhoto && media?.file_path) {
            preview.innerHTML = `<img src="${esc(media.file_path)}" style="width:100%;height:100%;object-fit:cover;" alt="">`;
        } else {
            preview.innerHTML = '📄';
        }
        nameEl.textContent = media?.original_name || media?.file_name || '';

        _pendingDeleteId = id;
        overlay.hidden = false;
    }

    function _execDeleteMedia(id) {
        fetch('api/property_media.php?id=' + id, { method: 'DELETE' })
            .then(r => r.json())
            .then(json => { if (!json.success) throw new Error(); loadMedia(); })
            .catch(() => showAlert('Impossibile eliminare il file.', 'error'));
    }

    function setCover(id) {
        fetch('api/property_media.php?action=set_cover', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ media_id: parseInt(id, 10), property_id: parseInt(propertyId, 10) })
        })
            .then(r => r.json())
            .then(() => loadMedia())
            .catch(() => showAlert('Impossibile impostare la copertina.', 'error'));
    }

    // ── Documents ─────────────────────────────────────────────────────────────

    function loadDocuments() {
        const list = document.getElementById('pp-docs-list');
        list.innerHTML = '<div class="entity-loading">Caricamento…</div>';
        fetch('api/documents.php?property_id=' + propertyId + '&limit=100')
            .then(r => r.json())
            .then(json => {
                if (!json.success) throw new Error();
                const docs = json.data?.items || json.data || [];
                document.getElementById('pp-docs-count').textContent = docs.length + ' documenti';
                if (!docs.length) { list.innerHTML = '<p class="text-muted" style="padding:16px;">Nessun documento caricato.</p>'; return; }
                list.innerHTML = docs.map(d => `
                    <div class="doc-row">
                        <a href="${esc(d.file_path)}" target="_blank" class="doc-row__name">📄 ${esc(d.original_name || d.file_name || 'Documento')}</a>
                        <span class="doc-row__date text-muted">${d.created_at ? new Date(d.created_at).toLocaleDateString('it-IT') : ''}</span>
                        <button class="btn btn--xs btn--danger" data-doc-id="${d.id}">🗑</button>
                    </div>`).join('');
                list.querySelectorAll('[data-doc-id]').forEach(btn => btn.addEventListener('click', () => deleteDocument(btn.dataset.docId)));
            })
            .catch(() => { list.innerHTML = '<p class="text-muted" style="padding:16px;">Errore caricamento documenti.</p>'; });
    }

    function uploadDocuments(files) {
        const uploads = Array.from(files).map(file => {
            const fd = new FormData();
            fd.append('property_id', propertyId);
            fd.append('doc_type', 'generic');
            fd.append('file', file);
            return fetch('api/documents.php', { method: 'POST', body: fd }).then(r => r.json());
        });
        Promise.all(uploads).then(() => loadDocuments()).catch(() => showAlert('Errore durante il caricamento.', 'error'));
    }

    function deleteDocument(id) {
        if (!confirm('Eliminare questo documento?')) return;
        fetch('api/documents.php?id=' + id, { method: 'DELETE' })
            .then(r => r.json())
            .then(json => { if (!json.success) throw new Error(); loadDocuments(); })
            .catch(() => showAlert('Impossibile eliminare il documento.', 'error'));
    }

    // ── Reminders ─────────────────────────────────────────────────────────────

    function loadReminders() {
        const list = document.getElementById('pp-reminders-list');
        list.innerHTML = '<div class="entity-loading">Caricamento…</div>';
        fetch('api/reminders.php?property_id=' + propertyId + '&limit=100')
            .then(r => r.json())
            .then(json => {
                const items = json.data?.items || json.data || [];
                document.getElementById('pp-reminders-count').textContent = items.length + ' promemoria';
                if (!items.length) { list.innerHTML = '<p class="text-muted" style="padding:16px;">Nessun promemoria.</p>'; return; }
                list.innerHTML = items.map(r => `
                    <div class="reminder-row ${r.completed ? 'reminder-row--done' : ''}">
                        <div class="reminder-row__info">
                            <strong>${esc(r.title)}</strong>
                            ${r.due_date ? `<span class="text-muted">${new Date(r.due_date).toLocaleDateString('it-IT')}</span>` : ''}
                            ${r.notes ? `<span class="text-muted">${esc(r.notes)}</span>` : ''}
                        </div>
                        <div class="reminder-row__actions">
                            ${!r.completed ? `<button class="btn btn--xs btn--ghost" data-rem-complete="${r.id}">✓</button>` : '<span class="badge badge--success">Fatto</span>'}
                            <button class="btn btn--xs btn--danger" data-rem-delete="${r.id}">🗑</button>
                        </div>
                    </div>`).join('');
                list.querySelectorAll('[data-rem-complete]').forEach(btn => btn.addEventListener('click', () => completeReminder(btn.dataset.remComplete)));
                list.querySelectorAll('[data-rem-delete]').forEach(btn => btn.addEventListener('click', () => deleteReminder(btn.dataset.remDelete)));
            })
            .catch(() => { list.innerHTML = '<p class="text-muted" style="padding:16px;">Errore caricamento.</p>'; });
    }

    function openReminderModal(reminder) {
        document.getElementById('pp-rem-id').value = reminder?.id || '';
        document.getElementById('pp-rem-title').textContent = reminder ? 'Modifica promemoria' : 'Nuovo promemoria';
        document.getElementById('pp-rem-title-input').value = reminder?.title || '';
        document.getElementById('pp-rem-date').value = reminder?.due_date?.split('T')[0] || '';
        document.getElementById('pp-rem-freq').value = reminder?.frequency || 'once';
        document.getElementById('pp-rem-notes').value = reminder?.notes || '';
        document.getElementById('pp-reminder-modal').hidden = false;
    }

    function closeReminderModal() {
        document.getElementById('pp-reminder-modal').hidden = true;
    }

    function handleReminderSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('pp-rem-id').value;
        const body = {
            property_id: propertyId,
            title: document.getElementById('pp-rem-title-input').value.trim(),
            due_date: document.getElementById('pp-rem-date').value || null,
            frequency: document.getElementById('pp-rem-freq').value,
            notes: document.getElementById('pp-rem-notes').value.trim(),
        };
        const method = id ? 'PUT' : 'POST';
        const url = id ? 'api/reminders.php?id=' + id : 'api/reminders.php';
        fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .then(r => r.json())
            .then(json => { if (!json.success) throw new Error(json.error || 'Errore'); closeReminderModal(); loadReminders(); })
            .catch(err => showAlert('Errore: ' + err.message, 'error'));
    }

    function completeReminder(id) {
        fetch('api/reminders.php?id=' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed: 1 }) })
            .then(r => r.json())
            .then(() => loadReminders())
            .catch(() => showAlert('Errore.', 'error'));
    }

    function deleteReminder(id) {
        if (!confirm('Eliminare questo promemoria?')) return;
        fetch('api/reminders.php?id=' + id, { method: 'DELETE' })
            .then(r => r.json())
            .then(() => loadReminders())
            .catch(() => showAlert('Errore.', 'error'));
    }

    // ── Price history ─────────────────────────────────────────────────────────

    function renderPriceHistory(history) {
        const el = document.getElementById('pp-price-history');
        if (!history.length) { el.innerHTML = '<p class="text-muted" style="padding:16px;">Nessuna variazione di prezzo registrata.</p>'; return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr><th>Data</th><th>Prezzo</th><th>Tipo</th><th>Note</th></tr></thead>
            <tbody>${history.map(h => `<tr>
                <td>${h.changed_at ? new Date(h.changed_at).toLocaleDateString('it-IT') : '—'}</td>
                <td>€ ${parseFloat(h.price).toLocaleString('it-IT')}</td>
                <td>${h.price_type || '—'}</td>
                <td>${esc(h.notes || '')}</td>
            </tr>`).join('')}</tbody>
        </table>`;
    }

    // ── Edit modal ────────────────────────────────────────────────────────────

    function loadClients() {
        return fetch('api/clients.php?limit=500')
            .then(r => r.json())
            .then(json => {
                const clients = json.data?.items || json.data || [];
                const sel = document.getElementById('pp-client');
                sel.innerHTML = '<option value="">— Seleziona proprietario —</option>' +
                    clients.map(c => `<option value="${c.id}">${esc(c.name || c.full_name || '')}</option>`).join('');
                return clients;
            });
    }

    function openEditModal() {
        const p = currentProperty;
        if (!p) return;
        loadClients().then(() => {
            document.getElementById('pp-prop-id').value = p.id;
            document.getElementById('pp-client').value = p.client_id || p.owner_id || '';
            document.getElementById('pp-status').value = p.status || 'available';
            document.getElementById('pp-address').value = p.address || '';
            document.getElementById('pp-floor').value = p.floor || '';
            document.getElementById('pp-city').value = p.city || '';
            document.getElementById('pp-cap').value = p.cap || '';
            document.getElementById('pp-province').value = p.province || '';
            document.getElementById('pp-sqm').value = p.sqm || '';
            document.getElementById('pp-rooms').value = p.rooms || '';
            document.getElementById('pp-bathrooms').value = p.bathrooms || '';
            document.getElementById('pp-property-type').value = p.property_type || 'appartamento';
            document.getElementById('pp-price').value = p.price || '';
            document.getElementById('pp-price-type').value = p.price_type || 'affitto';
            document.getElementById('pp-description').value = p.description || '';
            document.getElementById('pp-features').value = p.features || '';
            document.getElementById('pp-edit-notes').value = p.notes || '';
            document.getElementById('pp-edit-modal').hidden = false;
        });
    }

    function closeEditModal() {
        document.getElementById('pp-edit-modal').hidden = true;
    }

    function handleEditSubmit(e) {
        e.preventDefault();
        const body = {
            id: propertyId,
            client_id: document.getElementById('pp-client').value || null,
            status: document.getElementById('pp-status').value,
            address: document.getElementById('pp-address').value.trim(),
            floor: document.getElementById('pp-floor').value.trim() || null,
            city: document.getElementById('pp-city').value.trim(),
            cap: document.getElementById('pp-cap').value.trim() || null,
            province: document.getElementById('pp-province').value.trim().toUpperCase() || null,
            sqm: parseFloat(document.getElementById('pp-sqm').value) || null,
            rooms: parseInt(document.getElementById('pp-rooms').value, 10) || null,
            bathrooms: parseInt(document.getElementById('pp-bathrooms').value, 10) || null,
            property_type: document.getElementById('pp-property-type').value,
            price: parseFloat(document.getElementById('pp-price').value) || null,
            price_type: document.getElementById('pp-price-type').value,
            description: document.getElementById('pp-description').value.trim() || null,
            features: document.getElementById('pp-features').value.trim() || null,
            notes: document.getElementById('pp-edit-notes').value.trim() || null,
        };
        const btn = document.getElementById('pp-edit-save');
        btn.disabled = true;
        fetch('api/properties.php?id=' + propertyId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .then(r => r.json())
            .then(json => { if (!json.success) throw new Error(json.error || 'Errore'); closeEditModal(); loadProperty(); })
            .catch(err => showAlert('Errore salvataggio: ' + err.message, 'error'))
            .finally(() => { btn.disabled = false; });
    }

    // ── Archive ───────────────────────────────────────────────────────────────

    function confirmArchive() {
        fetch('api/properties.php?id=' + propertyId, { method: 'DELETE' })
            .then(r => r.json())
            .then(json => {
                if (!json.success) throw new Error(json.error || 'Errore');
                document.getElementById('pp-archive-modal').hidden = true;
                if (window.App) window.App.navigateTo('properties');
            })
            .catch(err => showAlert('Errore: ' + err.message, 'error'));
    }

    // ── PDF & QR ──────────────────────────────────────────────────────────────

    function generatePdf() {
        fetch('api/generate_pdf.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ property_id: propertyId }) })
            .then(r => r.blob())
            .then(blob => {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'immobile_' + propertyId + '.pdf';
                a.click();
            })
            .catch(() => showAlert('Errore generazione PDF.', 'error'));
    }

    function openQrModal() {
        const publicUrl = window.location.origin + '/property/' + propertyId;
        const qrSrc = 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent(publicUrl);
        document.getElementById('pp-qr-img').src = qrSrc;
        document.getElementById('pp-qr-url').value = publicUrl;
        document.getElementById('pp-qr-download').href = qrSrc;
        document.getElementById('pp-qr-modal').hidden = false;
    }

    function closeQrModal() {
        document.getElementById('pp-qr-modal').hidden = true;
    }

    // ── Tabs ──────────────────────────────────────────────────────────────────

    function switchTab(tabName) {
        document.querySelectorAll('.profile-tab').forEach(t => t.classList.toggle('profile-tab--active', t.dataset.tab === tabName));
        ['media', 'documents', 'reminders', 'history'].forEach(name => {
            document.getElementById('panel-' + name).hidden = name !== tabName;
        });
        if (tabName === 'documents') loadDocuments();
        if (tabName === 'reminders') loadReminders();
    }

    // ── Event binding ──────────────────────────────────────────────────────────

    function bindStaticEvents() {
        document.getElementById('btn-back-to-properties').addEventListener('click', () => {
            if (window.App) window.App.navigateTo('properties');
        });

        document.getElementById('property-profile-tabs').addEventListener('click', e => {
            const tab = e.target.closest('[data-tab]');
            if (tab) switchTab(tab.dataset.tab);
        });

        document.getElementById('pp-media-upload').addEventListener('change', e => {
            if (e.target.files.length) uploadMedia(e.target.files);
            e.target.value = '';
        });

        document.getElementById('pp-doc-upload').addEventListener('change', e => {
            if (e.target.files.length) uploadDocuments(e.target.files);
            e.target.value = '';
        });

        document.getElementById('btn-pp-new-reminder').addEventListener('click', () => openReminderModal());
        document.getElementById('pp-rem-close').addEventListener('click', closeReminderModal);
        document.getElementById('pp-rem-cancel').addEventListener('click', closeReminderModal);
        document.getElementById('pp-reminder-form').addEventListener('submit', handleReminderSubmit);

        document.getElementById('pp-edit-close').addEventListener('click', closeEditModal);
        document.getElementById('pp-edit-cancel').addEventListener('click', closeEditModal);
        document.getElementById('pp-edit-form').addEventListener('submit', handleEditSubmit);

        document.getElementById('pp-archive-close').addEventListener('click', () => { document.getElementById('pp-archive-modal').hidden = true; });
        document.getElementById('pp-archive-cancel').addEventListener('click', () => { document.getElementById('pp-archive-modal').hidden = true; });
        document.getElementById('pp-archive-confirm').addEventListener('click', confirmArchive);

        document.getElementById('pp-qr-close').addEventListener('click', closeQrModal);
        document.getElementById('pp-qr-cancel').addEventListener('click', closeQrModal);
        document.getElementById('pp-qr-copy').addEventListener('click', () => {
            navigator.clipboard.writeText(document.getElementById('pp-qr-url').value).catch(() => {});
        });

        const closeDeleteModal = () => {
            document.getElementById('pp-delete-media-modal').hidden = true;
            _pendingDeleteId = null;
        };
        document.getElementById('pp-delete-media-close').addEventListener('click', closeDeleteModal);
        document.getElementById('pp-delete-media-cancel').addEventListener('click', closeDeleteModal);
        document.getElementById('pp-delete-media-modal').addEventListener('click', e => {
            if (e.target === e.currentTarget) closeDeleteModal();
        });
        document.getElementById('pp-delete-media-confirm').addEventListener('click', () => {
            const id = _pendingDeleteId;
            closeDeleteModal();
            if (id != null) _execDeleteMedia(id);
        });
    }

    // ── Utility ───────────────────────────────────────────────────────────────

    function showAlert(msg, type) {
        const el = document.getElementById('property-profile-alert');
        el.textContent = msg;
        el.className = 'alert alert--' + (type || 'info');
        el.style.display = '';
        setTimeout(() => { el.style.display = 'none'; }, 5000);
    }

    function esc(str) {
        if (str == null) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    init();
})();
