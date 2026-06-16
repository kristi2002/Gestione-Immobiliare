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

        /** Fetch a list endpoint and always return an array (handles paginated APIs). */
        async fetchList(url, params = {}) {
            const qs = new URLSearchParams({ page: '1', limit: '500', ...params });
            const res = await fetch(`${url}?${qs}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Errore API');
            return Pagination.parseResponse(json).items;
        },
    };
})();
