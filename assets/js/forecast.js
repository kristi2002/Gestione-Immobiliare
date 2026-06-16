(function () {
    'use strict';

    const API = 'api/forecast.php';

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

    function fmt(n) {
        return n != null
            ? new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n)
            : '—';
    }

    let selectedMonths = 6;
    let chartRevenue   = null;
    let chartOccupancy = null;
    const els          = {};

    function init() {
        els.alert          = document.getElementById('forecast-alert');
        els.topTbody       = document.getElementById('forecast-top-tbody');
        els.overdueTbody   = document.getElementById('forecast-overdue-tbody');

        bindEvents();
        loadForecast();
    }

    function bindEvents() {
        document.querySelectorAll('.forecast-period').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.forecast-period').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedMonths = parseInt(btn.dataset.months);
                loadForecast();
            });
        });
    }

    async function loadForecast() {
        try {
            const res  = await fetch(`${API}?months=${selectedMonths}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const data = json.data || {};
            renderStats(data.stats || {});
            renderCharts(data.monthly || []);
            renderTopProperties(data.top_properties || []);
            renderOverdue(data.overdue || []);
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    function renderStats(stats) {
        document.getElementById('stat-expected-6m').textContent   = fmt(stats.expected_next_6m);
        document.getElementById('stat-avg-occupancy').textContent  = stats.avg_occupancy_rate != null
            ? `${parseFloat(stats.avg_occupancy_rate).toFixed(1)}%` : '—';
        document.getElementById('stat-overdue-total').textContent  = fmt(stats.overdue_total);
        document.getElementById('stat-top-property').textContent   = stats.top_property_address || '—';
    }

    function renderCharts(monthly) {
        const labels    = monthly.map(m => m.label || m.month || '');
        const expected  = monthly.map(m => parseFloat(m.expected || 0));
        const confirmed = monthly.map(m => parseFloat(m.confirmed || 0));
        const occupancy = monthly.map(m => parseFloat(m.occupancy_rate || 0));

        // Destroy previous chart instances before re-creating
        if (chartRevenue) { chartRevenue.destroy(); chartRevenue = null; }
        if (chartOccupancy) { chartOccupancy.destroy(); chartOccupancy = null; }

        const revenueCtx = document.getElementById('chart-revenue');
        if (revenueCtx) {
            chartRevenue = new Chart(revenueCtx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Atteso',
                            data: expected,
                            borderColor: '#3b82f6',
                            backgroundColor: 'rgba(59,130,246,0.1)',
                            fill: true,
                            tension: 0.3,
                            pointRadius: 4,
                        },
                        {
                            label: 'Confermato',
                            data: confirmed,
                            borderColor: '#22c55e',
                            backgroundColor: 'rgba(34,197,94,0.1)',
                            fill: true,
                            tension: 0.3,
                            pointRadius: 4,
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'top' },
                        tooltip: {
                            callbacks: {
                                label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`,
                            },
                        },
                    },
                    scales: {
                        y: {
                            ticks: {
                                callback: v => fmt(v),
                            },
                        },
                    },
                },
            });
        }

        const occupancyCtx = document.getElementById('chart-occupancy');
        if (occupancyCtx) {
            chartOccupancy = new Chart(occupancyCtx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Occupazione %',
                        data: occupancy,
                        backgroundColor: occupancy.map(v =>
                            v >= 80 ? 'rgba(34,197,94,0.7)' :
                            v >= 50 ? 'rgba(234,179,8,0.7)' :
                            'rgba(239,68,68,0.7)'
                        ),
                        borderRadius: 4,
                    }],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: ctx => ` ${ctx.parsed.y.toFixed(1)}%`,
                            },
                        },
                    },
                    scales: {
                        y: {
                            min: 0,
                            max: 100,
                            ticks: { callback: v => `${v}%` },
                        },
                    },
                },
            });
        }
    }

    function renderTopProperties(items) {
        if (!items.length) {
            els.topTbody.innerHTML = '<tr><td colspan="2" class="text-muted" style="text-align:center;padding:1.5rem;">Nessun dato disponibile.</td></tr>';
            return;
        }
        els.topTbody.innerHTML = items.slice(0, 5).map((p, i) => `<tr>
            <td><span style="color:#888;margin-right:0.5rem;">${i + 1}.</span>${esc(p.address || p.title || `#${p.property_id}`)}</td>
            <td><strong>${fmt(p.income_12m)}</strong></td>
        </tr>`).join('');
    }

    function renderOverdue(items) {
        if (!items.length) {
            els.overdueTbody.innerHTML = '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:1.5rem;">Nessun insoluto.</td></tr>';
            return;
        }
        els.overdueTbody.innerHTML = items.map(o => {
            const days = o.days_overdue != null ? parseInt(o.days_overdue) : '—';
            const daysColor = typeof days === 'number' && days > 60
                ? 'var(--color-danger,#c0392b)'
                : typeof days === 'number' && days > 30
                    ? 'var(--color-warning,#e67e22)'
                    : 'inherit';

            return `<tr>
                <td>${esc(o.tenant_name || `#${o.tenant_id}`)}</td>
                <td>${esc(o.property_address || `#${o.property_id}`)}</td>
                <td><strong style="color:var(--color-danger,#c0392b);">${fmt(o.amount)}</strong></td>
                <td><span style="color:${daysColor};font-weight:600;">${esc(String(days))}</span></td>
            </tr>`;
        }).join('');
    }

    function showAlert(msg, type) {
        els.alert.textContent   = msg;
        els.alert.className     = `alert alert--${type}`;
        els.alert.style.display = 'block';
        clearTimeout(els.alert._t);
        els.alert._t = setTimeout(() => { els.alert.style.display = 'none'; }, 6000);
    }

    init();
})();
