/**
 * Portale Inquilino — navigazione fra le sezioni.
 *
 * SENZA STATO DI MODULO, di proposito: il caricatore mette la marca di versione
 * solo sull'entry, quindi questo file puo' restare in cache mentre index.js e'
 * gia' quello nuovo. Tutto cio' che serve viene passato o riletto dal DOM.
 */

/** Le quattro sezioni, nell'ordine in cui compaiono. */
export const SECTIONS = ['immobile', 'pagamenti', 'documenti', 'assistenza'];

export const SECTION_TITLES = {
    immobile: 'Il mio immobile',
    pagamenti: 'Pagamenti',
    documenti: 'Documenti',
    assistenza: 'Assistenza',
};

/** Sezione valida a partire da un frammento tipo "#pagamenti". */
export function sectionFromHash(hash) {
    const key = String(hash || '').replace(/^#/, '');
    return SECTIONS.includes(key) ? key : SECTIONS[0];
}

/**
 * Mostra una sezione e allinea navigazione, titolo e stati ARIA.
 * Non tocca la cronologia: se ne occupa chi chiama.
 */
export function showSection(key) {
    const target = SECTIONS.includes(key) ? key : SECTIONS[0];

    document.querySelectorAll('.tp-section').forEach((el) => {
        el.classList.toggle('is-active', el.id === `tp-section-${target}`);
    });

    // La barra laterale e quella in basso portano gli stessi data-section.
    document.querySelectorAll('[data-section]').forEach((el) => {
        const on = el.dataset.section === target;
        el.classList.toggle('is-active', on);
        // aria-current sui link, aria-selected sulle schede: non sono la stessa cosa.
        if (el.hasAttribute('role') && el.getAttribute('role') === 'tab') {
            el.setAttribute('aria-selected', on ? 'true' : 'false');
        } else if (on) {
            el.setAttribute('aria-current', 'page');
        } else {
            el.removeAttribute('aria-current');
        }
    });

    const title = document.getElementById('tp-title');
    if (title) title.textContent = SECTION_TITLES[target] || target;

    document.title = `${SECTION_TITLES[target] || target} — Portale Inquilino`;
    return target;
}

/**
 * Aggancia i click di navigazione e il tasto "indietro".
 * Il frammento e' la sola fonte di verita': cosi' un link condiviso e il
 * pulsante indietro del telefono aprono davvero la stessa scheda.
 */
export function wireNavigation() {
    document.querySelectorAll('[data-section]').forEach((el) => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const key = el.dataset.section;
            if (`#${key}` !== window.location.hash) {
                window.history.pushState({ section: key }, '', `#${key}`);
            }
            showSection(key);
            // Cambiando scheda si torna in cima: il telefono resta
            // altrimenti a meta' della sezione precedente.
            const pane = document.querySelector('.tp-pane') || window;
            pane.scrollTo({ top: 0, behavior: 'auto' });
        });
    });

    window.addEventListener('popstate', () => {
        showSection(sectionFromHash(window.location.hash));
    });

    return showSection(sectionFromHash(window.location.hash));
}
