/**
 * Appointments (Visite) — CRUD (Phase 11)
 */
(function () {
    'use strict';

    const API        = 'api/appointments.php';
    const PROPS_API  = 'api/properties.php';
    const LEADS_API  = 'api/leads.php';
    const CLIENTS_API = 'api/clients.php';

    const STATUS_LABELS = {
        scheduled: 'Programmata', completed: 'Completata',
        cancelled: 'Annullata', no_show: 'Mancata presentazione',
    };

    let appointments = [];
    let currentPage = 1;
    const PAGE_LIMIT = 25;
    let schedaAppointmentId = null;
    const els = {};

    function init() {
        els.grid         = document.getElementById('appointments-grid');
        els.statusFilter = document.getElementById('appt-status-filter');
        els.from         = document.getElementById('appt-from');
        els.to           = document.getElementById('appt-to');
        els.alert        = document.getElementById('appointments-alert');
        els.modal        = document.getElementById('appointment-modal');
        els.form         = document.getElementById('appointment-form');
        els.modalTitle   = document.getElementById('appointment-modal-title');
        els.propSelect   = document.getElementById('appt-property');
        els.leadSelect   = document.getElementById('appt-lead');
        els.clientSelect = document.getElementById('appt-client');
        els.agentSelect  = document.getElementById('appt-agent');
        els.pagination   = document.getElementById('appointments-pagination');

        bindEvents();
        Promise.all([loadProperties(), loadLeads(), loadClients(), loadAgents()])
            .then(loadAppointments);
    }

    function bindEvents() {
        document.getElementById('btn-new-appointment').addEventListener('click', () => openModal());
        document.getElementById('appointment-modal-close').addEventListener('click', closeModal);
        document.getElementById('appointment-modal-cancel').addEventListener('click', closeModal);
        els.form.addEventListener('submit', handleFormSubmit);
        [els.statusFilter, els.from, els.to].forEach(el => el.addEventListener('change', () => { currentPage = 1; loadAppointments(); }));
        els.modal.addEventListener('click', (e) => { if (e.target === els.modal) closeModal(); });

        // Scheda quick-view
        const schedaModal = document.getElementById('appointment-scheda-modal');
        document.getElementById('appointment-scheda-close').addEventListener('click', closeSchedaModal);
        document.getElementById('scheda-appt-close2').addEventListener('click', closeSchedaModal);
        schedaModal.addEventListener('click', (e) => { if (e.target === schedaModal) closeSchedaModal(); });
        document.getElementById('scheda-appt-edit').addEventListener('click', () => {
            const id = schedaAppointmentId;
            closeSchedaModal();
            const a = appointments.find(x => x.id === id);
            if (a) openModal(a);
        });
        document.getElementById('scheda-appt-complete').addEventListener('click', () => {
            const id = schedaAppointmentId;
            closeSchedaModal();
            quickStatus(id, 'completed');
        });
        document.getElementById('scheda-appt-cancel').addEventListener('click', () => {
            const id = schedaAppointmentId;
            closeSchedaModal();
            quickStatus(id, 'cancelled');
        });
    }

    async function loadProperties() {
        const res = await fetch(`${PROPS_API}?limit=500&page=1`);
        const json = await res.json();
        if (json.success) {
            const items = Pagination.parseResponse(json).items;
            els.propSelect.innerHTML = '<option value="">— Seleziona immobile —</option>' +
                items.map(p => `<option value="${p.id}">${escapeHtml(p.address)}, ${escapeHtml(p.city)}</option>`).join('');
        }
    }
    async function loadLeads() {
        const res = await fetch(`${LEADS_API}?limit=500&page=1`);
        const json = await res.json();
        if (json.success) {
            const items = Pagination.parseResponse(json).items;
            els.leadSelect.innerHTML = '<option value="">— Nessuno —</option>' +
                items.map(l => `<option value="${l.id}">${escapeHtml(l.surname)} ${escapeHtml(l.name)}</option>`).join('');
        }
    }
    async function loadClients() {
        const items = await Pagination.fetchList(CLIENTS_API, { status: 'active' });
        els.clientSelect.innerHTML = '<option value="">— Nessuno —</option>' +
            items.map(c => `<option value="${c.id}">${escapeHtml(c.surname)} ${escapeHtml(c.name)}</option>`).join('');
    }
    async function loadAgents() {
        const res = await fetch(`${LEADS_API}?action=agents`);
        const json = await res.json();
        if (json.success) {
            els.agentSelect.innerHTML = '<option value="">— Nessuno —</option>' +
                json.data.map(a => `<option value="${a.id}">${escapeHtml(a.username)}</option>`).join('');
        }
    }

    async function loadAppointments() {
        const params = new URLSearchParams();
        if (els.statusFilter.value) params.set('status', els.statusFilter.value);
        if (els.from.value) params.set('from', els.from.value);
        if (els.to.value) params.set('to', els.to.value);
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);
        const url = `${API}?${params}`;
        softLoad(els.grid, '<div class="entity-loading">Caricamento…</div>');
        try {
            const res = await fetch(url);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const parsed = Pagination.parseResponse(json);
            appointments = parsed.items;
            renderCards();
            Pagination.render(els.pagination, parsed, (p) => { currentPage = p; loadAppointments(); });
        } catch (err) {
            els.grid.classList.remove('is-loading');
            els.grid.innerHTML = `<div class="entity-error">${escapeHtml(err.message)}</div>`;
        }
    }

    function renderCards() {
        els.grid.classList.remove('is-loading');
        if (appointments.length === 0) {
            els.grid.innerHTML = '<div class="entity-empty">Nessuna visita trovata.</div>';
            return;
        }
        els.grid.innerHTML = appointments.map(a => {
            const who = a.lead_id ? `${a.lead_surname} ${a.lead_name}` :
                        (a.client_id ? `${a.client_surname} ${a.client_name}` : '—');
            return `
            <div class="entity-card appointment-card appointment-card--${a.status} entity-card--clickable" data-id="${a.id}">
                <div class="appointment-card__header">
                    <strong>${escapeHtml(a.property_address)}, ${escapeHtml(a.property_city)}</strong>
                    <span class="badge badge--appt-${a.status}">${STATUS_LABELS[a.status] || a.status}</span>
                </div>
                <div class="entity-card__body">
                    <div class="entity-card__info">📅 ${formatDateTime(a.appointment_date)} · ${a.duration_minutes} min</div>
                    <div class="entity-card__info">👤 ${escapeHtml(who)}</div>
                    ${a.agent_name ? `<div class="entity-card__info text-muted">Agente: ${escapeHtml(a.agent_name)}</div>` : ''}
                    ${a.notes ? `<div class="entity-card__info text-muted">${escapeHtml(a.notes)}</div>` : ''}
                </div>
                <div class="entity-card__footer">
                    <div class="entity-card__actions">
                        ${a.status === 'scheduled' ? `<button class="btn btn--sm btn--ghost btn-complete" data-id="${a.id}" title="Completa">✓</button>
                        <button class="btn btn--sm btn--ghost btn-cancel" data-id="${a.id}" title="Annulla">✕</button>` : ''}
                        <button class="btn btn--sm btn--ghost btn-edit" data-id="${a.id}" title="Modifica">✏️</button>
                        <button class="btn btn--sm btn--ghost btn-delete" data-id="${a.id}" title="Elimina">🗑️</button>
                    </div>
                </div>
            </div>`;
        }).join('');

        els.grid.querySelectorAll('.btn-edit').forEach(b => b.addEventListener('click', () => {
            const a = appointments.find(x => x.id == b.dataset.id); if (a) openModal(a);
        }));
        els.grid.querySelectorAll('.btn-complete').forEach(b => b.addEventListener('click', () => quickStatus(b.dataset.id, 'completed')));
        els.grid.querySelectorAll('.btn-cancel').forEach(b => b.addEventListener('click', () => quickStatus(b.dataset.id, 'cancelled')));
        els.grid.querySelectorAll('.btn-delete').forEach(b => b.addEventListener('click', () => deleteAppointment(b.dataset.id)));

        els.grid.querySelectorAll('.entity-card--clickable').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('button, a, input')) return;
                const a = appointments.find(x => x.id == card.dataset.id);
                if (a) openSchedaModal(a);
            });
        });
    }

    function openSchedaModal(a) {
        schedaAppointmentId = a.id;
        const who = a.lead_id
            ? `${a.lead_surname} ${a.lead_name}`
            : (a.client_id ? `${a.client_surname} ${a.client_name}` : '—');

        document.getElementById('scheda-appt-property').textContent =
            `${a.property_address}, ${a.property_city}`;
        document.getElementById('scheda-appt-badge').innerHTML =
            `<span class="badge badge--appt-${a.status}">${STATUS_LABELS[a.status] || a.status}</span>`;

        document.getElementById('scheda-appt-body').innerHTML = `
            <div class="scheda-rows">
                <div class="scheda-row"><span class="scheda-row__label">📅 Data e ora</span><span class="scheda-row__value">${formatDateTime(a.appointment_date)}</span></div>
                <div class="scheda-row"><span class="scheda-row__label">⏱ Durata</span><span class="scheda-row__value">${a.duration_minutes} minuti</span></div>
                <div class="scheda-row"><span class="scheda-row__label">👤 Visitatore</span><span class="scheda-row__value">${escapeHtml(who)}</span></div>
                ${a.agent_name ? `<div class="scheda-row"><span class="scheda-row__label">🧑‍💼 Agente</span><span class="scheda-row__value">${escapeHtml(a.agent_name)}</span></div>` : ''}
                ${a.notes ? `<div class="scheda-row"><span class="scheda-row__label">📝 Note</span><span class="scheda-row__value">${escapeHtml(a.notes)}</span></div>` : ''}
            </div>`;

        const isScheduled = a.status === 'scheduled';
        document.getElementById('scheda-appt-complete').hidden = !isScheduled;
        document.getElementById('scheda-appt-cancel').hidden = !isScheduled;

        document.getElementById('appointment-scheda-modal').hidden = false;
    }

    function closeSchedaModal() {
        schedaAppointmentId = null;
        document.getElementById('appointment-scheda-modal').hidden = true;
    }

    function openModal(appt = null) {
        els.form.reset();
        document.getElementById('appointment-id').value = '';
        document.getElementById('appt-duration').value = 60;
        if (appt) {
            els.modalTitle.textContent = 'Modifica Visita';
            document.getElementById('appointment-id').value = appt.id;
            els.propSelect.value = appt.property_id;
            els.leadSelect.value = appt.lead_id || '';
            els.clientSelect.value = appt.client_id || '';
            els.agentSelect.value = appt.agent_id || '';
            document.getElementById('appt-date').value = toDatetimeLocal(appt.appointment_date);
            document.getElementById('appt-duration').value = appt.duration_minutes;
            document.getElementById('appt-status').value = appt.status;
            document.getElementById('appt-notes').value = appt.notes || '';
        } else {
            els.modalTitle.textContent = 'Nuova Visita';
            const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0);
            document.getElementById('appt-date').value = toDatetimeLocal(d.toISOString());
        }
        els.modal.hidden = false;
    }
    function closeModal() { els.modal.hidden = true; }

    async function handleFormSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('appointment-id').value;
        const data = {
            property_id: els.propSelect.value,
            lead_id: els.leadSelect.value || null,
            client_id: els.clientSelect.value || null,
            agent_id: els.agentSelect.value || null,
            appointment_date: document.getElementById('appt-date').value,
            duration_minutes: document.getElementById('appt-duration').value,
            status: document.getElementById('appt-status').value,
            notes: document.getElementById('appt-notes').value.trim(),
        };
        const btn = document.getElementById('appointment-modal-save');
        btn.disabled = true; btn.textContent = 'Salvataggio...';
        try {
            const url = id ? `${API}?id=${id}` : API;
            const res = await fetch(url, {
                method: id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeModal();
            showAlert('Visita salvata.', 'success');
            loadAppointments();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Salva';
        }
    }

    async function quickStatus(id, status) {
        const a = appointments.find(x => x.id == id);
        if (!a) return;
        try {
            const res = await fetch(`${API}?id=${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    property_id: a.property_id, lead_id: a.lead_id, client_id: a.client_id,
                    agent_id: a.agent_id, appointment_date: a.appointment_date,
                    duration_minutes: a.duration_minutes, status, notes: a.notes,
                }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert('Visita aggiornata.', 'success');
            loadAppointments();
        } catch (err) { showAlert(err.message, 'error'); }
    }

    async function deleteAppointment(id) {
        if (!await confirmDialog('Vuoi eliminare questa visita?', { title: 'Elimina visita' })) return;
        try {
            const res = await fetch(`${API}?id=${id}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert('Visita eliminata.', 'success');
            loadAppointments();
        } catch (err) { showAlert(err.message, 'error'); }
    }

    function toDatetimeLocal(dateStr) {
        const d = new Date(dateStr);
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    function formatDateTime(dateStr) {
        return new Date(dateStr).toLocaleString('it-IT', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
        });
    }
    function showAlert(message, type) {
        els.alert.textContent = message;
        els.alert.className = `alert alert--${type}`;
        els.alert.style.display = 'block';
        clearTimeout(els.alert._timer);
        els.alert._timer = setTimeout(() => { els.alert.style.display = 'none'; }, 4000);
    }
    function escapeHtml(str) {
        if (str == null) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    init();
})();
