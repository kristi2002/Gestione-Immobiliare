/**
 * Social Media — Meta API posts & scheduling (Phase 7)
 */
(function () {
    'use strict';

    const POSTS_API    = 'api/social_posts.php';
    const SETTINGS_API = 'api/social_settings.php';
    const PUBLISH_API  = 'api/publish_social_posts.php';
    const PROPERTIES_API = 'api/properties.php';
    const MEDIA_API    = 'api/property_media.php';

    const PLATFORM_LABELS = {
        facebook:  'Facebook',
        instagram: 'Instagram',
        both:      'FB + IG',
    };

    const STATUS_LABELS = {
        draft:     'Bozza',
        scheduled: 'Programmato',
        published: 'Pubblicato',
        failed:    'Fallito',
    };

    let posts      = [];
    let properties = [];
    let searchTimer = null;
    let currentPage = 1;
    const PAGE_LIMIT = 25;

    const els = {};

    function init() {
        els.tbody          = document.getElementById('posts-tbody');
        els.search         = document.getElementById('post-search');
        els.statusFilter   = document.getElementById('post-status-filter');
        els.platformFilter = document.getElementById('post-platform-filter');
        els.alert          = document.getElementById('social-alert');
        els.modal          = document.getElementById('post-modal');
        els.form           = document.getElementById('post-form');
        els.modalTitle     = document.getElementById('post-modal-title');
        els.propertySelect = document.getElementById('post-property');
        els.metaForm       = document.getElementById('meta-settings-form');
        els.metaBadge      = document.getElementById('meta-status-badge');
        els.imagePreview   = document.getElementById('post-image-preview');
        els.pagination     = document.getElementById('social-pagination');

        bindEvents();
        loadSettings();
        loadProperties()
            .then(() => loadPosts())
            .catch(err => {
                if (!els.alert?.isConnected) return;
                showAlert('Errore inizializzazione: ' + err.message, 'error');
            });
    }

    function bindEvents() {
        document.getElementById('btn-new-post').addEventListener('click', () => openModal());
        document.getElementById('btn-publish-scheduled').addEventListener('click', publishScheduled);
        document.getElementById('post-modal-close').addEventListener('click', closeModal);
        document.getElementById('post-modal-cancel').addEventListener('click', closeModal);

        els.form.addEventListener('submit', handlePostSubmit);
        els.metaForm.addEventListener('submit', handleMetaSubmit);

        els.search.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => { currentPage = 1; loadPosts(); }, 300);
        });

        els.statusFilter.addEventListener('change', () => { currentPage = 1; loadPosts(); });
        els.platformFilter.addEventListener('change', () => { currentPage = 1; loadPosts(); });

        document.getElementById('post-image').addEventListener('change', previewImage);
        document.getElementById('post-property').addEventListener('change', onPropertyChange);

        els.modal.addEventListener('click', (e) => {
            if (e.target === els.modal) closeModal();
        });
    }

    // -------------------------------------------------------------------------
    // Meta settings
    // -------------------------------------------------------------------------

    async function loadSettings() {
        try {
            const res  = await fetch(SETTINGS_API);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const s = json.data;
            document.getElementById('meta-app-id').value   = s.meta_app_id || '';
            document.getElementById('meta-page-id').value  = s.facebook_page_id || '';
            document.getElementById('meta-page-token').value = s.facebook_page_token || '';
            document.getElementById('meta-ig-id').value      = s.instagram_account_id || '';
            document.getElementById('meta-token-expires').value = s.token_expires_at
                ? toDatetimeLocal(s.token_expires_at) : '';

            updateMetaBadge(s.is_connected);
        } catch (err) {
            updateMetaBadge(false);
        }
    }

    function updateMetaBadge(connected) {
        if (connected) {
            els.metaBadge.textContent = '● Connesso';
            els.metaBadge.className   = 'meta-status meta-status--connected';
        } else {
            els.metaBadge.textContent = '○ Modalità simulata';
            els.metaBadge.className   = 'meta-status meta-status--simulated';
        }
    }

    async function handleMetaSubmit(e) {
        e.preventDefault();

        const btn = document.getElementById('btn-save-meta');
        btn.disabled = true;

        const data = {
            meta_app_id:          document.getElementById('meta-app-id').value.trim(),
            facebook_page_id:     document.getElementById('meta-page-id').value.trim(),
            facebook_page_token:  document.getElementById('meta-page-token').value.trim(),
            instagram_account_id: document.getElementById('meta-ig-id').value.trim(),
            token_expires_at:     document.getElementById('meta-token-expires').value || null,
        };

        try {
            const res  = await fetch(SETTINGS_API, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            updateMetaBadge(json.data.is_connected);
            showAlert('Impostazioni Meta salvate.', 'success');
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    // -------------------------------------------------------------------------
    // Posts
    // -------------------------------------------------------------------------

    async function loadProperties() {
        properties = await Pagination.fetchList(PROPERTIES_API);
        const opts = properties.map(p =>
            `<option value="${p.id}">${escapeHtml(p.address)}, ${escapeHtml(p.city)}</option>`
        ).join('');
        els.propertySelect.innerHTML = '<option value="">— Nessuno —</option>' + opts;
    }

    async function loadPosts() {
        const params = new URLSearchParams();
        const search   = els.search.value.trim();
        const status   = els.statusFilter.value;
        const platform = els.platformFilter.value;

        if (search)   params.set('search', search);
        if (status)   params.set('status', status);
        if (platform) params.set('platform', platform);
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);

        const url = `${POSTS_API}?${params}`;
        els.tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Caricamento...</td></tr>';

        try {
            const res  = await fetch(url);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const parsed = Pagination.parseResponse(json);
            posts = parsed.items;
            renderTable();
            Pagination.render(els.pagination, parsed, (p) => { currentPage = p; loadPosts(); });
        } catch (err) {
            els.tbody.innerHTML = `<tr><td colspan="6" class="table-empty table-empty--error">${escapeHtml(err.message)}</td></tr>`;
        }
    }

    function renderTable() {
        if (posts.length === 0) {
            els.tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Nessun post trovato.</td></tr>';
            return;
        }

        els.tbody.innerHTML = posts.map(p => {
            const propertyLabel = p.property_id
                ? `${p.property_address}, ${p.property_city}`
                : null;

            const canEdit = p.status !== 'published';
            const actions = canEdit
                ? `<button class="btn btn--sm btn--ghost btn-publish" data-id="${p.id}" title="Pubblica ora">🚀</button>
                   <button class="btn btn--sm btn--ghost btn-edit" data-id="${p.id}" title="Modifica">✏️</button>
                   <button class="btn btn--sm btn--ghost btn-delete" data-id="${p.id}" title="Elimina">🗑️</button>`
                : `<span class="text-muted" title="${escapeHtml(p.facebook_post_id || '')}">✓ Pubblicato</span>`;

            return `
                <tr>
                    <td data-label="Didascalia">
                        <div class="post-caption-cell">
                            ${p.image_path ? '<span class="post-has-image" title="Con immagine">🖼</span>' : ''}
                            <span title="${escapeHtml(p.caption)}">${escapeHtml(truncate(p.caption, 60))}</span>
                        </div>
                        ${p.error_message ? `<small class="text-muted post-error">${escapeHtml(truncate(p.error_message, 50))}</small>` : ''}
                    </td>
                    <td data-label="Piattaforma"><span class="badge badge--platform-${p.platform}">${PLATFORM_LABELS[p.platform]}</span></td>
                    <td data-label="Immobile">${propertyLabel ? escapeHtml(propertyLabel) : '<span class="text-muted">—</span>'}</td>
                    <td data-label="Programmato">${formatDateTime(p.scheduled_at)}</td>
                    <td data-label="Stato"><span class="badge badge--social-${p.status}">${STATUS_LABELS[p.status]}</span></td>
                    <td class="col-actions" data-label="Azioni">${actions}</td>
                </tr>`;
        }).join('');

        els.tbody.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', () => {
                const post = posts.find(p => p.id == btn.dataset.id);
                if (post) openModal(post);
            });
        });

        els.tbody.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (await confirmDialog('Vuoi eliminare questo post?', { title: 'Elimina post' })) deletePost(btn.dataset.id);
            });
        });

        els.tbody.querySelectorAll('.btn-publish').forEach(btn => {
            btn.addEventListener('click', () => publishNow(btn.dataset.id));
        });
    }

    // -------------------------------------------------------------------------
    // Post modal
    // -------------------------------------------------------------------------

    function openModal(post = null) {
        els.form.reset();
        document.getElementById('post-id').value = '';
        document.getElementById('post-property-media-id').value = '';
        els.imagePreview.hidden = true;
        els.imagePreview.innerHTML = '';
        clearPropertyPhotoPicker();

        if (post) {
            els.modalTitle.textContent = 'Modifica Post';
            document.getElementById('post-id').value       = post.id;
            document.getElementById('post-platform').value = post.platform;
            document.getElementById('post-property').value   = post.property_id || '';
            document.getElementById('post-caption').value  = post.caption;
            document.getElementById('post-scheduled').value = toDatetimeLocal(post.scheduled_at);
            document.getElementById('post-status').value   = post.status === 'scheduled' ? 'scheduled' : 'draft';

            if (post.image_path) {
                els.imagePreview.hidden = false;
                els.imagePreview.innerHTML = `<img src="${escapeHtml(post.image_path)}" alt="Anteprima">`;
            }
            if (post.property_id) loadPropertyPhotos(post.property_id);
        } else {
            els.modalTitle.textContent = 'Nuovo Post';
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(10, 0, 0, 0);
            document.getElementById('post-scheduled').value = toDatetimeLocal(tomorrow.toISOString());
            document.getElementById('post-status').value = 'scheduled';
        }

        els.modal.hidden = false;
        document.getElementById('post-caption').focus();
    }

    function clearPropertyPhotoPicker() {
        document.getElementById('post-property-photos-group').hidden = true;
        document.getElementById('post-property-photos').innerHTML = '';
    }

    async function onPropertyChange() {
        document.getElementById('post-property-media-id').value = '';
        const propertyId = document.getElementById('post-property').value;
        if (!propertyId) {
            clearPropertyPhotoPicker();
            return;
        }
        await loadPropertyPhotos(propertyId);
    }

    async function loadPropertyPhotos(propertyId) {
        const group = document.getElementById('post-property-photos-group');
        const container = document.getElementById('post-property-photos');
        group.hidden = false;
        container.innerHTML = '<p class="text-muted">Caricamento foto immobile…</p>';

        try {
            const res = await fetch(`${MEDIA_API}?property_id=${propertyId}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const photos = (json.data || []).filter(m => m.mime_type && m.mime_type.startsWith('image/'));
            if (!photos.length) {
                container.innerHTML = '<p class="text-muted">Nessuna foto in galleria per questo immobile. Caricala dalla scheda Immobili.</p>';
                return;
            }

            container.innerHTML = photos.map(p => `
                <button type="button" class="property-photo-picker__item" data-id="${p.id}" data-url="${escapeHtml(p.url)}" title="${escapeHtml(p.original_name)}">
                    <img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.original_name)}" loading="lazy">
                </button>
            `).join('');

            container.querySelectorAll('.property-photo-picker__item').forEach(btn => {
                btn.addEventListener('click', () => selectPropertyPhoto(btn));
            });
        } catch (err) {
            container.innerHTML = `<p class="text-muted">${escapeHtml(err.message)}</p>`;
        }
    }

    function selectPropertyPhoto(btn) {
        document.querySelectorAll('.property-photo-picker__item').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        document.getElementById('post-property-media-id').value = btn.dataset.id;
        document.getElementById('post-image').value = '';
        els.imagePreview.hidden = false;
        els.imagePreview.innerHTML = `<img src="${escapeHtml(btn.dataset.url)}" alt="Anteprima da immobile">`;
    }

    function closeModal() {
        els.modal.hidden = true;
    }

    function previewImage() {
        const file = document.getElementById('post-image').files[0];
        if (!file) {
            els.imagePreview.hidden = true;
            return;
        }
        document.getElementById('post-property-media-id').value = '';
        document.querySelectorAll('.property-photo-picker__item').forEach(b => b.classList.remove('selected'));
        const url = URL.createObjectURL(file);
        els.imagePreview.hidden = false;
        els.imagePreview.innerHTML = `<img src="${url}" alt="Anteprima">`;
    }

    async function handlePostSubmit(e) {
        e.preventDefault();

        const id = document.getElementById('post-id').value;
        const formData = new FormData();
        formData.append('platform', document.getElementById('post-platform').value);
        formData.append('property_id', document.getElementById('post-property').value);
        formData.append('caption', document.getElementById('post-caption').value.trim());
        formData.append('scheduled_at', document.getElementById('post-scheduled').value);
        formData.append('status', document.getElementById('post-status').value);

        const imageFile = document.getElementById('post-image').files[0];
        if (imageFile) formData.append('image', imageFile);

        const propertyMediaId = document.getElementById('post-property-media-id').value;
        if (propertyMediaId) formData.append('property_media_id', propertyMediaId);

        const btn = document.getElementById('post-modal-save');
        btn.disabled = true;
        btn.textContent = 'Salvataggio...';

        try {
            const url    = id ? `${POSTS_API}?id=${id}` : POSTS_API;
            const method = 'POST';

            const res  = await fetch(url, { method, body: formData });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            closeModal();
            showAlert('Post salvato.', 'success');
            loadPosts();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Salva';
        }
    }

    async function deletePost(id) {
        try {
            const res  = await fetch(`${POSTS_API}?id=${id}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            showAlert('Post eliminato.', 'success');
            loadPosts();
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    async function publishNow(id) {
        if (!await confirmDialog('Vuoi pubblicare questo post adesso?', { title: 'Pubblica post', confirmText: 'Pubblica', danger: false })) return;

        try {
            const res  = await fetch(`${POSTS_API}?id=${id}&action=publish`, { method: 'PATCH' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            showAlert('Post pubblicato.', 'success');
            loadPosts();
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    async function publishScheduled() {
        const btn = document.getElementById('btn-publish-scheduled');
        btn.disabled = true;
        btn.textContent = 'Pubblicazione...';

        try {
            const res  = await fetch(PUBLISH_API, { method: 'POST' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const count = json.data.processed;
            showAlert(
                count > 0
                    ? `Pubblicati ${count} post programmati.`
                    : 'Nessun post programmato da pubblicare.',
                'success'
            );
            loadPosts();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '⚡ Pubblica programmati';
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
        els.alert._timer = setTimeout(() => { els.alert.style.display = 'none'; }, 5000);
    }

    function toDatetimeLocal(dateStr) {
        const d = new Date(dateStr);
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function formatDateTime(dateStr) {
        return new Date(dateStr).toLocaleString('it-IT', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
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
