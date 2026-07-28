/**
 * Scheda appuntamento — read-only detail page for a single appointment.
 * viewParams: { appointmentId }
 */
(function () {
    'use strict';

    const API = 'api/appointments.php';

    const vp = window.App?.viewParams || {};
    const appointmentId = vp.appointmentId || null;

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
        immobile: 'Presso l\'immobile', agenzia: 'In agenzia', virtuale: 'Videochiamata',
    };
    const PROPERTY_STATUS_LABELS = {
        available: 'Disponibile', rented: 'Affittato', sold: 'Venduto', archived: 'Archiviato',
    };

    let appt = null;

    function $(id) { return document.getElementById(id); }
    function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }

    function showAlert(msg, type) {
        const el = $('apr-alert');
        el.textContent = msg; el.className = `alert alert--${type}`; el.style.display = 'block';
        clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 4000);
    }

    function parseDate(s) { return s ? new Date(String(s).replace(' ', 'T')) : null; }

    function fmtDateTime(s) { return window.Fmt.dateTime(s); }
    function fmtTime(d) {
        return d && !isNaN(d) ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '—';
    }
    function fmtDuration(min) {
        const m = Number(min) || 0;
        if (m < 60) return `${m} minuti`;
        const h = Math.floor(m / 60), rest = m % 60;
        return rest ? `${h}h ${rest}min` : `${h} ${h === 1 ? 'ora' : 'ore'}`;
    }
    function fmtMoney(v) {
        if (v == null || v === '') return null;
        return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
            .format(Number(v));
    }

    function row(icon, label, value) {
        return `<div class="scheda-row">
            <span class="scheda-row__label"><i data-lucide="${icon}"></i> ${esc(label)}</span>
            <span class="scheda-row__value">${value}</span>
        </div>`;
    }

    function goBack() {
        if (window.App) window.App.navigateTo('appointments');
    }

    async function load() {
        if (!appointmentId) {
            $('apr-title').textContent = 'Appuntamento non specificato';
            return;
        }
        try {
            const j = await fetch(`${API}?id=${appointmentId}`).then(r => r.json());
            if (!j.success) throw new Error(j.error);
            appt = j.data;
            render();
        } catch (err) {
            $('apr-title').textContent = 'Appuntamento non trovato';
            showAlert(err.message, 'error');
        }
    }

    function renderHero() {
        const start = parseDate(appt.appointment_date);

        $('apr-dow').textContent   = start ? start.toLocaleDateString('it-IT', { weekday: 'short' }) : '—';
        $('apr-day').textContent   = start ? String(start.getDate()).padStart(2, '0') : '—';
        $('apr-month').textContent = start ? start.toLocaleDateString('it-IT', { month: 'short' }) : '';

        const type = appt.appointment_type || 'visita';
        $('apr-badges').innerHTML =
            `<span class="badge badge--appt-type"><i data-lucide="${TYPE_ICONS[type] || 'calendar'}"></i> ${esc(TYPE_LABELS[type] || type)}</span>` +
            `<span class="badge badge--appt-${appt.status}">${esc(STATUS_LABELS[appt.status] || appt.status)}</span>`;

        $('apr-title').textContent = appt.property_address
            ? `${appt.property_address}, ${appt.property_city}`
            : 'Immobile eliminato';

        const end = start ? new Date(start.getTime() + (Number(appt.duration_minutes) || 0) * 60000) : null;
        $('apr-meta').innerHTML =
            `<span><i data-lucide="clock"></i> ${fmtTime(start)}–${fmtTime(end)} · ${esc(fmtDuration(appt.duration_minutes))}</span>` +
            (appt.agent_name ? `<span><i data-lucide="briefcase"></i> ${esc(appt.agent_name)}</span>` : '');

        const isScheduled = appt.status === 'scheduled';
        $('apr-complete').hidden = !isScheduled;
        $('apr-cancel').hidden   = !isScheduled;
    }

    function renderWhen() {
        const start = parseDate(appt.appointment_date);
        const end = start ? new Date(start.getTime() + (Number(appt.duration_minutes) || 0) * 60000) : null;

        let place = LOCATION_LABELS[appt.location_type] || LOCATION_LABELS.immobile;
        if (appt.location_type === 'immobile') {
            place += appt.property_address ? ` — ${esc(appt.property_address)}, ${esc(appt.property_city)}` : '';
        } else if (appt.location_detail) {
            place += appt.location_type === 'virtuale'
                ? ` — <a href="${esc(appt.location_detail)}" target="_blank" rel="noopener noreferrer">apri link</a>`
                : ` — ${esc(appt.location_detail)}`;
        }

        $('apr-when').innerHTML =
            row('calendar', 'Data', esc(fmtDateTime(appt.appointment_date))) +
            row('clock', 'Orario', `${esc(fmtTime(start))} – ${esc(fmtTime(end))}`) +
            row('timer', 'Durata', esc(fmtDuration(appt.duration_minutes))) +
            row('map-pin', 'Luogo', place);
    }

    function personCard(role, name, email, phone, onClick) {
        if (!name) return '';
        const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
        const contacts = [
            email ? `<a href="mailto:${esc(email)}"><i data-lucide="mail"></i> ${esc(email)}</a>` : '',
            phone ? `<a href="tel:${esc(phone)}"><i data-lucide="phone"></i> ${esc(phone)}</a>` : '',
        ].filter(Boolean).join('');

        return `<div class="appt-person${onClick ? ' appt-person--clickable' : ''}"${onClick ? ` data-nav="${esc(onClick)}"` : ''}>
            <div class="appt-person__avatar">${esc(initials || '?')}</div>
            <div class="appt-person__body">
                <span class="appt-person__role">${esc(role)}</span>
                <strong class="appt-person__name">${esc(name)}</strong>
                ${contacts ? `<div class="appt-person__contacts">${contacts}</div>` : '<span class="text-muted">Nessun contatto registrato</span>'}
            </div>
        </div>`;
    }

    function renderPeople() {
        const counterpartName = appt.lead_id
            ? `${appt.lead_surname || ''} ${appt.lead_name || ''}`.trim()
            : (appt.client_id ? `${appt.client_surname || ''} ${appt.client_name || ''}`.trim() : '');

        const cards = [
            personCard(
                appt.lead_id ? 'Lead' : 'Cliente',
                counterpartName,
                appt.lead_id ? appt.lead_email : appt.client_email,
                appt.lead_id ? appt.lead_phone : appt.client_phone,
                appt.lead_id ? `lead_edit:leadId:${appt.lead_id}`
                            : (appt.client_id ? `client_profile:clientId:${appt.client_id}` : ''),
            ),
            personCard(
                'Proprietario',
                `${appt.owner_surname || ''} ${appt.owner_name || ''}`.trim(),
                appt.owner_email, appt.owner_phone,
                appt.owner_id ? `client_profile:clientId:${appt.owner_id}` : '',
            ),
            appt.agent_name ? personCard('Agente', appt.agent_name, null, null, '') : '',
        ].filter(Boolean).join('');

        $('apr-people').innerHTML = cards ||
            '<p class="text-muted">Nessuna controparte registrata su questo appuntamento.</p>';

        $('apr-people').querySelectorAll('[data-nav]').forEach(el => {
            el.addEventListener('click', () => {
                const [view, key, value] = el.dataset.nav.split(':');
                if (window.App) window.App.navigateTo(view, { [key]: Number(value) });
            });
        });
    }

    function renderProperty() {
        if (!appt.property_id) {
            $('apr-property').innerHTML =
                '<p class="text-muted">L\'immobile collegato è stato eliminato. Lo storico dell\'appuntamento è conservato.</p>';
            return;
        }
        const price = fmtMoney(appt.property_price);
        $('apr-property').innerHTML =
            `<div class="scheda-rows">
                ${row('map-pin', 'Indirizzo', esc(`${appt.property_address || ''}, ${appt.property_city || ''}`))}
                ${row('building-2', 'Tipologia', esc(appt.property_type || '—'))}
                ${price ? row('euro', appt.property_price_type === 'affitto' ? 'Canone' : 'Prezzo', esc(price)) : ''}
                ${row('activity', 'Stato', esc(PROPERTY_STATUS_LABELS[appt.property_status] || appt.property_status || '—'))}
            </div>
            <button class="btn btn--ghost btn--sm appt-card__cta" id="apr-goto-property">
                <i data-lucide="arrow-right"></i> Apri scheda immobile
            </button>`;

        $('apr-goto-property').addEventListener('click', () => {
            if (window.App) window.App.navigateTo('property_profile', { propertyId: Number(appt.property_id) });
        });
    }

    function renderReminder() {
        const el = $('apr-reminder');

        if (String(appt.notify_client) !== '1') {
            el.innerHTML = '<p class="text-muted"><i data-lucide="bell-off"></i> Promemoria non richiesto per questo appuntamento.</p>';
            return;
        }
        if (!appt.reminder_date) {
            el.innerHTML = `<div class="alert alert--warning" style="margin:0">
                Promemoria richiesto ma non programmato: manca un lead o un cliente a cui inviarlo,
                oppure l'appuntamento non è più in stato "Programmato".
            </div>`;
            return;
        }

        const sent = appt.reminder_status === 'completed';
        el.innerHTML = `<div class="scheda-rows">
            ${row('bell', 'Invio previsto', esc(fmtDateTime(appt.reminder_date)))}
            ${row(sent ? 'check-circle-2' : 'hourglass', 'Stato',
                sent ? 'Inviato' : 'In attesa')}
        </div>`;
    }

    function renderNotes() {
        $('apr-notes').innerHTML = appt.notes
            ? `<p class="appt-notes">${esc(appt.notes)}</p>`
            : '<p class="text-muted">Nessuna nota.</p>';
    }

    function renderFootnote() {
        const created = fmtDateTime(appt.created_at);
        const updated = fmtDateTime(appt.updated_at);
        $('apr-footnote').textContent =
            `Appuntamento #${appt.id} · creato il ${created}` +
            (appt.updated_at && appt.updated_at !== appt.created_at ? ` · ultimo aggiornamento ${updated}` : '');
    }

    function render() {
        renderHero();
        renderWhen();
        renderPeople();
        renderProperty();
        renderReminder();
        renderNotes();
        renderFootnote();
        if (window.lucide) window.lucide.createIcons();
    }

    async function changeStatus(status) {
        try {
            const res = await fetch(`${API}?id=${appt.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    property_id: appt.property_id, lead_id: appt.lead_id, client_id: appt.client_id,
                    agent_id: appt.agent_id, appointment_type: appt.appointment_type,
                    appointment_date: appt.appointment_date, duration_minutes: appt.duration_minutes,
                    location_type: appt.location_type, location_detail: appt.location_detail,
                    notify_client: appt.notify_client, status, notes: appt.notes,
                }),
            });
            const j = await res.json();
            if (!j.success) throw new Error(j.error);
            appt = j.data;
            render();
            showAlert('Appuntamento aggiornato.', 'success');
        } catch (err) { showAlert(err.message, 'error'); }
    }

    async function remove() {
        if (!await confirmDialog('Vuoi eliminare questo appuntamento?', { title: 'Elimina appuntamento' })) return;
        try {
            const res = await fetch(`${API}?id=${appt.id}`, { method: 'DELETE' });
            const j = await res.json();
            if (!j.success) throw new Error(j.error);
            goBack();
        } catch (err) { showAlert(err.message, 'error'); }
    }

    function init() {
        $('apr-back').addEventListener('click', goBack);
        $('apr-edit').addEventListener('click', () => {
            if (window.App) window.App.navigateTo('appointment_edit', { appointmentId: Number(appointmentId) });
        });
        $('apr-complete').addEventListener('click', () => changeStatus('completed'));
        $('apr-cancel').addEventListener('click', () => changeStatus('cancelled'));
        $('apr-delete').addEventListener('click', remove);
        load();
    }

    init();
})();
