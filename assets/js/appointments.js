/**
 * Appuntamenti — list + CRUD. Opening a card lands on the scheda page
 * (views/appointment_profile.html), which replaced the old quick-view modal.
 */
(function () {
    'use strict';

    const API        = 'api/appointments.php';

    const STATUS_LABELS = {
        scheduled: 'Programmato', completed: 'Completato',
        cancelled: 'Annullato', no_show: 'Mancata presentazione',
    };
    const TYPE_LABELS = {
        visita: 'Visita', acquisizione: 'Acquisizione', atto: 'Atto', chiamata: 'Chiamata',
    };
    const TYPE_ICONS = {
        visita: 'home', acquisizione: 'handshake', atto: 'file-signature', chiamata: 'phone',
    };
    const LOCATION_LABELS = {
        immobile: 'Presso immobile', agenzia: 'In agenzia', virtuale: 'Videochiamata',
    };

    let appointments = [];
    let currentPage = 1;
    const PAGE_LIMIT = 25;
    const els = {};

    function init() {
        els.grid         = document.getElementById('appointments-grid');
        els.typeFilter   = document.getElementById('appt-type-filter');
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
        [els.typeFilter, els.statusFilter, els.from, els.to].forEach(el =>
            el.addEventListener('change', () => { currentPage = 1; loadAppointments(); }));

        const routeBtn = document.getElementById('btn-appt-route');
        if (routeBtn) routeBtn.addEventListener('click', planDay);
    }

    /**
     * Itinerario della giornata.
     *
     * Prende la data dal filtro "Da" (altrimenti oggi) e ricarica gli
     * appuntamenti di QUEL giorno, non quelli in pagina: la griglia è paginata a
     * 25 e filtrabile, quindi ciò che si vede a schermo non è la giornata.
     *
     * Solo gli appuntamenti presso l'immobile hanno un indirizzo da raggiungere.
     * Quelli in agenzia o in videochiamata restano visibili nell'elenco tappe ma
     * disattivati: escluderli in silenzio darebbe un giro incompleto senza dirlo.
     */
    async function planDay() {
        if (typeof RoutePlanner === 'undefined') {
            showAlert('Pianificatore itinerario non disponibile.', 'error');
            return;
        }

        const day = els.from.value || new Date().toISOString().slice(0, 10);
        const params = new URLSearchParams({ from: day, to: day, limit: '100' });
        if (els.typeFilter.value) params.set('type', els.typeFilter.value);

        try {
            const res = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const items = Pagination.parseResponse(json).items
                .filter(a => a.status !== 'cancelled');

            if (items.length < 2) {
                showAlert(`Servono almeno due appuntamenti attivi il ${formatDay(day)} per calcolare un itinerario.`, 'info');
                return;
            }

            const stops = items.map(a => {
                const atProperty = (a.location_type || 'immobile') === 'immobile';
                const lat = atProperty ? parseFloat(a.property_latitude) : NaN;
                const lng = atProperty ? parseFloat(a.property_longitude) : NaN;
                const who = a.lead_id ? `${a.lead_surname || ''} ${a.lead_name || ''}`.trim()
                    : (a.client_id ? `${a.client_surname || ''} ${a.client_name || ''}`.trim() : '');
                return {
                    id: a.id,
                    label: a.property_address
                        ? `${a.property_address}, ${a.property_city || ''}`.replace(/,\s*$/, '')
                        : (LOCATION_LABELS[a.location_type] || 'Appuntamento'),
                    sublabel: [TYPE_LABELS[a.appointment_type] || a.appointment_type, who].filter(Boolean).join(' · '),
                    lat: Number.isFinite(lat) ? lat : null,
                    lng: Number.isFinite(lng) ? lng : null,
                    time: new Date(a.appointment_date),
                    durationMinutes: Number(a.duration_minutes) || null,
                    flag: atProperty ? 'senza coordinate' : (LOCATION_LABELS[a.location_type] || '').toLowerCase(),
                };
            });

            RoutePlanner.open({
                title: `Itinerario ${formatDay(day)}`,
                subtitle: 'Gli orari sono già presi con i clienti: l\'ordine resta cronologico e viene verificato che gli spostamenti ci stiano.',
                stops,
            });
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    function formatDay(iso) {
        const d = new Date(`${iso}T00:00:00`);
        return isNaN(d) ? iso : d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    }

    async function loadAppointments() {
        const params = new URLSearchParams();
        if (els.typeFilter.value) params.set('type', els.typeFilter.value);
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
            els.grid.innerHTML = '<div class="entity-empty">Nessun appuntamento trovato.</div>';
            return;
        }
        els.grid.innerHTML = appointments.map(a => {
            const who = a.lead_id ? `${a.lead_surname} ${a.lead_name}` :
                        (a.client_id ? `${a.client_surname} ${a.client_name}` : '—');
            const type = a.appointment_type || 'visita';
            const owner = `${a.owner_surname || ''} ${a.owner_name || ''}`.trim();
            return `
            <div class="entity-card appointment-card appointment-card--${a.status} entity-card--clickable" data-id="${a.id}">
                <div class="appointment-card__header">
                    <strong>${a.property_address ? `${escapeHtml(a.property_address)}, ${escapeHtml(a.property_city)}` : 'Immobile eliminato'}</strong>
                    <span class="badge badge--appt-${a.status}">${STATUS_LABELS[a.status] || a.status}</span>
                </div>
                <div class="entity-card__body">
                    <div class="appointment-card__tags">
                        <span class="badge badge--appt-type"><i data-lucide="${TYPE_ICONS[type] || 'calendar'}"></i> ${TYPE_LABELS[type] || type}</span>
                        <span class="badge badge--soft">${LOCATION_LABELS[a.location_type] || LOCATION_LABELS.immobile}</span>
                        ${String(a.notify_client) === '1' ? '<span class="badge badge--soft" title="Promemoria al cliente attivo"><i data-lucide="bell"></i></span>' : ''}
                    </div>
                    <div class="entity-card__info"><i data-lucide="calendar"></i> ${formatDateTime(a.appointment_date)} · ${a.duration_minutes} min</div>
                    <div class="entity-card__info"><i data-lucide="user"></i> ${escapeHtml(who)}</div>
                    ${owner ? `<div class="entity-card__info text-muted">Proprietario: ${escapeHtml(owner)}</div>` : ''}
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
                if (window.App) window.App.navigateTo('appointment_profile', { appointmentId: Number(card.dataset.id) });
            });
        });

        if (window.lucide) window.lucide.createIcons();
    }

    async function quickStatus(id, status) {
        const a = appointments.find(x => x.id == id);
        if (!a) return;
        try {
            const res = await fetch(`${API}?id=${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                // PUT is a full overwrite: every column has to be echoed back or
                // the API's defaults silently reset type/luogo/promemoria.
                body: JSON.stringify({
                    property_id: a.property_id, lead_id: a.lead_id, client_id: a.client_id,
                    agent_id: a.agent_id, appointment_type: a.appointment_type,
                    appointment_date: a.appointment_date, duration_minutes: a.duration_minutes,
                    location_type: a.location_type, location_detail: a.location_detail,
                    notify_client: a.notify_client, status, notes: a.notes,
                }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert('Appuntamento aggiornato.', 'success');
            loadAppointments();
        } catch (err) { showAlert(err.message, 'error'); }
    }

    async function deleteAppointment(id) {
        if (!await confirmDialog('Vuoi eliminare questo appuntamento?', { title: 'Elimina appuntamento' })) return;
        try {
            const res = await fetch(`${API}?id=${id}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert('Appuntamento eliminato.', 'success');
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
