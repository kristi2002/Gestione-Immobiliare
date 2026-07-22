/**
 * Appointments (Visite) — CRUD (Phase 11)
 */
(function () {
    'use strict';

    const API        = 'api/appointments.php';

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
        els.pagination   = document.getElementById('appointments-pagination');

        bindEvents();
        loadAppointments();
    }

    function bindEvents() {
        document.getElementById('btn-new-appointment').addEventListener('click', () => {
            if (window.App) window.App.navigateTo('appointment_edit');
        });
        [els.statusFilter, els.from, els.to].forEach(el => el.addEventListener('change', () => { currentPage = 1; loadAppointments(); }));

        // Scheda quick-view
        const schedaModal = document.getElementById('appointment-scheda-modal');
        document.getElementById('appointment-scheda-close').addEventListener('click', closeSchedaModal);
        document.getElementById('scheda-appt-close2').addEventListener('click', closeSchedaModal);
        schedaModal.addEventListener('click', (e) => { if (e.target === schedaModal) closeSchedaModal(); });
        document.getElementById('scheda-appt-edit').addEventListener('click', () => {
            const id = schedaAppointmentId;
            closeSchedaModal();
            if (window.App) window.App.navigateTo('appointment_edit', { appointmentId: id });
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
                    <div class="entity-card__info"><i data-lucide="calendar"></i> ${formatDateTime(a.appointment_date)} · ${a.duration_minutes} min</div>
                    <div class="entity-card__info"><i data-lucide="user"></i> ${escapeHtml(who)}</div>
                    ${a.agent_name ? `<div class="entity-card__info text-muted">Agente: ${escapeHtml(a.agent_name)}</div>` : ''}
                    ${a.notes ? `<div class="entity-card__info text-muted">${escapeHtml(a.notes)}</div>` : ''}
                </div>
                <div class="entity-card__footer">
                    <div class="entity-card__actions">
                        ${a.status === 'scheduled' ? `<button class="btn btn--sm btn--ghost btn-complete" data-id="${a.id}" title="Completa"><i data-lucide="check"></i></button>
                        <button class="btn btn--sm btn--ghost btn-cancel" data-id="${a.id}" title="Annulla"><i data-lucide="x"></i></button>` : ''}
                        <button class="btn btn--sm btn--ghost btn-edit" data-id="${a.id}" title="Modifica"><i data-lucide="pencil"></i></button>
                        <button class="btn btn--sm btn--ghost btn-delete" data-id="${a.id}" title="Elimina"><i data-lucide="trash-2"></i></button>
                    </div>
                </div>
            </div>`;
        }).join('');

        els.grid.querySelectorAll('.btn-edit').forEach(b => b.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.App) window.App.navigateTo('appointment_edit', { appointmentId: Number(b.dataset.id) });
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
                <div class="scheda-row"><span class="scheda-row__label"><i data-lucide="calendar"></i> Data e ora</span><span class="scheda-row__value">${formatDateTime(a.appointment_date)}</span></div>
                <div class="scheda-row"><span class="scheda-row__label"><i data-lucide="timer"></i> Durata</span><span class="scheda-row__value">${a.duration_minutes} minuti</span></div>
                <div class="scheda-row"><span class="scheda-row__label"><i data-lucide="user"></i> Visitatore</span><span class="scheda-row__value">${escapeHtml(who)}</span></div>
                ${a.agent_name ? `<div class="scheda-row"><span class="scheda-row__label"><i data-lucide="briefcase"></i> Agente</span><span class="scheda-row__value">${escapeHtml(a.agent_name)}</span></div>` : ''}
                ${a.notes ? `<div class="scheda-row"><span class="scheda-row__label"><i data-lucide="file-pen"></i> Note</span><span class="scheda-row__value">${escapeHtml(a.notes)}</span></div>` : ''}
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
