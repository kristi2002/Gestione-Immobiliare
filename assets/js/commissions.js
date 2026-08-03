(function () {
    'use strict';

    const API = 'api/commissions.php';

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

    const STATUS_LABELS = { pending: 'In sospeso', paid: 'Pagata', cancelled: 'Annullata' };
    const STATUS_COLORS = { pending: 'var(--color-warning,#e67e22)', paid: 'var(--color-success,#27ae60)', cancelled: '#999' };
    // 'unico' resta senza etichetta: e' il caso normale, non una meta' di split.
    const ROLE_LABELS   = { acquisitore: 'Acquisitore', venditore: 'Venditore' };

    let currentPage    = 1;
    const PAGE_LIMIT   = 25;
    let deleteTargetId = null;
    let statusFilter   = '';
    const els          = {};

    function fmt(n) {
        return n != null
            ? new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n)
            : '—';
    }

    function init() {
        els.alert      = document.getElementById('commissions-alert');
        els.search     = document.getElementById('commission-search');
        els.tbody      = document.getElementById('commissions-tbody');
        els.pagination = document.getElementById('commissions-pagination');
        els.delModal   = document.getElementById('commissions-delete-modal');

        bindEvents();
        bindRowMenu();
        loadCommissions();
    }

    function openForm(id) {
        // La scheda vive in entity_edit (schema in entity_edit/schemas/commissions.js):
        // qui non si costruisce piu' il form, si porta l'utente sulla pagina.
        if (window.App) window.App.navigateTo('entity_edit', id ? { entity: 'commissions', id: Number(id) } : { entity: 'commissions' });
    }

    function bindEvents() {
        document.getElementById('btn-new-commission').addEventListener('click', () => openForm());

        document.getElementById('commissions-delete-close').addEventListener('click', closeDeleteModal);
        document.getElementById('commissions-delete-cancel').addEventListener('click', closeDeleteModal);
        document.getElementById('commissions-delete-confirm').addEventListener('click', confirmDelete);
        els.delModal.addEventListener('click', e => { if (e.target === els.delModal) closeDeleteModal(); });

        els.search.addEventListener('input', () => {
            clearTimeout(els._timer);
            els._timer = setTimeout(() => { currentPage = 1; loadCommissions(); }, 400);
        });

        document.querySelectorAll('.comm-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.comm-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                statusFilter = tab.dataset.status;
                currentPage  = 1;
                loadCommissions();
            });
        });
    }

    async function loadCommissions() {
        const params = new URLSearchParams({ page: currentPage, limit: PAGE_LIMIT });
        if (statusFilter) params.set('status', statusFilter);
        if (els.search.value.trim()) params.set('search', els.search.value.trim());

        softLoad(els.tbody, '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:2rem;">Caricamento…</td></tr>');

        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const parsed = window.Pagination.parseResponse(json);
            renderStats((json.data && json.data.stats) || {});
            renderRows(parsed.items);
            window.Pagination.render(els.pagination, parsed, p => { currentPage = p; loadCommissions(); });
        } catch (err) {
            els.tbody.classList.remove('is-loading');
            els.tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--color-danger);padding:2rem;">${esc(err.message)}</td></tr>`;
        }
    }

    function renderStats(stats) {
        document.getElementById('stat-pending-amount').textContent = fmt(stats.pending_total);
        document.getElementById('stat-paid-amount').textContent    = fmt(stats.paid_total);
        document.getElementById('stat-total-count').textContent    = stats.total_count ?? '—';
    }

    function renderRows(items) {
        els.tbody.classList.remove('is-loading');
        if (!items.length) {
            els.tbody.innerHTML = '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:2rem;">Nessuna provvigione trovata.</td></tr>';
            return;
        }

        els.tbody.innerHTML = items.map(c => {
            const agentName = c.agent_username || c.agent_name || `#${c.admin_user_id || c.agent_id}`;
            const statusLabel = STATUS_LABELS[c.status] || c.status;
            const statusColor = STATUS_COLORS[c.status] || '#333';
            const isPending   = c.status === 'pending';

            // Il ruolo sta sotto il nome invece che in una colonna sua: la tabella
            // ne ha gia' otto, e 'unico' (il caso normale) non va detto.
            const roleLabel = ROLE_LABELS[c.agent_role] || '';

            return `<tr>
                <td data-label="Agente">${esc(agentName)}
                    ${roleLabel ? `<div class="text-muted" style="font-size:11px;">${esc(roleLabel)}</div>` : ''}</td>
                <td data-label="Tipo"><span class="badge">${esc(c.commission_type || '—')}</span></td>
                <td data-label="Importo"><strong>${fmt(c.amount)}</strong></td>
                <td data-label="Percentuale">${c.percentage != null ? esc(c.percentage) + '%' : '—'}</td>
                <td data-label="Contratto">${c.contract_title ? esc(c.contract_title) : (c.contract_id ? `<code>#${esc(c.contract_id)}</code>` : '<span class="text-muted">—</span>')}</td>
                <td data-label="Scadenza">${formatDate(c.due_date)}</td>
                <td data-label="Stato"><span style="color:${statusColor};font-weight:600;">${esc(statusLabel)}</span></td>
                <td data-label="Azioni" class="col-actions lt-actions">
                    ${window.canWrite !== false
                        ? window.RowMenu.button(c.id, 'Azioni provvigione', { pending: isPending ? '1' : '' })
                        : '<span class="text-muted">—</span>'}
                </td>
            </tr>`;
        }).join('');

    }

    function bindRowMenu() {
        window.RowMenu.bind(els.tbody, btn => [
            // "Pagata" solo se c'e' ancora da pagare: su una provvigione gia'
            // saldata la voce non compare invece di comparire inerte.
            btn.dataset.pending === '1'
                ? { label: 'Segna come pagata', icon: 'check', onClick: () => markPaid(btn.dataset.id) }
                : null,
            // Il record lo rilegge la scheda: qui basta l'id.
            { label: 'Modifica', icon: 'pencil', onClick: () => openForm(btn.dataset.id) },
            { sep: true },
            { label: 'Elimina', icon: 'trash-2', danger: true, onClick: () => {
                deleteTargetId = btn.dataset.id;
                els.delModal.hidden = false;
            } },
        ]);
    }

    // Nessuno stato "in corso" sul pulsante: il pulsante non c'e' piu' (era una
    // voce di menu, sparita al click). L'esito lo dicono il ricarico e l'avviso.
    async function markPaid(id) {
        try {
            const res  = await fetch(`${API}?id=${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'paid' }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert('Provvigione segnata come pagata.', 'success');
            loadCommissions();
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    function closeDeleteModal() { els.delModal.hidden = true; deleteTargetId = null; }

    async function confirmDelete() {
        if (!deleteTargetId) return;
        const btn = document.getElementById('commissions-delete-confirm');
        btn.disabled = true;
        try {
            const res  = await fetch(`${API}?id=${deleteTargetId}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeDeleteModal();
            showAlert('Provvigione eliminata.', 'success');
            loadCommissions();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    function showAlert(msg, type) {
        els.alert.textContent   = msg;
        els.alert.className     = `alert alert--${type}`;
        els.alert.style.display = 'block';
        clearTimeout(els.alert._t);
        els.alert._t = setTimeout(() => { els.alert.style.display = 'none'; }, 5000);
    }

    function formatDate(str) { return window.Fmt.date(str); }

    init();
})();
