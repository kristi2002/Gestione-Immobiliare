/**
 * Clients (Proprietari) — CRUD logic for Phase 2
 */
(function () {
    'use strict';

    const API = 'api/clients.php';
    const COMM_API = 'api/communications.php';
    const REPORT_API = 'api/generate_owner_report.php';

    let importRows = [];

    const STATUS_LABELS = {
        active:   'Attivo',
        inactive: 'Inattivo',
        archived: 'Archiviato',
    };

    let clients       = [];
    let deleteTargetId = null;
    let searchTimer   = null;
    let editingClientId = null;
    let currentPage = 1;
    const PAGE_LIMIT = 25;

    // DOM refs — populated on init
    const els = {};

    let selectedIds = new Set();

    function init() {
        els.grid         = document.getElementById('clients-grid');
        els.search       = document.getElementById('client-search');
        els.statusFilter = document.getElementById('client-status-filter');
        els.alert        = document.getElementById('clients-alert');
        els.modal        = document.getElementById('client-modal');
        els.deleteModal  = document.getElementById('delete-modal');
        els.form         = document.getElementById('client-form');
        els.modalTitle   = document.getElementById('modal-title');
        els.pagination   = document.getElementById('clients-pagination');

        bindEvents();
        loadClients();
    }

    function bindEvents() {
        document.getElementById('btn-new-client').addEventListener('click', () => openModal());
        document.getElementById('modal-close').addEventListener('click', closeModal);
        document.getElementById('modal-cancel').addEventListener('click', closeModal);
        document.getElementById('delete-modal-close').addEventListener('click', closeDeleteModal);
        document.getElementById('delete-cancel').addEventListener('click', closeDeleteModal);
        document.getElementById('delete-confirm').addEventListener('click', confirmDelete);

        els.form.addEventListener('submit', handleFormSubmit);

        els.search.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => { currentPage = 1; loadClients(); }, 300);
        });

        // Bulk toolbar
        document.getElementById('clients-select-all')?.addEventListener('change', e => {
            els.grid.querySelectorAll('.client-checkbox').forEach(cb => {
                cb.checked = e.target.checked;
                e.target.checked ? selectedIds.add(+cb.dataset.id) : selectedIds.delete(+cb.dataset.id);
            });
            updateBulkToolbar();
        });
        document.getElementById('bulk-archive-clients')?.addEventListener('click', bulkArchive);
        document.getElementById('bulk-export-clients')?.addEventListener('click', bulkExport);

        els.statusFilter.addEventListener('change', () => { currentPage = 1; loadClients(); });

        els.modal.addEventListener('click', (e) => {
            if (e.target === els.modal) closeModal();
        });
        els.deleteModal.addEventListener('click', (e) => {
            if (e.target === els.deleteModal) closeDeleteModal();
        });

        document.getElementById('btn-open-chat').addEventListener('click', () => {
            if (editingClientId && window.App) {
                closeModal();
                window.App.navigateTo('communications', { clientId: editingClientId });
            }
        });

        // CSV export / import
        document.getElementById('btn-export-clients').addEventListener('click', () => {
            window.open(`${API}?format=csv`, '_blank');
        });
        document.getElementById('btn-import-clients').addEventListener('click', () => {
            document.getElementById('import-clients-file').click();
        });
        document.getElementById('import-clients-file').addEventListener('change', handleImportFile);
        document.getElementById('import-modal-close').addEventListener('click', closeImportModal);
        document.getElementById('import-modal-cancel').addEventListener('click', closeImportModal);
        document.getElementById('import-confirm').addEventListener('click', confirmImport);

        // Owner report
        document.getElementById('btn-owner-report').addEventListener('click', openReportModal);
        document.getElementById('report-modal-close').addEventListener('click', closeReportModal);
        document.getElementById('report-cancel').addEventListener('click', closeReportModal);
        document.getElementById('report-generate').addEventListener('click', generateReport);
    }

    // -------------------------------------------------------------------------
    // API calls
    // -------------------------------------------------------------------------

    async function loadClients() {
        const params = new URLSearchParams();
        const search = els.search.value.trim();
        const status = els.statusFilter.value;

        if (search) params.set('search', search);
        if (status) params.set('status', status);
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);

        const url = `${API}?${params}`;

        els.grid.innerHTML = '<div class="entity-loading">Caricamento…</div>';

        try {
            const res  = await fetch(url);
            const json = await res.json();

            if (!json.success) throw new Error(json.error);

            if (typeof Pagination === 'undefined') {
                throw new Error('Modulo paginazione non caricato. Ricarica la pagina (Ctrl+F5).');
            }

            const parsed = Pagination.parseResponse(json);
            clients = parsed.items;
            renderCards();
            Pagination.render(els.pagination, parsed, (p) => { currentPage = p; loadClients(); });
        } catch (err) {
            els.grid.innerHTML = `<div class="entity-error">${escapeHtml(err.message)}</div>`;
        }
    }

    async function saveClient(data, id) {
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

    async function archiveClient(id) {
        const res  = await fetch(`${API}?id=${id}`, { method: 'DELETE' });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
    }

    // -------------------------------------------------------------------------
    // Rendering
    // -------------------------------------------------------------------------

    function renderCards() {
        const list = Array.isArray(clients) ? clients : [];

        if (list.length === 0) {
            els.grid.innerHTML = '<div class="entity-empty">Nessun proprietario trovato.</div>';
            return;
        }

        els.grid.innerHTML = list.map(c => {
            const initials  = (c.name[0] || '') + (c.surname[0] || '');
            const propLabel = c.property_count === 1 ? '1 immobile' : `${c.property_count} immobili`;
            const checked   = selectedIds.has(c.id) ? 'checked' : '';
            return `
            <div class="entity-card" data-id="${c.id}">
                <div class="entity-card__header">
                    <input type="checkbox" class="client-checkbox entity-card__select" data-id="${c.id}" ${checked} title="Seleziona">
                    <div class="entity-card__avatar">${escapeHtml(initials.toUpperCase())}</div>
                    <div class="entity-card__title-group">
                        <div class="entity-card__name">${escapeHtml(c.name)} ${escapeHtml(c.surname)}</div>
                        <span class="badge badge--${c.status}">${STATUS_LABELS[c.status] || c.status}</span>
                    </div>
                </div>
                <div class="entity-card__body">
                    ${c.phone ? `<div class="entity-card__info"><span class="entity-card__info-icon">📞</span>${escapeHtml(c.phone)}</div>` : ''}
                    ${c.email ? `<div class="entity-card__info"><span class="entity-card__info-icon">✉️</span><a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a></div>` : ''}
                    ${!c.phone && !c.email ? `<div class="entity-card__info text-muted">Nessun contatto registrato</div>` : ''}
                </div>
                <div class="entity-card__footer">
                    <div class="entity-card__stat">
                        <span class="entity-card__stat-icon">🏢</span>
                        <span class="entity-card__stat-label">${propLabel}</span>
                    </div>
                    <div class="entity-card__actions">
                        <button class="btn btn--sm btn--ghost btn-comm" data-id="${c.id}" title="Comunicazioni">✉️</button>
                        <button class="btn btn--sm btn--ghost btn-edit" data-id="${c.id}" title="Modifica">✏️</button>
                        <button class="btn btn--sm btn--ghost btn-delete" data-id="${c.id}" title="Archivia">🗑️</button>
                    </div>
                </div>
            </div>`;
        }).join('');

        els.grid.querySelectorAll('.client-checkbox').forEach(cb => {
            cb.addEventListener('change', () => {
                cb.checked ? selectedIds.add(+cb.dataset.id) : selectedIds.delete(+cb.dataset.id);
                updateBulkToolbar();
            });
        });

        els.grid.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', () => {
                const client = clients.find(c => c.id == btn.dataset.id);
                if (client) openModal(client);
            });
        });

        els.grid.querySelectorAll('.btn-comm').forEach(btn => {
            btn.addEventListener('click', () => {
                if (window.App) window.App.navigateTo('communications', { clientId: Number(btn.dataset.id) });
            });
        });

        els.grid.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', () => {
                const client = clients.find(c => c.id == btn.dataset.id);
                if (client) openDeleteModal(client.id, `${client.name} ${client.surname}`);
            });
        });

        updateBulkToolbar();
    }

    function updateBulkToolbar() {
        const toolbar = document.getElementById('clients-bulk-toolbar');
        const countEl = document.getElementById('clients-bulk-count');
        if (!toolbar) return;
        const n = selectedIds.size;
        toolbar.hidden = n === 0;
        if (countEl) countEl.textContent = `${n} selezionat${n === 1 ? 'o' : 'i'}`;
        const selectAll = document.getElementById('clients-select-all');
        if (selectAll) selectAll.checked = n > 0 && n === clients.length;
    }

    async function bulkArchive() {
        if (!selectedIds.size) return;
        if (!confirm(`Archiviare ${selectedIds.size} proprietari selezionati?`)) return;
        const ids = [...selectedIds];
        const results = await Promise.allSettled(ids.map(id =>
            fetch(`${API}?id=${id}`, { method: 'DELETE' }).then(r => r.json())
        ));
        const failed = results.filter(r => r.status === 'rejected' || !r.value?.success).length;
        selectedIds.clear();
        await loadClients();
        showAlert(failed ? `Completato con ${failed} errori.` : `${ids.length} proprietari archiviati.`, failed ? 'error' : 'success');
    }

    function bulkExport() {
        if (!selectedIds.size) return;
        const ids = [...selectedIds].join(',');
        window.open(`${API}?format=csv&ids=${ids}`, '_blank');
    }

    // -------------------------------------------------------------------------
    // Modal
    // -------------------------------------------------------------------------

    function openModal(client = null) {
        els.form.reset();
        document.getElementById('client-id').value = '';
        editingClientId = null;
        document.getElementById('client-comm-section').hidden = true;
        document.getElementById('btn-owner-report').hidden = true;

        if (client) {
            editingClientId = client.id;
            document.getElementById('btn-owner-report').hidden = false;
            els.modalTitle.textContent = 'Modifica Proprietario';
            document.getElementById('client-id').value       = client.id;
            document.getElementById('client-name').value     = client.name;
            document.getElementById('client-surname').value  = client.surname;
            document.getElementById('client-phone').value    = client.phone || '';
            document.getElementById('client-email').value    = client.email || '';
            document.getElementById('client-status').value   = client.status;
            document.getElementById('client-notes').value    = client.internal_notes || '';

            document.getElementById('client-comm-section').hidden = false;
            loadClientCommunications(client.id);
        } else {
            els.modalTitle.textContent = 'Nuovo Proprietario';
            document.getElementById('client-status').value = 'active';
        }

        els.modal.hidden = false;
        document.getElementById('client-name').focus();
    }

    function closeModal() {
        els.modal.hidden = true;
        editingClientId = null;
    }

    async function loadClientCommunications(clientId) {
        const container = document.getElementById('client-comm-history');
        container.innerHTML = '<p class="text-muted">Caricamento...</p>';

        try {
            const res  = await fetch(`${COMM_API}?client_id=${clientId}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const msgs = json.data.messages.slice(-5);

            if (msgs.length === 0) {
                container.innerHTML = '<p class="text-muted">Nessuna comunicazione registrata.</p>';
                return;
            }

            container.innerHTML = msgs.map(m => {
                const dir = m.direction === 'sent' ? '↗ Inviata' : '↙ Ricevuta';
                const preview = truncate(m.body, 80);
                return `
                    <div class="client-comm-item client-comm-item--${m.direction}">
                        <div class="client-comm-item__head">
                            <span>${dir}</span>
                            <span>${formatDateTime(m.created_at)}</span>
                        </div>
                        ${m.subject ? `<div class="client-comm-item__subject">${escapeHtml(m.subject)}</div>` : ''}
                        <div class="client-comm-item__body">${escapeHtml(preview)}</div>
                    </div>`;
            }).join('');
        } catch (err) {
            container.innerHTML = `<p class="text-muted">${escapeHtml(err.message)}</p>`;
        }
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

    function openDeleteModal(id, name) {
        deleteTargetId = id;
        document.getElementById('delete-client-name').textContent = name;
        els.deleteModal.hidden = false;
    }

    function closeDeleteModal() {
        deleteTargetId = null;
        els.deleteModal.hidden = true;
    }

    async function handleFormSubmit(e) {
        e.preventDefault();

        const id   = document.getElementById('client-id').value;
        const data = {
            name:           document.getElementById('client-name').value.trim(),
            surname:        document.getElementById('client-surname').value.trim(),
            phone:          document.getElementById('client-phone').value.trim(),
            email:          document.getElementById('client-email').value.trim(),
            status:         document.getElementById('client-status').value,
            internal_notes: document.getElementById('client-notes').value.trim(),
        };

        const saveBtn = document.getElementById('modal-save');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Salvataggio...';

        try {
            await saveClient(data, id || null);
            closeModal();
            showAlert('Proprietario salvato con successo.', 'success');
            loadClients();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Salva';
        }
    }

    async function confirmDelete() {
        if (!deleteTargetId) return;

        const btn = document.getElementById('delete-confirm');
        btn.disabled = true;

        try {
            await archiveClient(deleteTargetId);
            closeDeleteModal();
            showAlert('Proprietario archiviato.', 'success');
            loadClients();
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
        const d = new Date(dateStr);
        return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str == null ? '' : str;
        return div.innerHTML;
    }

    // -------------------------------------------------------------------------
    // Owner report
    // -------------------------------------------------------------------------

    function openReportModal() {
        if (!editingClientId) return;
        document.getElementById('report-month').value = '';
        document.getElementById('report-year').value = new Date().getFullYear();
        document.getElementById('report-modal').hidden = false;
    }
    function closeReportModal() {
        document.getElementById('report-modal').hidden = true;
    }
    async function generateReport() {
        const btn = document.getElementById('report-generate');
        btn.disabled = true; btn.textContent = 'Generazione...';
        try {
            const res = await fetch(REPORT_API, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: editingClientId,
                    month: document.getElementById('report-month').value || null,
                    year: document.getElementById('report-year').value,
                }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeReportModal();
            window.open(json.data.download, '_blank');
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Genera PDF';
        }
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
        document.getElementById('import-count').textContent = importRows.length;
        document.getElementById('import-progress').textContent = '';
        const container = document.getElementById('import-preview');
        if (!importRows.length) {
            container.innerHTML = '<p class="text-muted">Nessuna riga valida nel file.</p>';
        } else {
            const cols = Object.keys(importRows[0]);
            const head = cols.map(c => `<th>${escapeHtml(c)}</th>`).join('');
            const rows = importRows.slice(0, 5).map(r =>
                `<tr>${cols.map(c => `<td>${escapeHtml(r[c] || '')}</td>`).join('')}</tr>`).join('');
            container.innerHTML = `<table class="data-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
        }
        document.getElementById('import-modal').hidden = false;
    }

    function closeImportModal() {
        document.getElementById('import-modal').hidden = true;
        importRows = [];
    }

    async function confirmImport() {
        if (!importRows.length) { showAlert('Nessuna riga da importare.', 'error'); return; }
        const btn = document.getElementById('import-confirm');
        const progress = document.getElementById('import-progress');
        btn.disabled = true;
        progress.textContent = 'Importazione in corso…';
        try {
            const res = await fetch(`${API}?action=import`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rows: importRows }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            progress.textContent = `Importati ${json.data.imported} proprietari.` +
                (json.data.errors.length ? ` ${json.data.errors.length} errori.` : '');
            showAlert(`Importati ${json.data.imported} proprietari.`, 'success');
            loadClients();
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
