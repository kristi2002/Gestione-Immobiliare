/**
 * Appointment (visita) create / edit — dedicated page (replaces the old modal).
 * viewParams: { appointmentId } for edit; { propertyId } to preselect on create.
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

    function $(id) { return document.getElementById(id); }
    function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }

    function showAlert(msg, type) {
        const el = $('ape-alert'); if (!el) return;
        el.textContent = msg; el.className = `alert alert--${type}`; el.style.display = 'block';
        clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
    }
    function showError(m) { const el = $('ape-error'); if (el) { el.textContent = m; el.style.display = 'block'; } }
    function clearError() { const el = $('ape-error'); if (el) el.style.display = 'none'; }

    function goBack() {
        if (!window.App) return;
        if (vp.propertyId) window.App.navigateTo('property_profile', { propertyId: vp.propertyId });
        else window.App.navigateTo('appointments');
    }

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
        $('ape-property').innerHTML = '<option value="">— Seleziona immobile —</option>' +
            props.map(p => `<option value="${p.id}">${esc(p.address)}, ${esc(p.city)}</option>`).join('');
        $('ape-lead').innerHTML = '<option value="">— Nessuno —</option>' +
            leads.map(l => `<option value="${l.id}">${esc(l.surname)} ${esc(l.name)}</option>`).join('');
        $('ape-client').innerHTML = '<option value="">— Nessuno —</option>' +
            clients.map(c => `<option value="${c.id}">${esc(c.surname)} ${esc(c.name)}</option>`).join('');
        $('ape-agent').innerHTML = '<option value="">— Nessuno —</option>' +
            (agentsJson.data || []).map(a => `<option value="${a.id}">${esc(a.username)}</option>`).join('');
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
    }

    function collect() {
        return {
            property_id:      $('ape-property').value,
            lead_id:          $('ape-lead').value || null,
            client_id:        $('ape-client').value || null,
            agent_id:         $('ape-agent').value || null,
            appointment_date: $('ape-date').value,
            duration_minutes: $('ape-duration').value,
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
            goBack();
        } catch (err) {
            showError(err.message);
            btn.disabled = false; btn.textContent = 'Salva';
        }
    }

    async function init() {
        $('ape-back').addEventListener('click', goBack);
        $('ape-cancel').addEventListener('click', goBack);
        $('ape-form').addEventListener('submit', save);

        try { await loadDropdowns(); }
        catch (err) { showAlert('Errore caricamento elenchi: ' + err.message, 'error'); }

        if (isEdit) {
            $('ape-title').textContent = 'Modifica Visita';
            try { await loadAppointment(); }
            catch (err) { showAlert('Impossibile caricare la visita: ' + err.message, 'error'); }
        } else {
            $('ape-title').textContent = 'Nuova Visita';
            const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0);
            $('ape-date').value = toLocal(d.toISOString());
            if (vp.propertyId) $('ape-property').value = String(vp.propertyId);
        }
    }

    init();
})();
