/**
 * Automazioni verso i Clienti — scheduled email automations (PDF spec requirement)
 * Wrapper around the reminders API with notify_client=1
 */
(function () {
    'use strict';

    const API         = 'api/reminders.php';
    const CLIENTS_API = 'api/clients.php';

    const FREQ_LABELS = {
        weekly:    'Settimanale',
        biweekly:  'Quindicinale',
        monthly:   'Mensile',
        quarterly: 'Trimestrale',
        yearly:    'Annuale',
    };

    const STATUS_LABELS = {
        pending:   'Attiva',
        completed: 'Completata',
        cancelled: 'In pausa',
    };

    let automations = [];
    let clients     = [];
    let currentPage = 1;
    const PAGE_LIMIT = 25;
    let searchTimer  = null;

    const els = {};

    function init() {
        els.grid       = document.getElementById('automations-grid');
        els.alert      = document.getElementById('automations-alert');
        els.pagination = document.getElementById('automations-pagination');
        els.modal      = document.getElementById('automation-modal');
        els.form       = document.getElementById('automation-form');

        bindEvents();
        loadClients().then(() => loadAutomations());
    }

    function bindEvents() {
        document.getElementById('btn-new-automation').addEventListener('click', () => openModal());
        document.getElementById('automation-modal-close').addEventListener('click', closeModal);
        document.getElementById('automation-modal-cancel').addEventListener('click', closeModal);
        els.modal.addEventListener('click', e => { if (e.target === els.modal) closeModal(); });
        els.form.addEventListener('submit', handleSubmit);

        document.getElementById('automation-search').addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => { currentPage = 1; loadAutomations(); }, 300);
        });
        ['automation-status-filter', 'automation-freq-filter'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => { currentPage = 1; loadAutomations(); });
        });
    }

    async function loadClients() {
        try {
            const res  = await fetch(`${CLIENTS_API}?limit=500&page=1`);
            const json = await res.json();
            if (!json.success) return;
            clients = json.data?.items ?? [];
            const sel = document.getElementById('automation-client');
            sel.innerHTML = '<option value="">— Seleziona proprietario —</option>' +
                clients.map(c => `<option value="${c.id}">${esc(c.surname)} ${esc(c.name)}</option>`).join('');
        } catch { /* non-fatal */ }
    }

    async function loadAutomations() {
        const params = new URLSearchParams();
        params.set('notify_client', '1');
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);

        const search = document.getElementById('automation-search').value.trim();
        const status = document.getElementById('automation-status-filter').value;
        const freq   = document.getElementById('automation-freq-filter').value;

        if (search) params.set('search', search);
        if (status) params.set('status', status);
        if (freq)   params.set('frequency', freq);

        softLoad(els.grid, '<div class="entity-loading">Caricamento…</div>');

        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const parsed = Pagination.parseResponse(json);
            automations  = parsed.items;
            renderCards();
            Pagination.render(els.pagination, parsed, p => { currentPage = p; loadAutomations(); });
        } catch (err) {
            els.grid.classList.remove('is-loading');
            els.grid.innerHTML = `<div class="entity-error">${esc(err.message)}</div>`;
        }
    }

    function renderCards() {
        els.grid.classList.remove('is-loading');
        if (!automations.length) {
            els.grid.innerHTML = '<div class="entity-empty">Nessuna automazione configurata. Creane una con il pulsante in alto.</div>';
            return;
        }

        els.grid.innerHTML = automations.map(a => {
            const who    = a.client_surname ? `${esc(a.client_surname)} ${esc(a.client_name)}` : '—';
            const freq   = FREQ_LABELS[a.frequency] || a.frequency;
            const status = STATUS_LABELS[a.status] || a.status;
            const start  = fmtDate(a.reminder_date);
            const end    = a.end_date ? fmtDate(a.end_date) : '∞';
            const statusClass = a.status === 'pending' ? 'success' : (a.status === 'cancelled' ? 'error' : 'inactive');

            return `
            <div class="entity-card automation-card">
                <div class="entity-card__header">
                    <div class="entity-card__title-group">
                        <div class="entity-card__name">${esc(a.email_subject || a.title)}</div>
                        <span class="badge badge--${statusClass}">${status}</span>
                    </div>
                </div>
                <div class="entity-card__body">
                    <div class="entity-card__info"><span class="entity-card__info-icon">👤</span>${who}</div>
                    <div class="entity-card__info"><span class="entity-card__info-icon">🔁</span>${freq}</div>
                    <div class="entity-card__info"><span class="entity-card__info-icon">📅</span>${start} → ${end}</div>
                    ${a.email_body ? `<div class="automation-preview">${esc(a.email_body.substring(0, 100))}${a.email_body.length > 100 ? '…' : ''}</div>` : ''}
                </div>
                <div class="entity-card__footer">
                    <div class="entity-card__actions">
                        ${a.status === 'pending' ? `<button class="btn btn--sm btn--ghost btn-pause" data-id="${a.id}" title="Metti in pausa">⏸️</button>` : ''}
                        ${a.status !== 'pending' ? `<button class="btn btn--sm btn--ghost btn-resume" data-id="${a.id}" title="Riattiva">▶️</button>` : ''}
                        <button class="btn btn--sm btn--ghost btn-edit" data-id="${a.id}" title="Modifica">✏️</button>
                        <button class="btn btn--sm btn--ghost btn-delete" data-id="${a.id}" title="Elimina">🗑️</button>
                    </div>
                </div>
            </div>`;
        }).join('');

        els.grid.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', () => {
                const a = automations.find(x => x.id == btn.dataset.id);
                if (a) openModal(a);
            });
        });

        els.grid.querySelectorAll('.btn-pause').forEach(btn => {
            btn.addEventListener('click', () => patchStatus(btn.dataset.id, 'cancel'));
        });

        els.grid.querySelectorAll('.btn-resume').forEach(btn => {
            btn.addEventListener('click', () => patchStatus(btn.dataset.id, 'reopen'));
        });

        els.grid.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (await confirmDialog('Eliminare questa automazione?', { title: 'Elimina automazione', confirmText: 'Elimina' })) {
                    deleteAutomation(btn.dataset.id);
                }
            });
        });
    }

    function openModal(automation = null) {
        els.form.reset();
        document.getElementById('automation-id').value = '';

        if (automation) {
            document.getElementById('automation-modal-title').textContent = 'Modifica Automazione';
            document.getElementById('automation-id').value          = automation.id;
            document.getElementById('automation-client').value       = automation.client_id || '';
            document.getElementById('automation-subject').value      = automation.email_subject || automation.title || '';
            document.getElementById('automation-body').value         = automation.email_body || automation.description || '';
            document.getElementById('automation-frequency').value    = automation.frequency || 'monthly';
            document.getElementById('automation-start').value        = (automation.reminder_date || '').slice(0, 10);
            document.getElementById('automation-end').value          = automation.end_date || '';
        } else {
            document.getElementById('automation-modal-title').textContent = 'Nuova Automazione';
            document.getElementById('automation-start').value = new Date().toISOString().slice(0, 10);
        }

        els.modal.hidden = false;
        document.getElementById('automation-subject').focus();
    }

    function closeModal() {
        els.modal.hidden = true;
    }

    async function handleSubmit(e) {
        e.preventDefault();
        const id      = document.getElementById('automation-id').value;
        const subject = document.getElementById('automation-subject').value.trim();
        const body    = document.getElementById('automation-body').value.trim();
        const start   = document.getElementById('automation-start').value;

        if (!subject || !body || !start) {
            showAlert('Compila tutti i campi obbligatori.', 'error');
            return;
        }

        const payload = {
            title:          subject,
            description:    body,
            email_subject:  subject,
            email_body:     body,
            reminder_date:  start,
            end_date:       document.getElementById('automation-end').value || null,
            frequency:      document.getElementById('automation-frequency').value,
            client_id:      document.getElementById('automation-client').value || null,
            notify_client:  1,
            notify_admin:   0,
            status:         'pending',
        };

        const btn = document.getElementById('automation-modal-save');
        btn.disabled = true; btn.textContent = 'Salvataggio…';

        try {
            const url    = id ? `${API}?id=${id}` : API;
            const method = id ? 'PUT' : 'POST';
            const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const json   = await res.json();
            if (!json.success) throw new Error(json.error);
            closeModal();
            loadAutomations();
            showAlert('Automazione salvata.', 'success');
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Salva automazione';
        }
    }

    async function patchStatus(id, action) {
        const res  = await fetch(`${API}?id=${id}&action=${action}`, { method: 'PATCH' });
        const json = await res.json();
        if (json.success) loadAutomations();
        else showAlert(json.error, 'error');
    }

    async function deleteAutomation(id) {
        const res  = await fetch(`${API}?id=${id}`, { method: 'DELETE' });
        const json = await res.json();
        if (json.success) {
            loadAutomations();
            showAlert('Automazione eliminata.', 'success');
        } else {
            showAlert(json.error, 'error');
        }
    }

    function showAlert(msg, type) {
        els.alert.textContent    = msg;
        els.alert.className      = `alert alert--${type}`;
        els.alert.style.display  = 'block';
        clearTimeout(els.alert._t);
        els.alert._t = setTimeout(() => { els.alert.style.display = 'none'; }, 4000);
    }

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    }

    function fmtDate(d) {
        if (!d) return '—';
        return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    init();
})();
