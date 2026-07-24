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

    // "Immobile richiesto" picker: the datalist offers labels, but the form must
    // submit an id. These maps translate both ways; the hidden #lde-property-id
    // is the source of truth for what gets saved.
    const labelToId = new Map(); // lowercased label -> property id
    const idToLabel = new Map(); // String(id) -> display label

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

    function propLabel(p) {
        const ref  = (p.reference_code || '').trim();
        const addr = [p.address, p.city].filter(Boolean).join(', ');
        return ref ? `${ref} · ${addr}` : (addr || `Immobile #${p.id}`);
    }

    async function loadAgents() {
        try {
            const j = await fetch(`${API}?action=agents`).then(r => r.json());
            if (j.success) {
                $('lde-assigned').innerHTML = '<option value="">— Nessuno —</option>' +
                    (j.data || []).map(a => `<option value="${a.id}">${esc(a.username)}</option>`).join('');
            }
        } catch (e) { /* non blocking */ }
    }

    async function loadProperties() {
        try {
            const j = await fetch('api/properties.php?limit=500').then(r => r.json());
            if (!j.success) return;
            const items = (j.data && j.data.items) || [];
            const opts = [];
            items.forEach(p => {
                let label = propLabel(p);
                let key = label.toLowerCase();
                // Guarantee the label round-trips to a single id (dup address+ref → suffix).
                if (labelToId.has(key)) { label = `${label} · #${p.id}`; key = label.toLowerCase(); }
                labelToId.set(key, p.id);
                idToLabel.set(String(p.id), label);
                opts.push(`<option value="${esc(label)}"></option>`);
            });
            $('lde-property-list').innerHTML = opts.join('');
        } catch (_) { /* non blocking — picker just stays empty */ }
    }

    /** Keep the hidden id in sync with whatever is typed/picked in the search box. */
    function resolveProperty() {
        const txt = $('lde-property-search').value.trim();
        $('lde-property-id').value = txt === '' ? '' : (labelToId.get(txt.toLowerCase()) || '');
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
        $('lde-next-date').value = l.next_action_at || '';
        $('lde-next-note').value = l.next_action || '';
        $('lde-source').value = l.source || 'telefono';
        $('lde-assigned').value = l.assigned_to || '';
        $('lde-notes').value = l.notes || '';

        // Immobile richiesto: hidden id is authoritative; label may be out of the
        // first 500 loaded, so fall back to a stable "Immobile #id".
        const pid = l.preferred_property_id;
        if (pid) {
            $('lde-property-id').value = String(pid);
            $('lde-property-search').value = idToLabel.get(String(pid)) || `Immobile #${pid}`;
        }

        // Reveal the collapsed CF block if this lead already has a codice fiscale.
        if (l.codice_fiscale) { const d = $('lde-more'); if (d) d.open = true; }
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
            preferred_property_id: $('lde-property-id').value || null,
            min_rooms:      $('lde-min-rooms').value,
            min_sqm:        $('lde-min-sqm').value,
            status:         $('lde-status').value,
            next_action_at: $('lde-next-date').value || null,
            next_action:    $('lde-next-note').value.trim() || null,
            source:         $('lde-source').value,
            assigned_to:    $('lde-assigned').value || null,
            notes:          $('lde-notes').value.trim(),
        };
    }

    async function save(e) {
        e.preventDefault();
        clearError();

        // If they typed something in the property box that didn't match a listing,
        // don't silently drop it — ask them to pick one or clear the field.
        const propTxt = $('lde-property-search').value.trim();
        if (propTxt !== '' && !$('lde-property-id').value) {
            showError('Immobile richiesto: seleziona una voce dall\'elenco oppure svuota il campo.');
            $('lde-property-search').focus();
            return;
        }

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

    function onKeydown(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            goBack();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            // Ctrl/Cmd+Enter saves from anywhere — including the Note textarea,
            // where a plain Enter is (correctly) a newline.
            e.preventDefault();
            const form = $('lde-form');
            if (form.requestSubmit) form.requestSubmit(); else save(new Event('submit'));
        }
    }

    async function init() {
        $('lde-back').addEventListener('click', goBack);
        $('lde-cancel').addEventListener('click', goBack);
        $('lde-form').addEventListener('submit', save);
        $('lde-form').addEventListener('keydown', onKeydown);
        $('lde-property-search').addEventListener('input', resolveProperty);

        await Promise.all([loadAgents(), loadProperties()]);

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
