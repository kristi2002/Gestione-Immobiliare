/**
 * Appointment create / edit — dedicated page.
 * viewParams: { appointmentId } for edit; { propertyId } / { leadId } / { clientId } to preselect on create.
 */
(function () {
    'use strict';

    const API         = 'api/appointments.php';
    const PROPS_API   = 'api/properties.php';
    const LEADS_API   = 'api/leads.php';
    const CLIENTS_API = 'api/clients.php';

    const vp            = window.App?.viewParams || {};
    const appointmentId = vp.appointmentId || null;
    const isEdit        = !!appointmentId;

    /** property id -> { owner, address, city } — powers the read-only owner badge. */
    const propertyIndex = new Map();

    const LOCATION_COPY = {
        immobile: {
            note: "L'appuntamento si svolge all'indirizzo dell'immobile selezionato.",
        },
        agenzia: {
            label: 'Indirizzo / sede',
            hint: 'Lascia vuoto per la sede principale dell\'agenzia.',
            placeholder: 'Es. Corso Umberto I 12, Civitanova Marche',
        },
        virtuale: {
            label: 'Link alla videochiamata',
            hint: 'Verrà incluso nel promemoria inviato al cliente.',
            placeholder: 'https://meet.google.com/...',
        },
    };

    function $(id) { return document.getElementById(id); }
    function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }

    function showAlert(msg, type) {
        const el = $('ape-alert'); if (!el) return;
        el.textContent = msg; el.className = `alert alert--${type}`; el.style.display = 'block';
        clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
    }
    function showError(m) { const el = $('ape-error'); if (el) { el.textContent = m; el.style.display = 'block'; } }
    function clearError() { const el = $('ape-error'); if (el) el.style.display = 'none'; }

    function backTarget() {
        if (isEdit)          return ['appointment_profile', { appointmentId }];
        if (vp.leadId)       return ['lead_edit', { leadId: vp.leadId }];
        if (vp.propertyId)   return ['property_profile', { propertyId: vp.propertyId }];
        if (vp.clientId)     return ['client_profile', { clientId: vp.clientId }];
        return ['appointments', {}];
    }
    function goBack() { if (window.App) { const [v, p] = backTarget(); window.App.navigateTo(v, p); } }
    // "Indietro"/"Annulla" ripercorrono il cammino fatto; backTarget() resta come
    // ripiego quando il form e' la prima pagina aperta.
    function leave() { if (window.App) { const [v, p] = backTarget(); window.App.back(v, p); } }

    function toLocal(dt) {
        if (!dt) return '';
        const d = new Date(dt.replace(' ', 'T'));
        if (isNaN(d)) return '';
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    async function fetchList(url, params) {
        if (window.Pagination?.fetchList) return window.Pagination.fetchList(url, params || {});
        const qs = new URLSearchParams(params || {}); qs.set('limit', '1000');
        const j = await fetch(`${url}?${qs}`).then(r => r.json());
        return j.data?.items || j.data || [];
    }

    async function loadDropdowns() {
        const [props, leads, clients, agentsJson] = await Promise.all([
            fetchList(PROPS_API, {}).catch(() => []),
            fetchList(LEADS_API, {}).catch(() => []),
            fetchList(CLIENTS_API, { status: 'active' }).catch(() => []),
            fetch(`${LEADS_API}?action=agents`).then(r => r.json()).catch(() => ({})),
        ]);

        propertyIndex.clear();
        props.forEach(p => propertyIndex.set(String(p.id), {
            owner: `${p.client_surname || ''} ${p.client_name || ''}`.trim(),
            address: p.address || '',
            city: p.city || '',
        }));

        $('ape-property').innerHTML = '<option value="">— Seleziona immobile —</option>' +
            props.map(p => `<option value="${p.id}">${esc(p.address)}, ${esc(p.city)}</option>`).join('');
        $('ape-lead').innerHTML = '<option value="">— Nessuno —</option>' +
            leads.map(l => `<option value="${l.id}">${esc(l.surname)} ${esc(l.name)}</option>`).join('');
        $('ape-client').innerHTML = '<option value="">— Nessuno —</option>' +
            clients.map(c => `<option value="${c.id}">${esc(c.surname)} ${esc(c.name)}</option>`).join('');
        $('ape-agent').innerHTML = '<option value="">— Nessuno —</option>' +
            (agentsJson.data || []).map(a => `<option value="${a.id}">${esc(a.username)}</option>`).join('');
    }

    // ---- Owner badge: derived from the property, never typed by the agent ----

    function refreshOwner() {
        const info = propertyIndex.get($('ape-property').value);
        const el = $('ape-owner-name');
        const wrap = $('ape-owner-hint');
        if (!info) {
            el.textContent = '— seleziona prima un immobile —';
            wrap.classList.remove('is-filled');
            return;
        }
        el.textContent = info.owner || 'Proprietario non disponibile';
        wrap.classList.add('is-filled');
    }

    // ---- Type cards ----

    function setType(type) {
        $('ape-type').value = type;
        document.querySelectorAll('#ape-type-grid .appt-type-card').forEach(b => {
            const on = b.dataset.type === type;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-checked', on ? 'true' : 'false');
        });
    }

    // ---- Duration: chips drive the number input, and vice versa ----

    function setDuration(min) {
        $('ape-duration').value = min;
        syncDurationChips();
    }

    function syncDurationChips() {
        const current = String($('ape-duration').value);
        document.querySelectorAll('#ape-duration-chips .appt-chip').forEach(c => {
            c.classList.toggle('is-active', c.dataset.min === current);
        });
    }

    // ---- Location ----

    function setLocation(loc) {
        $('ape-location-type').value = loc;
        document.querySelectorAll('#ape-location-seg .appt-seg').forEach(b => {
            const on = b.dataset.loc === loc;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-checked', on ? 'true' : 'false');
        });

        const wrap = $('ape-location-detail-wrap');
        const note = $('ape-location-note');
        const copy = LOCATION_COPY[loc];

        if (loc === 'immobile') {
            wrap.hidden = true;
            note.hidden = false;
            $('ape-location-detail').value = '';
        } else {
            wrap.hidden = false;
            note.hidden = true;
            $('ape-location-detail-label').textContent = copy.label;
            $('ape-location-detail-hint').textContent = copy.hint;
            $('ape-location-detail').placeholder = copy.placeholder;
            $('ape-location-detail').type = loc === 'virtuale' ? 'url' : 'text';
        }
    }

    // ---- Reminder toggle ----

    /**
     * The reminder is delivered by the cron engine to the lead or client on the
     * appointment. With neither set there is no address to write to, and a
     * non-scheduled appointment must never email anyone — say so instead of
     * letting the agent believe a message will go out.
     */
    function refreshNotifyWarning() {
        const box = $('ape-notify-warning');
        if (!$('ape-notify').checked) { box.hidden = true; return; }

        const hasCounterpart = $('ape-lead').value || $('ape-client').value;
        const status = $('ape-status').value;

        if (!hasCounterpart) {
            box.textContent = 'Nessun promemoria verrà inviato: seleziona un lead o un cliente a cui scrivere.';
            box.hidden = false;
        } else if (status !== 'scheduled') {
            box.textContent = 'Nessun promemoria verrà inviato: l\'appuntamento non è in stato "Programmato".';
            box.hidden = false;
        } else {
            box.hidden = true;
        }
    }

    async function loadAppointment() {
        const j = await fetch(`${API}?id=${appointmentId}`).then(r => r.json());
        if (!j.success) throw new Error(j.error);
        const a = j.data;
        $('ape-id').value = a.id;
        $('ape-property').value = a.property_id || '';
        $('ape-lead').value = a.lead_id || '';
        $('ape-client').value = a.client_id || '';
        $('ape-agent').value = a.agent_id || '';
        $('ape-date').value = toLocal(a.appointment_date);
        $('ape-duration').value = a.duration_minutes ?? 60;
        $('ape-status').value = a.status || 'scheduled';
        $('ape-notes').value = a.notes || '';
        $('ape-notify').checked = String(a.notify_client) === '1';

        setType(a.appointment_type || 'visita');
        setLocation(a.location_type || 'immobile');
        if (a.location_detail) $('ape-location-detail').value = a.location_detail;
        syncDurationChips();
        refreshOwner();
        refreshNotifyWarning();
    }

    function collect() {
        return {
            property_id:      $('ape-property').value,
            lead_id:          $('ape-lead').value || null,
            client_id:        $('ape-client').value || null,
            agent_id:         $('ape-agent').value || null,
            appointment_type: $('ape-type').value,
            appointment_date: $('ape-date').value,
            duration_minutes: $('ape-duration').value,
            location_type:    $('ape-location-type').value,
            location_detail:  $('ape-location-detail').value.trim(),
            notify_client:    $('ape-notify').checked ? 1 : 0,
            status:           $('ape-status').value,
            notes:            $('ape-notes').value.trim(),
        };
    }

    async function save(e) {
        e.preventDefault();
        clearError();
        const id = $('ape-id').value;
        const btn = $('ape-save');
        btn.disabled = true; btn.textContent = 'Salvataggio...';
        try {
            const res = await fetch(id ? `${API}?id=${id}` : API, {
                method: id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(collect()),
            });
            const j = await res.json();
            if (!j.success) throw new Error(j.error);
            // Land on the scheda of the appointment that was just saved.
            if (window.App && j.data?.id) window.App.navigateTo('appointment_profile', { appointmentId: j.data.id });
            else goBack();
        } catch (err) {
            showError(err.message);
            btn.disabled = false; btn.textContent = 'Salva';
        }
    }

    async function init() {
        $('ape-back').addEventListener('click', leave);
        $('ape-cancel').addEventListener('click', leave);
        $('ape-form').addEventListener('submit', save);

        $('ape-property').addEventListener('change', refreshOwner);

        document.querySelectorAll('#ape-type-grid .appt-type-card').forEach(b => {
            b.addEventListener('click', () => setType(b.dataset.type));
        });
        document.querySelectorAll('#ape-duration-chips .appt-chip').forEach(c => {
            c.addEventListener('click', () => setDuration(Number(c.dataset.min)));
        });
        $('ape-duration').addEventListener('input', syncDurationChips);
        document.querySelectorAll('#ape-location-seg .appt-seg').forEach(b => {
            b.addEventListener('click', () => setLocation(b.dataset.loc));
        });

        ['ape-notify', 'ape-lead', 'ape-client', 'ape-status'].forEach(id => {
            $(id).addEventListener('change', refreshNotifyWarning);
        });

        try { await loadDropdowns(); }
        catch (err) { showAlert('Errore caricamento elenchi: ' + err.message, 'error'); }

        if (isEdit) {
            $('ape-title').textContent = 'Modifica Appuntamento';
            try { await loadAppointment(); }
            catch (err) { showAlert('Impossibile caricare l\'appuntamento: ' + err.message, 'error'); }
        } else {
            $('ape-title').textContent = 'Nuovo Appuntamento';
            const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0);
            $('ape-date').value = window.Fmt.toInputDateTime(d);
            if (vp.propertyId) $('ape-property').value = String(vp.propertyId);
            if (vp.leadId) $('ape-lead').value = String(vp.leadId);
            if (vp.clientId) $('ape-client').value = String(vp.clientId);
            refreshOwner();
        }

        if (window.lucide) window.lucide.createIcons();
    }

    init();
})();
