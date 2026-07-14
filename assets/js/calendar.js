/**
 * Calendario Visuale — monthly reminder calendar (Phase 10)
 */
(function () {
    'use strict';

    const API = 'api/reminders.php';

    const MONTH_NAMES = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
        'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

    const STATUS_LABELS = {
        pending:   'In sospeso',
        completed: 'Completato',
        cancelled: 'Annullato',
    };

    let viewYear, viewMonth;     // month currently displayed (0-based month)
    let events = [];             // reminders for the displayed range
    let selectedKey = null;

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
        selectedKey = null;
        resetSide();

        const from = `${viewYear}-${pad(viewMonth + 1)}-01`;
        const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate();
        const to = `${viewYear}-${pad(viewMonth + 1)}-${pad(lastDay)}`;

        try {
            const res  = await fetch(`${API}?from=${from}&to=${to}&page=1&limit=500`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            events = typeof Pagination !== 'undefined'
                ? Pagination.parseResponse(json).items
                : (Array.isArray(json.data) ? json.data : (json.data?.items || []));
            renderGrid();
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    function renderGrid() {
        const firstDay = new Date(viewYear, viewMonth, 1);
        // Monday-first offset (JS getDay: 0=Sun..6=Sat).
        let offset = (firstDay.getDay() + 6) % 7;
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

        const byDay = {};
        events.forEach(ev => {
            const key = ev.reminder_date.slice(0, 10);
            (byDay[key] = byDay[key] || []).push(ev);
        });

        const today = new Date();
        const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
        let html = '';

        for (let i = 0; i < offset; i++) {
            html += '<div class="cal-day cal-day--empty"></div>';
        }

        for (let d = 1; d <= daysInMonth; d++) {
            const key = `${viewYear}-${pad(viewMonth + 1)}-${pad(d)}`;
            const dayEvents = byDay[key] || [];
            const isToday = key === todayKey;

            const chips = dayEvents.slice(0, 3).map(ev =>
                `<span class="cal-event cal-event--${ev.status}" title="${escapeHtml(ev.title)}">${escapeHtml(truncate(ev.title, 16))}</span>`
            ).join('');
            const more = dayEvents.length > 3 ? `<span class="cal-event cal-event--more">+${dayEvents.length - 3}</span>` : '';

            html += `
                <div class="cal-day${isToday ? ' cal-day--today' : ''}${dayEvents.length ? ' cal-day--has-events' : ''}" data-key="${key}">
                    <span class="cal-day__num">${d}</span>
                    <div class="cal-day__events">${chips}${more}</div>
                </div>`;
        }

        els.grid.innerHTML = html;

        els.grid.querySelectorAll('.cal-day[data-key]').forEach(cell => {
            cell.addEventListener('click', () => selectDay(cell.dataset.key, byDay[cell.dataset.key] || []));
        });

        // Show today's agenda by default when viewing the current month.
        if (today.getFullYear() === viewYear && today.getMonth() === viewMonth) {
            selectDay(todayKey, byDay[todayKey] || []);
        }
    }

    function selectDay(key, dayEvents) {
        selectedKey = key;
        els.grid.querySelectorAll('.cal-day').forEach(c => c.classList.remove('cal-day--selected'));
        const cell = els.grid.querySelector(`.cal-day[data-key="${key}"]`);
        if (cell) cell.classList.add('cal-day--selected');

        const d = new Date(key + 'T00:00:00');
        els.sideTitle.textContent = d.toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

        if (!dayEvents.length) {
            els.sideBody.innerHTML = '<p class="text-muted">Nessun promemoria in questa data.</p>';
            return;
        }

        els.sideBody.innerHTML = dayEvents.map(ev => `
            <div class="cal-side-item cal-side-item--${ev.status}">
                <div class="cal-side-item__time">${formatTime(ev.reminder_date)}</div>
                <div class="cal-side-item__title">${escapeHtml(ev.title)}</div>
                ${ev.description ? `<div class="cal-side-item__desc text-muted">${escapeHtml(truncate(ev.description, 80))}</div>` : ''}
                <span class="badge badge--reminder-${ev.status}">${STATUS_LABELS[ev.status] || ev.status}</span>
            </div>
        `).join('') + '<button type="button" class="btn btn--ghost btn--sm" id="cal-goto-reminders" style="margin-top:12px">Apri Promemoria →</button>';

        const goto = document.getElementById('cal-goto-reminders');
        if (goto) goto.addEventListener('click', () => {
            if (window.App) window.App.navigateTo('reminders');
        });
    }

    function resetSide() {
        els.sideTitle.textContent = 'Seleziona un giorno';
        els.sideBody.innerHTML = '<p class="text-muted">Clicca su un giorno del calendario per vedere i promemoria.</p>';
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
        return new Date(dateStr).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
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
