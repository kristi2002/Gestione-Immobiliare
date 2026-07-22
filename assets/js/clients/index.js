/**
 * Clients (Proprietari) — CRUD logic for Phase 2 (ES-module entry controller)
 */
import { API, COMM_API, REPORT_API, STATUS_LABELS, PAGE_LIMIT } from './constants.js';
import { escapeHtml, agentInitials, formatDateTime, truncate, parseCsv } from './helpers.js';

let importRows = [];

let clients       = [];
let deleteTargetId = null;
let searchTimer   = null;
let editingClientId = null;
let currentPage = 1;

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
    bindRowMenu();
    bindMessageModal();
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
        // Capture the id BEFORE closeRail() — it resets railClientId to null,
        // and reading it after produced clientId:null ("ID proprietario non
        // specificato" on the profile view).
        const id = railClientId;
        if (id && window.App) {
            closeRail();
            window.App.navigateTo('client_profile', { clientId: id });
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
                <button class="btn btn--sm btn--ghost btn-rail" data-id="${c.id}" title="Azioni" aria-label="Azioni proprietario" aria-haspopup="menu"><i data-lucide="more-vertical"></i></button>
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


    // Row kebab (⋮) opens the actions menu (Invia messaggio / Archivia /
    // Elimina); clicking anywhere else on the row opens the detail rail.
    els.grid.querySelectorAll('.btn-rail').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const c = clients.find(x => x.id === Number(btn.dataset.id));
            if (c) openRowMenu(btn, c);
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
        showAlert('Proprietario eliminato (spostato in archivio).', 'success');
        loadClients();
    } catch (err) {
        showAlert(err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

// -------------------------------------------------------------------------
// Row kebab menu (Invia messaggio / Archivia / Elimina)
// -------------------------------------------------------------------------

let rowMenuEl = null;

function bindRowMenu() {
    // The entry module re-runs on every visit to this view, so these
    // document/window listeners must self-remove once the view is gone
    // (same pattern as bindRail's Escape handler).
    const grid = els.grid;
    const gone = () => !document.body.contains(grid);
    function cleanup() {
        closeRowMenu();
        document.removeEventListener('click', onDocClick);
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('scroll', onAnyMove, true);
        window.removeEventListener('resize', onAnyMove);
    }
    function onDocClick(e) {
        if (gone()) { cleanup(); return; }
        if (rowMenuEl && !rowMenuEl.contains(e.target)) closeRowMenu();
    }
    function onKey(e) {
        if (gone()) { cleanup(); return; }
        if (e.key === 'Escape') closeRowMenu();
    }
    function onAnyMove() {
        if (gone()) { cleanup(); return; }
        closeRowMenu();
    }
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onAnyMove, true);
    window.addEventListener('resize', onAnyMove);
}

function closeRowMenu() {
    if (rowMenuEl) { rowMenuEl.remove(); rowMenuEl = null; }
}

function openRowMenu(btn, client) {
    // Second click on the same kebab toggles the menu closed.
    if (rowMenuEl && Number(rowMenuEl.dataset.id) === client.id) { closeRowMenu(); return; }
    closeRowMenu();

    const menu = document.createElement('div');
    menu.className = 'lt-menu';
    menu.dataset.id = client.id;
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `
        <button type="button" class="lt-menu__item" data-act="message" role="menuitem">
            <i data-lucide="mail"></i> Invia messaggio
        </button>
        <button type="button" class="lt-menu__item" data-act="archive" role="menuitem" disabled title="Funzione in arrivo">
            <i data-lucide="archive"></i> Archivia
        </button>
        <div class="lt-menu__sep"></div>
        <button type="button" class="lt-menu__item lt-menu__item--danger" data-act="delete" role="menuitem">
            <i data-lucide="trash-2"></i> Elimina
        </button>`;
    document.body.appendChild(menu);

    // Fixed positioning: right-aligned to the kebab, flipped above when the
    // menu would overflow the viewport bottom.
    const r  = btn.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let left = Math.min(r.right - mw, window.innerWidth - mw - 8);
    let top  = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = r.top - mh - 6;
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top  = Math.max(8, top) + 'px';

    menu.querySelector('[data-act="message"]').addEventListener('click', () => {
        closeRowMenu();
        openMessageModal(client);
    });
    menu.querySelector('[data-act="delete"]').addEventListener('click', () => {
        closeRowMenu();
        openDeleteModal(client.id, `${client.name} ${client.surname}`);
    });

    if (window.lucide) window.lucide.createIcons();
    rowMenuEl = menu;
}

// -------------------------------------------------------------------------
// Invia messaggio — real email via api/communications.php, with the email
// templates registered in Impostazioni (placeholders pre-filled and left
// editable so the agent can adjust before sending).
// -------------------------------------------------------------------------

let messageClient  = null;
let emailTemplates = null; // lazy cache; null = not fetched yet

function bindMessageModal() {
    const modal = document.getElementById('message-modal');
    document.getElementById('message-modal-close').addEventListener('click', closeMessageModal);
    document.getElementById('message-cancel').addEventListener('click', closeMessageModal);
    document.getElementById('message-send').addEventListener('click', sendMessage);
    document.getElementById('message-template').addEventListener('change', applyMessageTemplate);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeMessageModal(); });

    // Sezione "Allega documenti"
    document.getElementById('attach-property').addEventListener('change', loadAttachableDocs);
    document.getElementById('attach-document').addEventListener('change', updateAttachAddState);
    document.getElementById('attach-add').addEventListener('click', addAttachment);
    document.querySelectorAll('#attach-section .attach-toggle').forEach(t =>
        t.addEventListener('click', () => {
            t.classList.toggle('is-active');
            t.setAttribute('aria-pressed', String(t.classList.contains('is-active')));
            loadAttachableDocs();
        }));
}

async function openMessageModal(client) {
    messageClient = client;
    const modal = document.getElementById('message-modal');

    clearMessageError();
    document.getElementById('message-subject').value  = '';
    document.getElementById('message-body').value     = '';
    document.getElementById('message-template').value = '';
    document.getElementById('message-recipient').innerHTML =
        `Destinatario: <strong>${escapeHtml(client.name)} ${escapeHtml(client.surname)}</strong>` +
        (client.email ? ` — ${escapeHtml(client.email)}` : '');

    const noEmail = !client.email;
    document.getElementById('message-send').disabled = noEmail;
    if (noEmail) showMessageError('Questo proprietario non ha un indirizzo email registrato.');

    resetAttachments();

    modal.hidden = false;
    if (window.lucide) window.lucide.createIcons();
    document.getElementById('message-subject').focus();

    await Promise.all([ensureEmailTemplates(), loadAttachProperties(client)]);
}

function closeMessageModal() {
    document.getElementById('message-modal').hidden = true;
    messageClient = null;
    resetAttachments();
}

async function ensureEmailTemplates() {
    const group  = document.getElementById('message-template-group');
    const select = document.getElementById('message-template');
    if (emailTemplates !== null) {
        group.hidden = emailTemplates.length === 0;
        return;
    }
    try {
        const res  = await fetch('api/email_templates.php?active=1&limit=200');
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        emailTemplates = json.data?.items || json.data || [];
    } catch (_) {
        emailTemplates = [];
    }
    if (!emailTemplates.length) { group.hidden = true; return; }

    const CAT = {
        benvenuto: 'Benvenuto', scadenza_affitto: 'Scad. affitto',
        scadenza_contratto: 'Scad. contratto', promemoria: 'Promemoria',
        richiesta_documento: 'Richiesta doc.', generico: 'Generico',
    };
    group.hidden = false;
    select.innerHTML = '<option value="">— Nessun template —</option>' +
        emailTemplates.map(t =>
            `<option value="${t.id}">${escapeHtml(t.name)} (${escapeHtml(CAT[t.category] || t.category)})</option>`
        ).join('');
}

function fillTemplateVars(text) {
    const c   = messageClient || {};
    const now = new Date();
    const full = `${c.name || ''} ${c.surname || ''}`.trim();
    const vars = {
        nome:          c.name || '',
        cognome:       c.surname || '',
        nome_completo: full,
        proprietario:  full,
        email:         c.email || '',
        telefono:      c.phone || '',
        mese:          now.toLocaleDateString('it-IT', { month: 'long' }),
        anno:          String(now.getFullYear()),
        data:          now.toLocaleDateString('it-IT'),
        data_oggi:     now.toLocaleDateString('it-IT'),
    };
    // Known placeholders are filled with the owner's data; unknown ones
    // ({{indirizzo}}, {{canone}}, …) stay visible so the agent adjusts them.
    return String(text || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (m, k) => {
        const key = k.toLowerCase();
        return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : m;
    });
}

function applyMessageTemplate() {
    const id  = Number(document.getElementById('message-template').value);
    const tpl = id ? (emailTemplates || []).find(t => Number(t.id) === id) : null;
    if (!tpl) return;
    document.getElementById('message-subject').value = fillTemplateVars(tpl.subject);
    document.getElementById('message-body').value    = fillTemplateVars(tpl.body);
    clearMessageError();
}

function showMessageError(message) {
    const el = document.getElementById('message-modal-error');
    el.textContent = message;
    el.style.display = 'block';
}

function clearMessageError() {
    document.getElementById('message-modal-error').style.display = 'none';
}

// -------------------------------------------------------------------------
// Allega documenti — filtri D/F/C/P, select immobile→documento, chips.
// I file vivono tutti nella tabella `documents`, quindi il valore inviato
// è il solo id (input hidden name="allegati[]" dentro ogni chip).
// -------------------------------------------------------------------------

const ATTACH_MAX_BYTES = 20 * 1024 * 1024; // deve combaciare col limite server (20 MB)
const ATTACH_CAT_NAMES = { D: 'Documenti', F: 'Fatture', C: 'Contratti', P: 'Preventivi' };

let attachSelected = new Map(); // docId → {id, tipo, nome_file, dimensione}
let attachDocs     = [];        // documenti attualmente proposti nella select

function resetAttachments() {
    attachSelected.clear();
    attachDocs = [];
    document.querySelectorAll('#attach-section .attach-toggle').forEach(t => {
        t.classList.add('is-active');
        t.setAttribute('aria-pressed', 'true');
    });
    document.getElementById('attach-property').innerHTML = '<option value="">— Immobile —</option>';
    const docSel = document.getElementById('attach-document');
    docSel.innerHTML = '<option value="">— Prima scegli l\'immobile —</option>';
    docSel.disabled = true;
    document.getElementById('attach-add').disabled = true;
    renderAttachChips();
}

// La select Immobile propone SOLO gli immobili del destinatario, più la voce
// "senza immobile" per i documenti collegati direttamente al proprietario.
async function loadAttachProperties(client) {
    const sel = document.getElementById('attach-property');
    const baseOptions = '<option value="">— Immobile —</option>' +
        '<option value="0">Documenti del proprietario (senza immobile)</option>';
    sel.innerHTML = baseOptions;
    try {
        const res  = await fetch(`api/properties.php?client_id=${client.id}&limit=200`);
        const json = await res.json();
        if (!messageClient || messageClient.id !== client.id) return; // modal cambiata nel frattempo
        const items = json.success ? (json.data.items || json.data || []) : [];
        sel.innerHTML = baseOptions + items.map(p =>
            `<option value="${p.id}">${escapeHtml(p.address || '')}${p.city ? ', ' + escapeHtml(p.city) : ''}</option>`
        ).join('');
    } catch (_) { /* restano le voci base */ }
}

async function loadAttachableDocs() {
    const propSel = document.getElementById('attach-property');
    const docSel  = document.getElementById('attach-document');
    const propVal = propSel.value;

    const setPlaceholder = (text) => {
        attachDocs = [];
        docSel.innerHTML = `<option value="">${escapeHtml(text)}</option>`;
        docSel.disabled = true;
        updateAttachAddState();
    };

    if (!messageClient || propVal === '') { setPlaceholder('— Prima scegli l\'immobile —'); return; }

    const cats = [...document.querySelectorAll('#attach-section .attach-toggle.is-active')]
        .map(t => t.dataset.cat);
    if (!cats.length) { setPlaceholder('Nessuna categoria selezionata'); return; }

    docSel.disabled = true;
    docSel.innerHTML = '<option value="">Caricamento…</option>';
    try {
        const res  = await fetch(`api/get_attachable_documents.php?client_id=${messageClient.id}` +
            `&property_id=${propVal}&categories=${cats.join(',')}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        if (propSel.value !== propVal) return; // risposta ormai vecchia
        attachDocs = json.data.items || [];
        if (!attachDocs.length) { setPlaceholder('Nessun documento per i filtri selezionati'); return; }
        docSel.innerHTML = '<option value="">— Documento —</option>' + attachDocs.map(d =>
            `<option value="${d.id}">[${d.tipo}] ${escapeHtml(d.nome_file)}</option>`).join('');
        docSel.disabled = false;
    } catch (err) {
        setPlaceholder(err.message || 'Errore di caricamento');
        return;
    }
    updateAttachAddState();
}

// "Aggiungi" abilitato solo con immobile E documento selezionati.
function updateAttachAddState() {
    const propOk = document.getElementById('attach-property').value !== '';
    const docOk  = document.getElementById('attach-document').value !== '';
    document.getElementById('attach-add').disabled = !(propOk && docOk);
}

function addAttachment() {
    const docSel = document.getElementById('attach-document');
    const id = Number(docSel.value);
    if (!id) return;

    // Niente duplicati: evidenzia la chip esistente invece di aggiungerla.
    if (attachSelected.has(id)) { flashChip(id); return; }

    const doc = attachDocs.find(d => d.id === id);
    if (!doc) return;

    const total = [...attachSelected.values()].reduce((s, d) => s + (d.dimensione || 0), 0)
        + (doc.dimensione || 0);
    if (total > ATTACH_MAX_BYTES) {
        showMessageError(`Limite allegati superato: il totale (${formatAttachSize(total)}) eccede i 20 MB. Rimuovi qualche documento.`);
        return;
    }

    if (messageClient?.email) clearMessageError(); // non coprire l'avviso "nessuna email"
    attachSelected.set(id, doc);
    renderAttachChips();
    // La riga resta com'è: si può cambiare immobile e continuare ad aggiungere.
}

function renderAttachChips() {
    const box  = document.getElementById('attach-chips-box');
    const wrap = document.getElementById('attach-chips');
    const n = attachSelected.size;
    document.getElementById('attach-count').textContent = n;
    box.hidden = n === 0;
    wrap.innerHTML = [...attachSelected.values()].map(d => `
        <span class="attach-chip" data-id="${d.id}">
            <span class="attach-chip__dot attach-chip__dot--${d.tipo.toLowerCase()}" title="${ATTACH_CAT_NAMES[d.tipo] || d.tipo}">${d.tipo}</span>
            <span class="attach-chip__name" title="${escapeHtml(d.nome_file)}">${escapeHtml(d.nome_file)}</span>
            <button type="button" class="attach-chip__x" data-remove="${d.id}" aria-label="Rimuovi allegato">&times;</button>
            <input type="hidden" name="allegati[]" value="${d.id}">
        </span>`).join('');
    wrap.querySelectorAll('[data-remove]').forEach(b =>
        b.addEventListener('click', () => {
            attachSelected.delete(Number(b.dataset.remove));
            renderAttachChips();
        }));
    updateSendButtonLabel();
}

function flashChip(id) {
    const chip = document.querySelector(`#attach-chips .attach-chip[data-id="${id}"]`);
    if (!chip) return;
    chip.classList.remove('attach-chip--flash');
    void chip.offsetWidth; // forza il reflow per riavviare l'animazione
    chip.classList.add('attach-chip--flash');
}

function updateSendButtonLabel() {
    const label = document.getElementById('message-send-label');
    if (!label) return;
    const n = attachSelected.size;
    label.textContent = n ? `Invia (${n} allegat${n === 1 ? 'o' : 'i'})` : 'Invia email';
}

function formatAttachSize(bytes) {
    return bytes >= 1048576
        ? (bytes / 1048576).toLocaleString('it-IT', { maximumFractionDigits: 1 }) + ' MB'
        : Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

async function sendMessage() {
    if (!messageClient) return;
    const subject = document.getElementById('message-subject').value.trim();
    const body    = document.getElementById('message-body').value.trim();
    if (!body) { showMessageError('Il testo del messaggio è obbligatorio.'); return; }

    // Gli id degli allegati vengono letti dagli input hidden delle chips.
    const attachments = [...document.querySelectorAll('#attach-chips input[name="allegati[]"]')]
        .map(i => Number(i.value)).filter(Boolean);

    const btn  = document.getElementById('message-send');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Invio…';

    try {
        const res  = await fetch(COMM_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: messageClient.id,
                channel:   'email',
                direction: 'sent',
                subject:   subject || null,
                body,
                attachments,
            }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Invio fallito.');
        const name = `${messageClient.name} ${messageClient.surname}`;
        const attInfo = attachments.length
            ? ` con ${attachments.length} allegat${attachments.length === 1 ? 'o' : 'i'}`
            : '';
        closeMessageModal();
        showAlert(`Messaggio inviato a ${name}${attInfo}.`, 'success');
    } catch (err) {
        showMessageError(err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
        if (window.lucide) window.lucide.createIcons();
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
