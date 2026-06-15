/**
 * Clients (Proprietari) — CRUD logic for Phase 2
 */
(function () {
    'use strict';

    const API = 'api/clients.php';
    const COMM_API = 'api/communications.php';

    const STATUS_LABELS = {
        active:   'Attivo',
        inactive: 'Inattivo',
        archived: 'Archiviato',
    };

    let clients       = [];
    let deleteTargetId = null;
    let searchTimer   = null;
    let editingClientId = null;

    // DOM refs — populated on init
    const els = {};

    function init() {
        els.tbody        = document.getElementById('clients-tbody');
        els.search       = document.getElementById('client-search');
        els.statusFilter = document.getElementById('client-status-filter');
        els.alert        = document.getElementById('clients-alert');
        els.modal        = document.getElementById('client-modal');
        els.deleteModal  = document.getElementById('delete-modal');
        els.form         = document.getElementById('client-form');
        els.modalTitle   = document.getElementById('modal-title');

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
            searchTimer = setTimeout(loadClients, 300);
        });

        els.statusFilter.addEventListener('change', loadClients);

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

        const url = params.toString() ? `${API}?${params}` : API;

        els.tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Caricamento...</td></tr>';

        try {
            const res  = await fetch(url);
            const json = await res.json();

            if (!json.success) throw new Error(json.error);

            clients = json.data;
            renderTable();
        } catch (err) {
            els.tbody.innerHTML = `<tr><td colspan="8" class="table-empty table-empty--error">${escapeHtml(err.message)}</td></tr>`;
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

    function renderTable() {
        if (clients.length === 0) {
            els.tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Nessun proprietario trovato.</td></tr>';
            return;
        }

        els.tbody.innerHTML = clients.map(c => `
            <tr>
                <td data-label="Nome">${escapeHtml(c.name)}</td>
                <td data-label="Cognome">${escapeHtml(c.surname)}</td>
                <td data-label="Telefono">${c.phone ? escapeHtml(c.phone) : '<span class="text-muted">—</span>'}</td>
                <td data-label="Email">${c.email ? `<a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a>` : '<span class="text-muted">—</span>'}</td>
                <td data-label="Stato"><span class="badge badge--${c.status}">${STATUS_LABELS[c.status] || c.status}</span></td>
                <td data-label="Immobili">${c.property_count}</td>
                <td data-label="Data creazione">${formatDate(c.creation_date)}</td>
                <td class="col-actions" data-label="Azioni">
                    <button class="btn btn--sm btn--ghost btn-comm" data-id="${c.id}" title="Comunicazioni">✉️</button>
                    <button class="btn btn--sm btn--ghost btn-edit" data-id="${c.id}" title="Modifica">✏️</button>
                    <button class="btn btn--sm btn--ghost btn-delete" data-id="${c.id}" title="Archivia">🗑️</button>
                </td>
            </tr>
        `).join('');

        els.tbody.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', () => {
                const client = clients.find(c => c.id == btn.dataset.id);
                if (client) openModal(client);
            });
        });

        els.tbody.querySelectorAll('.btn-comm').forEach(btn => {
            btn.addEventListener('click', () => {
                if (window.App) {
                    window.App.navigateTo('communications', { clientId: Number(btn.dataset.id) });
                }
            });
        });

        els.tbody.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', () => {
                const client = clients.find(c => c.id == btn.dataset.id);
                if (client) openDeleteModal(client.id, `${client.name} ${client.surname}`);
            });
        });
    }

    // -------------------------------------------------------------------------
    // Modal
    // -------------------------------------------------------------------------

    function openModal(client = null) {
        els.form.reset();
        document.getElementById('client-id').value = '';
        editingClientId = null;
        document.getElementById('client-comm-section').hidden = true;

        if (client) {
            editingClientId = client.id;
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
        div.textContent = str;
        return div.innerHTML;
    }

    init();
})();
