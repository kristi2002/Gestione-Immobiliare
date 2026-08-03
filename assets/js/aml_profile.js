/**
 * Fascicolo antiriciclaggio — scheda di una singola pratica.
 * viewParams: { amlId }
 *
 * Esiste per due motivi che l'elenco non poteva coprire:
 *
 *  1. le copie dei documenti raccolti in adeguata verifica (art. 31) hanno
 *     bisogno di un posto che sia la pratica, non la cartella del proprietario:
 *     `documents.aml_record_id`, aggiunto in phase94;
 *  2. lo scadenzario e le notifiche puntavano alla lista, non alla riga —
 *     "conservazione in scadenza per Rossi" apriva 200 pratiche.
 *
 * Il riquadro di conformità in cima dice cosa MANCA. Una scheda che elenca solo
 * i campi compilati è un modulo in sola lettura: qui l'unica cosa che serve
 * davvero, davanti a un'ispezione, è sapere dove il fascicolo è incompleto.
 */
(function () {
    'use strict';

    const API      = 'api/aml.php';
    const DOCS_API = 'api/documents.php';

    const vp    = window.App?.viewParams || {};
    const amlId = vp.amlId || null;

    const RISK_LABEL   = { basso: 'Rischio basso', medio: 'Rischio medio', alto: 'Rischio alto' };
    const RISK_BADGE   = { basso: 'badge--success', medio: 'badge--warning', alto: 'badge--danger' };
    const STATUS_LABEL = { da_completare: 'Da completare', completata: 'Completata', sospesa: 'Sospesa' };
    const STATUS_BADGE = { da_completare: 'badge--warning', completata: 'badge--success', sospesa: 'badge' };
    const VERIF_LABEL  = { ordinaria: 'Verifica ordinaria', semplificata: 'Verifica semplificata', rafforzata: 'Verifica rafforzata' };
    const SUBJ_LABEL   = { persona_fisica: 'Persona fisica', persona_giuridica: 'Persona giuridica' };
    const OP_LABEL     = { vendita: 'Vendita', locazione: 'Locazione', mediazione: 'Mediazione', altro: 'Altro' };
    const DOC_LABEL    = {
        id: 'Documento d\'identità', id_front: 'Documento — fronte', id_back: 'Documento — retro',
        other: 'Altro', contract: 'Contratto', invoice: 'Fattura',
    };

    let rec = null;

    function $(id) { return document.getElementById(id); }
    function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }
    function fmtDate(s) { return window.Fmt.date(s); }

    function showAlert(msg, type) {
        const el = $('amp-alert');
        el.textContent = msg; el.className = `alert alert--${type}`; el.style.display = 'block';
        clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 4000);
    }

    function fmtMoney(v) {
        if (v == null || v === '') return null;
        return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(v));
    }

    /** Giorni da oggi a una data ISO, negativo se passata. */
    function daysUntil(iso) {
        if (!iso) return null;
        const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
        if (isNaN(d)) return null;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        return Math.round((d - today) / 86400000);
    }

    function row(icon, label, value) {
        return `<div class="scheda-row">
            <span class="scheda-row__label"><i data-lucide="${icon}"></i> ${esc(label)}</span>
            <span class="scheda-row__value">${value}</span>
        </div>`;
    }

    // ── Caricamento ──────────────────────────────────────────────────

    async function load() {
        if (!amlId) { $('amp-title').textContent = 'Pratica non specificata'; return; }
        try {
            const j = await fetch(`${API}?id=${amlId}`).then(r => r.json());
            if (!j.success) throw new Error(j.error);
            rec = j.data;
            render();
            loadDocuments();
        } catch (err) {
            $('amp-title').textContent = 'Pratica non trovata';
            showAlert(err.message, 'error');
        }
    }

    // ── Render ───────────────────────────────────────────────────────

    function renderHero() {
        const pep = Number(rec.is_pep) === 1;
        $('amp-badges').innerHTML =
            `<span class="badge ${RISK_BADGE[rec.risk_level] || 'badge'}">${esc(RISK_LABEL[rec.risk_level] || rec.risk_level)}</span>` +
            `<span class="badge">${esc(VERIF_LABEL[rec.verification_type] || rec.verification_type)}</span>` +
            `<span class="badge ${STATUS_BADGE[rec.status] || 'badge'}">${esc(STATUS_LABEL[rec.status] || rec.status)}</span>` +
            (pep ? '<span class="badge badge--danger" title="Persona Politicamente Esposta">PEP</span>' : '');

        $('amp-title').textContent = rec.subject_name || 'Soggetto senza nome';
        window.App?.setCrumb(rec.subject_name || 'Fascicolo');

        const idcode = rec.codice_fiscale || rec.partita_iva;
        $('amp-meta').innerHTML =
            `<span><i data-lucide="user"></i> ${esc(SUBJ_LABEL[rec.subject_type] || rec.subject_type)}</span>` +
            (idcode ? `<span><i data-lucide="hash"></i> ${esc(idcode)}</span>` : '') +
            `<span><i data-lucide="briefcase"></i> ${esc(OP_LABEL[rec.operation_type] || rec.operation_type)}</span>`;
    }

    /**
     * Quello che manca al fascicolo, in ordine di gravità.
     * Ogni voce è una cosa che un'ispezione contesterebbe, non un campo vuoto.
     */
    function renderCompliance() {
        const issues = [];
        const pep    = Number(rec.is_pep) === 1;
        const docs   = Number(rec.document_count) || 0;

        // Il vincolo di legge: alto rischio o PEP => misure rafforzate. Il form
        // lo impedisce, ma una riga importata o creata via API può violarlo.
        if ((rec.risk_level === 'alto' || pep) && rec.verification_type !== 'rafforzata') {
            issues.push(['error', 'shield-alert',
                'Rischio alto o soggetto PEP con verifica non rafforzata: gli artt. 24-25 richiedono le misure rafforzate.']);
        }

        // Il motivo per cui questa pagina esiste.
        if (!docs) {
            issues.push([rec.status === 'completata' ? 'error' : 'warning', 'file-x',
                rec.status === 'completata'
                    ? 'Pratica completata senza alcuna copia allegata: l\'art. 31 chiede di conservare copia dei documenti acquisiti.'
                    : 'Nessuna copia del documento allegata. Va acquisita prima di chiudere la pratica.']);
        }

        if (!rec.verification_date) {
            issues.push(['warning', 'calendar-x',
                'Manca la data di adeguata verifica: senza quella non decorrono i dieci anni di conservazione.']);
        }

        if (rec.status === 'da_completare') {
            issues.push(['warning', 'clock',
                'Pratica ancora da completare.']);
        }

        // Il documento era già scaduto quando è stato usato per identificare.
        const idExp = daysUntil(rec.id_document_expiry);
        if (idExp !== null && rec.verification_date) {
            const gap = daysUntil(rec.verification_date);
            if (idExp < gap) {
                issues.push(['warning', 'id-card',
                    'Il documento d\'identità risulta scaduto alla data della verifica.']);
            }
        }

        const ret = daysUntil(rec.retention_until);
        if (ret !== null && ret < 0) {
            issues.push(['info', 'archive',
                `Conservazione decennale conclusa il ${fmtDate(rec.retention_until)}: la pratica può essere archiviata o eliminata.`]);
        } else if (ret !== null && ret <= 180) {
            issues.push(['info', 'calendar-clock',
                `Conservazione in scadenza fra ${ret} giorni (${fmtDate(rec.retention_until)}).`]);
        }

        const box = $('amp-compliance');
        if (!issues.length) {
            box.innerHTML = `<div class="alert alert--success" style="margin-bottom:1rem;">
                <i data-lucide="shield-check"></i> Fascicolo completo: soggetto identificato, copia acquisita, verifica coerente col rischio.
            </div>`;
            return;
        }
        box.innerHTML = `<div class="card" style="margin-bottom:1rem;padding:1rem;">
            <div class="appt-card__header" style="margin-bottom:.5rem;">
                <i data-lucide="clipboard-check"></i><h3>Da sistemare</h3>
            </div>
            ${issues.map(([sev, icon, text]) => `
                <div class="alert alert--${sev}" style="margin:.35rem 0;">
                    <i data-lucide="${icon}"></i> ${esc(text)}
                </div>`).join('')}
        </div>`;
    }

    function renderSubject() {
        $('amp-subject').innerHTML =
            row('user', 'Nominativo', esc(rec.subject_name || '—')) +
            row('users', 'Tipo', esc(SUBJ_LABEL[rec.subject_type] || rec.subject_type || '—')) +
            row('hash', 'Codice fiscale', esc(rec.codice_fiscale || '—')) +
            row('building', 'Partita IVA', esc(rec.partita_iva || '—')) +
            row('user-check', 'Titolare effettivo',
                esc(rec.beneficial_owner || (rec.subject_type === 'persona_giuridica' ? '— (da indicare)' : '— (coincide col soggetto)'))) +
            row('landmark', 'PEP', Number(rec.is_pep) === 1 ? 'Sì' : 'No');
    }

    function renderOperation() {
        const val = fmtMoney(rec.operation_value);
        let html = `<div class="scheda-rows">
            ${row('briefcase', 'Tipo', esc(OP_LABEL[rec.operation_type] || rec.operation_type || '—'))}
            ${row('euro', 'Valore', val ? esc(val) : '—')}
            ${row('user', 'Proprietario collegato', esc(rec.client_name || '—'))}
            ${row('home', 'Immobile collegato', esc(rec.property_address || '—'))}
            ${row('target', 'Scopo e natura', esc(rec.purpose || '—'))}
        </div>`;

        if (rec.property_id) {
            html += `<button class="btn btn--ghost btn--sm appt-card__cta" id="amp-goto-property">
                <i data-lucide="arrow-right"></i> Apri scheda immobile
            </button>`;
        }
        $('amp-operation').innerHTML = html;

        $('amp-goto-property')?.addEventListener('click', () => {
            window.App?.navigateTo('property_profile', { propertyId: Number(rec.property_id) });
        });
    }

    function renderRisk() {
        $('amp-risk').innerHTML =
            row('gauge', 'Livello di rischio',
                `<span class="badge ${RISK_BADGE[rec.risk_level] || 'badge'}">${esc(RISK_LABEL[rec.risk_level] || rec.risk_level || '—')}</span>`) +
            row('shield-check', 'Tipo di verifica', esc(VERIF_LABEL[rec.verification_type] || rec.verification_type || '—')) +
            row('landmark', 'Persona Politicamente Esposta', Number(rec.is_pep) === 1 ? 'Sì' : 'No');
    }

    function renderOutcome() {
        const ret = daysUntil(rec.retention_until);
        const retNote = ret === null ? ''
            : ret < 0 ? ' <small class="text-muted">(conclusa)</small>'
            : ` <small class="text-muted">(fra ${ret} giorni)</small>`;

        $('amp-outcome').innerHTML =
            row('calendar-check', 'Data adeguata verifica', esc(fmtDate(rec.verification_date) || '—')) +
            row('activity', 'Stato',
                `<span class="badge ${STATUS_BADGE[rec.status] || 'badge'}">${esc(STATUS_LABEL[rec.status] || rec.status || '—')}</span>`) +
            row('archive', 'Conservazione fino a', (esc(fmtDate(rec.retention_until)) || '—') + retNote);
    }

    function renderIdDoc() {
        $('amp-iddoc').innerHTML =
            row('id-card', 'Tipo documento', esc(rec.id_document_type || '—')) +
            row('hash', 'Numero', esc(rec.id_document_number || '—')) +
            row('calendar-x', 'Scadenza', esc(fmtDate(rec.id_document_expiry) || '—'));
    }

    function renderNotes() {
        $('amp-notes').innerHTML = rec.notes
            ? `<p class="appt-notes">${esc(rec.notes)}</p>`
            : '<p class="text-muted">Nessuna nota.</p>';
    }

    function renderFootnote() {
        $('amp-footnote').textContent =
            `Pratica #${rec.id} · creata il ${window.Fmt.dateTime(rec.created_at)}` +
            (rec.updated_at && rec.updated_at !== rec.created_at
                ? ` · ultimo aggiornamento ${window.Fmt.dateTime(rec.updated_at)}` : '');
    }

    function render() {
        renderHero();
        renderCompliance();
        renderSubject();
        renderOperation();
        renderRisk();
        renderOutcome();
        renderIdDoc();
        renderNotes();
        renderFootnote();
        if (window.lucide) window.lucide.createIcons();
    }

    // ── Documenti ────────────────────────────────────────────────────

    async function loadDocuments() {
        const list = $('amp-docs-list');
        try {
            const j = await fetch(`${DOCS_API}?aml_record_id=${amlId}&limit=100`).then(r => r.json());
            if (!j.success) throw new Error(j.error);
            const items = (j.data && j.data.items) || [];

            list.innerHTML = items.length
                ? `<div class="table-wrapper" style="margin-top:.75rem;"><table class="data-table">
                       <thead><tr><th>Tipo</th><th>Documento</th><th>Data</th><th class="col-actions">Azioni</th></tr></thead>
                       <tbody>${items.map(d => `<tr>
                           <td data-label="Tipo"><span class="badge">${esc(DOC_LABEL[d.doc_type] || d.doc_type)}</span></td>
                           <td data-label="Documento">${esc(d.title || d.original_name)}</td>
                           <td data-label="Data">${esc(fmtDate(d.created_at))}</td>
                           <td data-label="Azioni" class="lt-actions">
                               <a class="btn btn--sm btn--ghost" href="${esc(d.download_url)}" target="_blank" rel="noopener">Scarica</a>
                               <button class="btn btn--sm btn--ghost btn-amp-doc-del" data-id="${d.id}">Elimina</button>
                           </td></tr>`).join('')}</tbody>
                   </table></div>`
                : `<p class="text-muted" style="margin-top:.75rem;">
                       Nessuna copia allegata. L'art. 31 chiede di conservare per dieci anni copia dei documenti
                       acquisiti in sede di adeguata verifica: allegala qui, dove sta la pratica che la giustifica.
                   </p>`;

            list.querySelectorAll('.btn-amp-doc-del').forEach(b =>
                b.addEventListener('click', () => deleteDocument(b.dataset.id)));
            if (window.lucide) window.lucide.createIcons();
        } catch (err) {
            list.innerHTML = `<p class="text-muted">${esc(err.message)}</p>`;
        }
    }

    async function uploadDocument(e) {
        e.preventDefault();
        const fileInput = $('amp-doc-file');
        if (!fileInput.files.length) { showAlert('Seleziona un file.', 'error'); return; }

        const fd = new FormData();
        fd.append('aml_record_id', amlId);
        fd.append('doc_type', $('amp-doc-type').value);
        fd.append('title',    $('amp-doc-title-input').value.trim());
        fd.append('notes',    $('amp-doc-notes').value.trim());
        fd.append('file',     fileInput.files[0]);

        const btn = $('amp-doc-save');
        btn.disabled = true; btn.textContent = 'Caricamento…';
        try {
            const j = await fetch(DOCS_API, { method: 'POST', body: fd }).then(r => r.json());
            if (!j.success) throw new Error(j.error);
            closeDocModal();
            showAlert('Copia allegata alla pratica.', 'success');
            // Il conteggio vive sul record: il riquadro di conformità va rifatto.
            rec.document_count = (Number(rec.document_count) || 0) + 1;
            renderCompliance();
            if (window.lucide) window.lucide.createIcons();
            loadDocuments();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Carica';
        }
    }

    async function deleteDocument(id) {
        if (!await window.confirmDialog(
            'Eliminare questa copia dal fascicolo? Se la pratica è ancora in conservazione, il documento va sostituito.',
            { title: 'Elimina copia' })) return;
        try {
            const j = await fetch(`${DOCS_API}?id=${id}`, { method: 'DELETE' }).then(r => r.json());
            if (!j.success) throw new Error(j.error);
            showAlert('Copia eliminata.', 'success');
            rec.document_count = Math.max(0, (Number(rec.document_count) || 0) - 1);
            renderCompliance();
            if (window.lucide) window.lucide.createIcons();
            loadDocuments();
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    function openDocModal()  { $('amp-doc-modal').hidden = false; }
    function closeDocModal() {
        $('amp-doc-modal').hidden = true;
        $('amp-doc-form').reset();
    }

    // ── Azioni sulla pratica ─────────────────────────────────────────

    async function remove() {
        if (!await window.confirmDialog(
            `Eliminare la pratica antiriciclaggio di ${rec.subject_name}?`,
            { title: 'Elimina pratica' })) return;
        try {
            const j = await fetch(`${API}?id=${rec.id}`, { method: 'DELETE' }).then(r => r.json());
            if (!j.success) throw new Error(j.error);
            window.App?.navigateTo('aml');
        } catch (err) { showAlert(err.message, 'error'); }
    }

    function init() {
        $('amp-edit').addEventListener('click', () => {
            window.App?.navigateTo('entity_edit', { entity: 'aml', id: Number(amlId) });
        });
        $('amp-delete').addEventListener('click', remove);

        $('amp-doc-add').addEventListener('click', openDocModal);
        $('amp-doc-close').addEventListener('click', closeDocModal);
        $('amp-doc-cancel').addEventListener('click', closeDocModal);
        $('amp-doc-modal').addEventListener('click', e => { if (e.target === $('amp-doc-modal')) closeDocModal(); });
        $('amp-doc-form').addEventListener('submit', uploadDocument);

        load();
    }

    init();
})();
