/**
 * RowMenu — il menu ⋮ delle azioni di riga.
 *
 * Ogni tabella aveva la sua fila di pulsanti in coda: tre o quattro icone che
 * rubavano mezza colonna e andavano lette tutte per trovarne una. Adesso c'e'
 * un solo pulsante ⋮ e le azioni stanno dentro, con la loro etichetta scritta.
 *
 * Perche' qui e non copiato in ogni pagina: la meccanica (dove si apre, cosa
 * lo chiude, come non farlo tagliare dalla tabella) e' identica ovunque, e
 * ripeterla venti volte significa venti versioni che divergono.
 *
 * Il menu vive in <body> con posizione fissa: dentro la cella lo taglierebbe
 * l'overflow del contenitore della tabella. Per la stessa ragione qualsiasi
 * scroll o resize lo chiude — restando aperto finirebbe lontano dal pulsante
 * che lo ha aperto, ancorato al nulla.
 *
 * Il click sul ⋮ e' delegato al contenitore, non legato al singolo pulsante:
 * le tabelle si ridisegnano a ogni filtro e a ogni pagina, e un ascoltatore
 * per riga andrebbe riattaccato ogni volta (dimenticarsene = menu morto).
 *
 * Uso:
 *     // nel markup della riga
 *     <td class="col-actions lt-actions" data-label="Azioni">
 *         ${RowMenu.button(item.id, 'Azioni fattura')}
 *     </td>
 *
 *     // una volta sola, in init()
 *     RowMenu.bind(els.tbody, btn => {
 *         const row = items.find(x => String(x.id) === String(btn.dataset.id));
 *         return [
 *             { label: 'Modifica', icon: 'pencil', onClick: () => edit(row) },
 *             { sep: true },
 *             { label: 'Elimina', icon: 'trash-2', danger: true, onClick: () => del(row) },
 *         ];
 *     });
 *
 * Voci: { label, icon, onClick, disabled, title, danger } oppure { sep: true }.
 * Con { href, download, target } la voce diventa un vero link invece di un
 * pulsante. `icon` e' un nome Lucide; per un'icona propria si passa `html`.
 * Una voce `null`/`false` viene scartata: comodo per le voci condizionate.
 */
(function () {
    'use strict';

    let menuEl    = null;
    let openerBtn = null;

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

    function close() {
        if (!menuEl) return;
        // Se il fuoco e' rimasto dentro il menu che sta sparendo va riportato
        // sul ⋮, o chi naviga da tastiera si ritrova sul <body> e riparte da
        // capo. preventScroll: uno scroll qui rientrerebbe da onAnyMove.
        const focusWasInside = menuEl.contains(document.activeElement);
        menuEl.remove();
        menuEl = null;
        if (focusWasInside && openerBtn && document.body.contains(openerBtn)) {
            openerBtn.focus({ preventScroll: true });
        }
        openerBtn = null;
    }

    function open(btn, items) {
        close();

        const menu = document.createElement('div');
        menu.className = 'lt-menu';
        menu.setAttribute('role', 'menu');
        if (btn.dataset.id) menu.dataset.id = btn.dataset.id;

        items.forEach(it => {
            if (it.sep) {
                const sep = document.createElement('div');
                sep.className = 'lt-menu__sep';
                menu.appendChild(sep);
                return;
            }
            // Uno scaricamento resta un vero <a download>: come <button> con
            // un click simulato si perderebbero "apri in una nuova scheda" e
            // "salva con nome", che su un documento sono meta' del motivo per
            // cui uno ci clicca sopra col destro.
            const isLink = !!it.href;
            const el = document.createElement(isLink ? 'a' : 'button');
            el.className = 'lt-menu__item' + (it.danger ? ' lt-menu__item--danger' : '');
            el.setAttribute('role', 'menuitem');
            if (isLink) {
                el.href = it.href;
                el.style.textDecoration = 'none';
                if (it.download) el.setAttribute('download', '');
                if (it.target) { el.target = it.target; el.rel = 'noopener'; }
                el.addEventListener('click', () => close());
            } else {
                el.type = 'button';
                if (it.disabled) el.disabled = true;
                if (!it.disabled && typeof it.onClick === 'function') {
                    el.addEventListener('click', () => { close(); it.onClick(); });
                }
            }
            if (it.title) el.title = it.title;
            const icon = it.html || (it.icon ? `<i data-lucide="${esc(it.icon)}"></i>` : '');
            el.innerHTML = `${icon}<span>${esc(it.label)}</span>`;
            menu.appendChild(el);
        });

        document.body.appendChild(menu);

        // Le icone si disegnano PRIMA di misurare: un <i data-lucide> non
        // occupa spazio, l'<svg> che lo sostituisce si'. Misurando prima, un
        // menu con etichette lunghe si allineava sui pixel sbagliati.
        if (window.lucide) window.lucide.createIcons();

        // Allineato a destra sotto il ⋮; se sotto non ci sta, sopra. Mai fuori
        // dai bordi: un menu mezzo fuori schermo e' un menu con voci
        // irraggiungibili.
        const r  = btn.getBoundingClientRect();
        const mw = menu.offsetWidth;
        const mh = menu.offsetHeight;
        const left = Math.min(r.right - mw, window.innerWidth - mw - 8);
        let   top  = r.bottom + 6;
        if (top + mh > window.innerHeight - 8) top = r.top - mh - 6;
        menu.style.left = Math.max(8, left) + 'px';
        menu.style.top  = Math.max(8, top) + 'px';

        menuEl    = menu;
        openerBtn = btn;

        const first = menu.querySelector('.lt-menu__item:not(:disabled)');
        if (first) first.focus({ preventScroll: true });
    }

    /**
     * Il ⋮ da mettere nella cella Azioni.
     *
     * `data` finisce in altrettanti attributi data-*: e' quello che leggeva
     * ciascun pulsante prima di sparire (il nome da mostrare nella conferma di
     * eliminazione, lo stato corrente, l'immobile della riga). Tenerlo sul ⋮
     * evita di dover risalire alla riga da un elenco che la pagina magari non
     * conserva.
     */
    function button(id, ariaLabel, data) {
        let attrs = '';
        if (data) {
            for (const k in data) {
                if (data[k] === undefined || data[k] === null) continue;
                attrs += ` data-${esc(k)}="${esc(data[k])}"`;
            }
        }
        return `<button class="btn btn--sm btn--ghost btn-rail" data-id="${esc(id)}"${attrs}`
             + ` title="Azioni" aria-label="${esc(ariaLabel || 'Azioni')}" aria-haspopup="menu">`
             + '<i data-lucide="more-vertical"></i></button>';
    }

    const bound = new WeakSet();

    /**
     * Delegato sul contenitore: sopravvive ai ridisegni della tabella.
     * `buildItems(btn)` viene chiamata all'apertura, non al disegno, cosi' le
     * voci vedono sempre lo stato corrente della riga.
     */
    function bind(root, buildItems, opts) {
        if (!root || bound.has(root)) return;
        bound.add(root);
        const sel = (opts && opts.trigger) || '.btn-rail';

        root.addEventListener('click', e => {
            const btn = e.target.closest(sel);
            if (!btn || !root.contains(btn)) return;
            // La riga sotto spesso apre la scheda: questo click e' del menu.
            e.preventDefault();
            e.stopPropagation();
            // Secondo click sullo stesso ⋮ = chiudi.
            if (menuEl && openerBtn === btn) { close(); return; }
            const items = (buildItems(btn) || []).filter(Boolean);
            if (items.length) open(btn, items);
        });
    }

    document.addEventListener('click', e => {
        if (menuEl && !menuEl.contains(e.target)) close();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && menuEl) close();
    });
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);

    window.RowMenu = { button, bind, open, close };
})();
