/**
 * Shared pagination UI for list views.
 */
(function () {
    'use strict';

    window.Pagination = {
        /**
         * @param {HTMLElement} container
         * @param {{ page, pages, total, limit }} meta
         * @param {(page: number) => void} onPageChange
         */
        render(container, meta, onPageChange) {
            if (!container) return;
            const { page, pages, total, limit } = meta;
            if (!total || pages <= 1) {
                container.innerHTML = total
                    ? `<span class="pagination-info text-muted">${total} risultat${total === 1 ? 'o' : 'i'}</span>`
                    : '';
                return;
            }

            const prev = page > 1 ? page - 1 : null;
            const next = page < pages ? page + 1 : null;
            const start = (page - 1) * limit + 1;
            const end = Math.min(page * limit, total);

            container.innerHTML = `
                <div class="pagination-bar">
                    <span class="pagination-info text-muted">${start}–${end} di ${total}</span>
                    <div class="pagination-controls">
                        <button type="button" class="btn btn--ghost btn--sm" data-page="${prev || ''}" ${prev ? '' : 'disabled'}>‹ Prec</button>
                        <span class="pagination-page">${page} / ${pages}</span>
                        <button type="button" class="btn btn--ghost btn--sm" data-page="${next || ''}" ${next ? '' : 'disabled'}>Succ ›</button>
                    </div>
                </div>`;

            container.querySelectorAll('[data-page]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const p = parseInt(btn.dataset.page, 10);
                    if (p > 0) onPageChange(p);
                });
            });
        },

        queryParams(page, limit = 25) {
            return `page=${page}&limit=${limit}`;
        },

        /**
         * Tetto reale di apiGetPagination() per gli endpoint che non lo alzano.
         * Le schede chiedevano `limit=200` e il server ne concedeva 100 senza
         * dirlo: chiedere quello che si ottiene davvero e' l'unico modo perche'
         * `limit` nella risposta e le righe a schermo raccontino la stessa cosa.
         */
        TAB_LIMIT: 100,

        /**
         * Un elenco senza impaginatore (le schede: contratti di un inquilino,
         * documenti di un immobile...) mostra UNA pagina. `items.length` e' la
         * pagina, `total` e' il COUNT(*) a DB: contare il primo al posto del
         * secondo scrive "100 pagamenti" a chi ne ha 270, e niente lo segnala.
         */
        unwrap(payload) {
            const d     = payload && payload.data !== undefined ? payload.data : payload;
            const items = (d && d.items) || (Array.isArray(d) ? d : []);
            const total = Number(d?.total ?? items.length);
            return { items, total, truncated: total > items.length };
        },

        /** "12 documenti" quando ci sono tutti, "100 di 270 pagamenti" quando no. */
        countLabel(shown, total, noun) {
            return shown < total ? `${shown} di ${total} ${noun}` : `${total} ${noun}`;
        },

        /**
         * Avviso in coda all'elenco tagliato. Il conteggio onesto da solo si
         * legge come un filtro, non come "qui sotto manca roba".
         * @param {number} colspan  se >0 restituisce una <tr>, altrimenti un <div>
         * @param {string} hint     frase gia' formata su come vedere il resto
         */
        truncationNote(shown, total, colspan = 0, hint = '') {
            if (shown >= total) return '';
            const text = `Mostrate le prime ${shown} righe di ${total}.${hint ? ' ' + hint : ''}`;
            return colspan > 0
                ? `<tr><td colspan="${colspan}" class="list-truncated">${text}</td></tr>`
                : `<div class="list-truncated">${text}</div>`;
        },

        parseResponse(json) {
            const d = json?.data;

            if (Array.isArray(d)) {
                return { items: d, total: d.length, page: 1, pages: 1, limit: d.length || 25 };
            }

            if (!d || typeof d !== 'object') {
                return { items: [], total: 0, page: 1, pages: 1, limit: 25 };
            }

            const items = Array.isArray(d.items) ? d.items : [];

            return {
                items,
                total: d.total ?? items.length,
                page: d.page ?? 1,
                pages: d.pages ?? 1,
                limit: d.limit ?? 25,
            };
        },

        /**
         * Fetch an ENTIRE list endpoint and always return an array.
         *
         * Chiedeva `limit=500` in una richiesta sola. Ma apiGetPagination() e'
         * `apiGetPagination(int $defaultLimit = 25, int $maxLimit = 100)` e
         * tronca con `min($maxLimit, ...)`: il server ne restituiva 100, senza
         * errori e senza dirlo. Chi usa fetchList sono le tendine e gli elenchi
         * "prendi tutto", quindi dal centunesimo record in poi le voci
         * sparivano dai moduli — un immobile che esiste ma non e' selezionabile,
         * e nessun messaggio da nessuna parte.
         *
         * Ora si chiede quanto il server concede davvero e si continua finche'
         * non sono arrivati tutti, usando `total` invece di indovinare.
         */
        async fetchList(url, params = {}) {
            const PAGE = 100;      // il tetto vero di apiGetPagination()
            const MAX_PAGES = 50;  // 5.000 righe: rete di sicurezza, non un limite atteso

            const out = [];
            let page = 1;
            let total = null;

            while (page <= MAX_PAGES) {
                const qs = new URLSearchParams({ ...params, page: String(page), limit: String(PAGE) });
                const res = await fetch(`${url}?${qs}`);
                const json = await res.json();
                if (!json.success) throw new Error(json.error || 'Errore API');

                const parsed = Pagination.parseResponse(json);
                out.push(...parsed.items);

                if (total === null) total = parsed.total;
                // Meno di una pagina piena, oppure ne abbiamo gia' quanti ne
                // dichiara il server: non c'e' altro da chiedere.
                if (parsed.items.length < PAGE || out.length >= total) break;
                page++;
            }

            if (page > MAX_PAGES) {
                console.warn(`[Pagination] ${url}: fermato a ${out.length} record su ${total}.`);
            }
            return out;
        },
    };
})();
