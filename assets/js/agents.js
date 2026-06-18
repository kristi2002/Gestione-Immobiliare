/**
 * Portafoglio agenti — team performance dashboard
 */
(function () {
    'use strict';

    const API = 'api/agent_portfolio.php';

    const ROLE_LABELS = {
        super_admin: 'Super admin',
        admin: 'Amministratore',
        agent: 'Agente',
    };

    const STAT_ITEMS = [
        { key: 'leads_total',     label: 'Lead totali', icon: '📋' },
        { key: 'leads_converted', label: 'Convertiti',  icon: '✅' },
        { key: 'appointments',    label: 'Visite',      icon: '📅' },
        { key: 'properties',      label: 'Immobili',    icon: '🏢' },
        { key: 'keys_out',        label: 'Chiavi fuori', icon: '🔑' },
        { key: 'leads_new',       label: 'Nuovi lead',  icon: '🆕' },
    ];

    const els = {};

    function init() {
        els.grid = document.getElementById('agents-grid');
        loadAgents();
    }

    async function loadAgents() {
        softLoad(els.grid, '<div class="entity-loading">Caricamento…</div>');
        try {
            const res = await fetch(API);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            renderCards(json.data);
        } catch (err) {
            els.grid.classList.remove('is-loading');
            els.grid.innerHTML = `<div class="entity-error">${escapeHtml(err.message)}</div>`;
        }
    }

    function renderCards(agents) {
        els.grid.classList.remove('is-loading');
        if (!agents.length) {
            els.grid.innerHTML = '<div class="entity-empty">Nessun agente trovato.</div>';
            return;
        }

        els.grid.innerHTML = agents.map(renderCard).join('');
    }

    function renderCard(a) {
        const role = a.role || 'agent';
        const initials = (a.username || '?').slice(0, 2).toUpperCase();
        const rate = Number(a.conversion_rate) || 0;
        const rateWidth = Math.max(rate > 0 ? 6 : 0, Math.min(100, rate));

        const stats = STAT_ITEMS.map(item => `
            <div class="agent-stat">
                <span class="agent-stat__icon" aria-hidden="true">${item.icon}</span>
                <span class="agent-stat__value">${a[item.key] ?? 0}</span>
                <span class="agent-stat__label">${item.label}</span>
            </div>`).join('');

        return `
            <div class="entity-card agent-card agent-card--${escapeHtml(role)}">
                <div class="agent-card__header">
                    <div class="entity-card__avatar">${escapeHtml(initials)}</div>
                    <div class="agent-card__identity">
                        <div class="entity-card__name">${escapeHtml(a.username)}</div>
                        <span class="badge badge--role-${escapeHtml(role)}">${ROLE_LABELS[role] || role}</span>
                        ${a.email ? `<a class="agent-card__email" href="mailto:${escapeHtml(a.email)}">${escapeHtml(a.email)}</a>` : ''}
                    </div>
                    <div class="agent-card__rate" title="Tasso di conversione lead">
                        <span class="agent-card__rate-value">${rate}%</span>
                        <span class="agent-card__rate-label">Conversione</span>
                    </div>
                </div>
                <div class="agent-card__progress" role="presentation">
                    <div class="agent-card__progress-fill" style="width:${rateWidth}%"></div>
                </div>
                <div class="agent-card__stats">${stats}</div>
            </div>`;
    }

    function escapeHtml(s) {
        if (s == null) return '';
        const d = document.createElement('div');
        d.textContent = String(s);
        return d.innerHTML;
    }

    init();
})();
