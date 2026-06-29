/**
 * Client edit / create — dedicated page (replaces the old modal).
 * Reads window.App.viewParams.clientId for edit mode; absent => create mode.
 */
(function () {
    'use strict';

    const API        = 'api/clients.php';
    const DOCS_API   = 'api/documents.php';
    const REPORT_API = 'api/generate_owner_report.php';

    const clientId = window.App?.viewParams?.clientId || null;
    const isEdit   = !!clientId;

    function $(id) { return document.getElementById(id); }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str == null ? '' : str;
        return div.innerHTML;
    }

    function showAlert(message, type) {
        const el = $('ce-alert');
        if (!el) return;
        el.textContent = message;
        el.className = `alert alert--${type}`;
        el.style.display = 'block';
        clearTimeout(el._t);
        el._t = setTimeout(() => { el.style.display = 'none'; }, 4000);
    }

    function showError(message) {
        const el = $('ce-error');
        if (!el) return;
        el.textContent = message;
        el.style.display = 'block';
    }
    function clearError() {
        const el = $('ce-error');
        if (el) el.style.display = 'none';
    }

    function goBack() {
        if (!window.App) return;
        if (isEdit) window.App.navigateTo('client_profile', { clientId });
        else window.App.navigateTo('clients');
    }

    async function loadClient() {
        try {
            const res  = await fetch(`${API}?id=${clientId}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const c = json.data;
            $('ce-id').value      = c.id;
            $('ce-name').value    = c.name || '';
            $('ce-surname').value = c.surname || '';
            $('ce-cf').value      = c.codice_fiscale || '';
            $('ce-phone').value   = c.phone || '';
            $('ce-email').value   = c.email || '';
            $('ce-status').value  = c.status || 'active';
            $('ce-notes').value   = c.internal_notes || '';
        } catch (err) {
            showAlert('Impossibile caricare il proprietario: ' + err.message, 'error');
        }
    }

    async function loadIdSide(containerId, docType) {
        const container = $(containerId);
        if (!container) return;
        container.innerHTML = '<p class="text-muted" style="font-size:13px;margin:0;">Caricamento...</p>';
        try {
            const res  = await fetch(`${DOCS_API}?doc_type=${docType}&client_id=${clientId}&limit=1`);
            const json = await res.json();
            const doc  = json.data?.items?.[0] || null;
            if (!doc) {
                container.innerHTML = '<p class="text-muted" style="font-size:13px;margin:0;">Non caricato</p>';
                return;
            }
            container.innerHTML = `
                <div class="id-card-row">
                    <span style="font-size:13px;">📄 ${escapeHtml(doc.original_name)}</span>
                    <a href="${escapeHtml(doc.download_url)}" target="_blank" class="btn btn--xs btn--ghost">🖨️ Stampa</a>
                </div>`;
        } catch (_) {
            container.innerHTML = '<p class="text-muted" style="font-size:13px;margin:0;">Errore di caricamento.</p>';
        }
    }

    function loadIdDocs() {
        loadIdSide('ce-id-front-status', 'id_front');
        loadIdSide('ce-id-back-status', 'id_back');
    }

    async function uploadId(file, docType) {
        const btnId    = docType === 'id_front' ? 'ce-btn-front' : 'ce-btn-back';
        const btnLabel = docType === 'id_front' ? '⬆️ Carica Fronte' : '⬆️ Carica Retro';
        const title    = docType === 'id_front' ? 'CI - Fronte' : 'CI - Retro';
        const fd = new FormData();
        fd.append('file', file);
        fd.append('doc_type', docType);
        fd.append('client_id', clientId);
        fd.append('title', title);
        const btn = $(btnId);
        if (btn) { btn.disabled = true; btn.textContent = 'Caricamento...'; }
        try {
            const res  = await fetch(DOCS_API, { method: 'POST', body: fd });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert('Documento caricato.', 'success');
            loadIdSide(docType === 'id_front' ? 'ce-id-front-status' : 'ce-id-back-status', docType);
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
        }
    }

    async function save(e) {
        e.preventDefault();
        clearError();
        const id   = $('ce-id').value;
        const data = {
            name:           $('ce-name').value.trim(),
            surname:        $('ce-surname').value.trim(),
            codice_fiscale: $('ce-cf').value.trim().toUpperCase() || null,
            phone:          $('ce-phone').value.trim(),
            email:          $('ce-email').value.trim(),
            status:         $('ce-status').value,
            internal_notes: $('ce-notes').value.trim(),
        };

        const saveBtn = $('ce-save');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Salvataggio...';
        try {
            const url    = id ? `${API}?id=${id}` : API;
            const method = id ? 'PUT' : 'POST';
            const res  = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const newId = id || json.data?.id;
            if (window.App && newId) window.App.navigateTo('client_profile', { clientId: Number(newId) });
            else if (window.App) window.App.navigateTo('clients');
        } catch (err) {
            showError(err.message);
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Salva';
        }
    }

    // ----- Owner report -----
    function openReport() {
        $('ce-report-month').value = '';
        $('ce-report-year').value  = new Date().getFullYear();
        $('ce-report-modal').hidden = false;
    }
    function closeReport() { $('ce-report-modal').hidden = true; }
    async function generateReport() {
        const btn = $('ce-report-generate');
        btn.disabled = true; btn.textContent = 'Generazione...';
        try {
            const res = await fetch(REPORT_API, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: clientId,
                    month: $('ce-report-month').value || null,
                    year:  $('ce-report-year').value,
                }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeReport();
            window.open(json.data.download, '_blank');
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Genera PDF';
        }
    }

    function init() {
        $('ce-back').addEventListener('click', goBack);
        $('ce-cancel').addEventListener('click', goBack);
        $('ce-form').addEventListener('submit', save);

        // ID card uploads
        $('ce-btn-front').addEventListener('click', () => $('ce-id-front-file').click());
        $('ce-id-front-file').addEventListener('change', (e) => {
            const f = e.target.files[0]; e.target.value = '';
            if (f) uploadId(f, 'id_front');
        });
        $('ce-btn-back').addEventListener('click', () => $('ce-id-back-file').click());
        $('ce-id-back-file').addEventListener('change', (e) => {
            const f = e.target.files[0]; e.target.value = '';
            if (f) uploadId(f, 'id_back');
        });

        // Owner report
        $('ce-report').addEventListener('click', openReport);
        $('ce-report-close').addEventListener('click', closeReport);
        $('ce-report-cancel').addEventListener('click', closeReport);
        $('ce-report-generate').addEventListener('click', generateReport);
        $('ce-report-modal').addEventListener('click', (e) => {
            if (e.target === $('ce-report-modal')) closeReport();
        });

        if (isEdit) {
            $('ce-title').textContent = 'Modifica Proprietario';
            $('ce-id-card-section').hidden = false;
            $('ce-report').hidden = false;
            loadClient();
            loadIdDocs();
        } else {
            $('ce-title').textContent = 'Nuovo Proprietario';
        }
        $('ce-name').focus();
    }

    init();
})();
