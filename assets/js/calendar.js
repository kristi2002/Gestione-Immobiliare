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
    const APPT_PLACE_LABELS  = { agenzia: 'In agenzia', virtuale: 'Videochiamata' };

    // apiGetPagination() hard-caps `limit` at 100 regardless of what we ask for,
    // so a month is assembled by paging rather than by one oversized request —
    // the old `limit=500` was clamped to 100 and silently hid the rest.
    const PAGE_LIMIT = 100;
    const MAX_PAGES  = 10;

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

    async function loadMonth(keepSelection = false) {
        els.title.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
        if (!keepSelection) resetSide();

        const from = `${viewYear}-${pad(viewMonth + 1)}-01`;
        const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate();
        const to = `${viewYear}-${pad(viewMonth + 1)}-${pad(lastDay)}`;
        const range = `from=${from}&to=${to}`;

        try {
            const [rem, appt] = await Promise.all([
                fetchAllInRange(REM_API, range),
                fetchAllInRange(APPT_API, range),
            ]);

            const reminders = rem.items.map(r => ({
                type: 'reminder', id: r.id, date: r.reminder_date, status: r.status,
                time: hhmm(r.reminder_date),
                title: r.title, label: r.title,
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
                    title: place || kind,
                    // One predictable shape per type, so a month can be scanned
                    // without opening every event: a call says who to ring, a
                    // visit says where to be.
                    label: a.appointment_type === 'chiamata'
                        ? (who ? `Chiamare ${who}` : 'Chiamata')
                        : (place || (who ? `${kind} · ${who}` : kind)),
                    subtitle: [kind, who].filter(Boolean).join(' · '), raw: a,
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

            // [HH:mm] + one standardised label per type. The time leads because
            // that is what an agent scans a month for; the label is clipped by
            // CSS ellipsis rather than a fixed character count, so wide screens
            // show more instead of always cutting at 15 chars.
            const chips = dayEvents.slice(0, 3).map(ev => `
                <span class="cal-event cal-event--${ev.type} cal-event--${ev.type}-${ev.status}" title="${escapeHtml(`${ev.time} · ${ev.label}`)}">
                    <span class="cal-event__time">${escapeHtml(ev.time)}</span><span class="cal-event__label">${escapeHtml(ev.label)}</span>
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
        // keep whatever day was selected (re-render on type-filter change or
        // after a quick status update — including when that emptied the day).
        const keepKey = els.sideBody.dataset.key;
        if (keepKey) {
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

        els.sideBody.innerHTML = dayEvents.map((ev, i) => {
            const icon  = ev.type === 'appointment' ? 'calendar-check' : 'bell';
            const label = ev.type === 'appointment' ? (APPT_STATUS_LABELS[ev.status] || ev.status) : (REM_STATUS_LABELS[ev.status] || ev.status);
            const open  = ev.type === 'appointment' ? 'scheduled' : 'pending';
            // The panel is where the day gets worked, so the one action an agent
            // performs constantly lives here instead of two navigations away.
            const canComplete = window.canWrite !== false && ev.status === open;
            return `
            <div class="cal-side-item cal-side-item--${ev.type}-${ev.status}" data-type="${ev.type}" data-id="${ev.id}" data-idx="${i}">
                <div class="cal-side-item__head">
                    <i data-lucide="${icon}" class="cal-side-item__icon"></i>
                    <div class="cal-side-item__time">${escapeHtml(ev.time)}</div>
                    <span class="badge cal-side-item__badge">${escapeHtml(label)}</span>
                </div>
                <div class="cal-side-item__title">${escapeHtml(ev.title)}</div>
                ${ev.subtitle ? `<div class="cal-side-item__desc text-muted">${escapeHtml(truncate(ev.subtitle, 90))}</div>` : ''}
                ${canComplete ? `
                <div class="cal-side-item__actions">
                    <button type="button" class="cal-side-item__done" data-idx="${i}">
                        <i data-lucide="check"></i> Segna come completata
                    </button>
                </div>` : ''}
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

    /**
     * "2026-07-27 10:00:00" -> "10:00".
     * Sliced rather than parsed through Date: the DB stores local wall-clock
     * time, so re-parsing only risks a timezone shift on the displayed hour.
     */
    function hhmm(dateStr) {
        const t = String(dateStr || '').slice(11, 16);
        return /^\d{2}:\d{2}$/.test(t) ? t : '--:--';
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
