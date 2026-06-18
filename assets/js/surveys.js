(function () {
    'use strict';

    const API       = 'api/surveys.php';
    const TENANT_API = 'api/tenants.php';

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

    let currentPage = 1;
    const PAGE_LIMIT = 25;
    const els = {};

    function init() {
        els.alert      = document.getElementById('surveys-alert');
        els.tbody      = document.getElementById('surveys-tbody');
        els.pagination = document.getElementById('surveys-pagination');
        els.linkModal  = document.getElementById('surveys-link-modal');

        bindEvents();
        loadTenants();
        loadSurveys();
    }

    function bindEvents() {
        document.getElementById('btn-new-survey-link').addEventListener('click', openLinkModal);
        document.getElementById('surveys-link-close').addEventListener('click', closeLinkModal);
        document.getElementById('surveys-link-cancel').addEventListener('click', closeLinkModal);
        els.linkModal.addEventListener('click', e => { if (e.target === els.linkModal) closeLinkModal(); });
        document.getElementById('surveys-link-generate').addEventListener('click', generateLink);
        document.getElementById('btn-copy-survey-link').addEventListener('click', () => {
            const url = document.getElementById('surveys-link-url');
            url.select();
            try { document.execCommand('copy'); } catch (e) { navigator.clipboard?.writeText(url.value); }
            showAlert('Link copiato negli appunti!', 'success');
        });
    }

    async function loadTenants() {
        try {
            const items = await window.Pagination.fetchList(TENANT_API);
            const sel = document.getElementById('surveys-tenant-select');
            items.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = `${t.name || ''} ${t.surname || ''}`.trim() || `#${t.id}`;
                sel.appendChild(opt);
            });
        } catch (e) { /* non-critical */ }
    }

    async function loadSurveys() {
        const params = new URLSearchParams({ page: currentPage, limit: PAGE_LIMIT });
        softLoad(els.tbody, '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:2rem;">Caricamento…</td></tr>');

        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const parsed = window.Pagination.parseResponse(json);
            renderStats((json.data && json.data.stats) || {});
            renderRows(parsed.items);
            window.Pagination.render(els.pagination, parsed, p => { currentPage = p; loadSurveys(); });
        } catch (err) {
            els.tbody.classList.remove('is-loading');
            els.tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--color-danger);padding:2rem;">${esc(err.message)}</td></tr>`;
        }
    }

    function starsHtml(rating) {
        const v = parseFloat(rating) || 0;
        const full = Math.floor(v);
        return Array.from({ length: 5 }, (_, i) =>
            `<span style="color:${i < full ? '#f5a623' : '#ccc'}">${i < full ? '★' : '☆'}</span>`
        ).join('') + (v ? ` <small style="color:#888;">(${parseFloat(v).toFixed(1)})</small>` : '');
    }

    function renderStats(stats) {
        document.getElementById('stat-avg-global').innerHTML       = starsHtml(stats.avg_global);
        document.getElementById('stat-avg-maintenance').innerHTML  = starsHtml(stats.avg_maintenance);
        document.getElementById('stat-avg-communication').innerHTML = starsHtml(stats.avg_communication);
        document.getElementById('stat-total-surveys').textContent  = stats.total ?? '—';
    }

    function renderRows(items) {
        els.tbody.classList.remove('is-loading');
        if (!items.length) {
            els.tbody.innerHTML = '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:2rem;">Nessun sondaggio compilato.</td></tr>';
            return;
        }

        els.tbody.innerHTML = items.map(s => {
            const tenantName  = `${s.tenant_name || ''} ${s.tenant_surname || ''}`.trim() || `#${s.tenant_id}`;
            const propLabel   = s.property_address || s.property_title || `#${s.property_id}`;
            const comment     = s.comment ? (s.comment.length > 80 ? s.comment.substring(0, 80) + '…' : s.comment) : '—';

            return `<tr>
                <td>${esc(tenantName)}</td>
                <td>${esc(propLabel)}</td>
                <td>${starsHtml(s.rating_global)}</td>
                <td>${starsHtml(s.rating_maintenance)}</td>
                <td>${starsHtml(s.rating_communication)}</td>
                <td title="${esc(s.comment || '')}">${esc(comment)}</td>
                <td>${formatDate(s.submitted_at || s.created_at)}</td>
            </tr>`;
        }).join('');
    }

    function openLinkModal() {
        document.getElementById('surveys-tenant-select').value = '';
        document.getElementById('surveys-generated-link').style.display = 'none';
        document.getElementById('surveys-link-url').value = '';
        els.linkModal.hidden = false;
    }

    function closeLinkModal() { els.linkModal.hidden = true; }

    async function generateLink() {
        const tenantId = document.getElementById('surveys-tenant-select').value;
        if (!tenantId) { showAlert('Seleziona un inquilino.', 'error'); return; }

        const btn = document.getElementById('surveys-link-generate');
        btn.disabled = true; btn.textContent = 'Generazione…';

        try {
            const res  = await fetch(API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'generate_link', tenant_id: tenantId }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const token = json.data?.token || json.token;
            const base  = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/');
            const link  = `${base}tenant/survey.php?token=${encodeURIComponent(token)}`;

            document.getElementById('surveys-link-url').value = link;
            document.getElementById('surveys-generated-link').style.display = 'block';
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Genera link';
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
