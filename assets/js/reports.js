/**
 * Reports & Statistics (Phase 10)
 */
(function () {
    'use strict';

    const API = 'api/reports.php';

    const MONTH_NAMES = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

    const STATUS_LABELS = {
        available: 'Disponibili', rented: 'Affittati', sold: 'Venduti', archived: 'Archiviati',
    };
    const TYPE_LABELS = {
        appartamento: 'Appartamento', villa: 'Villa', ufficio: 'Ufficio',
        negozio: 'Negozio', box: 'Box', terreno: 'Terreno', altro: 'Altro',
    };
    const CATEGORY_LABELS = {
        manutenzione: 'Manutenzione', utenze: 'Utenze', tasse: 'Tasse',
        assicurazione: 'Assicurazione', agenzia: 'Agenzia', altro: 'Altro',
    };

    const cache = { properties: null, payments: null, expenses: null };
    const els = {};

    function init() {
        els.alert = document.getElementById('reports-alert');
        els.year  = document.getElementById('report-year');
        els.year.value = new Date().getFullYear();

        els.year.addEventListener('input', () => {
            clearTimeout(els._t);
            els._t = setTimeout(loadAll, 400);
        });

        document.querySelectorAll('.btn-export').forEach(btn => {
            btn.addEventListener('click', () => exportCsv(btn.dataset.type));
        });

        loadAll();
    }

    function loadAll() {
        cache.properties = null;
        cache.payments = null;
        cache.expenses = null;
        setKpiLoading();

        loadReport('properties', renderProperties);
        loadReport('payments', renderPayments);
        loadReport('expenses', renderExpenses);
    }

    async function loadReport(type, renderer) {
        const body = document.getElementById(`report-${type}-body`);
        body.innerHTML = '<div class="report-loading"><div class="spinner"></div></div>';

        try {
            const res  = await fetch(`${API}?type=${type}&year=${els.year.value}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            cache[type] = json.data;
            renderer(json.data, body);
            updateKpis();
        } catch (err) {
            body.innerHTML = `<p class="entity-error">${escapeHtml(err.message)}</p>`;
        }
    }

    function setKpiLoading() {
        ['kpi-properties', 'kpi-expected', 'kpi-collected', 'kpi-expenses'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '—';
        });
    }

    function updateKpis() {
        if (cache.properties) {
            const total = cache.properties.by_status.reduce((s, r) => s + Number(r.total), 0);
            document.getElementById('kpi-properties').textContent = total;
        }

        if (cache.payments) {
            const expected  = cache.payments.months.reduce((s, m) => s + Number(m.expected), 0);
            const collected = cache.payments.months.reduce((s, m) => s + Number(m.collected), 0);
            document.getElementById('kpi-expected').textContent  = '€ ' + formatPrice(expected);
            document.getElementById('kpi-collected').textContent = '€ ' + formatPrice(collected);
        }

        if (cache.expenses) {
            const total = cache.expenses.by_category.reduce((s, r) => s + Number(r.total), 0);
            document.getElementById('kpi-expenses').textContent = '€ ' + formatPrice(total);
        }
    }

    function exportCsv(type) {
        window.open(`${API}?type=${type}&year=${els.year.value}&format=csv`, '_blank');
    }

    function renderProperties(data, body) {
        const total = data.by_status.reduce((s, r) => s + Number(r.total), 0) || 1;

        let html = '<div class="report-section"><h4 class="report-subtitle">Per stato</h4>';
        html += data.by_status.map(r =>
            bar(STATUS_LABELS[r.status] || r.status, Number(r.total), total, Number(r.total), 'status-' + r.status)
        ).join('') || '<p class="text-muted report-empty">Nessun dato.</p>';
        html += '</div>';

        const totalType = data.by_type.reduce((s, r) => s + Number(r.total), 0) || 1;
        html += '<div class="report-section"><h4 class="report-subtitle">Per tipologia</h4>';
        html += data.by_type.map(r =>
            bar(TYPE_LABELS[r.property_type] || r.property_type, Number(r.total), totalType, Number(r.total))
        ).join('') || '<p class="text-muted report-empty">Nessun dato.</p>';
        html += '</div>';

        html += '<div class="report-section"><h4 class="report-subtitle">Prezzo medio</h4>';
        if (data.avg_price.length) {
            html += '<ul class="report-list">' + data.avg_price.map(r =>
                `<li><span>${r.price_type === 'affitto' ? 'Affitto' : 'Vendita'}</span><strong>€ ${formatPrice(r.avg_price)}</strong></li>`
            ).join('') + '</ul>';
        } else {
            html += '<p class="text-muted report-empty">Nessun prezzo registrato.</p>';
        }
        html += '</div>';

        body.innerHTML = html;
    }

    function renderPayments(data, body) {
        const max = Math.max(1, ...data.months.map(m => Math.max(m.expected, m.collected)));
        const totalExpected  = data.months.reduce((s, m) => s + Number(m.expected), 0);
        const totalCollected = data.months.reduce((s, m) => s + Number(m.collected), 0);
        const rate = totalExpected > 0 ? Math.round(100 * totalCollected / totalExpected) : 0;

        let html = `<div class="report-payments-summary">
            <span>Tasso di incasso <strong>${rate}%</strong></span>
            <span class="text-muted">Atteso € ${formatPrice(totalExpected)} · Incassato € ${formatPrice(totalCollected)}</span>
        </div>`;

        html += '<div class="report-chart">';
        data.months.forEach((m, i) => {
            const expH = (m.expected / max * 100).toFixed(1);
            const colH = (m.collected / max * 100).toFixed(1);
            html += `
                <div class="report-chart__col" title="${MONTH_NAMES[i]}: atteso € ${formatPrice(m.expected)}, incassato € ${formatPrice(m.collected)}">
                    <div class="report-chart__bars">
                        <div class="report-chart__bar report-chart__bar--expected" style="height:${expH}%"></div>
                        <div class="report-chart__bar report-chart__bar--collected" style="height:${colH}%"></div>
                    </div>
                    <div class="report-chart__label">${MONTH_NAMES[i]}</div>
                </div>`;
        });
        html += '</div>';

        html += `<div class="report-legend">
            <span><i class="report-swatch report-swatch--expected"></i> Atteso</span>
            <span><i class="report-swatch report-swatch--collected"></i> Incassato</span>
        </div>`;

        body.innerHTML = html;
    }

    function renderExpenses(data, body) {
        if (!data.by_category.length) {
            body.innerHTML = '<p class="text-muted report-empty">Nessuna spesa registrata per l\'anno selezionato.</p>';
            return;
        }
        const total = data.by_category.reduce((s, r) => s + Number(r.total), 0) || 1;
        body.innerHTML = '<div class="report-section">' + data.by_category.map(r =>
            bar(CATEGORY_LABELS[r.category] || r.category, Number(r.total), total, '€ ' + formatPrice(r.total), 'cat-' + r.category)
        ).join('') + '</div>';
    }

    function bar(label, value, max, displayValue, modifier = '') {
        const pct = Math.max(4, (value / max * 100));
        return `
            <div class="report-row">
                <div class="report-row__label">${escapeHtml(label)}</div>
                <div class="report-bar">
                    <div class="report-bar__fill ${modifier ? 'report-bar__fill--' + modifier : ''}" style="width:${pct.toFixed(1)}%"></div>
                </div>
                <div class="report-row__value">${escapeHtml(String(displayValue))}</div>
            </div>`;
    }

    function formatPrice(value) {
        const n = Number(value);
        if (!isFinite(n)) return '0';
        return n.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }

    function escapeHtml(str) {
        if (str == null) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    init();
})();
