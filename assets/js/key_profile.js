/**
 * Scheda chiavi — un singolo mazzo, chi lo ha e come ci è arrivato.
 * viewParams: { keyId }
 *
 * L'elenco (views/keys.html) risponde a "quali chiavi sono fuori"; questa pagina
 * risponde alle due domande che l'elenco non poteva contenere:
 *
 *  1. lo storico di custodia è un registro append-only (property_key_events) e
 *     nella modale dell'elenco stava in un riquadro alto trecento pixel: è la
 *     prova di chi aveva le chiavi il giorno in cui è successo qualcosa, e va
 *     letta per intero;
 *  2. "chi altro può entrare in questo immobile" non è una proprietà di una
 *     riga ma dell'immobile: gli altri mazzi vanno visti accanto a questo.
 *
 * Il riquadro in cima dice cosa NON torna (in ritardo, smarrite, consegnate
 * senza data di rientro, in ufficio senza ubicazione). Come nel fascicolo
 * antiriciclaggio: una scheda che riepiloga solo i campi compilati è un modulo
 * in sola lettura, mentre al bancone serve sapere dove la custodia è scoperta.
 */
(function () {
    'use strict';

    const API = 'api/property_keys.php';

    const vp    = window.App?.viewParams || {};
    const keyId = vp.keyId || null;

    const STATUS_LABEL = { out: 'In possesso', in_office: 'In ufficio', lost: 'Smarrite' };
    const STATUS_BADGE = { out: 'badge--key-out', in_office: 'badge--key-in_office', lost: 'badge--key-lost' };

    // Rispecchiano KEY_TYPES / KEY_HOLDER_TYPES in api/property_keys.php.
    const KEY_TYPE_LABEL = {
        portone: 'Portone principale', appartamento: 'Appartamento', cantina: 'Cantina',
        box: 'Box auto', cancello: 'Cancello / telecomando', altro: 'Altro',
    };
    const KEY_TYPE_ICON = {
        portone: 'door-open', appartamento: 'home', cantina: 'archive',
        box: 'car', cancello: 'radio', altro: 'key-round',
    };
    const HOLDER_TYPE_LABEL = {
        agente: 'Agente', fornitore: 'Fornitore', inquilino: 'Inquilino',
        proprietario: 'Proprietario', lead: 'Cliente / lead', altro: 'Detentore occasionale',
    };
    const HOLDER_TYPE_ICON = {
        agente: 'user-round', fornitore: 'wrench', inquilino: 'user-round',
        proprietario: 'user-round', lead: 'user-round', altro: 'user-round',
    };
    const EVENT_LABEL = {
        created: 'Scheda creata', handover: 'Chiavi consegnate', return: 'Chiavi rientrate',
        status_change: 'Stato aggiornato', lost: 'Chiavi smarrite',
        overdue: 'Ritardo rilevato', deleted: 'Scheda eliminata',
    };

    /**
     * holder_type → dove si apre la scheda di quel detentore.
     * I fornitori non hanno una scheda propria (suppliers è solo un elenco):
     * l'assenza qui è voluta, e il nome resta testo semplice invece di un link
     * che porterebbe a una pagina che non esiste.
     */
    const HOLDER_LINK = {
        inquilino:    { idField: 'holder_tenant_id',   view: 'tenant_profile', param: 'tenantId' },
        proprietario: { idField: 'holder_client_id',   view: 'client_profile', param: 'clientId' },
        lead:         { idField: 'holder_lead_id',     view: 'lead_edit',      param: 'leadId' },
        // Il portafoglio agenti è riservato ad admin+ (VIEW_MIN_ROLE in
        // config/roles.php), mentre questa pagina la vede anche `agent`:
        // il link si mostra solo a chi non riceverebbe un 403.
        agente:       { idField: 'holder_id',          view: 'agent_profile',  param: 'agentId',
                        roles: ['admin', 'super_admin'] },
    };

    let rec = null;

    function $(id) { return document.getElementById(id); }

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s == null ? '' : s;
        return d.innerHTML;
    }

    function fmtDate(s) { return window.Fmt.date(s); }
    function fmtDateTime(s) { return window.Fmt.dateTime(s); }

    function showAlert(msg, type) {
        const el = $('kp-alert');
        el.textContent = msg;
        el.className = `alert alert--${type}`;
        el.style.display = 'block';
        clearTimeout(el._t);
        el._t = setTimeout(() => { el.style.display = 'none'; }, 4000);
    }

    function row(icon, label, value) {
        return `<div class="scheda-row">
            <span class="scheda-row__label"><i data-lucide="${icon}"></i> ${esc(label)}</span>
            <span class="scheda-row__value">${value}</span>
        </div>`;
    }

    function todayISO() {
        const d = new Date();
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    /** Giorni fra oggi e una data ISO: positivo se futura, negativo se passata. */
    function daysUntil(iso) {
        if (!iso) return null;
        const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
        if (isNaN(d)) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return Math.round((d - today) / 86400000);
    }

    function plural(n, one, many) { return n === 1 ? one : many; }

    function isOverdue() { return Number(rec.is_overdue) === 1; }

    // ── Caricamento ──────────────────────────────────────────────────

    async function load() {
        if (!keyId) {
            $('kp-title').textContent = 'Registro chiavi non specificato';
            return;
        }
        try {
            const j = await fetch(`${API}?id=${keyId}`).then(r => r.json());
            if (!j.success) throw new Error(j.error);
            rec = j.data;
            render();
            loadHistory();
            loadSiblings();
        } catch (err) {
            $('kp-title').textContent = 'Registro chiavi non trovato';
            showAlert(err.message, 'error');
        }
    }

    // ── Render ───────────────────────────────────────────────────────

    function renderHero() {
        const qty     = parseInt(rec.quantity, 10) || 1;
        const overdue = isOverdue();

        // Il colore del riquadro è lo stato: è la prima cosa che si guarda, e
        // arriva prima della lettura del badge.
        //
        // Il contenuto si riscrive invece di modificarlo: dopo il primo
        // createIcons() l'<i data-lucide> non esiste più, è diventato un <svg>,
        // e cambiargli l'attributo non ridisegnerebbe nulla (vedi app.js).
        const tile = $('kp-tile');
        tile.className = 'kp-tile kp-tile--' + (overdue ? 'overdue' : (rec.status || 'in_office'));
        tile.innerHTML = `<i data-lucide="${KEY_TYPE_ICON[rec.key_type] || 'key-round'}"></i>`
                       + `<span class="kp-tile__qty">${qty > 1 ? `× ${qty}` : 'mazzo'}</span>`;

        $('kp-badges').innerHTML =
            `<span class="badge ${overdue ? 'badge--key-overdue' : (STATUS_BADGE[rec.status] || 'badge')}">`
          + `${esc(overdue ? 'In ritardo' : (STATUS_LABEL[rec.status] || rec.status))}</span>`
          + `<span class="badge key-card__type">${esc(KEY_TYPE_LABEL[rec.key_type] || 'Altro')}</span>`
          + (qty > 1 ? `<span class="badge key-card__qty">× ${qty} copie</span>` : '');

        const where = [rec.address, rec.city].filter(Boolean).join(', ');
        $('kp-title').textContent = where || 'Immobile senza indirizzo';
        window.App?.setCrumb(where || 'Chiavi');

        const late = parseInt(rec.days_overdue, 10);
        $('kp-meta').innerHTML =
            (rec.key_code
                ? `<span><i data-lucide="scan-line"></i> <span class="key-card__code">${esc(rec.key_code)}</span></span>`
                : '')
          + `<span><i data-lucide="user"></i> ${esc(rec.holder_display || 'Nessun detentore')}</span>`
          + (rec.location ? `<span><i data-lucide="map-pin"></i> ${esc(rec.location)}</span>` : '')
          + (overdue && late > 0
                ? `<span class="key-card__overdue"><i data-lucide="alarm-clock"></i> ${late} ${plural(late, 'giorno', 'giorni')} di ritardo</span>`
                : '');

        // Il rientro si registra solo su chiavi che sono davvero fuori.
        $('kp-return').hidden = rec.status !== 'out';
    }

    /**
     * Le falle nella custodia, in ordine di gravità. Ogni voce è una cosa da
     * fare, non un campo vuoto: se non ce n'è nessuna la scheda lo dice.
     */
    function renderFlags() {
        const flags   = [];
        const overdue = isOverdue();
        const late    = parseInt(rec.days_overdue, 10);

        if (rec.status === 'lost') {
            flags.push(['error', 'triangle-alert',
                'Chiavi date per smarrite. Finché non rientrano, l\'immobile è accessibile a chi le ha trovate: '
              + 'valutare la sostituzione della serratura e avvisare il proprietario.']);
        }

        if (overdue) {
            flags.push(['error', 'alarm-clock',
                `Rientro previsto il ${fmtDate(rec.due_back_at)}, ${late} ${plural(late, 'giorno', 'giorni')} fa`
              + `${rec.holder_display ? `: le ha ancora ${rec.holder_display}` : ''}.`]);
            // Il cron scrive overdue_notified_at quando manda l'avviso: se è
            // vuoto, nessuno ha ancora sollecitato — e il ritardo è muto.
            flags.push(rec.overdue_notified_at
                ? ['info', 'bell', `Ultimo sollecito inviato il ${fmtDateTime(rec.overdue_notified_at)}.`]
                : ['warning', 'bell-off', 'Nessun sollecito ancora inviato per questo ritardo.']);
        }

        if (rec.status === 'out' && !rec.due_back_at) {
            flags.push(['warning', 'calendar-x',
                'Consegna senza data di rientro prevista: queste chiavi non finiranno mai fra quelle in ritardo, '
              + 'perché non c\'è una scadenza da superare.']);
        }

        if (rec.status === 'out' && !rec.holder_display) {
            flags.push(['warning', 'user-x',
                'Chiavi segnate come consegnate ma senza detentore registrato: non risulta a chi chiederle indietro.']);
        }

        if (rec.status === 'in_office' && !rec.location) {
            flags.push(['warning', 'map-pin-off',
                'Chiavi in ufficio senza ubicazione: manca il cassetto o la cassetta in cui cercarle.']);
        }

        if (!rec.key_code) {
            flags.push(['info', 'scan-line',
                'Nessun codice sul portachiavi: al bancone questo mazzo non si trova né cercandolo né scansionandolo.']);
        }

        const box = $('kp-flags');
        if (!flags.length) {
            box.innerHTML = `<div class="alert alert--success kp-flags__ok">
                <i data-lucide="shield-check"></i>
                Custodia in ordine: stato coerente, detentore e collocazione noti, mazzo identificabile.
            </div>`;
            return;
        }
        box.innerHTML = `<div class="card kp-flags">
            <div class="appt-card__header"><i data-lucide="clipboard-check"></i><h3>Da sistemare</h3></div>
            ${flags.map(([sev, icon, text]) => `
                <div class="alert alert--${sev} kp-flags__item">
                    <i data-lucide="${icon}"></i> ${esc(text)}
                </div>`).join('')}
        </div>`;
    }

    function renderHolder() {
        const box = $('kp-holder');

        if (!rec.holder_display) {
            box.innerHTML = `<p class="text-muted">
                Nessun detentore: il mazzo risulta ${rec.status === 'lost' ? 'smarrito' : 'in ufficio'}.
            </p>`;
            return;
        }

        const type    = rec.holder_type || 'altro';
        const label   = HOLDER_TYPE_LABEL[type] || type;
        const name    = rec.holder_display;
        const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();

        const link   = HOLDER_LINK[type];
        const target = link && (!link.roles || link.roles.includes(window.userRole))
            ? Number(rec[link.idField]) || null
            : null;

        box.innerHTML = `
            <div class="appt-people">
                <div class="appt-person${target ? ' appt-person--clickable' : ''}" id="kp-holder-card">
                    <div class="appt-person__avatar">${esc(initials) || '<i data-lucide="user"></i>'}</div>
                    <div class="appt-person__body">
                        <span class="appt-person__role">${esc(label)}</span>
                        <strong class="appt-person__name">${esc(name)}</strong>
                    </div>
                    ${target ? '<i data-lucide="chevron-right" class="kp-chevron"></i>' : ''}
                </div>
            </div>
            ${rec.status === 'out'
                ? `<div class="scheda-rows kp-holder-dates">
                       ${row('calendar-check', 'Dal', esc(fmtDate(rec.handed_at) || '—'))}
                   </div>`
                : ''}`;

        if (target) {
            $('kp-holder-card').addEventListener('click', () => {
                window.App?.navigateTo(link.view, { [link.param]: target });
            });
        }
    }

    function renderProperty() {
        $('kp-property').innerHTML = `
            <div class="scheda-rows">
                ${row('map-pin', 'Indirizzo', esc(rec.address || '—'))}
                ${row('building-2', 'Comune', esc(rec.city || '—'))}
            </div>
            <button class="btn btn--ghost btn--sm appt-card__cta" id="kp-goto-property">
                <i data-lucide="arrow-right"></i> Apri scheda immobile
            </button>`;

        $('kp-goto-property').addEventListener('click', () => {
            window.App?.navigateTo('property_profile', { propertyId: Number(rec.property_id) });
        });
    }

    function renderKeyData() {
        const qty = parseInt(rec.quantity, 10) || 1;
        $('kp-keydata').innerHTML =
            row('key-round', 'Tipo', esc(KEY_TYPE_LABEL[rec.key_type] || 'Altro')) +
            row('copy', 'Copie', `${qty} ${plural(qty, 'copia', 'copie')}`) +
            row('scan-line', 'Codice portachiavi',
                rec.key_code ? `<span class="key-card__code">${esc(rec.key_code)}</span>` : '—') +
            row('map-pin', 'Ubicazione', esc(rec.location || '—')) +
            row('activity', 'Stato',
                `<span class="badge ${STATUS_BADGE[rec.status] || 'badge'}">${esc(STATUS_LABEL[rec.status] || rec.status || '—')}</span>`);
    }

    function renderCustody() {
        const due = daysUntil(rec.due_back_at);
        let dueNote = '';
        if (rec.due_back_at && rec.status === 'out') {
            dueNote = due < 0
                ? ` <small class="key-card__overdue">(${-due} ${plural(-due, 'giorno', 'giorni')} di ritardo)</small>`
                : due === 0
                    ? ' <small class="text-muted">(oggi)</small>'
                    : ` <small class="text-muted">(fra ${due} ${plural(due, 'giorno', 'giorni')})</small>`;
        }

        $('kp-custody').innerHTML =
            row('calendar-check', 'Consegnate il', esc(fmtDate(rec.handed_at) || '—')) +
            row('calendar-clock', 'Rientro previsto', (esc(fmtDate(rec.due_back_at)) || '—') + dueNote) +
            row('calendar-x', 'Restituite il', esc(fmtDate(rec.returned_at) || '—')) +
            row('bell', 'Ultimo sollecito', esc(fmtDateTime(rec.overdue_notified_at) || '—'));
    }

    function renderNotes() {
        $('kp-notes').innerHTML = rec.notes
            ? `<p class="appt-notes">${esc(rec.notes)}</p>`
            : '<p class="text-muted">Nessuna nota.</p>';
    }

    function renderFootnote() {
        $('kp-footnote').textContent =
            `Registro #${rec.id} · creato il ${fmtDateTime(rec.created_at)}`
          + (rec.updated_at && rec.updated_at !== rec.created_at
                ? ` · ultimo aggiornamento ${fmtDateTime(rec.updated_at)}` : '');
    }

    function render() {
        renderHero();
        renderFlags();
        renderHolder();
        renderProperty();
        renderKeyData();
        renderCustody();
        renderNotes();
        renderFootnote();
        if (window.lucide) window.lucide.createIcons();
    }

    // ── Storico custodia ─────────────────────────────────────────────

    /**
     * Stessa timeline della modale in elenco (.key-timeline), qui a piena
     * larghezza e senza limite: il registro è append-only e la sua utilità è
     * proprio poterlo leggere tutto.
     */
    async function loadHistory() {
        const box = $('kp-history');
        try {
            const j = await fetch(`${API}?id=${keyId}&action=history`).then(r => r.json());
            if (!j.success) throw new Error(j.error);
            const events = j.data || [];

            $('kp-history-count').textContent = events.length
                ? `${events.length} ${plural(events.length, 'movimento', 'movimenti')}` : '';

            if (!events.length) {
                box.innerHTML = '<p class="text-muted">Nessun movimento registrato.</p>';
                return;
            }

            box.innerHTML = '<ul class="key-timeline">' + events.map(e => {
                const title = EVENT_LABEL[e.event_type] || e.event_type;
                const when  = e.event_date ? fmtDate(e.event_date) : fmtDateTime(e.created_at);
                const bits  = [];

                if (e.holder_label) {
                    const tag = e.holder_type ? ` (${HOLDER_TYPE_LABEL[e.holder_type] || e.holder_type})` : '';
                    bits.push(`Detentore: ${esc(e.holder_label)}${esc(tag)}`);
                } else if (e.event_type === 'return') {
                    bits.push('Rientrate in ufficio');
                }
                if (e.prev_holder_label && e.prev_holder_label !== e.holder_label) {
                    bits.push(`Prima: ${esc(e.prev_holder_label)}`);
                }
                if (e.due_back_at) bits.push(`Rientro previsto: ${fmtDate(e.due_back_at)}`);
                if (e.appointment_date) bits.push(`Appuntamento del ${fmtDateTime(e.appointment_date)}`);
                // Il promemoria agganciato a un evento 'overdue' è l'avviso
                // stesso, non un ordine di lavoro (vedi keys.js).
                if (e.reminder_title && e.reminder_request_type !== 'key_overdue') {
                    bits.push(`Intervento: ${esc(e.reminder_title)}`);
                }
                bits.push(`Registrato da ${esc(e.admin_username || 'utente non tracciato')}`);
                if (e.event_date && e.created_at && !String(e.created_at).startsWith(e.event_date)) {
                    bits.push(`registrato il ${fmtDateTime(e.created_at)}`);
                }
                if (e.notes) bits.push(esc(e.notes));

                return `
                <li class="key-timeline__item key-timeline__item--${esc(e.event_type)}">
                    <div class="key-timeline__head">
                        <span class="key-timeline__title">${esc(title)}</span>
                        <span class="key-timeline__date">${when}</span>
                    </div>
                    <div class="key-timeline__meta">${bits.join(' · ')}</div>
                </li>`;
            }).join('') + '</ul>';

            if (window.lucide) window.lucide.createIcons();
        } catch (err) {
            box.innerHTML = `<p class="text-muted">${esc(err.message)}</p>`;
        }
    }

    // ── Gli altri mazzi dello stesso immobile ────────────────────────

    async function loadSiblings() {
        const box = $('kp-siblings');
        try {
            const j = await fetch(`${API}?property_id=${rec.property_id}&limit=100`).then(r => r.json());
            if (!j.success) throw new Error(j.error);
            const items = (window.Pagination.parseResponse(j).items || [])
                .filter(k => String(k.id) !== String(rec.id));

            $('kp-siblings-count').textContent = items.length
                ? `${items.length} ${plural(items.length, 'altro mazzo', 'altri mazzi')}` : '';

            if (!items.length) {
                box.innerHTML = '<p class="text-muted">Questo è l\'unico mazzo registrato per l\'immobile.</p>';
                return;
            }

            box.innerHTML = '<div class="appt-people">' + items.map(k => {
                const overdue = Number(k.is_overdue) === 1;
                const qty     = parseInt(k.quantity, 10) || 1;
                return `
                <div class="appt-person appt-person--clickable kp-sibling" data-id="${esc(k.id)}">
                    <div class="appt-person__avatar kp-sibling__icon">
                        <i data-lucide="${KEY_TYPE_ICON[k.key_type] || 'key-round'}"></i>
                    </div>
                    <div class="appt-person__body">
                        <span class="appt-person__role">${esc(KEY_TYPE_LABEL[k.key_type] || 'Altro')}${qty > 1 ? ` · × ${qty}` : ''}</span>
                        <strong class="appt-person__name">${esc(k.holder_display || 'Nessun detentore')}</strong>
                    </div>
                    <span class="badge ${overdue ? 'badge--key-overdue' : (STATUS_BADGE[k.status] || 'badge')} kp-sibling__badge">
                        ${esc(overdue ? 'In ritardo' : (STATUS_LABEL[k.status] || k.status))}
                    </span>
                </div>`;
            }).join('') + '</div>';

            box.querySelectorAll('.kp-sibling').forEach(el => {
                el.addEventListener('click', () => {
                    window.App?.navigateTo('key_profile', { keyId: Number(el.dataset.id) });
                });
            });

            if (window.lucide) window.lucide.createIcons();
        } catch (err) {
            box.innerHTML = `<p class="text-muted">${esc(err.message)}</p>`;
        }
    }

    // ── Azioni ───────────────────────────────────────────────────────

    async function registerReturn() {
        if (!await window.confirmDialog(
            `Registrare il rientro delle chiavi${rec.holder_display ? ` da ${rec.holder_display}` : ''}?`,
            { title: 'Rientro chiavi', confirmText: 'Registra rientro' }
        )) return;
        try {
            const j = await fetch(`${API}?id=${rec.id}&action=return`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ returned_at: todayISO() }),
            }).then(r => r.json());
            if (!j.success) throw new Error(j.error);
            showAlert('Rientro registrato.', 'success');
            load();
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    async function remove() {
        const where = [rec.address, rec.city].filter(Boolean).join(', ');
        if (!await window.confirmDialog(
            `Eliminare il registro chiavi per ${where || '#' + rec.id}? Lo storico delle consegne resta archiviato.`,
            { title: 'Elimina chiavi', confirmText: 'Elimina' }
        )) return;
        try {
            const j = await fetch(`${API}?id=${rec.id}`, { method: 'DELETE' }).then(r => r.json());
            if (!j.success) throw new Error(j.error);
            window.App?.navigateTo('keys');
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    function init() {
        $('kp-return').addEventListener('click', registerReturn);
        $('kp-edit').addEventListener('click', () => {
            window.App?.navigateTo('entity_edit', { entity: 'keys', id: Number(keyId) });
        });
        $('kp-delete').addEventListener('click', remove);
        load();
    }

    init();
})();
