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
