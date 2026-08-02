/**
 * Solleciti pagamenti — anteprima, invio, registro.
 *
 * api/payment_reminder_log.php sapeva gia' fare tutto: scegliere i morosi,
 * scrivere loro e registrare l'esito. Non aveva pero' nessuna pagina, quindi
 * l'unico modo di usarlo era il cron notturno — e se il cron si fermava, non
 * c'era un posto dove accorgersene ne' un modo di rimediare a mano.
 *
 * La regola di questa pagina: non si preme "Invia" al buio. Prima si vede
 * riga per riga chi riceverebbe l'email e chi no, con il motivo.
 */
(function () {
    'use strict';

    const API = 'api/payment_reminder_log.php';

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

    const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
    function money(v) { const n = parseFloat(v); return Number.isFinite(n) ? eur.format(n) : '—'; }

    function fmtDate(v) {
        if (!v) return '—';
        const d = new Date(String(v).replace(' ', 'T'));
        return isNaN(d) ? '—' : d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
    function fmtDateTime(v) {
        if (!v) return '—';
        const d = new Date(String(v).replace(' ', 'T'));
        if (isNaN(d)) return '—';
        return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
            ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    }

    let overview = null;
    let logPage = 1;
    const LOG_LIMIT = 25;
    // Righe di anteprima dei candidati. Non e' un limite di invio: vedi renderCandidates.
    const PREVIEW_LIMIT = 100;
    const els = {};

    function init() {
        els.alert      = document.getElementById('pr-alert');
        els.candidates = document.getElementById('pr-candidates');
        els.log        = document.getElementById('pr-log');
        els.logPag     = document.getElementById('pr-log-pagination');
        els.runBtn     = document.getElementById('pr-run');
        els.modal      = document.getElementById('pr-confirm-modal');

        els.runBtn.addEventListener('click', openConfirm);
        document.getElementById('pr-confirm-close').addEventListener('click', closeConfirm);
        document.getElementById('pr-confirm-cancel').addEventListener('click', closeConfirm);
        document.getElementById('pr-confirm-ok').addEventListener('click', run);
        els.modal.addEventListener('click', e => { if (e.target === els.modal) closeConfirm(); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && !els.modal.hidden) closeConfirm(); });

        loadOverview();
        loadLog();
    }

    async function loadOverview() {
        try {
            const res  = await fetch(`${API}?action=overview`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            overview = json.data;
            renderCron(overview.cron, overview.mail_enabled);
            renderKpi(overview.summary);
            renderCandidates(overview.candidates);
            // Nessuno da sollecitare = niente da premere: un pulsante attivo che
            // non fa nulla e' peggio di uno spento.
            els.runBtn.disabled = overview.summary.would_send === 0 || window.canWrite === false;
        } catch (err) {
            els.candidates.innerHTML = `<tr><td colspan="6" style="color:var(--color-danger);padding:2rem;text-align:center;">${esc(err.message)}</td></tr>`;
        }
    }

    function renderCron(cron, mailEnabled) {
        const dot  = document.getElementById('pr-cron-dot');
        const text = document.getElementById('pr-cron-text');

        let state, msg;
        if (cron.never_run) {
            state = 'bad';
            msg = 'Non è mai partito. I solleciti automatici non stanno funzionando: finché resta così, l\'unico invio è quello manuale qui sotto.';
        } else if (cron.stale) {
            state = 'bad';
            msg = `Fermo. Ultima esecuzione: ${fmtDateTime(cron.last_run)} — dovrebbe girare ogni giorno.`;
        } else {
            state = 'ok';
            msg = `Attivo. Ultima esecuzione: ${fmtDateTime(cron.last_run)}.`;
        }

        if (!mailEnabled) {
            state = 'warn';
            msg += ' L\'invio email è disattivato: nessun sollecito parte davvero.';
        }

        dot.className = 'pr-dot pr-dot--' + state;
        text.textContent = msg;
    }

    function renderKpi(s) {
        document.getElementById('pr-kpi-overdue').textContent = s.overdue_total;
        document.getElementById('pr-kpi-send').textContent    = s.would_send;
        document.getElementById('pr-kpi-skip').textContent    = s.would_skip;
        document.getElementById('pr-kpi-amount').textContent  = money(s.amount_due);
    }

    function renderCandidates(rows) {
        if (!rows.length) {
            els.candidates.innerHTML = '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:2.5rem;">Nessun pagamento in ritardo. Niente da sollecitare.</td></tr>';
            return;
        }

        // L'anteprima si ferma a PREVIEW_LIMIT righe: con centinaia di rate
        // scadute la tabella diventa impaginabile a mano e basta. Il tetto e'
        // SOLO di disegno — l'invio lavora sull'elenco intero, e l'avviso lo
        // dice, perche' "mostrate le prime 100" letto accanto a un pulsante
        // "Invia solleciti" si presta a credere che ne partano 100.
        const total = rows.length;
        rows = rows.slice(0, PREVIEW_LIMIT);

        els.candidates.innerHTML = rows.map(r => `
            <tr>
                <td data-label="Inquilino">
                    <div>${esc(r.tenant_full_name)}</div>
                    <div class="text-muted" style="font-size:.8rem;">${esc(r.tenant_email || 'nessuna email')}</div>
                </td>
                <td data-label="Immobile">${esc(r.property_label)}</td>
                <td data-label="Scadenza">${esc(fmtDate(r.due_date))}</td>
                <td data-label="Ritardo">${esc(r.days_overdue)} gg</td>
                <td data-label="Importo">${esc(money(r.amount))}</td>
                <td data-label="Esito previsto">${
                    r.eligible
                        ? '<span class="badge badge--info">Da sollecitare</span>'
                        : `<span class="badge badge--muted">Saltato</span><div class="text-muted" style="font-size:.78rem;">${esc(r.skip_reason)}</div>`
                }</td>
            </tr>
        `).join('');

        els.candidates.insertAdjacentHTML('beforeend', window.Pagination.truncationNote(
            rows.length, total, 6,
            'L\'invio le prende comunque tutte.'
        ));
    }

    async function loadLog() {
        const params = new URLSearchParams({ page: logPage, limit: LOG_LIMIT });
        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const parsed = window.Pagination.parseResponse(json);
            renderLog(parsed.items);
            window.Pagination.render(els.logPag, parsed, p => { logPage = p; loadLog(); });
        } catch (err) {
            els.log.innerHTML = `<tr><td colspan="5" style="color:var(--color-danger);padding:2rem;text-align:center;">${esc(err.message)}</td></tr>`;
        }
    }

    function outcomeBadge(row) {
        if (row.status === 'sent')      return '<span class="badge badge--success">Inviato</span>';
        if (row.status === 'simulated') return '<span class="badge badge--warning">Non inviato — invio email spento</span>';
        return `<span class="badge badge--danger">Fallito</span>${
            row.error_msg ? `<div class="text-muted" style="font-size:.78rem;">${esc(row.error_msg)}</div>` : ''}`;
    }

    function renderLog(items) {
        if (!items.length) {
            els.log.innerHTML = '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:2.5rem;">Nessun sollecito ancora registrato.</td></tr>';
            return;
        }
        els.log.innerHTML = items.map(r => {
            const who = [r.tenant_name, r.tenant_surname].filter(Boolean).join(' ')
                || [r.client_name, r.client_surname].filter(Boolean).join(' ')
                || '—';
            return `
            <tr>
                <td data-label="Data">${esc(fmtDateTime(r.sent_at))}</td>
                <td data-label="Destinatario">${esc(who)}</td>
                <td data-label="Canale">${esc(r.channel)}</td>
                <td data-label="Ritardo">${esc(r.days_overdue)} gg</td>
                <td data-label="Esito">${outcomeBadge(r)}</td>
            </tr>`;
        }).join('');
    }

    function openConfirm() {
        if (!overview) return;
        const n = overview.summary.would_send;
        document.getElementById('pr-confirm-count').textContent =
            n === 1 ? '1 inquilino' : `${n} inquilini`;
        document.getElementById('pr-confirm-cooldown').textContent = overview.summary.cooldown_days;
        document.getElementById('pr-confirm-mailoff').style.display =
            overview.mail_enabled ? 'none' : 'block';
        els.modal.hidden = false;
    }
    function closeConfirm() { els.modal.hidden = true; }

    async function run() {
        const btn = document.getElementById('pr-confirm-ok');
        btn.disabled = true;
        btn.textContent = 'Invio…';
        try {
            const res  = await fetch(`${API}?action=send_reminders`, { method: 'POST' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeConfirm();
            // L'API distingue "inviato" da "simulato": qui si riporta quella
            // distinzione invece di annunciare comunque un successo.
            showAlert(json.data.message, json.data.simulated > 0 ? 'warning' : 'success');
            loadOverview();
            logPage = 1;
            loadLog();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Invia';
        }
    }

    function showAlert(msg, type) {
        els.alert.textContent = msg;
        els.alert.className = `alert alert--${type}`;
        els.alert.style.display = 'block';
        clearTimeout(els.alert._t);
        els.alert._t = setTimeout(() => { els.alert.style.display = 'none'; }, 8000);
    }

    init();
})();
