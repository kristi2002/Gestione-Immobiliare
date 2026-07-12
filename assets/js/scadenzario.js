(function () {
    'use strict';

    const API = 'api/scadenzario.php';

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
    function fmtDate(str) { return str ? new Date(str).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'; }

    const TYPE_LABEL = {
        contract_expiry: 'Scadenza contratto',
        registration:    'Imposta di registro',
        ape:             'Scadenza APE',
        insurance:       'Assicurazione',
        aml:             'Antiriciclaggio',
    };
    const TYPE_ICON = {
        contract_expiry: 'scroll-text',
        registration:    'landmark',
        ape:             'zap',
        insurance:       'shield-check',
        aml:             'shield-alert',
    };
    const SEV_BADGE = { overdue: 'badge--danger', soon: 'badge--warning', upcoming: 'badge' };

    const els = {};

    function init() {
        els.alert    = document.getElementById('scad-alert');
        els.tbody    = document.getElementById('scad-tbody');
        els.horizon  = document.getElementById('scad-horizon');
        els.typeF    = document.getElementById('scad-type');

        els.horizon.addEventListener('change', load);
        els.typeF.addEventListener('change', load);
        load();
    }

    async function load() {
        const params = new URLSearchParams();
        params.set('horizon', els.horizon.value);
        if (els.typeF.value) params.set('type', els.typeF.value);

        softLoad(els.tbody, '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:2rem;">Caricamento…</td></tr>');
        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            renderStats(json.data.stats || {});
            renderRows(json.data.items || []);
        } catch (err) {
            els.tbody.classList.remove('is-loading');
            els.tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--color-danger);padding:2rem;">${esc(err.message)}</td></tr>`;
        }
    }

    function renderStats(s) {
        document.getElementById('stat-scad-overdue').textContent  = s.overdue ?? '—';
        document.getElementById('stat-scad-soon').textContent     = s.soon ?? '—';
        document.getElementById('stat-scad-upcoming').textContent = s.upcoming ?? '—';
        document.getElementById('stat-scad-total').textContent    = s.total ?? '—';
    }

    function renderRows(items) {
        els.tbody.classList.remove('is-loading');
        if (!items.length) {
            els.tbody.innerHTML = '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:2rem;">Nessuna scadenza nel periodo selezionato.</td></tr>';
            return;
        }
        els.tbody.innerHTML = items.map(it => {
            const days = it.days_until;
            const daysLabel = days == null ? '—'
                : days < 0 ? `${Math.abs(days)} gg fa`
                : days === 0 ? 'oggi'
                : `tra ${days} gg`;
            const rowStyle = it.severity === 'overdue' ? 'style="background:rgba(220,38,38,.05)"' : '';
            return `<tr ${rowStyle}>
                <td data-label="Tipo"><i data-lucide="${TYPE_ICON[it.type] || 'calendar'}" style="width:16px;height:16px;vertical-align:-3px"></i> ${esc(TYPE_LABEL[it.type] || it.label)}</td>
                <td data-label="Soggetto">${esc(it.subject)}</td>
                <td data-label="Immobile">${esc(it.context || '—')}</td>
                <td data-label="Scadenza">${fmtDate(it.date)}</td>
                <td data-label="Giorni"><span class="badge ${SEV_BADGE[it.severity] || 'badge'}">${esc(daysLabel)}</span></td>
                <td data-label="" class="col-actions"><button class="btn btn--sm btn--ghost btn-scad-go" data-view="${esc(it.view)}" data-id="${it.entity_id}" title="Apri">Apri</button></td>
            </tr>`;
        }).join('');

        els.tbody.querySelectorAll('.btn-scad-go').forEach(b => {
            b.addEventListener('click', () => {
                const view = b.dataset.view;
                if (window.App) window.App.navigateTo(view);
            });
        });
    }

    init();
})();
