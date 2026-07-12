/**
 * DatePicker — a styled calendar popup that replaces the browser's native
 * (unstyleable) date picker on every `input[type="date"]`.
 *
 * Design goals:
 *  - The <input type="date"> stays the source of truth. Its value stays ISO
 *    (YYYY-MM-DD) so every existing read (`el.value`) and write keeps working,
 *    and the browser keeps rendering the localised gg/mm/aaaa display for free.
 *  - The native picker + mobile keyboard are suppressed (readOnly + hidden
 *    indicator); interaction opens our own calendar instead.
 *  - One shared popup element, portalled to <body> as position:fixed, so it is
 *    never clipped by a modal's overflow and always sits above it.
 *
 * Usage: DatePicker.setupIn(root) after a view renders (mirrors FilterBar).
 */
(function () {
    'use strict';

    const MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
                    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
    const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']; // Monday-first

    const CHEVRON_L = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
    const CHEVRON_R = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
    const CAL_ICON  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';

    let popup, elMonth, elYear, elGrid, activeInput = null, viewY, viewM;

    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    function iso(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }

    // Parse "YYYY-MM-DD" without timezone surprises.
    function parseISO(v) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
        if (!m) return null;
        return { y: +m[1], m: +m[2] - 1, d: +m[3] };
    }

    function buildPopup() {
        popup = document.createElement('div');
        popup.className = 'dp-popup';
        popup.setAttribute('role', 'dialog');
        popup.setAttribute('aria-label', 'Seleziona data');
        popup.hidden = true;
        popup.innerHTML =
            '<div class="dp-head">' +
                '<button type="button" class="dp-nav" data-step="-1" aria-label="Mese precedente">' + CHEVRON_L + '</button>' +
                '<div class="dp-selects">' +
                    '<select class="dp-month" aria-label="Mese"></select>' +
                    '<select class="dp-year" aria-label="Anno"></select>' +
                '</div>' +
                '<button type="button" class="dp-nav" data-step="1" aria-label="Mese successivo">' + CHEVRON_R + '</button>' +
            '</div>' +
            '<div class="dp-weekdays">' + WEEKDAYS.map(w => '<span>' + w + '</span>').join('') + '</div>' +
            '<div class="dp-days" role="grid"></div>' +
            '<div class="dp-foot">' +
                '<button type="button" class="dp-today">Oggi</button>' +
                '<button type="button" class="dp-clear">Cancella</button>' +
            '</div>';
        document.body.appendChild(popup);

        elMonth = popup.querySelector('.dp-month');
        elYear  = popup.querySelector('.dp-year');
        elGrid  = popup.querySelector('.dp-days');

        MONTHS.forEach((name, i) => {
            const o = document.createElement('option');
            o.value = i; o.textContent = name; elMonth.appendChild(o);
        });

        popup.addEventListener('mousedown', e => e.preventDefault()); // keep input focus
        popup.querySelectorAll('.dp-nav').forEach(b =>
            b.addEventListener('click', () => stepMonth(+b.dataset.step)));
        elMonth.addEventListener('change', () => { viewM = +elMonth.value; renderDays(); });
        elYear.addEventListener('change', () => { viewY = +elYear.value; renderDays(); });
        popup.querySelector('.dp-today').addEventListener('click', () => {
            const t = new Date();
            commit(t.getFullYear(), t.getMonth(), t.getDate());
        });
        popup.querySelector('.dp-clear').addEventListener('click', () => {
            if (activeInput) { setValue(activeInput, ''); }
            close();
        });
    }

    function stepMonth(delta) {
        viewM += delta;
        if (viewM < 0) { viewM = 11; viewY--; }
        else if (viewM > 11) { viewM = 0; viewY++; }
        syncSelects();
        renderDays();
    }

    function fillYears(center) {
        const from = center - 100, to = center + 15;
        elYear.innerHTML = '';
        for (let y = to; y >= from; y--) {
            const o = document.createElement('option');
            o.value = y; o.textContent = y; elYear.appendChild(o);
        }
    }

    function syncSelects() {
        if (!elYear.querySelector('option[value="' + viewY + '"]')) fillYears(viewY);
        elMonth.value = viewM;
        elYear.value = viewY;
    }

    function bounds(input) {
        return { min: parseISO(input && input.min), max: parseISO(input && input.max) };
    }
    function cmp(a, b) { // a,b as {y,m,d}
        if (a.y !== b.y) return a.y - b.y;
        if (a.m !== b.m) return a.m - b.m;
        return a.d - b.d;
    }

    function renderDays() {
        const { min, max } = bounds(activeInput);
        const sel = parseISO(activeInput && activeInput.value);
        const t = new Date();
        const today = { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };

        const first = new Date(viewY, viewM, 1);
        let lead = (first.getDay() + 6) % 7; // Monday = 0
        const days = new Date(viewY, viewM + 1, 0).getDate();

        let html = '';
        for (let i = 0; i < lead; i++) html += '<span class="dp-day dp-day--pad"></span>';
        for (let d = 1; d <= days; d++) {
            const cell = { y: viewY, m: viewM, d };
            const disabled = (min && cmp(cell, min) < 0) || (max && cmp(cell, max) > 0);
            const cls = ['dp-day'];
            if (sel && sel.y === viewY && sel.m === viewM && sel.d === d) cls.push('is-selected');
            if (today.y === viewY && today.m === viewM && today.d === d) cls.push('is-today');
            if (disabled) cls.push('is-disabled');
            html += '<button type="button" class="' + cls.join(' ') + '"' +
                    (disabled ? ' disabled' : ' data-d="' + d + '"') + '>' + d + '</button>';
        }
        elGrid.innerHTML = html;
        elGrid.querySelectorAll('button[data-d]').forEach(b =>
            b.addEventListener('click', () => commit(viewY, viewM, +b.dataset.d)));
    }

    function setValue(input, v) {
        input.value = v;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function commit(y, m, d) {
        if (activeInput) setValue(activeInput, iso(y, m, d));
        close();
    }

    function position() {
        if (!activeInput) return;
        const r = activeInput.getBoundingClientRect();
        popup.hidden = false; // must be laid out to measure
        const pw = popup.offsetWidth, ph = popup.offsetHeight;
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        let left = r.left;
        if (left + pw > vw - 8) left = Math.max(8, vw - pw - 8);
        let top = r.bottom + 6;
        if (top + ph > vh - 8 && r.top - ph - 6 > 8) top = r.top - ph - 6; // flip above
        popup.style.left = Math.round(left) + 'px';
        popup.style.top = Math.round(top) + 'px';
    }

    function open(input) {
        if (!popup) buildPopup();
        activeInput = input;
        const cur = parseISO(input.value);
        const now = new Date();
        viewY = cur ? cur.y : now.getFullYear();
        viewM = cur ? cur.m : now.getMonth();
        fillYears(viewY);
        syncSelects();
        renderDays();
        position();
        popup.classList.add('is-open');
    }

    function close() {
        if (!popup) return;
        popup.classList.remove('is-open');
        popup.hidden = true;
        activeInput = null;
    }

    function isOpen() { return popup && popup.classList.contains('is-open'); }

    // Global dismissers (bound once).
    document.addEventListener('mousedown', e => {
        if (!isOpen()) return;
        if (popup.contains(e.target) || e.target === activeInput) return;
        close();
    });
    document.addEventListener('keydown', e => {
        if (isOpen() && e.key === 'Escape') { const i = activeInput; close(); i && i.focus(); }
    });
    window.addEventListener('resize', () => { if (isOpen()) position(); });
    // Reposition while the modal/content scrolls under the fixed popup.
    window.addEventListener('scroll', () => { if (isOpen()) position(); }, true);

    function enhance(input) {
        if (input.dataset.dpBound === '1') return;
        input.dataset.dpBound = '1';
        input.classList.add('dp-input');
        input.readOnly = true;            // suppress native picker + mobile keyboard
        input.autocomplete = 'off';

        // Wrap so we can hang a calendar affordance beside the field.
        const wrap = document.createElement('span');
        wrap.className = 'dp-field';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'dp-toggle';
        toggle.tabIndex = -1;
        toggle.setAttribute('aria-label', 'Apri calendario');
        toggle.innerHTML = CAL_ICON;
        wrap.appendChild(toggle);

        const openThis = () => { (isOpen() && activeInput === input) ? close() : open(input); };
        input.addEventListener('mousedown', e => { e.preventDefault(); openThis(); });
        input.addEventListener('focus', () => { if (!isOpen()) open(input); });
        toggle.addEventListener('mousedown', e => e.preventDefault());
        toggle.addEventListener('click', openThis);
        input.addEventListener('keydown', e => {
            if (['Enter', ' ', 'ArrowDown'].includes(e.key)) { e.preventDefault(); open(input); }
        });
    }

    window.DatePicker = {
        setupIn(root) {
            (root || document).querySelectorAll('input[type="date"]').forEach(enhance);
        },
    };
})();
