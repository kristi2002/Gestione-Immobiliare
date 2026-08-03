/**
 * Portale Inquilino — scheda Account.
 *
 * Senza stato di modulo (vedi nav.js): tutto si rilegge dal DOM.
 */

function showAlert(el, kind, message) {
    el.className = `alert alert--${kind}`;
    el.textContent = message;
    el.hidden = false;
}

/**
 * Invia un'azione ad api_account.php e restituisce {ok, message}.
 * Il 500 restituisce HTML, non JSON: senza questa rete l'inquilino leggerebbe
 * "errore di rete" per un guasto del server.
 */
async function post(csrfToken, payload) {
    try {
        const res = await fetch('api_account.php', {
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

/** Esegue un invio gestendo pulsante, alert e ripristino dell'etichetta. */
async function submit(btn, alertEl, payloadFn, csrfToken, onSuccess) {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Salvataggio…';
    alertEl.hidden = true;

    const res = await post(csrfToken, payloadFn());
    showAlert(alertEl, res.ok ? 'success' : 'error', res.message);
    if (res.ok && onSuccess) onSuccess();

    btn.disabled = false;
    btn.textContent = label;
}

export function wireAccount(csrfToken) {
    const contactForm = document.getElementById('tp-contact-form');
    if (contactForm) {
        const alertEl = document.getElementById('tp-contact-alert');
        const btn = document.getElementById('tp-contact-save');
        contactForm.addEventListener('submit', (e) => {
            e.preventDefault();
            submit(btn, alertEl, () => ({
                action: 'contact',
                phone: document.getElementById('tp-acc-phone').value.trim(),
            }), csrfToken);
        });
    }

    const pwdForm = document.getElementById('tp-pwd-form');
    if (pwdForm) {
        const alertEl = document.getElementById('tp-pwd-alert');
        const btn = document.getElementById('tp-pwd-save');
        const cur = document.getElementById('tp-pwd-current');
        const next = document.getElementById('tp-pwd-next');
        const conf = document.getElementById('tp-pwd-confirm');

        pwdForm.addEventListener('submit', (e) => {
            e.preventDefault();

            // Il controllo di coincidenza sta anche qui, non solo sul server:
            // e' l'errore piu' probabile e non vale un giro di rete.
            if (next.value !== conf.value) {
                showAlert(alertEl, 'error', 'Le due nuove password non coincidono.');
                conf.focus();
                return;
            }

            submit(btn, alertEl, () => ({
                action: 'password',
                current: cur.value,
                next: next.value,
                confirm: conf.value,
            }), csrfToken, () => pwdForm.reset());
        });
    }
}

/**
 * Pulsanti "Copia" (IBAN e causale).
 *
 * `navigator.clipboard` esiste solo in contesto sicuro: su http non c'e', e
 * senza ripiego il pulsante non farebbe nulla in silenzio. Il ripiego
 * seleziona il testo, cosi' resta comunque copiabile a mano.
 */
export function wireCopyButtons() {
    document.querySelectorAll('[data-copy]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const src = document.querySelector(btn.dataset.copy);
            if (!src) return;
            const text = src.textContent.trim();
            const label = btn.querySelector('span');
            const original = label ? label.textContent : '';

            try {
                if (!navigator.clipboard) throw new Error('no clipboard');
                await navigator.clipboard.writeText(text);
                if (label) label.textContent = 'Copiato';
            } catch {
                const range = document.createRange();
                range.selectNodeContents(src);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
                if (label) label.textContent = 'Seleziona e copia';
            }

            btn.classList.add('is-done');
            setTimeout(() => {
                if (label) label.textContent = original;
                btn.classList.remove('is-done');
            }, 2000);
        });
    });
}
