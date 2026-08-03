/**
 * Portale Inquilino — modulo "Invia una richiesta".
 *
 * Senza stato di modulo (vedi nav.js): il tipo scelto si legge dal DOM, non da
 * una variabile che sopravvive fra due caricamenti diversi del file.
 */

/** Tipo attualmente selezionato, letto dai pulsanti. */
function selectedType() {
    const on = document.querySelector('.tp-type.is-on');
    return on ? on.dataset.type : 'maintenance';
}

/** Seleziona un tipo e allinea gli stati ARIA. */
function selectType(key) {
    document.querySelectorAll('.tp-type').forEach((b) => {
        const on = b.dataset.type === key;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
}

function showAlert(el, kind, message) {
    el.className = `alert alert--${kind}`;
    el.textContent = message;
    el.hidden = false;
}

/**
 * Aggancia i pulsanti del tipo e l'invio del modulo.
 * @param {string} csrfToken passato dal PHP tramite data-attribute
 */
export function wireRequestForm(csrfToken) {
    const form = document.getElementById('tp-request-form');
    if (!form) return;

    const alertEl = document.getElementById('tp-request-alert');
    const btn = document.getElementById('tp-req-send');
    const subjectEl = document.getElementById('tp-req-subject');
    const messageEl = document.getElementById('tp-req-message');

    document.querySelectorAll('.tp-type').forEach((b) => {
        b.addEventListener('click', () => selectType(b.dataset.type));
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const subject = subjectEl.value.trim();
        const message = messageEl.value.trim();

        // Il form e' `novalidate`: la validazione la facciamo qui per poter
        // dire QUALE campo manca invece del solo fumetto del browser.
        if (!subject || !message) {
            showAlert(alertEl, 'error', 'Compila sia l\'oggetto sia il messaggio.');
            (!subject ? subjectEl : messageEl).focus();
            return;
        }

        btn.disabled = true;
        const label = btn.textContent;
        btn.textContent = 'Invio in corso…';
        alertEl.hidden = true;

        try {
            const res = await fetch('api_maintenance.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: JSON.stringify({ subject, message, type: selectedType() }),
            });

            // Un 500 restituisce HTML, non JSON: senza questa rete l'inquilino
            // vedeva "Errore di rete" per un guasto del server.
            let json;
            try {
                json = await res.json();
            } catch {
                showAlert(alertEl, 'error', `Errore del server (${res.status}). Riprova o contatta l'agenzia.`);
                return;
            }

            if (json.success) {
                showAlert(alertEl, 'success', json.data?.message || 'Richiesta inviata.');
                form.reset();
                selectType('maintenance');
            } else {
                showAlert(alertEl, 'error', json.error || 'Errore durante l\'invio.');
            }
        } catch {
            showAlert(alertEl, 'error', 'Errore di rete. Controlla la connessione e riprova.');
        } finally {
            btn.disabled = false;
            btn.textContent = label;
        }
    });
}
