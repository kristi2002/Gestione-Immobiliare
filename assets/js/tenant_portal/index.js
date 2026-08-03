/**
 * Portale Inquilino — entry.
 *
 * Questo e' l'unico file a cui il PHP mette la marca di versione, quindi e'
 * l'unico che si puo' dare per aggiornato: i sotto-moduli restano senza stato
 * (vedi nav.js e requests.js).
 *
 * Il token CSRF NON e' piu' interpolato dentro il codice: adesso il modulo e'
 * un file esterno e non passa dal PHP. Arriva da un data-attribute sul guscio.
 */

import { wireNavigation } from './nav.js';
import { wireRequestForm } from './requests.js';

/** Idrata le icone lucide, se la libreria e' arrivata. */
function paintIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        try {
            window.lucide.createIcons();
        } catch {
            /* un'icona mancante non deve fermare il portale */
        }
    }
}

/** Messaggio a comparsa, per il ritorno da un pagamento. */
function toast(message, kind = 'success', ms = 6000) {
    const el = document.createElement('div');
    el.className = `tp-toast alert alert--${kind}`;
    el.setAttribute('role', 'status');
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
}

function init() {
    const shell = document.querySelector('.tp-shell');
    const csrf = shell?.dataset.csrf || '';

    paintIcons();
    wireNavigation();
    wireRequestForm(csrf);

    // Ritorno dal pagamento. Il parametro si legge qui invece di far scrivere
    // al PHP un blocco <script> inline (che la CSP di domani rifiuterebbe).
    if (new URLSearchParams(window.location.search).has('paid')) {
        toast('Pagamento ricevuto con successo. Grazie!');
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
