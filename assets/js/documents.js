/**
 * Documents (Documenti) — upload, list, download, delete (Phase 4)
 */
(function () {
    'use strict';

    const API           = 'api/documents.php';
    const CLIENTS_API   = 'api/clients.php';
    const PROPERTIES_API = 'api/properties.php';

    const DOC_TYPE_LABELS = {
        invoice:   'Fattura',
        contract:  'File contratto',
        contratto: 'Contratto',
        id:        'Doc. identità',
        id_front:  'CI Fronte',
        id_back:   'CI Retro',
        other:     'Altro',
    };

    let documents      = [];
    let clients        = [];
    let properties     = [];
    let deleteTargetId = null;
    let searchTimer    = null;
    let currentPage    = 1;
    const PAGE_LIMIT   = 25;

    const els = {};

    function init() {
        els.tbody           = document.getElementById('documents-tbody');
        els.search          = document.getElementById('doc-search');
        els.typeFilter      = document.getElementById('doc-type-filter');
        els.clientFilter    = document.getElementById('doc-client-filter');
        els.propertyFilter  = document.getElementById('doc-property-filter');
        els.alert           = document.getElementById('documents-alert');
        els.uploadModal     = document.getElementById('doc-upload-modal');
        els.deleteModal     = document.getElementById('doc-delete-modal');
        els.uploadForm      = document.getElementById('doc-upload-form');
        els.clientSelect    = document.getElementById('doc-client');
        els.propertySelect  = document.getElementById('doc-property');
        els.pagination      = document.getElementById('documents-pagination');

        bindEvents();
        loadClients()
            .then(() => loadProperties())
            .then(() => loadDocuments())
            .catch(err => {
                if (!els.alert?.isConnected) return;
                showAlert('Errore inizializzazione: ' + err.message, 'error');
            });
    }

    function bindEvents() {
        document.getElementById('btn-upload-document').addEventListener('click', openUploadModal);
        document.getElementById('doc-upload-close').addEventListener('click', closeUploadModal);
        document.getElementById('doc-upload-cancel').addEventListener('click', closeUploadModal);
        document.getElementById('doc-delete-close').addEventListener('click', closeDeleteModal);
        document.getElementById('doc-delete-cancel').addEventListener('click', closeDeleteModal);
        document.getElementById('doc-delete-confirm').addEventListener('click', confirmDelete);

        els.uploadForm.addEventListener('submit', handleUpload);

        els.search.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => { currentPage = 1; loadDocuments(); }, 300);
        });

        els.typeFilter.addEventListener('change', () => { currentPage = 1; loadDocuments(); });
        els.clientFilter.addEventListener('change', () => {
            updatePropertyFilterOptions(els.clientFilter.value);
            currentPage = 1;
            loadDocuments();
        });
        els.propertyFilter.addEventListener('change', () => { currentPage = 1; loadDocuments(); });

        els.clientSelect.addEventListener('change', () => {
            updatePropertySelectOptions(els.clientSelect.value);
        });

        els.uploadModal.addEventListener('click', (e) => {
            if (e.target === els.uploadModal) closeUploadModal();
        });
        els.deleteModal.addEventListener('click', (e) => {
            if (e.target === els.deleteModal) closeDeleteModal();
        });
    }

    // -------------------------------------------------------------------------
    // Reference data
    // -------------------------------------------------------------------------

    async function loadClients() {
        clients = await Pagination.fetchList(CLIENTS_API, { status: 'active' });
        const opts = clients.map(c =>
            `<option value="${c.id}">${escapeHtml(c.surname)} ${escapeHtml(c.name)}</option>`
        ).join('');

        els.clientFilter.innerHTML  = '<option value="">Tutti i proprietari</option>' + opts;
        els.clientSelect.innerHTML  = '<option value="">— Nessuno —</option>' + opts;
    }

    async function loadProperties(clientId = null) {
        const params = { limit: '500', page: '1' };
        if (clientId) params.client_id = clientId;

        properties = await Pagination.fetchList(PROPERTIES_API, params);
        updatePropertyFilterOptions(els.clientFilter.value);
        updatePropertySelectOptions(els.clientSelect.value);
    }

    function propertyLabel(p) {
        return `${p.address}, ${p.city}`;
    }

    function updatePropertyFilterOptions(clientId) {
        const filtered = clientId
            ? properties.filter(p => p.client_id == clientId)
            : properties;

        const opts = filtered.map(p =>
            `<option value="${p.id}">${escapeHtml(propertyLabel(p))}</option>`
        ).join('');

        const prev = els.propertyFilter.value;
        els.propertyFilter.innerHTML = '<option value="">Tutti gli immobili</option>' + opts;

        if (prev && filtered.some(p => p.id == prev)) {
            els.propertyFilter.value = prev;
        }
    }

    function updatePropertySelectOptions(clientId) {
        const filtered = clientId
            ? properties.filter(p => p.client_id == clientId)
            : properties;

        const opts = filtered.map(p =>
            `<option value="${p.id}">${escapeHtml(propertyLabel(p))}</option>`
        ).join('');

        const prev = els.propertySelect.value;
        els.propertySelect.innerHTML = '<option value="">— Nessuno —</option>' + opts;

        if (prev && filtered.some(p => p.id == prev)) {
            els.propertySelect.value = prev;
        }
    }

    // -------------------------------------------------------------------------
    // Documents list
    // -------------------------------------------------------------------------

    async function loadDocuments() {
        const params = new URLSearchParams();
        const search     = els.search.value.trim();
        const docType    = els.typeFilter.value;
        const clientId   = els.clientFilter.value;
        const propertyId = els.propertyFilter.value;

        if (search)     params.set('search', search);
        if (docType)    params.set('doc_type', docType);
        if (clientId)   params.set('client_id', clientId);
        if (propertyId) params.set('property_id', propertyId);
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);

        const url = `${API}?${params}`;
        softLoad(els.tbody, '<tr><td colspan="7" class="table-empty">Caricamento...</td></tr>');

        try {
            const res  = await fetch(url);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const parsed = Pagination.parseResponse(json);
            documents = parsed.items;
            renderTable();
            Pagination.render(els.pagination, parsed, (p) => { currentPage = p; loadDocuments(); });
        } catch (err) {
            els.tbody.classList.remove('is-loading');
            els.tbody.innerHTML = `<tr><td colspan="7" class="table-empty table-empty--error">${escapeHtml(err.message)}</td></tr>`;
        }
    }

    function renderTable() {
        els.tbody.classList.remove('is-loading');
        if (documents.length === 0) {
            els.tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Nessun documento trovato.</td></tr>';
            return;
        }

        els.tbody.innerHTML = documents.map(d => {
            const isContract    = d.doc_type === 'contratto';
            const displayName   = d.title || d.original_name;
            const clientLabel   = d.client_id ? `${d.client_surname || ''} ${d.client_name || ''}`.trim() : null;
            const propertyLabel = d.property_id ? `${d.property_address || ''}, ${d.property_city || ''}` : null;
            const typeLabel     = DOC_TYPE_LABELS[d.doc_type] || d.doc_type;

            const actions = isContract
                ? `<button class="btn btn--sm btn--ghost btn-open-contract" data-id="${d.contract_id}" title="Apri contratto">📋 Apri</button>`
                : `<a href="${escapeHtml(d.download_url)}" class="btn btn--sm btn--ghost" title="Scarica" download>⬇️</a>
                   <button class="btn btn--sm btn--ghost btn-delete-doc" data-id="${d.id}" title="Elimina">🗑️</button>`;

            return `
                <tr>
                    <td data-label="Tipo"><span class="badge badge--doc-${d.doc_type}">${escapeHtml(typeLabel)}</span></td>
                    <td data-label="Documento">
                        <span class="doc-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
                        ${!isContract && d.title && d.title !== d.original_name ? `<br><small class="text-muted">${escapeHtml(d.original_name)}</small>` : ''}
                        ${isContract ? `<br><small class="text-muted">${escapeHtml(d.original_name)}</small>` : ''}
                    </td>
                    <td data-label="Proprietario">${clientLabel ? escapeHtml(clientLabel) : '<span class="text-muted">—</span>'}</td>
                    <td data-label="Immobile">${propertyLabel ? escapeHtml(propertyLabel) : '<span class="text-muted">—</span>'}</td>
                    <td data-label="Dimensione">${isContract ? '—' : formatFileSize(d.file_size)}</td>
                    <td data-label="Data">${formatDate(d.created_at)}</td>
                    <td class="col-actions" data-label="Azioni">${actions}</td>
                </tr>`;
        }).join('');

        els.tbody.querySelectorAll('.btn-delete-doc').forEach(btn => {
            btn.addEventListener('click', () => {
                const doc = documents.find(d => d.id == btn.dataset.id);
                if (doc) openDeleteModal(doc.id, doc.title || doc.original_name);
            });
        });

        els.tbody.querySelectorAll('.btn-open-contract').forEach(btn => {
            btn.addEventListener('click', () => {
                if (window.App) window.App.navigateTo('contracts', { contractId: parseInt(btn.dataset.id, 10) });
            });
        });
    }

    // -------------------------------------------------------------------------
    // Upload
    // -------------------------------------------------------------------------

    function openUploadModal() {
        els.uploadForm.reset();
        els.uploadModal.hidden = false;
        document.getElementById('doc-type').focus();
    }

    function closeUploadModal() {
        els.uploadModal.hidden = true;
    }

    async function handleUpload(e) {
        e.preventDefault();

        const clientId   = els.clientSelect.value;
        const propertyId = els.propertySelect.value;
        const fileInput  = document.getElementById('doc-file');

        if (!clientId && !propertyId) {
            showAlert('Associa il documento ad almeno un proprietario o un immobile.', 'error');
            return;
        }

        if (!fileInput.files.length) {
            showAlert('Seleziona un file da caricare.', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('doc_type', document.getElementById('doc-type').value);
        formData.append('title', document.getElementById('doc-title').value.trim());
        formData.append('notes', document.getElementById('doc-notes').value.trim());
        if (clientId)   formData.append('client_id', clientId);
        if (propertyId) formData.append('property_id', propertyId);
        formData.append('file', fileInput.files[0]);

        const btn = document.getElementById('doc-upload-save');
        btn.disabled = true;
        btn.textContent = 'Caricamento...';

        try {
            const res  = await fetch(API, { method: 'POST', body: formData });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            closeUploadModal();
            showAlert('Documento caricato con successo.', 'success');
            loadDocuments();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Carica';
        }
    }

    // -------------------------------------------------------------------------
    // Delete
    // -------------------------------------------------------------------------

    function openDeleteModal(id, label) {
        deleteTargetId = id;
        document.getElementById('delete-doc-label').textContent = label;
        els.deleteModal.hidden = false;
    }

    function closeDeleteModal() {
        deleteTargetId = null;
        els.deleteModal.hidden = true;
    }

    async function confirmDelete() {
        if (!deleteTargetId) return;

        const btn = document.getElementById('doc-delete-confirm');
        btn.disabled = true;

        try {
            const res  = await fetch(`${API}?id=${deleteTargetId}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            closeDeleteModal();
            showAlert('Documento eliminato.', 'success');
            loadDocuments();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
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

    function formatDate(dateStr) {
        if (!dateStr) return '—';
        return new Date(dateStr).toLocaleDateString('it-IT', {
            day: '2-digit', month: '2-digit', year: 'numeric',
        });
    }

    function formatFileSize(bytes) {
        if (!bytes) return '—';
        if (bytes < 1024)       return bytes + ' B';
        if (bytes < 1048576)    return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

    function escapeHtml(str) {
        if (str == null) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    init();
})();
