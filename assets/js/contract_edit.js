/**
 * Contract create / edit — dedicated page (replaces the old modal).
 * viewParams: { contractId } for edit; { propertyId } / { clientId } to preselect on create.
 */
(function () {
    'use strict';

    const API          = 'api/contracts.php';
    const PROPS_API    = 'api/properties.php';
    const TENANTS_API  = 'api/tenants.php';
    const CLIENTS_API  = 'api/clients.php';

    const vp         = window.App?.viewParams || {};
    const contractId = vp.contractId || null;
    const isEdit     = !!contractId;

    function $(id) { return document.getElementById(id); }
    function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }

    function showAlert(msg, type) {
        const el = $('cte-alert'); if (!el) return;
        el.textContent = msg; el.className = `alert alert--${type}`; el.style.display = 'block';
        clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
    }
    function showError(m) { const el = $('cte-error'); if (el) { el.textContent = m; el.style.display = 'block'; } }
    function clearError() { const el = $('cte-error'); if (el) el.style.display = 'none'; }

    function backTarget() {
        if (vp.propertyId) return ['property_profile', { propertyId: vp.propertyId }];
        if (vp.clientId)   return ['client_profile', { clientId: vp.clientId }];
        return ['contracts', {}];
    }
    function goBack() { if (window.App) { const [v, p] = backTarget(); window.App.navigateTo(v, p); } }

    async function fetchList(url, params) {
        if (window.Pagination?.fetchList) return window.Pagination.fetchList(url, params || {});
        const qs = new URLSearchParams(params || {}); qs.set('limit', '1000');
        const j = await fetch(`${url}?${qs}`).then(r => r.json());
        return j.data?.items || j.data || [];
    }

    async function loadDropdowns() {
        const [props, tenants, clients] = await Promise.all([
            fetchList(PROPS_API, {}).catch(() => []),
            fetchList(TENANTS_API, {}).catch(() => []),
            fetchList(CLIENTS_API, { status: 'active' }).catch(() => []),
        ]);
        $('cte-property').innerHTML = '<option value="">— Seleziona immobile —</option>' +
            props.map(p => `<option value="${p.id}">${esc(p.address)}, ${esc(p.city)}</option>`).join('');
        $('cte-tenant').innerHTML = '<option value="">— Nessuno —</option>' +
            tenants.map(t => `<option value="${t.id}">${esc(t.surname)} ${esc(t.name)}</option>`).join('');
        $('cte-client').innerHTML = '<option value="">— Nessuno —</option>' +
            clients.map(c => `<option value="${c.id}">${esc(c.surname)} ${esc(c.name)}</option>`).join('');
    }

    async function loadContract() {
        const j = await fetch(`${API}?id=${contractId}`).then(r => r.json());
        if (!j.success) throw new Error(j.error);
        const c = j.data;
        $('cte-id').value = c.id;
        $('cte-title-input').value = c.title || '';
        $('cte-type').value = c.contract_type || 'locazione';
        $('cte-status').value = c.status || ''; // null/empty = Automatico
        $('cte-property').value = c.property_id || '';
        $('cte-tenant').value = c.tenant_id || '';
        $('cte-client').value = c.client_id || '';
        $('cte-start').value = c.start_date || '';
        $('cte-end').value = c.end_date || '';
        $('cte-rent').value = c.monthly_rent ?? '';
        $('cte-deposit').value = c.deposit ?? '';
        $('cte-notes').value = c.notes || '';
        // Fiscal / registration
        setVal('cte-subtype', c.contract_subtype);
        $('cte-cedolare').checked = !!Number(c.cedolare_secca);
        setVal('cte-reg-number', c.registration_number);
        setVal('cte-reg-date', c.registration_date ? String(c.registration_date).substring(0, 10) : '');
        setVal('cte-reg-office', c.registration_office);
        setVal('cte-registro-due', c.imposta_registro_due_date ? String(c.imposta_registro_due_date).substring(0, 10) : '');
        setVal('cte-reg-tax', c.registration_tax_annual);
        setVal('cte-stamp', c.stamp_duty);
        $('cte-istat-enabled').checked = !!Number(c.istat_update_enabled);
        setVal('cte-istat-index', c.istat_baseline_index);
        setVal('cte-istat-month', c.istat_baseline_month);
    }

    function setVal(id, v) { const el = $(id); if (el) el.value = (v ?? '') === null ? '' : (v ?? ''); }

    function collect() {
        return {
            title:         $('cte-title-input').value.trim(),
            contract_type: $('cte-type').value,
            status:        $('cte-status').value,
            property_id:   $('cte-property').value,
            tenant_id:     $('cte-tenant').value || null,
            client_id:     $('cte-client').value || null,
            start_date:    $('cte-start').value || null,
            end_date:      $('cte-end').value || null,
            monthly_rent:  $('cte-rent').value,
            deposit:       $('cte-deposit').value,
            notes:         $('cte-notes').value.trim(),
            contract_subtype:          $('cte-subtype').value || null,
            cedolare_secca:            $('cte-cedolare').checked ? 1 : 0,
            registration_number:       $('cte-reg-number').value.trim(),
            registration_date:         $('cte-reg-date').value || null,
            registration_office:       $('cte-reg-office').value.trim(),
            imposta_registro_due_date: $('cte-registro-due').value || null,
            registration_tax_annual:   $('cte-reg-tax').value || null,
            stamp_duty:                $('cte-stamp').value || null,
            istat_update_enabled:      $('cte-istat-enabled').checked ? 1 : 0,
            istat_baseline_index:      $('cte-istat-index').value || null,
            istat_baseline_month:      $('cte-istat-month').value.trim() || null,
        };
    }

    async function calcIstat() {
        const box = $('cte-istat-result');
        const id  = $('cte-id').value;
        if (!id) { box.className = 'alert alert--warning'; box.style.display = 'block'; box.textContent = 'Salva prima il contratto per calcolare l\'adeguamento.'; return; }
        const btn = $('cte-istat-calc');
        btn.disabled = true;
        try {
            const j = await fetch(`${API}?action=istat_adjustment&id=${id}`).then(r => r.json());
            if (!j.success) throw new Error(j.error);
            const d = j.data;
            const eur = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);
            box.className = 'alert alert--info';
            box.style.display = 'block';
            box.innerHTML =
                `<strong>Adeguamento ISTAT ${esc(d.target_year)}</strong><br>` +
                `Variazione FOI: ${d.variation_pct}% · applicata (75%): ${d.applied_pct}%<br>` +
                `Canone attuale ${eur(d.current_rent)} → <strong>${eur(d.new_rent)}</strong> ` +
                `(+${eur(d.monthly_increase)}/mese, +${eur(d.annual_increase)}/anno)<br>` +
                `<small class="text-muted">${esc(d.note || '')}</small>`;
        } catch (err) {
            box.className = 'alert alert--error';
            box.style.display = 'block';
            box.textContent = err.message;
        } finally {
            btn.disabled = false;
        }
    }

    async function save(e) {
        e.preventDefault();
        clearError();
        const id = $('cte-id').value;
        const btn = $('cte-save');
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
        $('cte-back').addEventListener('click', goBack);
        $('cte-cancel').addEventListener('click', goBack);
        $('cte-form').addEventListener('submit', save);
        const istatBtn = $('cte-istat-calc');
        if (istatBtn) istatBtn.addEventListener('click', calcIstat);

        try { await loadDropdowns(); }
        catch (err) { showAlert('Errore caricamento elenchi: ' + err.message, 'error'); }

        if (isEdit) {
            $('cte-title').textContent = 'Modifica Contratto';
            try { await loadContract(); }
            catch (err) { showAlert('Impossibile caricare il contratto: ' + err.message, 'error'); }
        } else {
            $('cte-title').textContent = 'Nuovo Contratto';
            $('cte-type').value = 'locazione';
            $('cte-status').value = ''; // default new contracts to Automatico (date-driven)
            if (vp.propertyId) $('cte-property').value = String(vp.propertyId);
            if (vp.clientId) $('cte-client').value = String(vp.clientId);
            $('cte-title-input').focus();
        }
    }

    init();
})();
