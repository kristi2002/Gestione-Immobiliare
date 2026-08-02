/**
 * Calendario Visuale — monthly board merging promemoria + appuntamenti, plus a
 * day agenda panel.
 *
 * The board always draws a full 6-week matrix and loads the events for that
 * WHOLE matrix, not just for the 1st–31st: the leading and trailing cells are
 * working days like any other, and an agent looking at early August needs to
 * see what is on July 31 in the same row. Months therefore also keep a constant
 * height instead of jumping between 5 and 6 rows.
 */
(function () {
    'use strict';

    const REM_API  = 'api/reminders.php';
    const APPT_API = 'api/appointments.php';

    const MONTH_NAMES = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
        'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

    const REM_STATUS_LABELS  = { pending: 'In sospeso', completed: 'Completato', cancelled: 'Annullato' };
    const APPT_STATUS_LABELS = { scheduled: 'Programmato', completed: 'Completato', cancelled: 'Annullato', no_show: 'Mancata presentazione' };
    const APPT_TYPE_LABELS   = { visita: 'Visita', acquisizione: 'Acquisizione', atto: 'Atto', chiamata: 'Chiamata' };
    const APPT_TYPE_ICONS    = { visita: 'home', acquisizione: 'key', atto: 'file-text', chiamata: 'phone' };
    const APPT_PLACE_LABELS  = { agenzia: 'In agenzia', virtuale: 'Videochiamata' };

    /** The status each type sits in while it is still outstanding. */
    const OPEN_STATUS = { reminder: 'pending', appointment: 'scheduled' };

    // apiGetPagination() hard-caps `limit` at 100 regardless of what we ask for,
    // so a month is assembled by paging rather than by one oversized request —
    // the old `limit=500` was clamped to 100 and silently hid the rest.
    const PAGE_LIMIT = 100;
    const MAX_PAGES  = 10;

    const GRID_CELLS   = 42;   // 6 weeks — a fixed board height for every month
    const MAX_CHIPS    = 3;    // events drawn in a cell before it collapses to "+N"

    let viewYear, viewMonth;   // month currently displayed (0-based month)
    let events = [];           // merged reminders + appointments for the visible matrix
    let typeFilter = 'all';    // 'all' | 'reminder' | 'appointment'

    const els = {};

    function init() {
        els.grid      = document.getElementById('cal-grid');
        els.title     = document.getElementById('cal-title');
        els.count     = document.getElementById('cal-count');
        els.alert     = document.getElementById('calendar-alert');
        els.sideDate  = document.getElementById('cal-side-date');
        els.sideCount = document.getElementById('cal-side-count');
        els.sideAdd   = document.getElementById('cal-side-add');
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
            delete els.sideBody.dataset.key;   // jump back to today's agenda too
            loadMonth();
        });

        document.querySelectorAll('#cal-seg button').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#cal-seg button').forEach(b => b.classList.remove('is-active'));
                btn.classList.add('is-active');
                typeFilter = btn.dataset.type;
                renderGrid();
            });
        });

        const newBtn = document.getElementById('btn-new-appointment');
        if (newBtn) newBtn.addEventListener('click', () => newAppointment());
        els.sideAdd.addEventListener('click', () => newAppointment(els.sideBody.dataset.key));

        loadMonth();
    }

    function changeMonth(delta) {
        viewMonth += delta;
        if (viewMonth < 0) { viewMonth = 11; viewYear--; }
        else if (viewMonth > 11) { viewMonth = 0; viewYear++; }
        loadMonth();
    }

    /** Open the appointment form, pre-dated to the day the agent was looking at. */
    function newAppointment(dateKey) {
        if (!window.App) return;
        window.App.navigateTo('appointment_edit', dateKey ? { date: dateKey } : {});
    }

    /** First cell of the board: the Monday on or before the 1st of the month. */
    function gridStart() {
        const first = new Date(viewYear, viewMonth, 1);
        const offset = (first.getDay() + 6) % 7;   // JS getDay: 0=Sun..6=Sat
        return new Date(viewYear, viewMonth, 1 - offset);
    }

    async function loadMonth(keepSelection = false) {
        els.title.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
        if (!keepSelection) resetSide();

        const start = gridStart();
        const end   = addDays(start, GRID_CELLS - 1);
        const range = `from=${ymd(start)}&to=${ymd(end)}`;

        try {
            const [rem, appt] = await Promise.all([
                fetchAllInRange(REM_API, range),
                fetchAllInRange(APPT_API, range),
            ]);

            const reminders = rem.items.map(r => ({
                type: 'reminder', id: r.id, date: r.reminder_date, status: r.status,
                time: hhmm(r.reminder_date),
                icon: 'bell',
                title: r.title, label: r.title,
                meta: '',
                subtitle: r.description || '', raw: r,
            }));
            const appointments = appt.items.map(a => {
                const who   = [a.lead_name, a.lead_surname].filter(Boolean).join(' ')
                    || [a.client_name, a.client_surname].filter(Boolean).join(' ');
                const kind  = APPT_TYPE_LABELS[a.appointment_type] || 'Appuntamento';
                const place = appointmentPlace(a);
                return {
                    type: 'appointment', id: a.id, date: a.appointment_date, status: a.status,
                    time: hhmm(a.appointment_date),
                    icon: APPT_TYPE_ICONS[a.appointment_type] || 'calendar-check',
                    title: place || kind,
                    // One predictable shape per type, so a month can be scanned
                    // without opening every event: a call says who to ring, a
                    // visit says where to be.
                    label: a.appointment_type === 'chiamata'
                        ? (who ? `Chiamare ${who}` : 'Chiamata')
                        : (place || (who ? `${kind} · ${who}` : kind)),
                    meta: [kind, who].filter(Boolean).join(' · '),
                    subtitle: a.notes || '', raw: a,
                };
            });
            events = [...reminders, ...appointments];
            renderGrid();

            const hidden = rem.hidden + appt.hidden;
            if (hidden > 0) {
                showAlert(`Mese molto pieno: ${hidden} eventi non mostrati.`, 'warning');
            }
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    /**
     * Pull every row in the date range, following pagination.
     * Returns the items plus how many were left behind at the MAX_PAGES ceiling,
     * so the view can say it is incomplete instead of looking merely empty.
     */
    async function fetchAllInRange(api, range) {
        const get = async (page) => {
            const json = await fetch(`${api}?${range}&page=${page}&limit=${PAGE_LIMIT}`).then(r => r.json());
            if (!json.success) throw new Error(json.error);
            return json;
        };

        const first = await get(1);
        const total = Number(first.data?.total ?? 0);
        const items = [...itemsOf(first)];   // copy: parseResponse hands back the response's own array

        const pagesNeeded = Math.min(Math.ceil(total / PAGE_LIMIT) || 1, MAX_PAGES);
        if (pagesNeeded > 1) {
            const rest = await Promise.all(
                Array.from({ length: pagesNeeded - 1 }, (_, i) => get(i + 2))
            );
            rest.forEach(json => items.push(...itemsOf(json)));
        }

        return { items, hidden: Math.max(0, total - items.length) };
    }

    /** Where the agent physically has to be, by location type. */
    function appointmentPlace(a) {
        if (a.location_type === 'immobile' || !a.location_type) {
            return [a.property_address, a.property_city].filter(Boolean).join(', ')
                || (a.location_detail || '');
        }
        return a.location_detail || APPT_PLACE_LABELS[a.location_type] || '';
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
        const start = gridStart();
        const todayKey = ymd(new Date());

        const byDay = {};
        visibleEvents().forEach(ev => {
            const key = ev.date.slice(0, 10);
            (byDay[key] = byDay[key] || []).push(ev);
        });
        Object.values(byDay).forEach(list => list.sort((a, b) => a.date.localeCompare(b.date)));

        let html = '';
        for (let i = 0; i < GRID_CELLS; i++) {
            const d   = addDays(start, i);
            const key = ymd(d);
            const dow = d.getDay();
            const isWeekend = dow === 0 || dow === 6;
            const isOutside = d.getMonth() !== viewMonth;
            const dayEvents = byDay[key] || [];

            // [HH:mm] + one standardised label per type. The time leads because
            // that is what an agent scans a month for; the label is clipped by
            // CSS ellipsis rather than a fixed character count, so wide screens
            // show more instead of always cutting at 15 chars.
            const chips = dayEvents.slice(0, MAX_CHIPS).map(ev => `
                <span class="cal-event cal-event--${ev.type} cal-event--${ev.type}-${ev.status}" title="${escapeHtml(`${ev.time} · ${ev.label}`)}">
                    <span class="cal-event__time">${escapeHtml(ev.time)}</span><span class="cal-event__label">${escapeHtml(ev.label)}</span>
                </span>`).join('');
            const more = dayEvents.length > MAX_CHIPS
                ? `<span class="cal-event cal-event--more">+${dayEvents.length - MAX_CHIPS} altri</span>` : '';

            const cls = ['cal-day'];
            if (isOutside) cls.push('cal-day--outside');
            if (isWeekend) cls.push('cal-day--weekend');
            if (key === todayKey) cls.push('cal-day--today');
            if (dayEvents.length) cls.push('cal-day--has-events');

            html += `
                <div class="${cls.join(' ')}" data-key="${key}">
                    <span class="cal-day__num">${d.getDate()}</span>
                    <div class="cal-day__events">${chips}${more}</div>
                </div>`;
        }

        els.grid.innerHTML = html;
        renderCount();

        els.grid.querySelectorAll('.cal-day[data-key]').forEach(cell => {
            cell.addEventListener('click', () => selectDay(cell.dataset.key, byDay[cell.dataset.key] || []));
        });

        // Show today's agenda by default when viewing the current month, else
        // keep whatever day was selected (re-render on type-filter change or
        // after a quick status update — including when that emptied the day).
        const keepKey = els.sideBody.dataset.key;
        const today = new Date();
        if (keepKey) {
            selectDay(keepKey, byDay[keepKey] || []);
        } else if (today.getFullYear() === viewYear && today.getMonth() === viewMonth) {
            selectDay(todayKey, byDay[todayKey] || []);
        }
    }

    /**
     * Month scope line. Counts the month itself, not the drawn matrix — the
     * spill-over cells belong to the neighbouring months and would inflate it.
     * Both types are always shown: this describes the month, not the filter.
     */
    function renderCount() {
        const inMonth = events.filter(ev => {
            const [y, m] = ev.date.slice(0, 10).split('-').map(Number);
            return y === viewYear && (m - 1) === viewMonth;
        });
        const appts = inMonth.filter(e => e.type === 'appointment').length;
        const rems  = inMonth.length - appts;

        els.count.innerHTML = `
            <span class="cal-count--appointment"><b>${appts}</b> ${appts === 1 ? 'appuntamento' : 'appuntamenti'}</span>
            <span class="cal-count--reminder"><b>${rems}</b> ${rems === 1 ? 'promemoria' : 'promemoria'}</span>`;
    }

    function selectDay(key, dayEvents) {
        els.sideBody.dataset.key = key;
        els.grid.querySelectorAll('.cal-day').forEach(c => c.classList.remove('cal-day--selected'));
        const cell = els.grid.querySelector(`.cal-day[data-key="${key}"]`);
        if (cell) cell.classList.add('cal-day--selected');

        const d = new Date(key + 'T00:00:00');
        els.sideDate.textContent =
            d.toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: 'long' });
        els.sideCount.textContent = dayEvents.length
            ? `${dayEvents.length} ${dayEvents.length === 1 ? 'impegno' : 'impegni'}`
            : 'Nessun impegno';
        els.sideAdd.hidden = window.canWrite === false;

        if (!dayEvents.length) {
            els.sideBody.innerHTML = `
                <div class="cal-side__empty">
                    <i data-lucide="calendar"></i>
                    <p>Nessun impegno in questa data.</p>
                </div>`;
            if (window.lucide) window.lucide.createIcons();
            return;
        }

        els.sideBody.innerHTML = dayEvents.map((ev, i) => {
            const labels = ev.type === 'appointment' ? APPT_STATUS_LABELS : REM_STATUS_LABELS;
            const isOpen = ev.status === OPEN_STATUS[ev.type];
            // The panel is where the day gets worked, so the one action an agent
            // performs constantly lives here instead of two navigations away.
            const canComplete = window.canWrite !== false && isOpen;
            // "Programmato"/"In sospeso" on every open row is noise — the row is
            // open precisely because it still has the button. Only the states
            // that change how the row should be read get a badge.
            const badge = isOpen ? '' :
                `<span class="badge ${statusBadgeClass(ev.status)} cal-side-item__badge">${escapeHtml(labels[ev.status] || ev.status)}</span>`;

            return `
            <div class="cal-side-item cal-side-item--${ev.type}${ev.status === 'cancelled' ? ' cal-side-item--cancelled' : ''}" data-type="${ev.type}" data-id="${ev.id}">
                <div class="cal-side-item__time">${escapeHtml(ev.time)}</div>
                <div class="cal-side-item__body">
                    <div class="cal-side-item__title">${escapeHtml(ev.title)}</div>
                    ${ev.meta ? `<div class="cal-side-item__meta"><i data-lucide="${ev.icon}"></i>${escapeHtml(ev.meta)}</div>` : ''}
                    ${ev.subtitle ? `<div class="cal-side-item__desc">${escapeHtml(truncate(ev.subtitle, 90))}</div>` : ''}
                    ${badge}
                    ${canComplete ? `
                    <button type="button" class="cal-side-item__done" data-idx="${i}">
                        <i data-lucide="check"></i> Segna come completata
                    </button>` : ''}
                </div>
            </div>`;
        }).join('');

        els.sideBody.querySelectorAll('.cal-side-item__done').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();   // do not also open the profile behind it
                completeEvent(dayEvents[Number(btn.dataset.idx)], btn);
            });
        });

        els.sideBody.querySelectorAll('.cal-side-item').forEach(item => {
            item.addEventListener('click', () => {
                if (!window.App) return;
                if (item.dataset.type === 'appointment') window.App.navigateTo('appointment_profile', { appointmentId: Number(item.dataset.id) });
                else window.App.navigateTo('reminders');
            });
        });

        if (window.lucide) window.lucide.createIcons();
    }

    function statusBadgeClass(status) {
        if (status === 'completed') return 'badge--success';
        if (status === 'no_show')   return 'badge--danger';
        return 'badge--neutral';
    }

    /**
     * Close an event from the day panel.
     * Reminders have a dedicated PATCH action; appointments only expose a PUT,
     * which is a full overwrite — every column has to be echoed back or the
     * API's defaults silently reset tipo/luogo/promemoria.
     */
    async function completeEvent(ev, btn) {
        if (!ev) return;
        btn.disabled = true;
        const original = btn.innerHTML;
        btn.textContent = 'Salvataggio…';

        try {
            let res;
            if (ev.type === 'reminder') {
                res = await fetch(`${REM_API}?id=${ev.id}&action=complete`, { method: 'PATCH' });
            } else {
                const a = ev.raw;
                res = await fetch(`${APPT_API}?id=${ev.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        property_id: a.property_id, lead_id: a.lead_id, client_id: a.client_id,
                        agent_id: a.agent_id, appointment_type: a.appointment_type,
                        appointment_date: a.appointment_date, duration_minutes: a.duration_minutes,
                        location_type: a.location_type, location_detail: a.location_detail,
                        notify_client: a.notify_client, status: 'completed', notes: a.notes,
                    }),
                });
            }
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert('Segnato come completato.', 'success');
            await loadMonth(true);
        } catch (err) {
            showAlert(err.message, 'error');
            btn.disabled = false;
            btn.innerHTML = original;
        }
    }

    function resetSide() {
        delete els.sideBody.dataset.key;
        els.sideDate.textContent = 'Seleziona un giorno';
        els.sideCount.textContent = '';
        els.sideAdd.hidden = true;
        els.sideBody.innerHTML = `
            <div class="cal-side__empty">
                <i data-lucide="mouse-pointer-click"></i>
                <p>Clicca su un giorno del calendario per vedere gli impegni.</p>
            </div>`;
        if (window.lucide) window.lucide.createIcons();
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

    /**
     * "2026-07-27 10:00:00" -> "10:00".
     * Sliced rather than parsed through Date: the DB stores local wall-clock
     * time, so re-parsing only risks a timezone shift on the displayed hour.
     */
    function hhmm(dateStr) {
        const t = String(dateStr || '').slice(11, 16);
        return /^\d{2}:\d{2}$/.test(t) ? t : '--:--';
    }

    /** Local calendar date -> "YYYY-MM-DD" (never via toISOString, which is UTC). */
    function ymd(d) {
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    /** Day arithmetic through the Date constructor, which normalises overflow. */
    function addDays(d, n) {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
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
