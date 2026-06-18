(function () {
    'use strict';

    const API       = 'api/commissions.php';
    const USERS_API = 'api/admin_users.php';

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

    const STATUS_LABELS = { pending: 'In sospeso', paid: 'Pagata', cancelled: 'Annullata' };
    const STATUS_COLORS = { pending: 'var(--color-warning,#e67e22)', paid: 'var(--color-success,#27ae60)', cancelled: '#999' };

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
        els.tbody      = document.getElementById('commissions-tbody');
        els.pagination = document.getElementById('commissions-pagination');
        els.modal      = document.getElementById('commissions-modal');
        els.form       = document.getElementById('commissions-form');
        els.delModal   = document.getElementById('commissions-delete-modal');

        bindEvents();
        loadAgents();
        loadCommissions();
    }

    function bindEvents() {
        document.getElementById('btn-new-commission').addEventListener('click', () => openModal());
        document.getElementById('commissions-modal-close').addEventListener('click', closeModal);
        document.getElementById('commissions-modal-cancel').addEventListener('click', closeModal);
        els.modal.addEventListener('click', e => { if (e.target === els.modal) closeModal(); });
        els.form.addEventListener('submit', handleSubmit);

        document.getElementById('commissions-delete-close').addEventListener('click', closeDeleteModal);
        document.getElementById('commissions-delete-cancel').addEventListener('click', closeDeleteModal);
        document.getElementById('commissions-delete-confirm').addEventListener('click', confirmDelete);
        els.delModal.addEventListener('click', e => { if (e.target === els.delModal) closeDeleteModal(); });

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

    async function loadAgents() {
        try {
            const items = await window.Pagination.fetchList(USERS_API);
            const sel = document.getElementById('commissions-agent-id');
            items.forEach(u => {
                const opt = document.createElement('option');
                opt.value = u.id;
                opt.textContent = `${u.name || ''} ${u.surname || ''}`.trim() || u.username || `#${u.id}`;
                sel.appendChild(opt);
            });
        } catch (e) { /* non-critical */ }
    }

    async function loadCommissions() {
        const params = new URLSearchParams({ page: currentPage, limit: PAGE_LIMIT });
        if (statusFilter) params.set('status', statusFilter);

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

            return `<tr>
                <td>${esc(agentName)}</td>
                <td><span class="badge">${esc(c.commission_type || '—')}</span></td>
                <td><strong>${fmt(c.amount)}</strong></td>
                <td>${c.percentage != null ? esc(c.percentage) + '%' : '—'}</td>
                <td>${c.contract_title ? esc(c.contract_title) : (c.contract_id ? `<code>#${esc(c.contract_id)}</code>` : '<span class="text-muted">—</span>')}</td>
                <td>${formatDate(c.due_date)}</td>
                <td><span style="color:${statusColor};font-weight:600;">${esc(statusLabel)}</span></td>
                <td style="white-space:nowrap;">
                    ${isPending ? `<button class="btn btn--sm btn--ghost btn-mark-paid" data-id="${c.id}" title="Segna come pagata" style="color:var(--color-success,#27ae60);">✓ Pagata</button>` : ''}
                    <button class="btn btn--sm btn--ghost btn-c-edit" data-id="${c.id}" title="Modifica">✏️</button>
                    <button class="btn btn--sm btn--ghost btn-c-del" data-id="${c.id}" title="Elimina">🗑️</button>
                </td>
            </tr>`;
        }).join('');

        els.tbody.querySelectorAll('.btn-mark-paid').forEach(btn => {
            btn.addEventListener('click', () => markPaid(btn.dataset.id, btn));
        });

        els.tbody.querySelectorAll('.btn-c-edit').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    const res  = await fetch(`${API}?id=${btn.dataset.id}`);
                    const json = await res.json();
                    if (!json.success) throw new Error(json.error);
                    const item = Array.isArray(json.data) ? json.data[0] : json.data;
                    openModal(item);
                } catch (e) { showAlert(e.message, 'error'); }
            });
        });

        els.tbody.querySelectorAll('.btn-c-del').forEach(btn => {
            btn.addEventListener('click', () => {
                deleteTargetId = btn.dataset.id;
                els.delModal.hidden = false;
            });
        });
    }

    async function markPaid(id, btn) {
        btn.disabled = true; btn.textContent = '…';
        try {
            const res  = await fetch(`${API}?id=${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert('Provvigione segnata come pagata.', 'success');
            loadCommissions();
        } catch (err) {
            showAlert(err.message, 'error');
            btn.disabled = false; btn.textContent = '✓ Pagata';
        }
    }

    function openModal(item = null) {
        els.form.reset();
        document.getElementById('commissions-id').value = '';
        document.getElementById('commissions-modal-title').textContent = item ? 'Modifica Provvigione' : 'Nuova Provvigione';

        if (item) {
            document.getElementById('commissions-id').value          = item.id;
            document.getElementById('commissions-agent-id').value    = item.admin_user_id || item.agent_id || '';
            document.getElementById('commissions-type').value        = item.commission_type || '';
            document.getElementById('commissions-amount').value      = item.amount || '';
            document.getElementById('commissions-percentage').value  = item.percentage || '';
            document.getElementById('commissions-due-date').value    = item.due_date ? item.due_date.substring(0, 10) : '';
            document.getElementById('commissions-contract-id').value = item.contract_id || '';
            document.getElementById('commissions-notes').value       = item.notes || '';
        }

        els.modal.hidden = false;
        document.getElementById('commissions-agent-id').focus();
    }

    function closeModal() { els.modal.hidden = true; }
    function closeDeleteModal() { els.delModal.hidden = true; deleteTargetId = null; }

    async function handleSubmit(e) {
        e.preventDefault();
        const id  = document.getElementById('commissions-id').value;
        const btn = document.getElementById('commissions-modal-save');
        btn.disabled = true; btn.textContent = 'Salvataggio…';

        const data = {
            admin_user_id:   document.getElementById('commissions-agent-id').value,
            commission_type: document.getElementById('commissions-type').value,
            amount:          parseFloat(document.getElementById('commissions-amount').value) || 0,
            percentage:      document.getElementById('commissions-percentage').value || null,
            due_date:        document.getElementById('commissions-due-date').value || null,
            contract_id:     document.getElementById('commissions-contract-id').value.trim() || null,
            notes:           document.getElementById('commissions-notes').value.trim(),
        };

        try {
            const res  = await fetch(id ? `${API}?id=${id}` : API, {
                method: id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeModal();
            showAlert('Provvigione salvata.', 'success');
            loadCommissions();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Salva';
        }
    }

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

    function formatDate(str) {
        if (!str) return '—';
        return new Date(str).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    init();
})();
