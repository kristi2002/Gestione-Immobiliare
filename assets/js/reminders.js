/**
 * Reminders (Promemoria) — CRUD + email automation (Phase 6, rivisto phase65)
 *
 * Il form parte da quello che l'agente ha in testa — "cosa devo fare, quando,
 * per chi" — invece che dalle tabelle del database:
 *  - un solo campo "Contatto" su tutta la rubrica (proprietari, lead, inquilini)
 *    al posto della sola select dei proprietari;
 *  - il proprietario si deduce dall'immobile, non si ridigita;
 *  - titoli rapidi, perché questa roba si compila dal telefono fra due visite;
 *  - "Assegnato a", perché chi compila di solito non è chi esegue.
 */
(function () {
    'use strict';

    const API            = 'api/reminders.php';
    const PROCESS_API    = 'api/process_reminders.php';
    const PROPERTIES_API = 'api/properties.php';

    const STATUS_LABELS = {
        pending:   'In sospeso',
        completed: 'Completato',
        cancelled: 'Annullato',
    };

    const FREQUENCY_LABELS = {
        once:      'Una tantum',
        weekly:    'Settimanale',
        biweekly:  'Quindicinale',
        monthly:   'Mensile',
        quarterly: 'Trimestrale',
        yearly:    'Annuale',
    };

    const CONTACT_LABELS = {
        client: 'Proprietario',
        lead:   'Lead',
        tenant: 'Inquilino',
    };

    let reminders  = [];
    let properties = [];
    let searchTimer = null;
    let currentPage = 1;
    const PAGE_LIMIT = 25;

    /** etichetta visibile -> { type, id } — risolve ciò che l'agente digita. */
    const contactsByLabel = new Map();
    /** "type:id" -> etichetta — riempie il campo in modifica. */
    const contactsByKey   = new Map();
    /** property id -> { ownerId, ownerLabel, address, city } */
    const propertyIndex   = new Map();

    const els = {};

    function init() {
        els.tbody          = document.getElementById('reminders-tbody');
        els.search         = document.getElementById('reminder-search');
        els.statusFilter   = document.getElementById('reminder-status-filter');
        els.frequencyFilter = document.getElementById('reminder-frequency-filter');
        els.dueFilter      = document.getElementById('reminder-due-filter');
        els.agentFilter    = document.getElementById('reminder-agent-filter');
        els.alert          = document.getElementById('reminders-alert');
        els.modal          = document.getElementById('reminder-modal');
        els.form           = document.getElementById('reminder-form');
        els.modalTitle     = document.getElementById('reminder-modal-title');
        els.propertySelect = document.getElementById('reminder-property');
        els.contactInput   = document.getElementById('reminder-contact');
        els.contactList    = document.getElementById('reminder-contact-options');
        els.contactType    = document.getElementById('reminder-contact-type');
        els.contactId      = document.getElementById('reminder-contact-id');
        els.contactHint    = document.getElementById('reminder-contact-hint');
        els.agentSelect    = document.getElementById('reminder-agent');
        els.frequency      = document.getElementById('reminder-frequency');
        els.endWrap        = document.getElementById('reminder-end-wrap');
        els.endDate        = document.getElementById('reminder-end');
        els.seriesHint     = document.getElementById('reminder-series-hint');
        els.notifyClient   = document.getElementById('reminder-notify-client');
        els.notifyWarning  = document.getElementById('reminder-notify-warning');
        els.clientEmailFields = document.getElementById('client-email-fields');
        els.pagination        = document.getElementById('reminders-pagination');

        bindEvents();
        bindRowMenu();
        Promise.all([loadContacts(), loadProperties(), loadAgents()])
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
        els.propertySelect.addEventListener('change', onPropertyChange);
        els.contactInput.addEventListener('input', resolveContact);
        els.contactInput.addEventListener('change', resolveContact);
        els.frequency.addEventListener('change', refreshFrequencyFields);

        document.querySelectorAll('#reminder-title-chips .rem-chip').forEach(chip => {
            chip.addEventListener('click', () => applyQuickTitle(chip.dataset.title));
        });

        els.search.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => { currentPage = 1; loadReminders(); }, 300);
        });

        [els.statusFilter, els.frequencyFilter, els.dueFilter, els.agentFilter].forEach(el => {
            el.addEventListener('change', () => { currentPage = 1; loadReminders(); });
        });

        els.modal.addEventListener('click', (e) => {
            if (e.target === els.modal) closeModal();
        });
    }

    function toggleClientEmailFields() {
        els.clientEmailFields.hidden = !els.notifyClient.checked;
        refreshNotifyWarning();
    }

    /**
     * Il motore scrive al contatto del promemoria. Senza contatto non c'è
     * indirizzo, e la spunta resterebbe una promessa non mantenuta: meglio
     * dirlo mentre si compila che scoprirlo dal log del cron.
     */
    function refreshNotifyWarning() {
        if (!els.notifyWarning) return;
        const show = els.notifyClient.checked && !els.contactId.value;
        els.notifyWarning.textContent = show
            ? 'Nessuna email verrà inviata: scegli prima un contatto a cui scrivere.'
            : '';
        els.notifyWarning.hidden = !show;
    }

    // -------------------------------------------------------------------------
    // Reference data
    // -------------------------------------------------------------------------

    /** Rubrica unificata: una sola richiesta, tre tabelle già etichettate. */
    async function loadContacts() {
        const json = await fetch(`${API}?action=contacts`).then(r => r.json());
        if (!json.success) throw new Error(json.error);

        contactsByLabel.clear();
        contactsByKey.clear();

        const options = (json.data || []).map(c => {
            const person = `${c.surname || ''} ${c.name || ''}`.trim();
            let label = `${person} · ${CONTACT_LABELS[c.contact_type] || c.contact_type}`;

            // Le etichette sono la chiave con cui il datalist risolve la scelta:
            // due omonimi nello stesso ruolo si annullerebbero a vicenda.
            if (contactsByLabel.has(label)) {
                label += c.email ? ` · ${c.email}` : ` · #${c.id}`;
            }
            if (contactsByLabel.has(label)) {
                label += ` · #${c.id}`;
            }

            const entry = { type: c.contact_type, id: String(c.id), label };
            contactsByLabel.set(label, entry);
            contactsByKey.set(`${c.contact_type}:${c.id}`, label);
            return `<option value="${escAttr(label)}"></option>`;
        }).join('');

        els.contactList.innerHTML = options;
    }

    async function loadProperties() {
        properties = await Pagination.fetchList(PROPERTIES_API);

        propertyIndex.clear();
        properties.forEach(p => propertyIndex.set(String(p.id), {
            ownerId:    p.client_id ? String(p.client_id) : '',
            ownerLabel: `${p.client_surname || ''} ${p.client_name || ''}`.trim(),
            address:    p.address || '',
            city:       p.city || '',
        }));

        els.propertySelect.innerHTML = '<option value="">— Nessuno —</option>' +
            properties.map(p =>
                `<option value="${p.id}">${escapeHtml(p.address)}, ${escapeHtml(p.city)}</option>`
            ).join('');
    }

    async function loadAgents() {
        const json = await fetch(`${API}?action=agents`).then(r => r.json());
        if (!json.success) return;

        const opts = (json.data || []).map(a =>
            `<option value="${a.id}">${escapeHtml(a.username)}</option>`
        ).join('');

        els.agentSelect.innerHTML  = '<option value="">— Non assegnato —</option>' + opts;
        els.agentFilter.innerHTML  = '<option value="">Tutti gli agenti</option>' + opts;
    }

    // -------------------------------------------------------------------------
    // Contatto + immobile
    // -------------------------------------------------------------------------

    function setContact(type, id) {
        const label = contactsByKey.get(`${type}:${id}`) || '';
        els.contactInput.value = label;
        els.contactType.value  = label ? type : '';
        els.contactId.value    = label ? String(id) : '';
        renderContactHint();
    }

    function clearContact() {
        els.contactInput.value = '';
        els.contactType.value  = '';
        els.contactId.value    = '';
        renderContactHint();
    }

    function resolveContact() {
        const typed = els.contactInput.value.trim();
        const match = contactsByLabel.get(typed);

        els.contactType.value = match ? match.type : '';
        els.contactId.value   = match ? match.id : '';
        renderContactHint();
    }

    function renderContactHint() {
        const typed = els.contactInput.value.trim();

        if (!typed) {
            els.contactHint.textContent = 'Chiunque in rubrica: acquirenti, venditori, inquilini.';
            els.contactHint.className   = 'form-hint';
        } else if (els.contactId.value) {
            els.contactHint.textContent = 'Contatto collegato.';
            els.contactHint.className   = 'form-hint form-hint--ok';
        } else {
            els.contactHint.textContent = 'Nessun contatto in rubrica corrisponde: il promemoria resterà senza collegamento.';
            els.contactHint.className   = 'form-hint form-hint--warn';
        }

        refreshNotifyWarning();
    }

    /**
     * Il proprietario è un dato derivato dall'immobile. Mostrarlo (e proporlo
     * come contatto quando il campo è ancora vuoto) evita all'agente di
     * selezionare due volte la stessa informazione — e di sbagliarne una.
     */
    function onPropertyChange() {
        const info = propertyIndex.get(els.propertySelect.value);
        const hint = document.getElementById('reminder-owner-hint');
        const name = document.getElementById('reminder-owner-name');

        if (!info) {
            name.textContent = '— nessun immobile selezionato —';
            hint.classList.remove('is-filled');
            return;
        }

        name.textContent = info.ownerLabel || 'Proprietario non disponibile';
        hint.classList.add('is-filled');

        if (!els.contactId.value && !els.contactInput.value.trim() && info.ownerId) {
            setContact('client', info.ownerId);
        }
    }

    function applyQuickTitle(title) {
        const input = document.getElementById('reminder-title');
        input.value = title;
        input.focus();
    }

    /** La data di fine serve solo a una serie; su "una tantum" è rumore. */
    function refreshFrequencyFields() {
        const recurring = els.frequency.value !== 'once';
        els.endWrap.hidden = !recurring;
        els.seriesHint.textContent = recurring
            ? 'Le singole occorrenze vengono create in automatico (fino a 12 mesi, o alla data indicata). Potrai completare o annullare una data senza toccare le altre.'
            : '';
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
        const agent     = els.agentFilter.value;

        if (search)    params.set('search', search);
        if (status)    params.set('status', status);
        if (frequency) params.set('frequency', frequency);
        if (dueSoon)   params.set('due_soon', dueSoon);
        if (agent)     params.set('assigned_agent_id', agent);
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);

        const url = `${API}?${params}`;
        softLoad(els.tbody, '<tr><td colspan="8" class="table-empty">Caricamento...</td></tr>');

        try {
            const res  = await fetch(url);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const parsed = Pagination.parseResponse(json);
            reminders = parsed.items;
            renderTable();
            Pagination.render(els.pagination, parsed, (p) => { currentPage = p; loadReminders(); });
        } catch (err) {
            els.tbody.classList.remove('is-loading');
            els.tbody.innerHTML = `<tr><td colspan="8" class="table-empty table-empty--error">${escapeHtml(err.message)}</td></tr>`;
        }
    }

    /** Etichetta del contatto qualunque delle tre tabelle lo ospiti. */
    function contactOf(r) {
        if (r.client_id && (r.client_surname || r.client_name)) {
            return { text: `${r.client_surname || ''} ${r.client_name || ''}`.trim(), kind: 'client' };
        }
        if (r.lead_id && (r.lead_surname || r.lead_name)) {
            return { text: `${r.lead_surname || ''} ${r.lead_name || ''}`.trim(), kind: 'lead' };
        }
        if (r.tenant_id && (r.tenant_contact_surname || r.tenant_contact_name)) {
            return { text: `${r.tenant_contact_surname || ''} ${r.tenant_contact_name || ''}`.trim(), kind: 'tenant' };
        }
        // Le richieste di manutenzione salvano il nome dell'inquilino come testo.
        if (r.tenant_name) return { text: r.tenant_name, kind: 'tenant' };
        return null;
    }

    function renderTable() {
        els.tbody.classList.remove('is-loading');
        if (reminders.length === 0) {
            els.tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Nessun promemoria trovato.</td></tr>';
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

            const contact = contactOf(r);
            const occurrences = Number(r.occurrence_count || 0);

            // Serie: la riga madre dichiara quante date ha generato, le
            // occorrenze dichiarano di appartenere a una serie. Senza questo
            // l'elenco sembrerebbe pieno di duplicati inspiegabili.
            let seriesBadge = '';
            if (r.series_id) {
                seriesBadge = '<span class="rem-series-tag" title="Occorrenza di una serie ricorrente"><i data-lucide="repeat"></i> occorrenza</span>';
            } else if (occurrences > 0) {
                seriesBadge = `<span class="rem-series-tag rem-series-tag--parent" title="Serie ricorrente">
                    <i data-lucide="repeat"></i> serie · ${occurrences + 1} date</span>`;
            }

            const notifyIcons = [
                r.notify_admin  ? '<span title="Notifica interna"><i data-lucide="bell"></i></span>' : '',
                r.notify_client ? '<span title="Email al contatto"><i data-lucide="mail"></i></span>' : '',
            ].filter(Boolean).join(' ') || '<span class="text-muted">—</span>';

            const actions = window.RowMenu.button(r.id, 'Azioni promemoria', { state: r.status });

            return `
                <tr class="${isOverdue ? 'row--overdue' : ''}">
                    <td data-label="Titolo">
                        <strong>${escapeHtml(r.title)}</strong> ${seriesBadge}
                        ${r.description ? `<br><small class="text-muted">${escapeHtml(truncate(r.description, 50))}</small>` : ''}
                    </td>
                    <td data-label="Data scadenza"><span class="${dateClass}">${formatDateTime(r.reminder_date)}</span></td>
                    <td data-label="Frequenza">${FREQUENCY_LABELS[r.frequency] || r.frequency}</td>
                    <td data-label="Stato"><span class="badge badge--reminder-${r.status}">${STATUS_LABELS[r.status]}</span></td>
                    <td data-label="Contatto">${contact
                        ? `${escapeHtml(contact.text)}<br><small class="text-muted">${CONTACT_LABELS[contact.kind]}</small>`
                        : '<span class="text-muted">—</span>'}</td>
                    <td data-label="Assegnato a">${r.agent_username
                        ? escapeHtml(r.agent_username)
                        : '<span class="text-muted">—</span>'}</td>
                    <td class="reminder-notify-icons" data-label="Notifiche">${notifyIcons}</td>
                    <td class="col-actions lt-actions" data-label="Azioni">${actions}</td>
                </tr>`;
        }).join('');

        if (window.lucide) window.lucide.createIcons();
    }

    function bindRowMenu() {
        window.RowMenu.bind(els.tbody, btn => {
            const id = btn.dataset.id;
            const pending = btn.dataset.state === 'pending';
            return [
                pending ? { label: 'Completa', icon: 'check', onClick: () => patchReminder(id, 'complete') } : null,
                { label: 'Modifica', icon: 'pencil', onClick: () => {
                    const r = reminders.find(x => x.id == id);
                    if (r) openModal(r);
                } },
                btn.dataset.state === 'cancelled'
                    ? { label: 'Riapri', icon: 'rotate-ccw', onClick: () => patchReminder(id, 'reopen') }
                    : null,
                pending ? { sep: true } : null,
                pending ? { label: 'Annulla', icon: 'x', danger: true, onClick: async () => {
                    // Annullare la madre di una serie porta via anche le
                    // occorrenze future: lo si dice prima, non dopo.
                    const r = reminders.find(x => x.id == id);
                    const isSeries = r && !r.series_id && Number(r.occurrence_count || 0) > 0;
                    const message = isSeries
                        ? 'Questo è il promemoria madre di una serie: annullandolo vengono rimosse anche le occorrenze future ancora in sospeso. Procedere?'
                        : 'Vuoi annullare questo promemoria?';

                    if (await confirmDialog(message, { title: 'Annulla promemoria', confirmText: 'Annulla promemoria', cancelText: 'Indietro' })) {
                        patchReminder(id, 'cancel');
                    }
                } } : null,
            ];
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
        clearContact();

        if (reminder) {
            els.modalTitle.textContent = reminder.series_id
                ? 'Modifica occorrenza'
                : 'Modifica Promemoria';
            document.getElementById('reminder-id').value            = reminder.id;
            document.getElementById('reminder-title').value         = reminder.title;
            document.getElementById('reminder-description').value   = reminder.description || '';
            document.getElementById('reminder-date').value          = toDatetimeLocal(reminder.reminder_date);
            els.frequency.value                                     = reminder.frequency;
            els.endDate.value                                       = reminder.end_date || '';
            document.getElementById('reminder-status').value        = reminder.status;
            els.propertySelect.value                                = reminder.property_id || '';
            els.agentSelect.value                                   = reminder.assigned_agent_id || '';
            document.getElementById('reminder-notify-admin').checked  = !!Number(reminder.notify_admin);
            document.getElementById('reminder-notify-client').checked = !!Number(reminder.notify_client);
            document.getElementById('reminder-email-subject').value   = reminder.email_subject || '';
            document.getElementById('reminder-email-body').value      = reminder.email_body || '';

            if (reminder.client_id)      setContact('client', reminder.client_id);
            else if (reminder.lead_id)   setContact('lead', reminder.lead_id);
            else if (reminder.tenant_id) setContact('tenant', reminder.tenant_id);

            onPropertyChange();
            toggleClientEmailFields();
        } else {
            els.modalTitle.textContent = 'Nuovo Promemoria';
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(9, 0, 0, 0);
            document.getElementById('reminder-date').value = toDatetimeLocal(tomorrow);
            onPropertyChange();
        }

        refreshFrequencyFields();
        refreshNotifyWarning();
        els.modal.hidden = false;
        if (window.lucide) window.lucide.createIcons();
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
            frequency:      els.frequency.value,
            end_date:       els.frequency.value !== 'once' ? els.endDate.value : '',
            status:         document.getElementById('reminder-status').value,
            // Un solo campo per il contatto: il server smista sulla FK giusta.
            contact_type:   els.contactType.value,
            contact_id:     els.contactId.value || null,
            property_id:    els.propertySelect.value || null,
            assigned_agent_id: els.agentSelect.value || null,
            notify_admin:   document.getElementById('reminder-notify-admin').checked,
            notify_client:  document.getElementById('reminder-notify-client').checked,
            email_subject:  document.getElementById('reminder-email-subject').value.trim(),
            email_body:     document.getElementById('reminder-email-body').value.trim(),
        };

        const btn = document.getElementById('reminder-modal-save');
        btn.disabled = true;
        btn.textContent = 'Salvataggio...';

        try {
            const saved = await saveReminder(data, id || null);
            closeModal();
            const generated = Number(saved?.occurrence_count || 0);
            showAlert(
                generated > 0
                    ? `Promemoria salvato con ${generated} occorrenze future.`
                    : 'Promemoria salvato.',
                'success'
            );
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
            btn.innerHTML = '<i data-lucide="zap"></i> Elabora scaduti';
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
        els.alert._timer = setTimeout(() => { els.alert.style.display = 'none'; }, 5000);
    }

    // `new Date(dateStr)` non bastava: i DATETIME di MySQL arrivano con lo
    // spazio e su alcuni browser diventano Invalid Date, cioe' un campo
    // riempito con "NaN-aN-aNTaN:aN".
    function toDatetimeLocal(dateStr) { return window.Fmt.toInputDateTime(dateStr); }

    function formatDateTime(dateStr) { return window.Fmt.dateTime(dateStr); }

    function truncate(str, len) {
        return str.length > len ? str.slice(0, len) + '…' : str;
    }

    function escapeHtml(str) {
        if (str == null) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    /** escapeHtml non tocca le virgolette: dentro un attributo servono anche quelle. */
    function escAttr(str) {
        return escapeHtml(str).replace(/"/g, '&quot;');
    }

    init();
})();
