/**
 * Reminders (Promemoria) — CRUD + email automation (Phase 6)
 */
(function () {
    'use strict';

    const API            = 'api/reminders.php';
    const PROCESS_API    = 'api/process_reminders.php';
    const CLIENTS_API    = 'api/clients.php';
    const PROPERTIES_API = 'api/properties.php';

    const STATUS_LABELS = {
        pending:   'In sospeso',
        completed: 'Completato',
        cancelled: 'Annullato',
    };

    const FREQUENCY_LABELS = {
        once:    'Una tantum',
        weekly:  'Settimanale',
        monthly: 'Mensile',
        yearly:  'Annuale',
    };

    let reminders  = [];
    let clients    = [];
    let properties = [];
    let searchTimer = null;
    let currentPage = 1;
    const PAGE_LIMIT = 25;

    const els = {};

    function init() {
        els.tbody          = document.getElementById('reminders-tbody');
        els.search         = document.getElementById('reminder-search');
        els.statusFilter   = document.getElementById('reminder-status-filter');
        els.frequencyFilter = document.getElementById('reminder-frequency-filter');
        els.dueFilter      = document.getElementById('reminder-due-filter');
        els.alert          = document.getElementById('reminders-alert');
        els.modal          = document.getElementById('reminder-modal');
        els.form           = document.getElementById('reminder-form');
        els.modalTitle     = document.getElementById('reminder-modal-title');
        els.clientSelect   = document.getElementById('reminder-client');
        els.propertySelect = document.getElementById('reminder-property');
        els.notifyClient   = document.getElementById('reminder-notify-client');
        els.clientEmailFields = document.getElementById('client-email-fields');
        els.pagination        = document.getElementById('reminders-pagination');

        bindEvents();
        loadClients()
            .then(() => loadProperties())
            .then(() => loadReminders())
            .catch(err => {
                if (!els.alert?.isConnected) return;
                showAlert('Errore inizializzazione: ' + err.message, 'error');
            });
    }

    function bindEvents() {
        document.getElementById('btn-new-reminder').addEventListener('click', () => openModal());
        document.getElementById('btn-process-reminders').addEventListener('click', processDueReminders);
        document.getElementById('reminder-modal-close').addEventListener('click', closeModal);
        document.getElementById('reminder-modal-cancel').addEventListener('click', closeModal);

        els.form.addEventListener('submit', handleFormSubmit);
        els.notifyClient.addEventListener('change', toggleClientEmailFields);
        els.clientSelect.addEventListener('change', () => updatePropertySelect(els.clientSelect.value));

        els.search.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => { currentPage = 1; loadReminders(); }, 300);
        });

        [els.statusFilter, els.frequencyFilter, els.dueFilter].forEach(el => {
            el.addEventListener('change', () => { currentPage = 1; loadReminders(); });
        });

        els.modal.addEventListener('click', (e) => {
            if (e.target === els.modal) closeModal();
        });
    }

    function toggleClientEmailFields() {
        els.clientEmailFields.hidden = !els.notifyClient.checked;
    }

    // -------------------------------------------------------------------------
    // Reference data
    // -------------------------------------------------------------------------

    async function loadClients() {
        clients = await Pagination.fetchList(CLIENTS_API, { status: 'active' });
        const opts = clients.map(c =>
            `<option value="${c.id}">${escapeHtml(c.surname)} ${escapeHtml(c.name)}</option>`
        ).join('');
        els.clientSelect.innerHTML = '<option value="">— Nessuno —</option>' + opts;
    }

    async function loadProperties() {
        properties = await Pagination.fetchList(PROPERTIES_API);
        updatePropertySelect(els.clientSelect.value);
    }

    function updatePropertySelect(clientId) {
        const filtered = clientId
            ? properties.filter(p => p.client_id == clientId)
            : properties;

        const opts = filtered.map(p =>
            `<option value="${p.id}">${escapeHtml(p.address)}, ${escapeHtml(p.city)}</option>`
        ).join('');

        const prev = els.propertySelect.value;
        els.propertySelect.innerHTML = '<option value="">— Nessuno —</option>' + opts;
        if (prev && filtered.some(p => p.id == prev)) {
            els.propertySelect.value = prev;
        }
    }

    // -------------------------------------------------------------------------
    // Reminders list
    // -------------------------------------------------------------------------

    async function loadReminders() {
        const params = new URLSearchParams();
        const search    = els.search.value.trim();
        const status    = els.statusFilter.value;
        const frequency = els.frequencyFilter.value;
        const dueSoon   = els.dueFilter.value;

        if (search)    params.set('search', search);
        if (status)    params.set('status', status);
        if (frequency) params.set('frequency', frequency);
        if (dueSoon)   params.set('due_soon', dueSoon);
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);

        const url = `${API}?${params}`;
        els.tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Caricamento...</td></tr>';

        try {
            const res  = await fetch(url);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const parsed = Pagination.parseResponse(json);
            reminders = parsed.items;
            renderTable();
            Pagination.render(els.pagination, parsed, (p) => { currentPage = p; loadReminders(); });
        } catch (err) {
            els.tbody.innerHTML = `<tr><td colspan="7" class="table-empty table-empty--error">${escapeHtml(err.message)}</td></tr>`;
        }
    }

    function renderTable() {
        if (reminders.length === 0) {
            els.tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Nessun promemoria trovato.</td></tr>';
            return;
        }

        const now = Date.now();

        els.tbody.innerHTML = reminders.map(r => {
            const dueDate   = new Date(r.reminder_date);
            const isOverdue = r.status === 'pending' && dueDate.getTime() < now;
            const isSoon    = r.status === 'pending' && !isOverdue &&
                              (dueDate.getTime() - now) < 7 * 86400000;

            let dateClass = '';
            if (isOverdue) dateClass = 'reminder-date--overdue';
            else if (isSoon) dateClass = 'reminder-date--soon';

            const clientLabel = r.client_id
                ? `${r.client_surname} ${r.client_name}`
                : null;

            const notifyIcons = [
                r.notify_admin  ? '<span title="Notifica admin">🔔</span>' : '',
                r.notify_client ? '<span title="Email proprietario">✉️</span>' : '',
            ].filter(Boolean).join(' ') || '<span class="text-muted">—</span>';

            const actions = r.status === 'pending'
                ? `<button class="btn btn--sm btn--ghost btn-complete" data-id="${r.id}" title="Completa">✓</button>
                   <button class="btn btn--sm btn--ghost btn-edit" data-id="${r.id}" title="Modifica">✏️</button>
                   <button class="btn btn--sm btn--ghost btn-cancel" data-id="${r.id}" title="Annulla">✕</button>`
                : `<button class="btn btn--sm btn--ghost btn-edit" data-id="${r.id}" title="Modifica">✏️</button>
                   ${r.status === 'cancelled' ? `<button class="btn btn--sm btn--ghost btn-reopen" data-id="${r.id}" title="Riapri">↩</button>` : ''}`;

            return `
                <tr class="${isOverdue ? 'row--overdue' : ''}">
                    <td data-label="Titolo">
                        <strong>${escapeHtml(r.title)}</strong>
                        ${r.description ? `<br><small class="text-muted">${escapeHtml(truncate(r.description, 50))}</small>` : ''}
                    </td>
                    <td data-label="Data scadenza"><span class="${dateClass}">${formatDateTime(r.reminder_date)}</span></td>
                    <td data-label="Frequenza">${FREQUENCY_LABELS[r.frequency] || r.frequency}</td>
                    <td data-label="Stato"><span class="badge badge--reminder-${r.status}">${STATUS_LABELS[r.status]}</span></td>
                    <td data-label="Proprietario">${clientLabel ? escapeHtml(clientLabel) : '<span class="text-muted">—</span>'}</td>
                    <td class="reminder-notify-icons" data-label="Notifiche">${notifyIcons}</td>
                    <td class="col-actions" data-label="Azioni">${actions}</td>
                </tr>`;
        }).join('');

        bindTableActions();
    }

    function bindTableActions() {
        els.tbody.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', () => {
                const r = reminders.find(x => x.id == btn.dataset.id);
                if (r) openModal(r);
            });
        });

        els.tbody.querySelectorAll('.btn-complete').forEach(btn => {
            btn.addEventListener('click', () => patchReminder(btn.dataset.id, 'complete'));
        });

        els.tbody.querySelectorAll('.btn-cancel').forEach(btn => {
            btn.addEventListener('click', () => {
                if (confirm('Annullare questo promemoria?')) {
                    patchReminder(btn.dataset.id, 'cancel');
                }
            });
        });

        els.tbody.querySelectorAll('.btn-reopen').forEach(btn => {
            btn.addEventListener('click', () => patchReminder(btn.dataset.id, 'reopen'));
        });
    }

    // -------------------------------------------------------------------------
    // Modal
    // -------------------------------------------------------------------------

    function openModal(reminder = null) {
        els.form.reset();
        document.getElementById('reminder-id').value = '';
        document.getElementById('reminder-notify-admin').checked = true;
        els.clientEmailFields.hidden = true;

        if (reminder) {
            els.modalTitle.textContent = 'Modifica Promemoria';
            document.getElementById('reminder-id').value            = reminder.id;
            document.getElementById('reminder-title').value         = reminder.title;
            document.getElementById('reminder-description').value   = reminder.description || '';
            document.getElementById('reminder-date').value          = toDatetimeLocal(reminder.reminder_date);
            document.getElementById('reminder-frequency').value     = reminder.frequency;
            document.getElementById('reminder-status').value        = reminder.status;
            document.getElementById('reminder-client').value        = reminder.client_id || '';
            updatePropertySelect(reminder.client_id || '');
            document.getElementById('reminder-property').value      = reminder.property_id || '';
            document.getElementById('reminder-notify-admin').checked  = !!Number(reminder.notify_admin);
            document.getElementById('reminder-notify-client').checked = !!Number(reminder.notify_client);
            document.getElementById('reminder-email-subject').value   = reminder.email_subject || '';
            document.getElementById('reminder-email-body').value      = reminder.email_body || '';
            toggleClientEmailFields();
        } else {
            els.modalTitle.textContent = 'Nuovo Promemoria';
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(9, 0, 0, 0);
            document.getElementById('reminder-date').value = toDatetimeLocal(tomorrow.toISOString());
        }

        els.modal.hidden = false;
        document.getElementById('reminder-title').focus();
    }

    function closeModal() {
        els.modal.hidden = true;
    }

    async function handleFormSubmit(e) {
        e.preventDefault();

        const id   = document.getElementById('reminder-id').value;
        const data = {
            title:          document.getElementById('reminder-title').value.trim(),
            description:    document.getElementById('reminder-description').value.trim(),
            reminder_date:  document.getElementById('reminder-date').value,
            frequency:      document.getElementById('reminder-frequency').value,
            status:         document.getElementById('reminder-status').value,
            client_id:      document.getElementById('reminder-client').value || null,
            property_id:    document.getElementById('reminder-property').value || null,
            notify_admin:   document.getElementById('reminder-notify-admin').checked,
            notify_client:  document.getElementById('reminder-notify-client').checked,
            email_subject:  document.getElementById('reminder-email-subject').value.trim(),
            email_body:     document.getElementById('reminder-email-body').value.trim(),
        };

        const btn = document.getElementById('reminder-modal-save');
        btn.disabled = true;
        btn.textContent = 'Salvataggio...';

        try {
            await saveReminder(data, id || null);
            closeModal();
            showAlert('Promemoria salvato.', 'success');
            loadReminders();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Salva';
        }
    }

    async function saveReminder(data, id) {
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

    async function patchReminder(id, action) {
        try {
            const res  = await fetch(`${API}?id=${id}&action=${action}`, { method: 'PATCH' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            showAlert('Promemoria aggiornato.', 'success');
            loadReminders();
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    async function processDueReminders() {
        const btn = document.getElementById('btn-process-reminders');
        btn.disabled = true;
        btn.textContent = 'Elaborazione...';

        try {
            const res  = await fetch(PROCESS_API, { method: 'POST' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const count = json.data.processed;
            showAlert(
                count > 0
                    ? `Elaborati ${count} promemoria scaduti.`
                    : 'Nessun promemoria scaduto da elaborare.',
                'success'
            );
            loadReminders();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '⚡ Elabora scaduti';
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
