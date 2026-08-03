/**
 * Portale Inquilino — messaggi, autoletture, privacy e foto allegate.
 *
 * Senza stato di modulo (vedi nav.js): tutto si rilegge dal DOM.
 */

function alertInto(el, kind, message) {
    if (!el) return;
    el.className = `alert alert--${kind}`;
    el.textContent = message;
    el.hidden = false;
}

/**
 * POST JSON verso api_portal_actions.php.
 * Un 500 restituisce HTML, non JSON: senza questa rete l'inquilino leggerebbe
 * "errore di rete" per un guasto del server.
 */
async function send(csrfToken, payload) {
    try {
        const res = await fetch('api_portal_actions.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
            body: JSON.stringify(payload),
        });
        let json;
        try {
            json = await res.json();
        } catch {
            return { ok: false, message: `Errore del server (${res.status}). Riprova più tardi.` };
        }
        return json.success
            ? { ok: true, message: json.data?.message || 'Fatto.' }
            : { ok: false, message: json.error || 'Operazione non riuscita.' };
    } catch {
        return { ok: false, message: 'Errore di rete. Controlla la connessione e riprova.' };
    }
}

/** Ricarica restando sulla sezione corrente, per rileggere i dati dal server. */
function reloadHere() {
    setTimeout(() => window.location.reload(), 900);
}

/** Filo diretto con l'agenzia. */
function wireMessages(csrfToken) {
    const form = document.getElementById('tp-msg-form');
    if (!form) return;

    const alertEl = document.getElementById('tp-msg-alert');
    const btn = document.getElementById('tp-msg-send');
    const box = document.getElementById('tp-msg-body');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = box.value.trim();
        if (!text) {
            alertInto(alertEl, 'error', 'Scrivi un messaggio.');
            box.focus();
            return;
        }

        btn.disabled = true;
        const label = btn.textContent;
        btn.textContent = 'Invio…';
        alertEl.hidden = true;

        const res = await send(csrfToken, { action: 'message', body: text });
        alertInto(alertEl, res.ok ? 'success' : 'error', res.message);
        if (res.ok) {
            box.value = '';
            reloadHere();   // il messaggio deve comparire nel filo
        }
        btn.disabled = false;
        btn.textContent = label;
    });
}

/** Autolettura di un contatore. */
function wireMeters(csrfToken) {
    const alertEl = document.getElementById('tp-reading-alert');

    document.querySelectorAll('.tp-meter__send').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const label = btn.dataset.label || 'contatore';
            const raw = window.prompt(`Lettura attuale del contatore ${label}:`, '');
            if (raw === null) return;               // annullato
            const value = raw.trim();
            if (!value) return;

            btn.disabled = true;
            const original = btn.textContent;
            btn.textContent = 'Invio…';

            const res = await send(csrfToken, {
                action: 'reading',
                meter_id: Number(btn.dataset.meter),
                value,
            });
            alertInto(alertEl, res.ok ? 'success' : 'error', res.message);
            if (res.ok) reloadHere();

            btn.disabled = false;
            btn.textContent = original;
        });
    });
}

/** Richieste privacy: copia dei dati e cancellazione. */
function wirePrivacy(csrfToken) {
    const alertEl = document.getElementById('tp-privacy-alert');

    document.querySelectorAll('[data-privacy]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const kind = btn.dataset.privacy;

            // La cancellazione e' irreversibile dal lato di chi la chiede: si
            // conferma, e si lascia scrivere il motivo (l'agenzia deve poter
            // capire cosa sta cancellando e perche').
            let reason = '';
            if (kind === 'erasure') {
                const ok = window.confirm(
                    'Chiedere la cancellazione dei tuoi dati personali?\n\n'
                    + "L'agenzia valuterà la richiesta e ti risponderà entro 30 giorni. "
                    + 'Alcuni documenti devono essere conservati per obbligo di legge.'
                );
                if (!ok) return;
                reason = window.prompt('Vuoi indicare un motivo? (facoltativo)', '') || '';
            }

            btn.disabled = true;
            const res = await send(csrfToken, { action: 'privacy', kind, reason });
            alertInto(alertEl, res.ok ? 'success' : 'error', res.message);
            if (res.ok) reloadHere();
            else btn.disabled = false;
        });
    });
}

/**
 * Foto allegata a una richiesta.
 *
 * L'input file si crea al volo invece di stare nella pagina: ce ne servirebbe
 * uno per ogni richiesta in elenco, e sarebbero tutti inerti tranne quello
 * premuto.
 */
function wireAttachments(csrfToken) {
    document.querySelectorAll('[data-attach]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/jpeg,image/png,image/webp,application/pdf';

            input.addEventListener('change', async () => {
                const file = input.files && input.files[0];
                if (!file) return;

                const original = btn.innerHTML;
                btn.disabled = true;
                btn.textContent = 'Caricamento…';

                const fd = new FormData();
                fd.append('reminder_id', btn.dataset.attach);
                fd.append('file', file);
                fd.append('csrf_token', csrfToken);

                try {
                    const res = await fetch('api_upload.php', {
                        method: 'POST',
                        headers: { 'X-CSRF-Token': csrfToken },
                        body: fd,      // niente Content-Type: lo mette il browser col boundary
                    });
                    let json;
                    try {
                        json = await res.json();
                    } catch {
                        json = { success: false, error: `Errore del server (${res.status}).` };
                    }
                    if (json.success) {
                        btn.textContent = 'Caricata';
                        reloadHere();
                        return;
                    }
                    window.alert(json.error || 'Caricamento non riuscito.');
                } catch {
                    window.alert('Errore di rete durante il caricamento.');
                }

                btn.disabled = false;
                btn.innerHTML = original;
            });

            input.click();
        });
    });
}

export function wirePortalActions(csrfToken) {
    wireMessages(csrfToken);
    wireMeters(csrfToken);
    wirePrivacy(csrfToken);
    wireAttachments(csrfToken);
}
