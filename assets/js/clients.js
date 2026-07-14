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
        bindRail();
        loadClients();
        loadStats();
    }

    // -------------------------------------------------------------------------
    // Right detail rail (proprietari.png): identity + contacts + documents +
    // linked properties, with "Visualizza Completo" opening the full profile.
    // -------------------------------------------------------------------------

    let railClientId = null;

    function bindRail() {
        const rail = document.getElementById('client-rail');
        if (!rail) return;
        document.getElementById('rail-close')?.addEventListener('click', closeRail);
        document.getElementById('rail-open-full')?.addEventListener('click', () => {
            if (railClientId && window.App) {
                closeRail();
                window.App.navigateTo('client_profile', { clientId: railClientId });
            }
        });
        document.addEventListener('keydown', function onEsc(e) {
            if (e.key === 'Escape' && !rail.hidden) closeRail();
            if (!document.body.contains(rail)) document.removeEventListener('keydown', onEsc);
        });
    }

    function closeRail() {
        const rail = document.getElementById('client-rail');
        if (rail) rail.hidden = true;
        railClientId = null;
        els.grid?.querySelectorAll('.lt-row.is-active').forEach(r => r.classList.remove('is-active'));
    }

    async function openRail(id) {
        const c = clients.find(x => x.id === id);
        const rail = document.getElementById('client-rail');
        if (!c || !rail) return;
        railClientId = id;

        els.grid.querySelectorAll('.lt-row').forEach(r =>
            r.classList.toggle('is-active', Number(r.dataset.id) === id));

        const accent = ((c.id % 8) + 8) % 8;
        const av = document.getElementById('rail-avatar');
        av.textContent = ((c.name[0] || '') + (c.surname[0] || '')).toUpperCase();
        av.className = `detail-rail__avatar av-a${accent}`;
        document.getElementById('rail-name').textContent = `${c.name} ${c.surname}`;
        document.getElementById('rail-chips').innerHTML =
            `<span class="badge badge--${c.status}">${STATUS_LABELS[c.status] || c.status}</span>`
            + `<span class="badge pill--blue">${c.property_count == 1 ? '1 immobile' : (Number(c.property_count) || 0) + ' immobili'}</span>`;
        document.getElementById('rail-contacts').innerHTML = [
            c.phone ? `<div>Telefono: <a href="tel:${escapeHtml(c.phone)}">${escapeHtml(c.phone)}</a></div>` : '',
            c.email ? `<div>Email: <a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a></div>` : '',
            c.codice_fiscale ? `<div>CF: ${escapeHtml(c.codice_fiscale)}</div>` : '',
        ].filter(Boolean).join('') || '<span class="text-muted">Nessun contatto registrato.</span>';

        const docsBox = document.getElementById('rail-docs');
        const propsBox = document.getElementById('rail-props');
        docsBox.innerHTML = propsBox.innerHTML = '<p class="text-muted detail-rail__empty">Caricamento…</p>';
        rail.hidden = false;

        const [docs, props] = await Promise.all([
            fetch(`api/documents.php?client_id=${id}&limit=5`).then(r => r.json()).catch(() => null),
            fetch(`api/properties.php?client_id=${id}&limit=5`).then(r => r.json()).catch(() => null),
        ]);
        if (railClientId !== id) return; // switched while loading

        const docItems = docs?.success ? (docs.data.items || docs.data || []) : [];
        docsBox.innerHTML = docItems.length
            ? docItems.slice(0, 5).map(d =>
                `<a class="rail-doc" href="${escapeHtml(d.download_url || 'api/download_document.php?id=' + d.id)}" target="_blank" rel="noopener">
                    <i data-lucide="file-text"></i><span>${escapeHtml(d.title || d.original_name || 'Documento')}</span>
                </a>`).join('')
            : '<p class="text-muted detail-rail__empty">Nessun documento.</p>';

        const propItems = props?.success ? (props.data.items || props.data || []) : [];
        propsBox.innerHTML = propItems.length
            ? propItems.slice(0, 5).map(p => {
                const img = p.cover_url
                    ? `<span class="rail-prop__img" style="background-image:url('${escapeHtml(p.cover_url)}')"></span>`
                    : '<span class="rail-prop__img"><i data-lucide="home"></i></span>';
                const price = p.price != null
                    ? '€ ' + Number(p.price).toLocaleString('it-IT') + (p.price_type === 'affitto' ? '/mese' : '')
                    : '';
                return `<div class="rail-prop" data-prop="${p.id}">${img}
                    <div class="rail-prop__txt"><b>${escapeHtml(p.address || '')}, ${escapeHtml(p.city || '')}</b><span>${price}</span></div>
                </div>`;
            }).join('')
            : '<p class="text-muted detail-rail__empty">Nessun immobile collegato.</p>';
        propsBox.querySelectorAll('.rail-prop').forEach(el =>
            el.addEventListener('click', () => {
                closeRail();
                if (window.App) window.App.navigateTo('property_profile', { propertyId: Number(el.dataset.prop) });
            }));

        if (window.lucide) window.lucide.createIcons();
    }

    function bindEvents() {
        // "Nuovo Proprietario" and editing now open a dedicated page (not a modal).
        document.getElementById('btn-new-client').addEventListener('click', () => {
            if (window.App) window.App.navigateTo('client_edit');
        });
        document.getElementById('delete-modal-close').addEventListener('click', closeDeleteModal);
        document.getElementById('delete-cancel').addEventListener('click', closeDeleteModal);
        document.getElementById('delete-confirm').addEventListener('click', confirmDelete);

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

        els.deleteModal.addEventListener('click', (e) => {
            if (e.target === els.deleteModal) closeDeleteModal();
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

        softLoad(els.grid, '<tr><td colspan="7" class="entity-loading">Caricamento…</td></tr>');

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
            els.grid.classList.remove('is-loading');
            els.grid.innerHTML = `<tr><td colspan="7" class="entity-error">${escapeHtml(err.message)}</td></tr>`;
        }
    }

    async function loadStats() {
        try {
            const res  = await fetch(`${API}?action=stats`);
            const json = await res.json();
            if (!json.success) return;
            const d = json.data;
            const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
            set('cstat-total',  d.total);
            set('cstat-props',  d.with_properties);
            set('cstat-new',    d.new_month);
            set('cstat-active', d.active);
        } catch (_) { /* the strip stays at — */ }
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
        els.grid.classList.remove('is-loading');
        const list = Array.isArray(clients) ? clients : [];

        if (list.length === 0) {
            els.grid.innerHTML = '<tr><td colspan="7" class="entity-empty">Nessun proprietario trovato.</td></tr>';
            return;
        }

        els.grid.innerHTML = list.map(c => {
            const initials  = ((c.name[0] || '') + (c.surname[0] || '')).toUpperCase();
            const checked   = selectedIds.has(c.id) ? 'checked' : '';
            // Stable per-owner accent, echoing the mockup's colored avatar circles.
            const accent    = ((c.id % 8) + 8) % 8;
            const contacts  = [
                c.email ? `<a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a>` : '',
                c.phone ? `<small>${escapeHtml(c.phone)}</small>` : '',
            ].filter(Boolean).join('') || '<small class="text-muted">Nessun contatto</small>';
            // Agente Ref. — assigned agent avatar + name, or an unassigned placeholder.
            const agentCell = c.agent_name
                ? `<div class="lt-agent">
                        <span class="lt-av lt-av--sm av-a${((Number(c.assigned_agent_id) % 8) + 8) % 8}">${escapeHtml(agentInitials(c.agent_name))}</span>
                        <span>${escapeHtml(c.agent_name)}</span>
                   </div>`
                : '<span class="text-muted lt-agent--none">Non assegnato</span>';
            return `
            <tr class="lt-row" data-id="${c.id}">
                <td class="lt-check"><input type="checkbox" class="client-checkbox" data-id="${c.id}" ${checked} title="Seleziona"></td>
                <td>
                    <div class="lt-who">
                        <span class="lt-av av-a${accent}">${escapeHtml(initials)}</span>
                        <div class="lt-who__txt">
                            <b>${escapeHtml(c.name)} ${escapeHtml(c.surname)}</b>
                            <small>${c.codice_fiscale ? 'CF: ' + escapeHtml(c.codice_fiscale) : '—'}</small>
                        </div>
                    </div>
                </td>
                <td class="lt-contacts">${contacts}</td>
                <td><span class="lt-count"><i data-lucide="building-2"></i>${Number(c.property_count) || 0}</span></td>
                <td><span class="badge badge--${c.status}">${STATUS_LABELS[c.status] || c.status}</span></td>
                <td>${agentCell}</td>
                <td class="lt-actions">
                    <button class="btn btn--sm btn--ghost btn-rail" data-id="${c.id}" title="Dettagli proprietario" aria-label="Apri dettaglio proprietario"><i data-lucide="more-vertical"></i></button>
                </td>
            </tr>`;
        }).join('');
        if (window.lucide) window.lucide.createIcons();

        els.grid.querySelectorAll('.client-checkbox').forEach(cb => {
            cb.addEventListener('change', () => {
                cb.checked ? selectedIds.add(+cb.dataset.id) : selectedIds.delete(+cb.dataset.id);
                updateBulkToolbar();
            });
        });


        // Row actions collapse to a single kebab (⋮) that opens the detail rail,
        // matching the proprietari.png mockup. Edit / comunicazioni / archivia /
        // stampa CI now live inside the rail's full profile ("Visualizza Completo").
        els.grid.querySelectorAll('.btn-rail').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openRail(Number(btn.dataset.id));
            });
        });

        els.grid.querySelectorAll('.lt-row').forEach(row => {
            row.addEventListener('click', (e) => {
                if (!e.target.closest('button, input, a')) {
                    openRail(Number(row.dataset.id));
                }
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
        if (!await confirmDialog(`Vuoi archiviare ${selectedIds.size} proprietari selezionati?`, { title: 'Archivia proprietari', confirmText: 'Archivia' })) return;
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

    function showModalError(message) {
        const el = document.getElementById('client-modal-error');
        if (!el) return;
        el.textContent = message;
        el.style.display = 'block';
    }

    function clearModalError() {
        const el = document.getElementById('client-modal-error');
        if (el) el.style.display = 'none';
    }

    function openModal(client = null) {
        els.form.reset();
        document.getElementById('client-id').value = '';
        editingClientId = null;
        clearModalError();
        document.getElementById('client-comm-section').hidden = true;
        document.getElementById('btn-owner-report').hidden = true;

        if (client) {
            editingClientId = client.id;
            document.getElementById('btn-owner-report').hidden = false;
            els.modalTitle.textContent = 'Modifica Proprietario';
            document.getElementById('client-id').value       = client.id;
            document.getElementById('client-name').value     = client.name;
            document.getElementById('client-surname').value  = client.surname;
            document.getElementById('client-cf').value       = client.codice_fiscale || '';
            document.getElementById('client-phone').value    = client.phone || '';
            document.getElementById('client-email').value    = client.email || '';
            document.getElementById('client-status').value   = client.status;
            document.querySelector('#client-status option[value="archived"]').hidden = false;
            document.getElementById('client-notes').value    = client.internal_notes || '';

            document.getElementById('client-comm-section').hidden = false;
            loadClientCommunications(client.id);
            document.getElementById('client-id-card-section').hidden = false;
            loadClientIdDocForModal(client.id);
        } else {
            els.modalTitle.textContent = 'Nuovo Proprietario';
            document.getElementById('client-status').value = 'active';
            document.querySelector('#client-status option[value="archived"]').hidden = true;
        }

        els.modal.hidden = false;
        document.getElementById('client-name').focus();
    }

    function closeModal() {
        els.modal.hidden = true;
        editingClientId = null;
        document.getElementById('client-id-card-section').hidden = true;
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
            codice_fiscale: document.getElementById('client-cf').value.trim().toUpperCase() || null,
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
            showModalError(err.message);
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

    // Initials for an agent's display name/username (e.g. "luca.rossi" -> "LR").
    function agentInitials(name) {
        const parts = String(name || '').split(/[.\s_@-]+/).filter(Boolean);
        const ini = ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
        return ini || (String(name || '')[0] || '?').toUpperCase();
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

    // -------------------------------------------------------------------------
    // ID card (carta di identità) for edit modal
    // -------------------------------------------------------------------------

    async function loadClientIdDocForModal(clientId) {
        const frontContainer = document.getElementById('client-id-front-status');
        const backContainer  = document.getElementById('client-id-back-status');
        if (!frontContainer && !backContainer) return;

        async function loadSide(container, docType, label, btnId) {
            if (!container) return;
            container.innerHTML = '<p class="text-muted" style="font-size:13px;margin:0;">Caricamento...</p>';
            try {
                const res  = await fetch(`api/documents.php?doc_type=${docType}&client_id=${clientId}&limit=1`);
                const json = await res.json();
                if (!json.success) throw new Error(json.error);
                const docs = json.data?.items || [];
                if (!docs.length) {
                    container.innerHTML = '<p class="text-muted" style="font-size:13px;margin:0;">Non caricato</p>';
                    return;
                }
                const doc = docs[0];
                container.innerHTML = `
                    <div class="id-card-row">
                        <span style="font-size:13px;"><i data-lucide="file-text"></i> ${escapeHtml(doc.original_name)}</span>
                        <a href="${escapeHtml(doc.download_url)}" target="_blank" class="btn btn--xs btn--ghost"><i data-lucide="printer"></i> Stampa</a>
                        <button type="button" class="btn btn--xs btn--ghost" data-del-id="${doc.id}" style="color:#b91c1c"><i data-lucide="trash-2"></i></button>
                    </div>`;
                container.querySelector('[data-del-id]')?.addEventListener('click', async () => {
                    if (!confirm('Rimuovere questo documento?')) return;
                    try {
                        const r = await fetch(`api/documents.php?id=${doc.id}`, { method: 'DELETE' });
                        const j = await r.json();
                        if (!j.success) throw new Error(j.error);
                        loadClientIdDocForModal(clientId);
                    } catch (err) { showAlert(err.message, 'error'); }
                });
            } catch (err) {
                if (container) container.innerHTML = `<p class="text-muted" style="font-size:13px;margin:0;">Errore</p>`;
            }
        }

        await Promise.all([
            loadSide(frontContainer, 'id_front', 'Fronte', 'btn-upload-id-front'),
            loadSide(backContainer,  'id_back',  'Retro',  'btn-upload-id-back'),
        ]);
    }

    async function uploadIdDocument(clientId, file, docType) {
        const btnId   = docType === 'id_front' ? 'btn-upload-id-front' : 'btn-upload-id-back';
        const btnLabel = docType === 'id_front' ? '<i data-lucide="upload"></i> Carica Fronte' : '<i data-lucide="upload"></i> Carica Retro';
        const title   = docType === 'id_front' ? 'CI - Fronte' : 'CI - Retro';
        const formData = new FormData();
        formData.append('file', file);
        formData.append('doc_type', docType);
        formData.append('client_id', clientId);
        formData.append('title', title);
        const btn = document.getElementById(btnId);
        if (btn) { btn.disabled = true; btn.textContent = 'Caricamento...'; }
        try {
            const res  = await fetch('api/documents.php', { method: 'POST', body: formData });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert('Documento caricato.', 'success');
            loadClientIdDocForModal(clientId);
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = btnLabel; window.lucide?.createIcons(); }
        }
    }

    async function loadAndPrintIdDoc(clientId) {
        try {
            const [frontRes, backRes] = await Promise.all([
                fetch(`api/documents.php?doc_type=id_front&client_id=${clientId}&limit=1`).then(r => r.json()),
                fetch(`api/documents.php?doc_type=id_back&client_id=${clientId}&limit=1`).then(r => r.json()),
            ]);
            const front = frontRes.data?.items?.[0] || null;
            const back  = backRes.data?.items?.[0] || null;
            if (!front && !back) {
                showAlert('Nessuna carta di identità caricata per questo proprietario.', 'error');
                return;
            }
            if (front) window.open(front.download_url, '_blank');
            if (back)  setTimeout(() => window.open(back.download_url, '_blank'), 300);
        } catch (_) {
            showAlert('Impossibile recuperare il documento.', 'error');
        }
    }

    // -------------------------------------------------------------------------
    // Copy to clipboard
    // -------------------------------------------------------------------------

    function copyToClipboard(text, btn) {
        const finish = () => {
            if (!btn) return;
            const orig = btn.textContent;
            btn.innerHTML = '<i data-lucide="check-circle"></i>';
            btn.classList.add('copied');
            setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
        };
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(finish).catch(finish);
        } else {
            const el = document.createElement('textarea');
            el.value = text;
            el.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(el);
            el.select();
            try { document.execCommand('copy'); } catch (_) {}
            document.body.removeChild(el);
            finish();
        }
    }

    init();
})();
