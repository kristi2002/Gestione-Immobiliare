/**
 * Tenant (inquilino) create / edit — dedicated page (replaces the old modal).
 * viewParams: { tenantId } for edit.
 */
(function () {
    'use strict';

    const API       = 'api/tenants.php';
    const PROP_API  = 'api/properties.php';
    const PDF_API   = 'api/generate_pdf.php';
    const RESET_API = 'api/password_reset.php';

    const vp       = window.App?.viewParams || {};
    const tenantId = vp.tenantId || null;
    const isEdit   = !!tenantId;
    let properties = [];
    // Vero appena l'utente tocca un campo. loadTenant() valorizza i campi via
    // assegnazione, che non emette 'input': il caricamento iniziale non sporca.
    let dirty      = false;

    function $(id) { return document.getElementById(id); }
    function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }

    function showAlert(msg, type) {
        const el = $('tne-alert'); if (!el) return;
        el.textContent = msg; el.className = `alert alert--${type}`; el.style.display = 'block';
        clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
    }
    function showError(m) { const el = $('tne-error'); if (el) { el.textContent = m; el.style.display = 'block'; } }
    function clearError() { const el = $('tne-error'); if (el) el.style.display = 'none'; }

    function goBack() { if (window.App) window.App.navigateTo('tenants'); }
    function leave() { if (window.App) window.App.back('tenants'); }

    // Persona fisica vs giuridica: reveal company fields, relabel the anagrafica
    // block as the legale rappresentante, hide the birth fields. Mirrors client_edit.
    function applyPersonType() {
        const isCompany = $('tne-person-type').value === 'giuridica';
        $('tne-company-row').hidden = !isCompany;
        $('tne-company-name').required = isCompany;
        $('tne-birth-place-group').style.display = isCompany ? 'none' : '';
        $('tne-birth-date-group').style.display  = isCompany ? 'none' : '';
        $('tne-name-label').textContent    = isCompany ? 'Nome legale rappr.' : 'Nome';
        $('tne-surname-label').textContent = isCompany ? 'Cognome legale rappr.' : 'Cognome';
        $('tne-anag-legend').textContent      = isCompany ? 'Legale rappresentante' : 'Dati anagrafici';
        $('tne-residence-legend').textContent = isCompany ? 'Sede legale' : 'Residenza';
    }

    async function loadProperties() {
        const j = await fetch(`${PROP_API}?limit=500&page=1`).then(r => r.json());
        if (j.success) {
            properties = (window.Pagination ? window.Pagination.parseResponse(j).items : (j.data?.items || j.data || []))
                .filter(p => p.status !== 'archived');
            $('tne-property').innerHTML = '<option value="">— Seleziona —</option>' +
                properties.map(p => `<option value="${p.id}">${esc(p.address)}, ${esc(p.city)}</option>`).join('');
        }
    }

    async function loadTenant() {
        const j = await fetch(`${API}?id=${tenantId}`).then(r => r.json());
        if (!j.success) throw new Error(j.error);
        const t = j.data;
        $('tne-id').value = t.id;
        $('tne-person-type').value = t.person_type || 'fisica';
        $('tne-company-name').value = t.company_name || '';
        $('tne-vat').value = t.vat_number || '';
        $('tne-name').value = t.name || '';
        $('tne-surname').value = t.surname || '';
        $('tne-cf').value = t.codice_fiscale || '';
        $('tne-birth-place').value = t.birth_place || '';
        $('tne-birth-date').value = t.birth_date || '';
        $('tne-email').value = t.email || '';
        $('tne-phone').value = t.phone || '';
        $('tne-pec').value = t.pec_email || '';
        $('tne-address').value = t.address || '';
        $('tne-city').value = t.city || '';
        $('tne-cap').value = t.cap || '';
        $('tne-province').value = t.province || '';
        applyPersonType();
        $('tne-property').value = t.property_id || '';
        $('tne-lease-start').value = t.lease_start || '';
        $('tne-lease-end').value = t.lease_end || '';
        $('tne-rent').value = t.monthly_rent || '';
        $('tne-notes').value = t.notes || '';
        if ($('tne-iban')) $('tne-iban').value = t.iban || '';
        if ($('tne-sdd-ref')) $('tne-sdd-ref').value = t.sdd_mandate_ref || '';
        if ($('tne-sdd-date')) $('tne-sdd-date').value = t.sdd_mandate_date ? String(t.sdd_mandate_date).substring(0, 10) : '';
    }

    async function save(e) {
        e.preventDefault();
        clearError();
        const id = $('tne-id').value;
        const payload = {
            person_type:     $('tne-person-type').value,
            company_name:    $('tne-company-name').value.trim() || null,
            vat_number:      $('tne-vat').value.trim().toUpperCase() || null,
            name:            $('tne-name').value,
            surname:         $('tne-surname').value,
            codice_fiscale:  $('tne-cf').value.trim().toUpperCase(),
            birth_place:     $('tne-birth-place').value.trim() || null,
            birth_date:      $('tne-birth-date').value || null,
            email:           $('tne-email').value,
            phone:           $('tne-phone').value,
            pec_email:       $('tne-pec').value.trim() || null,
            address:         $('tne-address').value.trim() || null,
            city:            $('tne-city').value.trim() || null,
            cap:             $('tne-cap').value.trim() || null,
            province:        $('tne-province').value.trim().toUpperCase() || null,
            property_id:     $('tne-property').value,
            lease_start:     $('tne-lease-start').value || null,
            lease_end:       $('tne-lease-end').value || null,
            monthly_rent:    $('tne-rent').value || null,
            notes:           $('tne-notes').value,
            iban:            $('tne-iban') ? $('tne-iban').value.trim() : '',
            sdd_mandate_ref: $('tne-sdd-ref') ? $('tne-sdd-ref').value.trim() : '',
            sdd_mandate_date:$('tne-sdd-date') ? ($('tne-sdd-date').value || null) : null,
            portal_password: $('tne-portal-pass').value,
        };
        const btn = $('tne-save');
        btn.disabled = true; btn.textContent = 'Salvataggio...';
        try {
            const res = await fetch(id ? `${API}?id=${id}` : API, {
                method: id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const j = await res.json();
            if (!j.success) throw new Error(j.error);
            goBack();
        } catch (err) {
            showError(err.message);
            btn.disabled = false; btn.textContent = 'Salva';
        }
    }

    async function generatePdf() {
        // Il PDF non e' una fotografia del form: generateContractPdf() rilegge
        // proprietario, immobile e inquilino DAL DATABASE a partire dagli id, e
        // prende dal payload solo canone e date. Su un inquilino mai salvato non
        // c'e' alcun id da rileggere — il contratto usciva con i dati anagrafici
        // digitati e nessun legame con l'archivio (pdf_documents.tenant_id NULL),
        // cioe' un documento che nella scheda dell'inquilino non compare. Il
        // bottone e' quindi nascosto finche' la riga non esiste (vedi init()).
        if (!isEdit) return;
        // Stessa ragione un passo piu' avanti: a form modificato meta' documento
        // verrebbe dal database e meta' dallo schermo, e le due meta' non
        // coinciderebbero. Meglio un rifiuto esplicito di un contratto ibrido.
        if (dirty) {
            showAlert('Salva le modifiche prima di generare il contratto: il PDF legge i dati dall\'archivio.', 'error');
            return;
        }
        const propertyId = $('tne-property').value;
        if (!propertyId) { showAlert('Seleziona un immobile.', 'error'); return; }
        const prop = properties.find(p => p.id == propertyId);
        const payload = {
            type: 'contract',
            property_id: parseInt(propertyId, 10),
            client_id: prop?.client_id,
            tenant_id: $('tne-id').value || null,
            tenant_name: $('tne-name').value + ' ' + $('tne-surname').value,
            tenant_email: $('tne-email').value,
            monthly_rent: $('tne-rent').value,
            lease_start: $('tne-lease-start').value,
            lease_end: $('tne-lease-end').value,
        };
        try {
            const j = await fetch(PDF_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json());
            if (j.success) { window.open(j.data.download, '_blank'); showAlert('Contratto PDF generato.', 'success'); }
            else showAlert(j.error || 'Errore generazione PDF', 'error');
        } catch (err) { showAlert(err.message, 'error'); }
    }

    /**
     * Invia all'inquilino il link con cui SI SCEGLIE la password.
     *
     * Il token non torna mai in questa risposta (tranne in sviluppo, dove non
     * parte nessuna email): se comparisse qui, l'accesso passerebbe di nuovo per
     * le mani dell'agenzia, che e' il punto che questo flusso rimuove.
     */
    async function sendResetLink() {
        const btn = $('tne-portal-reset');
        const id  = $('tne-id').value;
        if (!id) return;

        btn.disabled = true;
        const label = btn.innerHTML;
        btn.textContent = 'Invio…';
        try {
            const j = await fetch(RESET_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subject_type: 'tenant', subject_id: parseInt(id, 10) }),
            }).then(r => r.json());

            if (!j.success) throw new Error(j.error);

            const scade = j.data.expires_at ? ` Scade il ${j.data.expires_at.substring(0, 16).replace('T', ' ')}.` : '';
            if (j.data.simulated) {
                // MAIL_ENABLED=false: nessuna email e- partita davvero. Dire
                // "inviata" farebbe cercare per mezz'ora un messaggio inesistente.
                showAlert(`Invio SIMULATO (email disattivate): nessun messaggio e' partito. Link: ${j.data.link}`, 'warning');
            } else {
                showAlert(`Link di accesso inviato a ${j.data.email}.${scade}`, 'success');
            }
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = label;
            if (window.lucide) window.lucide.createIcons();
        }
    }

    async function init() {
        $('tne-cancel').addEventListener('click', leave);
        $('tne-form').addEventListener('submit', save);
        $('tne-pdf').addEventListener('click', generatePdf);
        $('tne-person-type').addEventListener('change', applyPersonType);

        // Su un nuovo inquilino il contratto non e' generabile: non esiste ancora
        // la riga a cui agganciarlo. Nascosto, non disabilitato — un bottone
        // grigio accanto a "Salva" si legge come un permesso mancante.
        $('tne-pdf').hidden = !isEdit;
        $('tne-form').addEventListener('input',  () => { dirty = true; });
        $('tne-form').addEventListener('change', () => { dirty = true; });

        // Su un inquilino esistente la password non si digita piu': si manda il
        // link e la sceglie lui. Il campo resta solo alla creazione, dove non
        // c'e' ancora una riga a cui agganciare un token.
        $('tne-portal-pass-group').hidden  = isEdit;
        $('tne-portal-reset-group').hidden = !isEdit;
        $('tne-portal-reset').addEventListener('click', sendResetLink);

        try { await loadProperties(); }
        catch (err) { showAlert('Errore caricamento immobili: ' + err.message, 'error'); }

        if (isEdit) {
            $('tne-title').textContent = 'Modifica inquilino';
            try { await loadTenant(); }
            catch (err) { showAlert('Impossibile caricare l\'inquilino: ' + err.message, 'error'); }
        } else {
            $('tne-title').textContent = 'Nuovo inquilino';
            applyPersonType();
            $('tne-name').focus();
        }
    }

    init();
})();
