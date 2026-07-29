/**
 * Contract create / edit — dedicated page (replaces the old modal).
 * viewParams: { contractId } for edit; { propertyId } / { clientId } / { tenantId } to preselect on create.
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

    // Deve restare allineato a CONTRACT_RENTAL_TYPES / CONTRACT_SALE_TYPES in
    // api/contracts.php: e' l'API a decidere quale importo sopravvive al
    // salvataggio, qui si decide solo cosa mostrare. Se i due elenchi divergono,
    // l'agente compila un campo che il server azzera subito dopo.
    const RENTAL_TYPES = ['locazione'];
    const SALE_TYPES   = ['compravendita', 'preliminare', 'mandato'];

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
        if (vp.tenantId)   return ['tenant_profile', { tenantId: vp.tenantId }];
        return ['contracts', {}];
    }
    function goBack() { if (window.App) { const [v, p] = backTarget(); window.App.navigateTo(v, p); } }
    // Il bottone "Indietro"/"Annulla" ripercorre il cammino fatto; backTarget()
    // resta come ripiego quando il form e' la prima pagina aperta.
    function leave() { if (window.App) { const [v, p] = backTarget(); window.App.back(v, p); } }

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
        $('cte-price').value = c.sale_price ?? '';
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

    /**
     * Mostra i campi economici che il tipo di contratto prevede davvero.
     *
     * Non e' cosmesi: finche' "Canone (€)" restava visibile su una
     * compravendita, l'importo che ci finiva dentro veniva poi stampato in
     * elenco come «€ 700,00/mese» su un rogito. Il campo nascosto viene anche
     * SVUOTATO, altrimenti al salvataggio successivo si rispedirebbe un valore
     * che l'agente non vede piu' e non puo' correggere.
     *
     * `altro` non e' in nessuno dei due gruppi e mostra entrambi: e' la casella
     * per i contratti che non abbiamo previsto, e li' nascondere un campo
     * significherebbe rendere impossibile registrarne l'importo.
     */
    function applyTypeVisibility() {
        const type   = $('cte-type').value;
        const isRent = RENTAL_TYPES.includes(type);
        const isSale = SALE_TYPES.includes(type);

        const show = (id, visible) => {
            const el = $(id);
            if (!el) return;
            // display inline invece di [hidden]: .form-group ha un display
            // esplicito nel foglio di stile, che vincerebbe sull'attributo.
            el.style.display = visible ? '' : 'none';
        };

        show('cte-rent-group',  !isSale);
        show('cte-price-group', !isRent);
        show('cte-fiscal-section', isRent);

        if (isSale) $('cte-rent').value  = '';
        if (isRent) $('cte-price').value = '';

        // Stesso dato, nome diverso a seconda del contratto: cauzione in
        // locazione, caparra in compravendita (vedi phase79).
        const depLabel = $('cte-deposit-label');
        if (depLabel) depLabel.textContent = isSale ? 'Caparra (€)' : 'Deposito cauzionale (€)';

        const legend = $('cte-economics-legend');
        if (legend) legend.textContent = isSale ? 'Durata e prezzo' : 'Durata e canone';
    }

    /**
     * La data di fine non può precedere quella di inizio. `min` fa segnalare il
     * campo dal browser prima della chiamata; il controllo che conta resta quello
     * dell'API (api/contracts.php), perché questo si aggira banalmente.
     */
    function syncDateBounds() {
        const start = $('cte-start');
        const end   = $('cte-end');
        if (!start || !end) return;
        end.min = start.value || '';
        // Spostando l'inizio oltre una fine già scelta il campo resta valorizzato
        // ma non valido: senza questo messaggio il browser mostra solo un bordo
        // rosso e l'agente non capisce quale delle due date deve cambiare.
        end.setCustomValidity(
            end.value && start.value && end.value < start.value
                ? 'La data di fine non può precedere la data di inizio.'
                : ''
        );
    }

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
            sale_price:    $('cte-price').value,
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
            // Gli avvisi decidono il colore del riquadro: un adeguamento calcolato
            // su un indice non verificato o su un ripiego di media annua non deve
            // avere lo stesso aspetto di uno calcolato sul dato ufficiale.
            const warnings = Array.isArray(d.warnings) ? d.warnings : [];
            box.className = warnings.length ? 'alert alert--warning' : 'alert alert--info';
            box.style.display = 'block';
            box.innerHTML =
                `<strong>Adeguamento ISTAT ${esc(d.baseline_period)} → ${esc(d.target_period)}</strong><br>` +
                `Indice base ${esc(d.baseline_index)} → ${esc(d.target_index)} · ` +
                `variazione ${d.variation_pct}%, applicata ${d.applied_pct}%<br>` +
                `Canone attuale ${eur(d.current_rent)} → <strong>${eur(d.new_rent)}</strong> ` +
                `(+${eur(d.monthly_increase)}/mese, +${eur(d.annual_increase)}/anno)<br>` +
                (warnings.length
                    ? `<small><strong>Attenzione:</strong> ${warnings.map(esc).join(' · ')}</small><br>`
                    : '') +
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
        $('cte-back').addEventListener('click', leave);
        $('cte-cancel').addEventListener('click', leave);
        $('cte-form').addEventListener('submit', save);
        const istatBtn = $('cte-istat-calc');
        if (istatBtn) istatBtn.addEventListener('click', calcIstat);
        $('cte-start').addEventListener('change', syncDateBounds);
        $('cte-end').addEventListener('change', syncDateBounds);
        $('cte-type').addEventListener('change', applyTypeVisibility);

        try { await loadDropdowns(); }
        catch (err) { showAlert('Errore caricamento elenchi: ' + err.message, 'error'); }

        if (isEdit) {
            $('cte-title').textContent = 'Modifica Contratto';
            try { await loadContract(); syncDateBounds(); applyTypeVisibility(); }
            catch (err) { showAlert('Impossibile caricare il contratto: ' + err.message, 'error'); }
        } else {
            $('cte-title').textContent = 'Nuovo Contratto';
            $('cte-type').value = 'locazione';
            applyTypeVisibility();
            $('cte-status').value = ''; // default new contracts to Automatico (date-driven)
            if (vp.propertyId) $('cte-property').value = String(vp.propertyId);
            if (vp.clientId) $('cte-client').value = String(vp.clientId);
            if (vp.tenantId) $('cte-tenant').value = String(vp.tenantId);
            $('cte-title-input').focus();
        }
    }

    init();
})();
