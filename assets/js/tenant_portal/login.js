/**
 * Portale Inquilino — pagina di accesso.
 *
 * Due pannelli nella stessa scheda: accesso e recupero password. Restano
 * entrambi nel documento (uno con `hidden`) invece di essere due pagine,
 * cosi' tornare indietro non ricarica nulla.
 */

function paintIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        try {
            window.lucide.createIcons();
        } catch {
            /* un'icona mancante non deve fermare l'accesso */
        }
    }
}

function swap(showId, hideId, focusId) {
    document.getElementById(hideId).hidden = true;
    document.getElementById(showId).hidden = false;
    const f = focusId && document.getElementById(focusId);
    if (f) f.focus();
}

function init() {
    paintIcons();

    const toForgot = document.getElementById('tp-show-forgot');
    const toLogin = document.getElementById('tp-show-login');

    if (toForgot) {
        toForgot.addEventListener('click', () => swap('tp-auth-forgot', 'tp-auth-login', 'tp-forgot-email'));
    }
    if (toLogin) {
        toLogin.addEventListener('click', () => swap('tp-auth-login', 'tp-auth-forgot', 'tp-login-email'));
    }

    const form = document.getElementById('tp-forgot-form');
    if (!form) return;

    const alertEl = document.getElementById('tp-forgot-alert');
    const btn = document.getElementById('tp-forgot-send');
    const email = document.getElementById('tp-forgot-email');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const value = email.value.trim();
        if (!value) {
            alertEl.className = 'alert alert--error';
            alertEl.textContent = 'Inserisci il tuo indirizzo email.';
            alertEl.hidden = false;
            email.focus();
            return;
        }

        btn.disabled = true;
        const label = btn.textContent;
        btn.textContent = 'Invio in corso…';
        alertEl.hidden = true;

        try {
            const res = await fetch('api_forgot_password.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: value }),
            });
            let json;
            try {
                json = await res.json();
            } catch {
                json = null;
            }
            // L'endpoint risponde sempre allo stesso modo, di proposito: non
            // deve far capire se l'indirizzo esiste. Qui non si aggiunge
            // niente che possa distinguere i due casi.
            alertEl.className = 'alert alert--success';
            alertEl.textContent = json?.data?.message
                || 'Se l\'indirizzo è registrato, riceverai a breve un\'email con il link.';
            alertEl.hidden = false;
            form.reset();
        } catch {
            alertEl.className = 'alert alert--error';
            alertEl.textContent = 'Errore di rete. Controlla la connessione e riprova.';
            alertEl.hidden = false;
        } finally {
            btn.disabled = false;
            btn.textContent = label;
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
