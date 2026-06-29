/**
 * Lead create / edit — dedicated page (replaces the old modal).
 * viewParams: { leadId } for edit.
 */
(function () {
    'use strict';

    const API = 'api/leads.php';
    const vp  = window.App?.viewParams || {};
    const leadId = vp.leadId || null;
    const isEdit = !!leadId;

    function $(id) { return document.getElementById(id); }
    function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }

    function showAlert(msg, type) {
        const el = $('lde-alert'); if (!el) return;
        el.textContent = msg; el.className = `alert alert--${type}`; el.style.display = 'block';
        clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
    }
    function showError(m) { const el = $('lde-error'); if (el) { el.textContent = m; el.style.display = 'block'; } }
    function clearError() { const el = $('lde-error'); if (el) el.style.display = 'none'; }

    function goBack() { if (window.App) window.App.navigateTo('leads'); }

    async function loadAgents() {
        try {
            const j = await fetch(`${API}?action=agents`).then(r => r.json());
            if (j.success) {
                $('lde-assigned').innerHTML = '<option value="">— Nessuno —</option>' +
                    (j.data || []).map(a => `<option value="${a.id}">${esc(a.username)}</option>`).join('');
            }
        } catch (e) { /* non blocking */ }
    }

    async function loadLead() {
        const j = await fetch(`${API}?id=${leadId}`).then(r => r.json());
        if (!j.success) throw new Error(j.error);
        const l = j.data;
        $('lde-id').value = l.id;
        $('lde-name').value = l.name || '';
        $('lde-surname').value = l.surname || '';
        $('lde-cf').value = l.codice_fiscale || '';
        $('lde-phone').value = l.phone || '';
        $('lde-email').value = l.email || '';
        $('lde-interest').value = l.interest_type || 'affitto';
        $('lde-budget-min').value = l.budget_min ?? '';
        $('lde-budget-max').value = l.budget_max ?? '';
        $('lde-city').value = l.preferred_city || '';
        $('lde-type').value = l.preferred_type || '';
        $('lde-min-rooms').value = l.min_rooms ?? '';
        $('lde-min-sqm').value = l.min_sqm ?? '';
        $('lde-status').value = l.status || 'new';
        $('lde-source').value = l.source || 'telefono';
        $('lde-assigned').value = l.assigned_to || '';
        $('lde-notes').value = l.notes || '';
    }

    function collect() {
        return {
            name:           $('lde-name').value.trim(),
            surname:        $('lde-surname').value.trim(),
            codice_fiscale: $('lde-cf').value.trim().toUpperCase() || null,
            phone:          $('lde-phone').value.trim(),
            email:          $('lde-email').value.trim(),
            interest_type:  $('lde-interest').value,
            budget_min:     $('lde-budget-min').value,
            budget_max:     $('lde-budget-max').value,
            preferred_city: $('lde-city').value.trim(),
            preferred_type: $('lde-type').value,
            min_rooms:      $('lde-min-rooms').value,
            min_sqm:        $('lde-min-sqm').value,
            status:         $('lde-status').value,
            source:         $('lde-source').value,
            assigned_to:    $('lde-assigned').value || null,
            notes:          $('lde-notes').value.trim(),
        };
    }

    async function save(e) {
        e.preventDefault();
        clearError();
        const id = $('lde-id').value;
        const btn = $('lde-save');
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
        $('lde-back').addEventListener('click', goBack);
        $('lde-cancel').addEventListener('click', goBack);
        $('lde-form').addEventListener('submit', save);

        await loadAgents();

        if (isEdit) {
            $('lde-title').textContent = 'Modifica Lead';
            try { await loadLead(); }
            catch (err) { showAlert('Impossibile caricare il lead: ' + err.message, 'error'); }
        } else {
            $('lde-title').textContent = 'Nuovo Lead';
            $('lde-name').focus();
        }
    }

    init();
})();
