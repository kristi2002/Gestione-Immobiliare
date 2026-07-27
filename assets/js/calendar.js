/**
 * Calendario Visuale — monthly calendar merging promemoria + visite (Phase 10,
 * extended to include appointments so the calendar reflects what the agency
 * actually has scheduled, not just reminders).
 */
(function () {
    'use strict';

    const REM_API  = 'api/reminders.php';
    const APPT_API = 'api/appointments.php';

    const MONTH_NAMES = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
        'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

    const REM_STATUS_LABELS = { pending: 'In sospeso', completed: 'Completato', cancelled: 'Annullato' };
    const APPT_STATUS_LABELS = { scheduled: 'Programmato', completed: 'Completato', cancelled: 'Annullato', no_show: 'Mancata presentazione' };
    const APPT_TYPE_LABELS   = { visita: 'Visita', acquisizione: 'Acquisizione', atto: 'Atto', chiamata: 'Chiamata' };

    let viewYear, viewMonth;     // month currently displayed (0-based month)
    let events = [];             // merged reminders + appointments for the displayed range
    let typeFilter = 'all';      // 'all' | 'reminder' | 'appointment'

    const els = {};

    function init() {
        els.grid      = document.getElementById('cal-grid');
        els.title     = document.getElementById('cal-title');
        els.alert     = document.getElementById('calendar-alert');
        els.sideTitle = document.getElementById('cal-side-title');
        els.sideBody  = document.getElementById('cal-side-events');

        const now = new Date();
        viewYear  = now.getFullYear();
        viewMonth = now.getMonth();

        document.getElementById('cal-prev').addEventListener('click', () => changeMonth(-1));
        document.getElementById('cal-next').addEventListener('click', () => changeMonth(1));
        document.getElementById('cal-today').addEventListener('click', () => {
            const d = new Date();
            viewYear = d.getFullYear();
            viewMonth = d.getMonth();
            loadMonth();
        });

        document.querySelectorAll('.cal-type-toggle button').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.cal-type-toggle button').forEach(b => b.classList.remove('is-active'));
                btn.classList.add('is-active');
                typeFilter = btn.dataset.type;
                renderGrid();
            });
        });

        loadMonth();
    }

    function changeMonth(delta) {
        viewMonth += delta;
        if (viewMonth < 0) { viewMonth = 11; viewYear--; }
        else if (viewMonth > 11) { viewMonth = 0; viewYear++; }
        loadMonth();
    }

    async function loadMonth() {
        els.title.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
        resetSide();

        const from = `${viewYear}-${pad(viewMonth + 1)}-01`;
        const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate();
        const to = `${viewYear}-${pad(viewMonth + 1)}-${pad(lastDay)}`;

        try {
            const [remJson, apptJson] = await Promise.all([
                fetch(`${REM_API}?from=${from}&to=${to}&page=1&limit=500`).then(r => r.json()),
                fetch(`${APPT_API}?from=${from}&to=${to}&page=1&limit=500`).then(r => r.json()),
            ]);
            if (!remJson.success) throw new Error(remJson.error);
            if (!apptJson.success) throw new Error(apptJson.error);

            const reminders = itemsOf(remJson).map(r => ({
                type: 'reminder', id: r.id, date: r.reminder_date, status: r.status,
                title: r.title, subtitle: r.description || '', raw: r,
            }));
            const appointments = itemsOf(apptJson).map(a => {
                const who = [a.lead_name, a.lead_surname].filter(Boolean).join(' ')
                    || [a.client_name, a.client_surname].filter(Boolean).join(' ');
                const where = [a.property_address, a.property_city].filter(Boolean).join(', ');
                const kind = APPT_TYPE_LABELS[a.appointment_type] || 'Appuntamento';
                return {
                    type: 'appointment', id: a.id, date: a.appointment_date, status: a.status,
                    title: where || kind, subtitle: [kind, who].filter(Boolean).join(' · '), raw: a,
                };
            });
            events = [...reminders, ...appointments];
            renderGrid();
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    function itemsOf(json) {
        return typeof Pagination !== 'undefined'
            ? Pagination.parseResponse(json).items
            : (Array.isArray(json.data) ? json.data : (json.data?.items || []));
    }

    function visibleEvents() {
        return typeFilter === 'all' ? events : events.filter(e => e.type === typeFilter);
    }

    function renderGrid() {
        const firstDay = new Date(viewYear, viewMonth, 1);
        // Monday-first offset (JS getDay: 0=Sun..6=Sat).
        let offset = (firstDay.getDay() + 6) % 7;
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

        const byDay = {};
        visibleEvents().forEach(ev => {
            const key = ev.date.slice(0, 10);
            (byDay[key] = byDay[key] || []).push(ev);
        });
        Object.values(byDay).forEach(list => list.sort((a, b) => a.date.localeCompare(b.date)));

        const today = new Date();
        const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
        let html = '';

        for (let i = 0; i < offset; i++) {
            html += '<div class="cal-day cal-day--empty"></div>';
        }

        for (let d = 1; d <= daysInMonth; d++) {
            const key = `${viewYear}-${pad(viewMonth + 1)}-${pad(d)}`;
            const dow = new Date(viewYear, viewMonth, d).getDay(); // 0=Sun, 6=Sat
            const isWeekend = dow === 0 || dow === 6;
            const dayEvents = byDay[key] || [];
            const isToday = key === todayKey;

            const chips = dayEvents.slice(0, 3).map(ev => `
                <span class="cal-event cal-event--${ev.type} cal-event--${ev.type}-${ev.status}" title="${escapeHtml(ev.title)}">
                    <i class="cal-event__dot"></i>${escapeHtml(truncate(ev.title, 15))}
                </span>`).join('');
            const more = dayEvents.length > 3 ? `<span class="cal-event cal-event--more">+${dayEvents.length - 3} altri</span>` : '';

            html += `
                <div class="cal-day${isToday ? ' cal-day--today' : ''}${isWeekend ? ' cal-day--weekend' : ''}${dayEvents.length ? ' cal-day--has-events' : ''}" data-key="${key}">
                    <span class="cal-day__num">${d}</span>
                    <div class="cal-day__events">${chips}${more}</div>
                </div>`;
        }

        els.grid.innerHTML = html;

        els.grid.querySelectorAll('.cal-day[data-key]').forEach(cell => {
            cell.addEventListener('click', () => selectDay(cell.dataset.key, byDay[cell.dataset.key] || []));
        });

        // Show today's agenda by default when viewing the current month, else
        // keep whatever day was selected (re-render on type-filter change).
        const keepKey = els.sideBody.dataset.key;
        if (keepKey && (byDay[keepKey] || keepKey in byDay)) {
            selectDay(keepKey, byDay[keepKey] || []);
        } else if (today.getFullYear() === viewYear && today.getMonth() === viewMonth) {
            selectDay(todayKey, byDay[todayKey] || []);
        }
    }

    function selectDay(key, dayEvents) {
        els.sideBody.dataset.key = key;
        els.grid.querySelectorAll('.cal-day').forEach(c => c.classList.remove('cal-day--selected'));
        const cell = els.grid.querySelector(`.cal-day[data-key="${key}"]`);
        if (cell) cell.classList.add('cal-day--selected');

        const d = new Date(key + 'T00:00:00');
        els.sideTitle.textContent = d.toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

        if (!dayEvents.length) {
            els.sideBody.innerHTML = '<p class="text-muted">Nessun evento in questa data.</p>';
            return;
        }

        els.sideBody.innerHTML = dayEvents.map(ev => {
            const icon  = ev.type === 'appointment' ? 'calendar-check' : 'bell';
            const label = ev.type === 'appointment' ? (APPT_STATUS_LABELS[ev.status] || ev.status) : (REM_STATUS_LABELS[ev.status] || ev.status);
            return `
            <div class="cal-side-item cal-side-item--${ev.type}-${ev.status}" data-type="${ev.type}" data-id="${ev.id}">
                <div class="cal-side-item__head">
                    <i data-lucide="${icon}" class="cal-side-item__icon"></i>
                    <div class="cal-side-item__time">${formatTime(ev.date)}</div>
                    <span class="badge cal-side-item__badge">${escapeHtml(label)}</span>
                </div>
                <div class="cal-side-item__title">${escapeHtml(ev.title)}</div>
                ${ev.subtitle ? `<div class="cal-side-item__desc text-muted">${escapeHtml(truncate(ev.subtitle, 90))}</div>` : ''}
            </div>`;
        }).join('');

        els.sideBody.querySelectorAll('.cal-side-item').forEach(item => {
            item.addEventListener('click', () => {
                if (!window.App) return;
                if (item.dataset.type === 'appointment') window.App.navigateTo('appointment_profile', { appointmentId: Number(item.dataset.id) });
                else window.App.navigateTo('reminders');
            });
        });

        if (window.lucide) window.lucide.createIcons();
    }

    function resetSide() {
        delete els.sideBody.dataset.key;
        els.sideTitle.textContent = 'Seleziona un giorno';
        els.sideBody.innerHTML = '<p class="text-muted">Clicca su un giorno del calendario per vedere gli eventi.</p>';
    }

    // -------------------------------------------------------------------------
    // Utilities
    // -------------------------------------------------------------------------

    function showAlert(message, type) {
        els.alert.textContent = message;
        els.alert.className   = `alert alert--${type}`;
        els.alert.style.display = 'block';
        clearTimeout(els.alert._t);
        els.alert._t = setTimeout(() => { els.alert.style.display = 'none'; }, 4000);
    }

    function formatTime(dateStr) {
        return new Date(dateStr.replace(' ', 'T')).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    }

    function pad(n) { return String(n).padStart(2, '0'); }

    function truncate(str, len) {
        return str.length > len ? str.slice(0, len) + '…' : str;
    }

    function escapeHtml(str) {
        if (str == null) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    init();
})();
