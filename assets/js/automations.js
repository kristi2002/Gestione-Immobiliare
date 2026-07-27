/**
 * Automazioni verso i Clienti.
 *
 * "Automazione" non è un'entità propria: è una riga `reminders` con
 * notify_client=1, filtrata a `series=parents` (la REGOLA, non le sue 12
 * occorrenze mensili) e `trigger=all` (anche le regole a evento, che le altre
 * pagine devono invece ignorare — hanno una data fittizia).
 *
 * phase66 aggiunge: token dinamici, immobile, contatto su tutta la rubrica,
 * ora di invio, regola del giorno, trigger a evento, esiti di consegna.
 */
(function () {
    'use strict';

    const API            = 'api/reminders.php';
    const PROPERTIES_API = 'api/properties.php';

    const FREQ_LABELS = {
        once:      'Una tantum',
        weekly:    'Settimanale',
        biweekly:  'Quindicinale',
        monthly:   'Mensile',
        quarterly: 'Trimestrale',
        yearly:    'Annuale',
    };

    const STATUS_LABELS = {
        pending:   'Attiva',
        completed: 'Completata',
        cancelled: 'In pausa',
    };

    const CONTACT_LABELS = {
        client: 'Proprietario',
        lead:   'Lead',
        tenant: 'Inquilino',
    };

    const DISPATCH_LABELS = {
        sent:      { text: 'Consegnata',  cls: 'success' },
        simulated: { text: 'Simulata',    cls: 'warning' },
        failed:    { text: 'Fallita',     cls: 'error' },
        skipped:   { text: 'Saltata',     cls: 'warning' },
    };

    const DOW_LABELS = ['', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];
    const NTH_LABELS = { 1: 'Il primo', 2: 'Il secondo', 3: 'Il terzo', 4: 'Il quarto', last: "L'ultimo" };

    let automations = [];
    let vocabulary  = { token_groups: {}, events: {}, recipient_rules: {}, event_token_group: 'Evento' };
    let currentPage = 1;
    const PAGE_LIMIT = 25;
    let searchTimer  = null;

    // Il datalist restituisce l'etichetta scelta, non un id: queste due mappe
    // fanno la traduzione nei due versi (scelta → FK, FK → etichetta in modifica).
    const contactsByLabel = new Map();
    const contactsByKey   = new Map();

    // Un token va inserito dove stava il cursore: senza ricordare quale campo
    // era attivo, cliccare la pillola sposta il focus e l'informazione è persa.
    let lastFocusedField = null;

    const els = {};

    function init() {
        els.grid       = document.getElementById('automations-grid');
        els.alert      = document.getElementById('automations-alert');
        els.pagination = document.getElementById('automations-pagination');
        els.modal      = document.getElementById('automation-modal');
        els.form       = document.getElementById('automation-form');
        els.logModal   = document.getElementById('automation-log-modal');
        els.logBody    = document.getElementById('automation-log-body');

        bindEvents();
        Promise.all([loadVocabulary(), loadContacts(), loadProperties()])
            .then(() => loadAutomations());
    }

    function bindEvents() {
        document.getElementById('btn-new-automation').addEventListener('click', () => openModal());
        document.getElementById('automation-modal-close').addEventListener('click', closeModal);
        document.getElementById('automation-modal-cancel').addEventListener('click', closeModal);
        els.modal.addEventListener('click', e => { if (e.target === els.modal) closeModal(); });
        els.form.addEventListener('submit', handleSubmit);

        document.getElementById('automation-log-close').addEventListener('click', () => { els.logModal.hidden = true; });
        els.logModal.addEventListener('click', e => { if (e.target === els.logModal) els.logModal.hidden = true; });

        document.getElementById('automation-search').addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => { currentPage = 1; loadAutomations(); }, 300);
        });
        ['automation-status-filter', 'automation-freq-filter', 'automation-trigger-filter'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => { currentPage = 1; loadAutomations(); });
        });

        document.querySelectorAll('input[name="automation-trigger"]').forEach(radio => {
            radio.addEventListener('change', syncTriggerMode);
        });
        document.getElementById('automation-event').addEventListener('change', syncEventChoice);
        document.getElementById('automation-frequency').addEventListener('change', syncDayRuleVisibility);
        document.getElementById('automation-day-mode').addEventListener('change', syncDayRuleVisibility);

        document.getElementById('automation-contact').addEventListener('input', resolveContact);
        document.getElementById('automation-contact').addEventListener('change', resolveContact);
        document.getElementById('automation-property').addEventListener('change', updatePreview);

        ['automation-subject', 'automation-body'].forEach(id => {
            const field = document.getElementById(id);
            field.addEventListener('focus', () => { lastFocusedField = field; });
            field.addEventListener('input', updatePreview);
        });
    }

    // ── Caricamenti ─────────────────────────────────────────────────────────

    /** Token, eventi e strategie di destinatario arrivano dal backend: una
     *  copia in JS divergerebbe al primo token aggiunto, offrendo segnaposto
     *  che il motore non sa sostituire. */
    async function loadVocabulary() {
        try {
            const json = await fetch(`${API}?action=tokens`).then(r => r.json());
            if (!json.success) return;
            vocabulary = json.data;
            renderTokenPicker();
            renderEventOptions();
        } catch { /* non-fatal: il form resta usabile senza pillole */ }
    }

    async function loadContacts() {
        try {
            const json = await fetch(`${API}?action=contacts`).then(r => r.json());
            if (!json.success) return;

            contactsByLabel.clear();
            contactsByKey.clear();

            const options = (json.data || []).map(c => {
                const person = `${c.surname || ''} ${c.name || ''}`.trim() || `#${c.id}`;
                let label = `${person} · ${CONTACT_LABELS[c.contact_type] || c.contact_type}`;
                // Due omonimi nello stesso ruolo si annullerebbero a vicenda:
                // l'etichetta È la chiave con cui il datalist risolve la scelta.
                if (contactsByLabel.has(label)) label += c.email ? ` · ${c.email}` : ` · #${c.id}`;
                if (contactsByLabel.has(label)) label += ` · #${c.id}`;

                contactsByLabel.set(label, { type: c.contact_type, id: String(c.id), label });
                contactsByKey.set(`${c.contact_type}:${c.id}`, label);
                return `<option value="${escAttr(label)}"></option>`;
            }).join('');

            document.getElementById('automation-contact-options').innerHTML = options;
        } catch { /* non-fatal */ }
    }

    async function loadProperties() {
        try {
            const items = await Pagination.fetchList(PROPERTIES_API);
            document.getElementById('automation-property').innerHTML =
                '<option value="">— Nessuno —</option>' +
                items.map(p => `<option value="${p.id}">${esc(p.address)}, ${esc(p.city)}</option>`).join('');
        } catch { /* non-fatal */ }
    }

    async function loadAutomations() {
        const params = new URLSearchParams();
        params.set('notify_client', '1');
        // Un'automazione è la REGOLA, non i suoi invii: da phase65 un promemoria
        // ricorrente materializza le occorrenze come righe, e senza questo
        // filtro una automazione mensile comparirebbe qui come 12 schede.
        params.set('series', 'parents');
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);

        const search  = document.getElementById('automation-search').value.trim();
        const status  = document.getElementById('automation-status-filter').value;
        const freq    = document.getElementById('automation-freq-filter').value;
        const trigger = document.getElementById('automation-trigger-filter').value;

        // Le regole a evento sono escluse di default da reminders.php (in agenda
        // sarebbero un impegno di oggi che non esiste): qui vanno chieste.
        params.set('trigger', trigger || 'all');

        if (search) params.set('search', search);
        if (status) params.set('status', status);
        if (freq)   params.set('frequency', freq);

        softLoad(els.grid, '<div class="entity-loading">Caricamento…</div>');

        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const parsed = Pagination.parseResponse(json);
            automations  = parsed.items;
            renderCards();
            Pagination.render(els.pagination, parsed, p => { currentPage = p; loadAutomations(); });
        } catch (err) {
            els.grid.classList.remove('is-loading');
            els.grid.innerHTML = `<div class="entity-error">${esc(err.message)}</div>`;
        }
    }

    // ── Schede ──────────────────────────────────────────────────────────────

    function renderCards() {
        els.grid.classList.remove('is-loading');
        if (!automations.length) {
            els.grid.innerHTML = '<div class="entity-empty">Nessuna automazione configurata. Creane una con il pulsante in alto.</div>';
            return;
        }

        els.grid.innerHTML = automations.map(a => {
            const status      = STATUS_LABELS[a.status] || a.status;
            const statusClass = a.status === 'pending' ? 'success' : (a.status === 'cancelled' ? 'error' : 'inactive');
            const isEvent     = a.trigger_type === 'event';

            // Il titolo è il NOME dell'automazione, non il destinatario: tre
            // automazioni per lo stesso cliente devono distinguersi al colpo
            // d'occhio. L'oggetto email scende a riga secondaria.
            const name    = a.title || a.email_subject || '—';
            const subject = a.email_subject && a.email_subject !== a.title ? a.email_subject : '';

            return `
            <div class="entity-card automation-card">
                <div class="entity-card__header">
                    <div class="entity-card__title-group">
                        <div class="entity-card__name">${esc(name)}</div>
                        <span class="badge badge--${statusClass}">${status}</span>
                    </div>
                    ${subject ? `<div class="entity-card__subtitle">${esc(subject)}</div>` : ''}
                </div>
                <div class="entity-card__body">
                    ${cardRow(isEvent ? 'zap' : 'repeat', triggerSummary(a))}
                    ${cardRow('user', contactSummary(a))}
                    ${a.property_address ? cardRow('home', `${esc(a.property_address)}${a.property_city ? ', ' + esc(a.property_city) : ''}`) : ''}
                    ${cardRow('calendar-clock', nextRunSummary(a))}
                    ${cardRow('send', lastRunSummary(a))}
                </div>
                <div class="entity-card__footer">
                    <div class="entity-card__actions">
                        ${a.status === 'pending'
                            ? `<button class="btn btn--sm btn--ghost btn-pause" data-id="${a.id}" title="Metti in pausa"><i data-lucide="pause"></i></button>`
                            : `<button class="btn btn--sm btn--ghost btn-resume" data-id="${a.id}" title="Riattiva"><i data-lucide="play"></i></button>`}
                        <button class="btn btn--sm btn--ghost btn-log" data-id="${a.id}" title="Storico invii"><i data-lucide="history"></i></button>
                        <button class="btn btn--sm btn--ghost btn-edit" data-id="${a.id}" title="Modifica"><i data-lucide="pencil"></i></button>
                        <button class="btn btn--sm btn--ghost btn-delete" data-id="${a.id}" title="Elimina"><i data-lucide="trash-2"></i></button>
                    </div>
                </div>
            </div>`;
        }).join('');

        wireCardActions();
        if (window.lucide) lucide.createIcons();
    }

    function cardRow(icon, html) {
        return `<div class="entity-card__info"><span class="entity-card__info-icon"><i data-lucide="${icon}"></i></span>${html}</div>`;
    }

    function triggerSummary(a) {
        if (a.trigger_type === 'event') {
            const ev    = vocabulary.events?.[a.trigger_event];
            const label = ev ? ev.label : a.trigger_event;
            const delay = Number(a.trigger_delay_minutes || 0);
            return esc(label) + (delay > 0 ? ` · dopo ${formatDelay(delay)}` : ' · subito');
        }

        const freq = FREQ_LABELS[a.frequency] || a.frequency;
        const bits = [freq];
        if (a.day_rule)      bits.push(describeDayRule(a.day_rule));
        if (a.schedule_time) bits.push('alle ' + String(a.schedule_time).slice(0, 5));
        return esc(bits.join(' · '));
    }

    function contactSummary(a) {
        if (a.trigger_type === 'event') {
            return esc(vocabulary.recipient_rules?.[a.recipient_rule] || '—');
        }
        if (a.client_surname || a.client_name) return esc(`${a.client_surname || ''} ${a.client_name || ''}`.trim());
        if (a.lead_surname   || a.lead_name)   return esc(`${a.lead_surname || ''} ${a.lead_name || ''}`.trim()) + ' <em>(lead)</em>';
        if (a.tenant_contact_surname || a.tenant_contact_name) {
            return esc(`${a.tenant_contact_surname || ''} ${a.tenant_contact_name || ''}`.trim()) + ' <em>(inquilino)</em>';
        }
        return '<span class="text-muted">Nessun contatto collegato</span>';
    }

    function nextRunSummary(a) {
        if (a.status !== 'pending') return '<span class="text-muted">Prossimo invio: nessuno</span>';
        if (a.trigger_type === 'event') return '<span class="text-muted">Prossimo invio: al prossimo evento</span>';
        if (!a.next_occurrence_at) return '<span class="text-muted">Prossimo invio: nessuno in programma</span>';
        return `Prossimo invio: <strong>${fmtDateTime(a.next_occurrence_at)}</strong>`;
    }

    function lastRunSummary(a) {
        if (!a.last_dispatch_at) return '<span class="text-muted">Mai eseguita</span>';
        const meta = DISPATCH_LABELS[a.last_dispatch_status] || { text: a.last_dispatch_status, cls: 'inactive' };
        const err  = a.last_dispatch_status === 'failed' && a.last_dispatch_error
            ? ` <span class="text-muted">— ${esc(a.last_dispatch_error)}</span>` : '';
        return `Ultimo invio: ${fmtDateTime(a.last_dispatch_at)} <span class="badge badge--${meta.cls}">${esc(meta.text)}</span>${err}`;
    }

    function wireCardActions() {
        els.grid.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', () => {
                const a = automations.find(x => String(x.id) === btn.dataset.id);
                if (a) openModal(a);
            });
        });
        els.grid.querySelectorAll('.btn-pause').forEach(btn => {
            btn.addEventListener('click', () => patchStatus(btn.dataset.id, 'cancel'));
        });
        els.grid.querySelectorAll('.btn-resume').forEach(btn => {
            btn.addEventListener('click', () => patchStatus(btn.dataset.id, 'reopen'));
        });
        els.grid.querySelectorAll('.btn-log').forEach(btn => {
            btn.addEventListener('click', () => openLog(btn.dataset.id));
        });
        els.grid.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (await confirmDialog('Eliminare questa automazione?', { title: 'Elimina automazione', confirmText: 'Elimina' })) {
                    deleteAutomation(btn.dataset.id);
                }
            });
        });
    }

    // ── Storico invii ───────────────────────────────────────────────────────

    async function openLog(id) {
        els.logModal.hidden = false;
        els.logBody.innerHTML = '<div class="entity-loading">Caricamento…</div>';

        try {
            const json = await fetch(`${API}?action=dispatch_log&id=${id}`).then(r => r.json());
            if (!json.success) throw new Error(json.error);
            const rows = json.data || [];

            if (!rows.length) {
                els.logBody.innerHTML = '<div class="entity-empty">Nessun invio registrato. Il registro parte dal primo invio dopo l\'attivazione.</div>';
                return;
            }

            els.logBody.innerHTML = `
                <table class="data-table">
                    <thead><tr><th>Data</th><th>Destinatario</th><th>Oggetto</th><th>Esito</th></tr></thead>
                    <tbody>${rows.map(r => {
                        const meta = DISPATCH_LABELS[r.status] || { text: r.status, cls: 'inactive' };
                        return `<tr>
                            <td>${fmtDateTime(r.dispatched_at)}</td>
                            <td>${esc(r.recipient_email || '—')}<br><small class="text-muted">${esc(CONTACT_LABELS[r.recipient_type] || r.recipient_type)}</small></td>
                            <td>${esc(r.rendered_subject || '—')}</td>
                            <td><span class="badge badge--${meta.cls}">${esc(meta.text)}</span>
                                ${r.error_details ? `<br><small class="text-muted">${esc(r.error_details)}</small>` : ''}</td>
                        </tr>`;
                    }).join('')}</tbody>
                </table>`;
        } catch (err) {
            els.logBody.innerHTML = `<div class="entity-error">${esc(err.message)}</div>`;
        }
    }

    // ── Form ────────────────────────────────────────────────────────────────

    function renderEventOptions() {
        const sel = document.getElementById('automation-event');
        sel.innerHTML = '<option value="">— Seleziona evento —</option>' +
            Object.entries(vocabulary.events || {})
                .map(([key, ev]) => `<option value="${escAttr(key)}">${esc(ev.label)}</option>`)
                .join('');
    }

    function syncEventChoice() {
        const key = document.getElementById('automation-event').value;
        const ev  = vocabulary.events?.[key];
        const sel = document.getElementById('automation-recipient-rule');

        document.getElementById('automation-event-hint').textContent = ev ? ev.description : '';

        // Non tutte le strategie hanno senso per tutti gli eventi: "i lead con
        // ricerca compatibile" su un nuovo lead non vuole dire nulla. Il
        // backend rifiuta le combinazioni sbagliate, qui non le si offre.
        if (!ev) {
            sel.innerHTML = '<option value="">— Seleziona evento prima —</option>';
            return;
        }
        sel.innerHTML = ev.recipients
            .map(r => `<option value="${escAttr(r)}">${esc(vocabulary.recipient_rules?.[r] || r)}</option>`)
            .join('');
    }

    function syncTriggerMode() {
        const isEvent = currentTriggerType() === 'event';
        document.getElementById('automation-event-fields').hidden    = !isEvent;
        document.getElementById('automation-schedule-fields').hidden = isEvent;
        // Con un trigger a evento il destinatario lo decide la regola
        // (il lead della visita, i lead compatibili…), non un contatto fisso.
        document.getElementById('automation-target-section').hidden  = isEvent;
        if (!isEvent) syncDayRuleVisibility();
        // I token {{evento.*}} compaiono/spariscono insieme al trigger: offrirli
        // su un'automazione a calendario significherebbe promettere un valore
        // che al momento dell'invio non esiste.
        syncEventTokenVisibility();
    }

    function currentTriggerType() {
        const checked = document.querySelector('input[name="automation-trigger"]:checked');
        return checked ? checked.value : 'scheduled';
    }

    function syncDayRuleVisibility() {
        const freq      = document.getElementById('automation-frequency').value;
        const monthlyish = ['monthly', 'quarterly', 'yearly'].includes(freq);
        const mode      = document.getElementById('automation-day-mode').value;

        // Settimanale e quindicinale conservano già il giorno per costruzione:
        // snappare una quindicinale a un giorno del mese ne romperebbe la cadenza.
        document.getElementById('automation-day-row').hidden   = !monthlyish;
        document.getElementById('automation-dom-group').hidden = !monthlyish || mode !== 'dom';
        document.getElementById('automation-nth-group').hidden = !monthlyish || mode !== 'nth';
    }

    function renderTokenPicker() {
        const box = document.getElementById('automation-tokens');
        const groups = vocabulary.token_groups || {};

        box.innerHTML = '<div class="token-picker__intro">Clicca un segnaposto per inserirlo nel campo selezionato: viene sostituito al momento dell\'invio.</div>' +
            Object.entries(groups).map(([group, tokens]) => `
                <div class="token-picker__group" data-group="${escAttr(group)}">
                    <span class="token-picker__label">${esc(group)}</span>
                    ${Object.entries(tokens).map(([token, desc]) =>
                        `<button type="button" class="token-pill" data-token="${escAttr(token)}" title="${escAttr(desc)}">{{${esc(token)}}}</button>`
                    ).join('')}
                </div>`).join('');

        box.querySelectorAll('.token-pill').forEach(btn => {
            // mousedown, non click: al click il campo ha già perso il focus e
            // con esso la posizione del cursore in cui inserire.
            btn.addEventListener('mousedown', e => {
                e.preventDefault();
                insertToken(btn.dataset.token);
            });
        });

        syncEventTokenVisibility();
    }

    /** I token d'evento non hanno alcun valore in un'automazione a calendario. */
    function syncEventTokenVisibility() {
        const group = document.querySelector(`.token-picker__group[data-group="${vocabulary.event_token_group || 'Evento'}"]`);
        if (group) group.hidden = currentTriggerType() !== 'event';
    }

    function insertToken(token) {
        const field = lastFocusedField || document.getElementById('automation-body');
        const text  = `{{${token}}}`;
        const start = field.selectionStart ?? field.value.length;
        const end   = field.selectionEnd ?? field.value.length;

        field.value = field.value.slice(0, start) + text + field.value.slice(end);
        field.focus();
        field.setSelectionRange(start + text.length, start + text.length);
        lastFocusedField = field;
        updatePreview();
    }

    /**
     * Anteprima dell'oggetto con dati veri quando ci sono.
     *
     * Serve a rendere visibile l'errore più probabile: un token scritto male
     * resta letterale nell'email, e senza anteprima lo scopre il cliente.
     */
    function updatePreview() {
        const subject = document.getElementById('automation-subject').value;
        const contact = contactsByLabel.get(document.getElementById('automation-contact').value.trim());
        const propSel = document.getElementById('automation-property');
        const propTxt = propSel.value ? propSel.options[propSel.selectedIndex].text : '';
        const [address, city] = propTxt.split(', ');

        const sample = {
            'contatto.nome':          contact ? contact.label.split(' ')[1] || contact.label.split(' ')[0] : 'Mario',
            'contatto.cognome':       contact ? contact.label.split(' ')[0] : 'Rossi',
            'contatto.nome_completo': contact ? contact.label.split(' · ')[0] : 'Mario Rossi',
            'immobile.indirizzo':     address || 'Via Roma 1',
            'immobile.citta':         city || 'Civitanova Marche',
        };

        const rendered = subject.replace(/\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/gi,
            (m, key) => sample[key.toLowerCase()] ?? m);

        document.getElementById('automation-preview').textContent = rendered || '—';
    }

    function openModal(automation = null) {
        els.form.reset();
        document.getElementById('automation-id').value = '';
        clearContact();

        if (automation) {
            document.getElementById('automation-modal-title').textContent = 'Modifica Automazione';
            document.getElementById('automation-id').value       = automation.id;
            document.getElementById('automation-name').value     = automation.title || '';
            document.getElementById('automation-subject').value  = automation.email_subject || automation.title || '';
            document.getElementById('automation-body').value     = automation.email_body || automation.description || '';
            document.getElementById('automation-property').value = automation.property_id || '';

            setTrigger(automation.trigger_type || 'scheduled');

            if (automation.trigger_type === 'event') {
                document.getElementById('automation-event').value = automation.trigger_event || '';
                syncEventChoice();
                document.getElementById('automation-recipient-rule').value = automation.recipient_rule || '';
                setDelay(Number(automation.trigger_delay_minutes || 0));
            } else {
                document.getElementById('automation-frequency').value = automation.frequency || 'monthly';
                document.getElementById('automation-start').value     = (automation.reminder_date || '').slice(0, 10);
                document.getElementById('automation-end').value       = automation.end_date || '';
                document.getElementById('automation-time').value      =
                    automation.schedule_time ? String(automation.schedule_time).slice(0, 5)
                                             : (automation.reminder_date || '').slice(11, 16) || '09:00';
                setDayRule(automation.day_rule || '');
                setContact(automation);
            }
        } else {
            document.getElementById('automation-modal-title').textContent = 'Nuova Automazione';
            document.getElementById('automation-start').value = new Date().toISOString().slice(0, 10);
            document.getElementById('automation-time').value  = '09:00';
            setTrigger('scheduled');
        }

        syncTriggerMode();
        syncEventTokenVisibility();
        updatePreview();

        els.modal.hidden = false;
        document.getElementById('automation-name').focus();
        if (window.lucide) lucide.createIcons();
    }

    function closeModal() {
        els.modal.hidden = true;
    }

    function setTrigger(type) {
        const radio = document.querySelector(`input[name="automation-trigger"][value="${type}"]`);
        if (radio) radio.checked = true;
    }

    function setDelay(minutes) {
        const unit = minutes % 1440 === 0 && minutes >= 1440 ? 1440 : (minutes % 60 === 0 && minutes >= 60 ? 60 : 1);
        document.getElementById('automation-delay-unit').value = String(unit);
        document.getElementById('automation-delay').value      = String(Math.round(minutes / unit));
    }

    function setDayRule(rule) {
        const mode = document.getElementById('automation-day-mode');
        const parts = String(rule).split(':');

        if (parts[0] === 'dom' && parts[1] === 'last') {
            mode.value = 'dom_last';
        } else if (parts[0] === 'dom') {
            mode.value = 'dom';
            document.getElementById('automation-day-of-month').value = parts[1] || '1';
        } else if (parts[0] === 'nth') {
            mode.value = 'nth';
            document.getElementById('automation-nth-week').value = parts[1] || '1';
            document.getElementById('automation-nth-dow').value  = parts[2] || '1';
        } else {
            mode.value = '';
        }
        syncDayRuleVisibility();
    }

    function buildDayRule() {
        const freq = document.getElementById('automation-frequency').value;
        if (!['monthly', 'quarterly', 'yearly'].includes(freq)) return null;

        const mode = document.getElementById('automation-day-mode').value;
        if (mode === 'dom')      return 'dom:' + (document.getElementById('automation-day-of-month').value || '1');
        if (mode === 'dom_last') return 'dom:last';
        if (mode === 'nth') {
            return 'nth:' + document.getElementById('automation-nth-week').value
                 + ':'   + document.getElementById('automation-nth-dow').value;
        }
        return null;
    }

    function describeDayRule(rule) {
        const parts = String(rule).split(':');
        if (parts[0] === 'dom') return parts[1] === 'last' ? "l'ultimo giorno del mese" : `il ${parts[1]} del mese`;
        if (parts[0] === 'nth') return `${NTH_LABELS[parts[1]] || parts[1]} ${DOW_LABELS[parts[2]] || ''}`.trim().toLowerCase();
        if (parts[0] === 'dow') return `ogni ${DOW_LABELS[parts[1]] || ''}`.trim();
        return rule;
    }

    function setContact(automation) {
        const pairs = [['client', automation.client_id], ['lead', automation.lead_id], ['tenant', automation.tenant_id]];
        for (const [type, id] of pairs) {
            if (!id) continue;
            const label = contactsByKey.get(`${type}:${id}`) || '';
            document.getElementById('automation-contact').value      = label;
            document.getElementById('automation-contact-type').value = label ? type : '';
            document.getElementById('automation-contact-id').value   = label ? String(id) : '';
            return;
        }
        clearContact();
    }

    function clearContact() {
        document.getElementById('automation-contact').value      = '';
        document.getElementById('automation-contact-type').value = '';
        document.getElementById('automation-contact-id').value   = '';
    }

    function resolveContact() {
        const typed = document.getElementById('automation-contact').value.trim();
        const match = contactsByLabel.get(typed);
        document.getElementById('automation-contact-type').value = match ? match.type : '';
        document.getElementById('automation-contact-id').value   = match ? match.id : '';

        const hint = document.getElementById('automation-contact-hint');
        if (typed === '') {
            hint.textContent = 'Proprietari, acquirenti e inquilini: tutta la rubrica.';
            hint.className   = 'form-hint';
        } else if (match) {
            hint.textContent = 'Contatto collegato.';
            hint.className   = 'form-hint form-hint--ok';
        } else {
            hint.textContent = 'Nessun contatto in rubrica corrisponde: senza destinatario l\'automazione non spedirà nulla.';
            hint.className   = 'form-hint form-hint--warn';
        }
        updatePreview();
    }

    async function handleSubmit(e) {
        e.preventDefault();

        const id      = document.getElementById('automation-id').value;
        const isEvent = currentTriggerType() === 'event';
        const name    = document.getElementById('automation-name').value.trim();
        const subject = document.getElementById('automation-subject').value.trim();
        const body    = document.getElementById('automation-body').value.trim();

        if (!name || !subject || !body) {
            showAlert('Nome, oggetto e corpo del messaggio sono obbligatori.', 'error');
            return;
        }

        const payload = {
            title:         name,
            description:   body,
            email_subject: subject,
            email_body:    body,
            notify_client: 1,
            notify_admin:  0,
            status:        'pending',
            trigger_type:  isEvent ? 'event' : 'scheduled',
        };

        if (isEvent) {
            const event = document.getElementById('automation-event').value;
            const rule  = document.getElementById('automation-recipient-rule').value;
            if (!event || !rule) {
                showAlert('Scegli l\'evento e i destinatari.', 'error');
                return;
            }
            payload.trigger_event  = event;
            payload.recipient_rule = rule;
            payload.trigger_delay_minutes =
                Number(document.getElementById('automation-delay').value || 0) *
                Number(document.getElementById('automation-delay-unit').value || 1);
            payload.reminder_date = new Date().toISOString().slice(0, 10);
            payload.frequency     = 'once';
            payload.property_id   = document.getElementById('automation-property').value || null;
        } else {
            const start     = document.getElementById('automation-start').value;
            const contactId = document.getElementById('automation-contact-id').value;
            if (!start) {
                showAlert('La data di inizio è obbligatoria.', 'error');
                return;
            }
            if (!contactId) {
                showAlert('Scegli un contatto dalla rubrica: senza destinatario l\'automazione non spedirebbe nulla.', 'error');
                return;
            }
            payload.reminder_date = start;
            payload.end_date      = document.getElementById('automation-end').value || null;
            payload.frequency     = document.getElementById('automation-frequency').value;
            payload.schedule_time = document.getElementById('automation-time').value || null;
            payload.day_rule      = buildDayRule();
            payload.contact_type  = document.getElementById('automation-contact-type').value;
            payload.contact_id    = contactId;
            payload.property_id   = document.getElementById('automation-property').value || null;
        }

        const btn = document.getElementById('automation-modal-save');
        btn.disabled = true; btn.textContent = 'Salvataggio…';

        try {
            const url    = id ? `${API}?id=${id}` : API;
            const method = id ? 'PUT' : 'POST';
            const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const json   = await res.json();
            if (!json.success) throw new Error(json.error);
            closeModal();
            loadAutomations();
            showAlert('Automazione salvata.', 'success');
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Salva automazione';
        }
    }

    async function patchStatus(id, action) {
        const res  = await fetch(`${API}?id=${id}&action=${action}`, { method: 'PATCH' });
        const json = await res.json();
        if (json.success) loadAutomations();
        else showAlert(json.error, 'error');
    }

    async function deleteAutomation(id) {
        const res  = await fetch(`${API}?id=${id}`, { method: 'DELETE' });
        const json = await res.json();
        if (json.success) {
            loadAutomations();
            showAlert('Automazione eliminata.', 'success');
        } else {
            showAlert(json.error, 'error');
        }
    }

    // ── Utility ─────────────────────────────────────────────────────────────

    function showAlert(msg, type) {
        els.alert.textContent    = msg;
        els.alert.className      = `alert alert--${type}`;
        els.alert.style.display  = 'block';
        clearTimeout(els.alert._t);
        els.alert._t = setTimeout(() => { els.alert.style.display = 'none'; }, 4000);
    }

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    }

    function escAttr(s) {
        return esc(s).replace(/"/g, '&quot;');
    }

    function formatDelay(minutes) {
        if (minutes % 1440 === 0) return `${minutes / 1440} giorni`;
        if (minutes % 60 === 0)   return `${minutes / 60} ore`;
        return `${minutes} minuti`;
    }

    function fmtDateTime(d) {
        if (!d) return '—';
        const dt = new Date(String(d).replace(' ', 'T'));
        if (isNaN(dt)) return '—';
        return dt.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
             + ' alle ' + dt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    }

    init();
})();
