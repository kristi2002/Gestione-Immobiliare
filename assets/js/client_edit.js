/**
 * Client edit / create — dedicated page (replaces the old modal).
 * Reads window.App.viewParams.clientId for edit mode; absent => create mode.
 */
(function () {
    'use strict';

    const API        = 'api/clients.php';
    const DOCS_API   = 'api/documents.php';
    const REPORT_API = 'api/generate_owner_report.php';

    const clientId = window.App?.viewParams?.clientId || null;
    const isEdit   = !!clientId;

    function $(id) { return document.getElementById(id); }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str == null ? '' : str;
        return div.innerHTML;
    }

    function showAlert(message, type) {
        const el = $('ce-alert');
        if (!el) return;
        el.textContent = message;
        el.className = `alert alert--${type}`;
        el.style.display = 'block';
        clearTimeout(el._t);
        el._t = setTimeout(() => { el.style.display = 'none'; }, 4000);
    }

    function showError(message) {
        // #ce-error sits just above the sticky action bar, below the fold on a
        // form this long: without scrolling it in, Salva looks like it did nothing.
        window.FormGuard.reportError($('ce-error'), message);
    }
    function clearError() {
        window.FormGuard.clearError($('ce-error'));
        const dup = $('ce-duplicate');
        if (dup) dup.style.display = 'none';
    }

    // ── Anti-duplicati ──────────────────────────────────────────────────────
    // L'indice unico copre solo il codice fiscale: due schede della stessa
    // persona con CF diversi (o senza) restano possibili, e da lì nascono i
    // proprietari elencati due o tre volte con gli immobili sparsi tra loro.
    // Qui l'inserimento non viene bloccato — viene mostrato cosa esiste già.
    let duplicateAcknowledged = false;

    // Guardia "modifiche non salvate", assegnata in init() e consultata da
    // leave(). Dichiarate qui: il file gira in strict mode, e senza
    // dichiarazione l'assegnamento in init() sollevava un ReferenceError che
    // interrompeva l'inizializzazione a meta' — modulo muto da li' in poi.
    let guard  = null;
    let saving = false;

    async function findDuplicates(data) {
        const params = new URLSearchParams({ action: 'check_duplicate' });
        if (clientId) params.set('exclude_id', clientId);
        ['name', 'surname', 'email', 'phone', 'codice_fiscale'].forEach(f => {
            if (data[f]) params.set(f, data[f]);
        });
        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            return json.success ? (json.data.matches || []) : [];
        } catch (_) {
            return []; // il controllo è un aiuto, non deve impedire di salvare
        }
    }

    function showDuplicateWarning(matches, onProceed) {
        const el = $('ce-duplicate');
        if (!el) { onProceed(); return; }

        el.innerHTML = `
            <strong>Forse questo proprietario esiste già.</strong>
            <ul style="margin:8px 0 10px 18px">
                ${matches.map(m => `
                    <li>
                        <button type="button" class="btn-link" data-open="${m.id}">
                            ${escapeHtml(m.name)} ${escapeHtml(m.surname)}
                        </button>
                        — ${escapeHtml(m.email || 'nessuna email')} · ${escapeHtml(m.phone || 'nessun telefono')}
                        · ${m.property_count} immobili
                        ${m.status === 'archived' ? ' <em>(archiviato)</em>' : ''}
                        <br><span class="text-muted">corrisponde per: ${escapeHtml((m.match_reasons || []).join(', '))}</span>
                    </li>`).join('')}
            </ul>
            <button type="button" class="btn btn--sm btn--ghost" id="ce-dup-proceed">Salva comunque, è una persona diversa</button>`;
        el.style.display = 'block';
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        el.querySelectorAll('[data-open]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (window.App) window.App.navigateTo('client_profile', { clientId: Number(btn.dataset.open) });
            });
        });
        $('ce-dup-proceed').addEventListener('click', () => {
            duplicateAcknowledged = true;
            el.style.display = 'none';
            onProceed();
        });
    }

    function goBack() {
        if (!window.App) return;
        if (isEdit) window.App.navigateTo('client_profile', { clientId });
        else window.App.navigateTo('clients');
    }
    // "Indietro"/"Annulla" ripercorrono il cammino fatto; la scheda (o l'elenco)
    // resta come ripiego quando il form e' la prima pagina aperta.
    function leave() {
        if (!window.App) return;
        if (guard && !guard.confirmLeave()) return;
        if (guard) guard.detach();
        // Chiesto qui: il router non deve richiederlo una seconda volta.
        window.App.setLeaveGuard(null);
        if (isEdit) window.App.back('client_profile', { clientId });
        else window.App.back('clients');
    }

    // Persona fisica vs giuridica: reveal company fields, relabel the anagrafica
    // block as the legale rappresentante, and hide the birth fields (a company
    // is not born). Keeps the form honest for mandato/contratto generation.
    function applyPersonType() {
        const isCompany = $('ce-person-type').value === 'giuridica';
        $('ce-company-row').hidden = !isCompany;
        $('ce-company-name').required = isCompany;
        $('ce-birth-place-group').style.display = isCompany ? 'none' : '';
        $('ce-birth-date-group').style.display  = isCompany ? 'none' : '';
        $('ce-name-label').textContent    = isCompany ? 'Nome legale rappr.' : 'Nome';
        $('ce-surname-label').textContent = isCompany ? 'Cognome legale rappr.' : 'Cognome';
        $('ce-anag-legend').textContent      = isCompany ? 'Legale rappresentante' : 'Dati anagrafici';
        $('ce-residence-legend').textContent = isCompany ? 'Sede legale' : 'Residenza';
    }

    // Populate the "Agente di riferimento" dropdown from active agents.
    async function loadAgents(selectedId) {
        const sel = $('ce-agent');
        if (!sel) return;
        try {
            const res  = await fetch(`${API}?action=agents`);
            const json = await res.json();
            if (!json.success) return;
            (json.data || []).forEach(a => {
                const opt = document.createElement('option');
                opt.value = String(a.id);
                opt.textContent = a.username;
                sel.appendChild(opt);
            });
            if (selectedId != null && selectedId !== '') sel.value = String(selectedId);
        } catch (_) { /* leave the "Non assegnato" default */ }
    }

    async function loadClient() {
        try {
            const res  = await fetch(`${API}?id=${clientId}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const c = json.data;
            $('ce-id').value           = c.id;
            $('ce-person-type').value  = c.person_type || 'fisica';
            $('ce-company-name').value = c.company_name || '';
            $('ce-vat').value          = c.vat_number || '';
            $('ce-name').value         = c.name || '';
            $('ce-surname').value      = c.surname || '';
            $('ce-cf').value           = c.codice_fiscale || '';
            $('ce-birth-place').value  = c.birth_place || '';
            $('ce-birth-date').value   = c.birth_date || '';   // MySQL DATE => 'YYYY-MM-DD'
            $('ce-phone').value        = c.phone || '';
            $('ce-email').value        = c.email || '';
            $('ce-pec').value          = c.pec_email || '';
            $('ce-address').value      = c.address || '';
            $('ce-city').value         = c.city || '';
            $('ce-cap').value          = c.cap || '';
            $('ce-province').value     = c.province || '';
            $('ce-status').value       = c.status || 'active';
            $('ce-notes').value        = c.internal_notes || '';
            $('ce-marketing-consent').checked = c.marketing_consent === true;
            applyPersonType();
            await loadAgents(c.assigned_agent_id);
        } catch (err) {
            showAlert('Impossibile caricare il proprietario: ' + err.message, 'error');
        }
    }

    async function loadIdSide(containerId, docType) {
        const container = $(containerId);
        if (!container) return;
        container.innerHTML = '<p class="text-muted" style="font-size:13px;margin:0;">Caricamento...</p>';
        try {
            const res  = await fetch(`${DOCS_API}?doc_type=${docType}&client_id=${clientId}&limit=1`);
            const json = await res.json();
            const doc  = json.data?.items?.[0] || null;
            if (!doc) {
                container.innerHTML = '<p class="text-muted" style="font-size:13px;margin:0;">Non caricato</p>';
                return;
            }
            container.innerHTML = `
                <div class="id-card-row">
                    <span style="font-size:13px;"><i data-lucide="file-text"></i> ${escapeHtml(doc.original_name)}</span>
                    <a href="${escapeHtml(doc.download_url)}" target="_blank" class="btn btn--xs btn--ghost"><i data-lucide="printer"></i> Stampa</a>
                </div>`;
        } catch (_) {
            container.innerHTML = '<p class="text-muted" style="font-size:13px;margin:0;">Errore di caricamento.</p>';
        }
    }

    function loadIdDocs() {
        loadIdSide('ce-id-front-status', 'id_front');
        loadIdSide('ce-id-back-status', 'id_back');
    }

    async function uploadId(file, docType) {
        if (!clientId) { showAlert('Salva prima il proprietario, poi potrai caricare la carta d\'identità.', 'error'); return; }
        const btnId    = docType === 'id_front' ? 'ce-btn-front' : 'ce-btn-back';
        const btnLabel = docType === 'id_front' ? '<i data-lucide="upload"></i> Carica Fronte' : '<i data-lucide="upload"></i> Carica Retro';
        const title    = docType === 'id_front' ? 'CI - Fronte' : 'CI - Retro';
        const fd = new FormData();
        fd.append('file', file);
        fd.append('doc_type', docType);
        fd.append('client_id', clientId);
        fd.append('title', title);
        const btn = $(btnId);
        if (btn) { btn.disabled = true; btn.textContent = 'Caricamento...'; }
        try {
            const res  = await fetch(DOCS_API, { method: 'POST', body: fd });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert('Documento caricato.', 'success');
            loadIdSide(docType === 'id_front' ? 'ce-id-front-status' : 'ce-id-back-status', docType);
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = btnLabel; }
        }
    }

    async function save(e) {
        e.preventDefault();
        clearError();
        // Una data obbligatoria non la blocca il browser: datepicker.js la mette
        // in sola lettura, e un controllo readonly esce dalla validazione HTML.
        const missingDate = window.FormGuard.checkReadonlyRequired($('ce-form'));
        if (missingDate) { showError(window.FormGuard.labelOf(missingDate) + ' è obbligatorio.'); return; }
        const data = {
            person_type:    $('ce-person-type').value,
            company_name:   $('ce-company-name').value.trim() || null,
            vat_number:     $('ce-vat').value.trim().toUpperCase() || null,
            name:           $('ce-name').value.trim(),
            surname:        $('ce-surname').value.trim(),
            codice_fiscale: $('ce-cf').value.trim().toUpperCase() || null,
            birth_place:    $('ce-birth-place').value.trim() || null,
            birth_date:     $('ce-birth-date').value || null,
            phone:          $('ce-phone').value.trim(),
            email:          $('ce-email').value.trim(),
            pec_email:      $('ce-pec').value.trim() || null,
            address:        $('ce-address').value.trim() || null,
            city:           $('ce-city').value.trim() || null,
            cap:            $('ce-cap').value.trim() || null,
            province:       $('ce-province').value.trim().toUpperCase() || null,
            status:         $('ce-status').value,
            internal_notes: $('ce-notes').value.trim(),
            assigned_agent_id: $('ce-agent').value ? Number($('ce-agent').value) : null,
            marketing_consent: $('ce-marketing-consent').checked ? 1 : 0,
        };

        const saveBtn = $('ce-save');

        // Solo in creazione: in modifica il record esiste già, avvisare che
        // "assomiglia a se stesso" sarebbe rumore.
        if (!clientId && !duplicateAcknowledged) {
            saveBtn.disabled = true;
            const matches = await findDuplicates(data);
            saveBtn.disabled = false;
            if (matches.length) {
                showDuplicateWarning(matches, () => persist(data));
                return;
            }
        }

        await persist(data);
    }

    async function persist(data) {
        const id      = $('ce-id').value;
        const saveBtn = $('ce-save');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Salvataggio...';
        // Un salvataggio in corso non e' una modifica da perdere.
        saving = true;
        try {
            const url    = id ? `${API}?id=${id}` : API;
            const method = id ? 'PUT' : 'POST';
            const res  = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            // Salvato: spegnere la guardia PRIMA di navigare, altrimenti il
            // router chiede "vuoi perdere le modifiche?" su una scheda gia'
            // scritta, e un Annulla lascia l'utente sul modulo convinto che il
            // salvataggio non sia andato a buon fine.
            if (guard) { guard.markClean(); guard.detach(); }
            window.App?.setLeaveGuard(null);

            const newId = id || json.data?.id;
            if (window.App && newId) window.App.navigateTo('client_profile', { clientId: Number(newId) });
            else if (window.App) window.App.navigateTo('clients');
        } catch (err) {
            saving = false;
            showError(err.message);
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Salva';
        }
    }

    // ----- Owner report -----
    function openReport() {
        $('ce-report-month').value = '';
        $('ce-report-year').value  = new Date().getFullYear();
        $('ce-report-modal').hidden = false;
    }
    function closeReport() { $('ce-report-modal').hidden = true; }
    async function generateReport() {
        const btn = $('ce-report-generate');
        btn.disabled = true; btn.textContent = 'Generazione...';
        try {
            const res = await fetch(REPORT_API, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: clientId,
                    month: $('ce-report-month').value || null,
                    year:  $('ce-report-year').value,
                }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeReport();
            window.open(json.data.download, '_blank');
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Genera PDF';
        }
    }

    function init() {
        $('ce-cancel').addEventListener('click', leave);
        $('ce-form').addEventListener('submit', save);
        guard = window.FormGuard.guardUnsaved($('ce-form'), { isSaving: () => saving });
        // La pagina non ha più un suo "Indietro": si esce dalle briciole, dalla
        // freccia o dalla barra laterale, e il router chiede qui prima di farlo.
        window.App?.setLeaveGuard(() => guard.confirmLeave());
        // Nascere domani non e' previsto. Il campo (e l'API) accettavano date future.
        const birth = $('ce-birth-date');
        if (birth) birth.max = new Date().toISOString().slice(0, 10);
        // Un campo obbligatorio dentro un <details> chiuso non e' focalizzabile.
        $('ce-form').addEventListener('invalid', (e) => window.FormGuard.revealField(e.target), true);
        $('ce-person-type').addEventListener('change', applyPersonType);

        // ID card uploads
        $('ce-btn-front').addEventListener('click', () => $('ce-id-front-file').click());
        $('ce-id-front-file').addEventListener('change', (e) => {
            const f = e.target.files[0]; e.target.value = '';
            if (f) uploadId(f, 'id_front');
        });
        $('ce-btn-back').addEventListener('click', () => $('ce-id-back-file').click());
        $('ce-id-back-file').addEventListener('change', (e) => {
            const f = e.target.files[0]; e.target.value = '';
            if (f) uploadId(f, 'id_back');
        });

        // Owner report
        $('ce-report').addEventListener('click', openReport);
        $('ce-report-close').addEventListener('click', closeReport);
        $('ce-report-cancel').addEventListener('click', closeReport);
        $('ce-report-generate').addEventListener('click', generateReport);
        $('ce-report-modal').addEventListener('click', (e) => {
            if (e.target === $('ce-report-modal')) closeReport();
        });

        if (isEdit) {
            $('ce-title').textContent = 'Modifica Proprietario';
            $('ce-id-card-section').hidden = false;
            $('ce-report').hidden = false;
            loadClient();
            loadIdDocs();
        } else {
            $('ce-title').textContent = 'Nuovo Proprietario';
            applyPersonType();
            loadAgents();
            // Show the Carta di Identità card too, but uploads need a saved owner.
            $('ce-id-card-section').hidden = false;
            const hint = '<p class="text-muted" style="font-size:13px;margin:0;">Salva il proprietario per caricare</p>';
            $('ce-id-front-status').innerHTML = hint;
            $('ce-id-back-status').innerHTML = hint;
        }
        $('ce-name').focus();
    }

    init();
})();
