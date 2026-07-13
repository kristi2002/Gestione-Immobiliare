(function () {
    'use strict';

    const BAR_SELECTORS = '.toolbar, .reports-toolbar, .chat-sidebar__search, .filter-bar';

    function hasFilters(bar) {
        return bar.querySelector(
            'input:not([type="hidden"]):not([type="file"]), select, textarea, .comm-tab, .forecast-period'
        );
    }

    function clearField(el) {
        if (el.tagName === 'SELECT') {
            el.selectedIndex = 0;
            return;
        }

        const type = (el.type || '').toLowerCase();
        if (type === 'checkbox' || type === 'radio') {
            el.checked = false;
            return;
        }

        if (type === 'number' && el.id === 'report-year') {
            el.value = String(new Date().getFullYear());
            return;
        }

        el.value = '';
    }

    function resetTabGroups(bar) {
        const commTabs = bar.querySelectorAll('.comm-tab');
        if (commTabs.length) {
            commTabs.forEach(t => t.classList.remove('active'));
            const first = bar.querySelector('.comm-tab[data-status=""]') || commTabs[0];
            first.classList.add('active');
            first.click();
            return true;
        }

        const forecastBtns = bar.querySelectorAll('.forecast-period');
        if (forecastBtns.length) {
            forecastBtns.forEach(b => b.classList.remove('active'));
            const first = bar.querySelector('.forecast-period[data-months="6"]') || forecastBtns[0];
            first.classList.add('active');
            first.click();
            return true;
        }

        return false;
    }

    function isFieldActive(el) {
        if (el.tagName === 'SELECT') {
            return el.selectedIndex > 0;
        }

        const type = (el.type || '').toLowerCase();
        if (type === 'checkbox' || type === 'radio') {
            return el.checked;
        }
        if (type === 'number' && el.id === 'report-year') {
            return el.value !== '' && el.value !== String(new Date().getFullYear());
        }
        return (el.value || '').trim() !== '';
    }

    function isTabGroupActive(bar) {
        const activeComm = bar.querySelector('.comm-tab.active');
        if (activeComm && (activeComm.dataset.status ?? '') !== '') {
            return true;
        }
        const activeForecast = bar.querySelector('.forecast-period.active');
        if (activeForecast && (activeForecast.dataset.months ?? '') !== '6') {
            return true;
        }
        return false;
    }

    function isBarActive(bar) {
        const fields = bar.querySelectorAll(
            'input:not([type="hidden"]):not([type="file"]), select, textarea'
        );
        for (const el of fields) {
            if (isFieldActive(el)) return true;
        }
        return isTabGroupActive(bar);
    }

    function fireFilterEvents(fields, tabsHandled) {
        fields.forEach(el => {
            const type = (el.type || '').toLowerCase();
            if (tabsHandled && type !== 'search' && type !== 'text' && el.tagName !== 'TEXTAREA') {
                return;
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }

    function ensureLayout(bar) {
        if (bar.querySelector('.filter-bar__controls')) return;

        const controls = document.createElement('div');
        controls.className = 'filter-bar__controls';

        const toMove = [...bar.childNodes];
        toMove.forEach(n => controls.appendChild(n));

        bar.appendChild(controls);
    }

    function setupCollapsible(bar) {
        if (bar.classList.contains('chat-sidebar__search')) return;
        if (bar.dataset.collapsibleBound === '1') return;
        bar.dataset.collapsibleBound = '1';

        const storageKey = 'filterBar:' + (bar.id || [...bar.classList].join('.'));
        const wasOpen = sessionStorage.getItem(storageKey) === 'true';

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'toolbar-toggle';
        toggle.setAttribute('aria-expanded', String(wasOpen));
        toggle.innerHTML = '<span>Filtri</span><span class="toggle-icon">▼</span>';
        bar.parentNode.insertBefore(toggle, bar);

        if (wasOpen) bar.classList.add('is-open');

        toggle.addEventListener('click', () => {
            const open = bar.classList.toggle('is-open');
            toggle.setAttribute('aria-expanded', String(open));
            sessionStorage.setItem(storageKey, String(open));
        });
    }

    // ---- Reference filter-bar layout ------------------------------------------
    function svgIco(p) {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
    }
    const REF_ICONS = {
        chev:   svgIco('<path d="m6 9 6 6 6-6"/>'),
        save:   svgIco('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>'),
        book:   svgIco('<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'),
        filter: svgIco('<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>'),
        sort:   svgIco('<path d="M11 5h10M11 9h7M11 13h4M3 17l3 3 3-3M6 18V4"/>'),
    };

    function findResultsContainer(bar) {
        let el = bar.nextElementSibling;
        while (el) {
            if (el.matches && el.matches('.entity-grid')) return el;
            const g = el.querySelector && el.querySelector('.entity-grid, table tbody');
            if (g) return g;
            el = el.nextElementSibling;
        }
        const p = bar.parentElement;
        return (p && (p.querySelector('.entity-grid') || p.querySelector('table tbody'))) || null;
    }

    // Reflow a toolbar's controls into the reference layout. Returns true when
    // applied. Any throw is caught by the caller, leaving the original bar intact.
    function buildRefBar(bar, controls, clearBtn) {
        if (controls.dataset.refBuilt === '1') return true;

        const searchBox = controls.querySelector('.search-box');
        const searchInput = (searchBox && searchBox.querySelector('input')) ||
                            controls.querySelector('input[type="search"]');
        const fields = [...controls.querySelectorAll('select, input[type="date"], input[type="text"], input[type="number"]')]
            .filter(el => el !== searchInput && !el.closest('.search-box'));
        if (!searchInput && !fields.length) return false;

        // The reference bar is always shown (it replaces the collapse-to-toggle
        // pattern with a Filtri popover), so keep it out of the collapsed state.
        bar.classList.add('is-open');

        const pageKey = 'fbSaved:' + (bar.id || (location.pathname + '|' + [...bar.classList].join('.')));
        const left  = document.createElement('div'); left.className  = 'fb-group fb-group--left';
        const right = document.createElement('div'); right.className = 'fb-group fb-group--right';

        if (searchBox) left.appendChild(searchBox);
        else if (searchInput) left.appendChild(searchInput);

        // Saved searches + save icon (localStorage)
        const saveWrap = document.createElement('div'); saveWrap.className = 'fb-ctrl';
        const saveBtn = document.createElement('button'); saveBtn.type = 'button'; saveBtn.className = 'fb-btn';
        saveBtn.innerHTML = REF_ICONS.book + '<span>Ricerche salvate</span><span class="fb-chev">' + REF_ICONS.chev + '</span>';
        const saveMenu = document.createElement('div'); saveMenu.className = 'fb-menu';
        saveWrap.append(saveBtn, saveMenu);
        const saveIcon = document.createElement('button'); saveIcon.type = 'button'; saveIcon.className = 'fb-icon-btn';
        saveIcon.title = 'Salva la ricerca corrente'; saveIcon.innerHTML = REF_ICONS.save;
        left.append(saveWrap, saveIcon);

        // View toggle moved in from the sibling .view-cols-row (where present)
        const colsRow = bar.parentElement && bar.parentElement.querySelector('.view-cols-row');
        if (colsRow) { [...colsRow.children].forEach(c => right.appendChild(c)); colsRow.remove(); }

        // Filtri popover holding the page's real filter fields
        let filterBadge = null;
        if (fields.length) {
            const fWrap = document.createElement('div'); fWrap.className = 'fb-ctrl';
            const fBtn = document.createElement('button'); fBtn.type = 'button'; fBtn.className = 'fb-btn';
            filterBadge = document.createElement('span'); filterBadge.className = 'fb-badge'; filterBadge.hidden = true;
            fBtn.innerHTML = REF_ICONS.filter + '<span>Filtri</span>';
            fBtn.appendChild(filterBadge);
            const pop = document.createElement('div'); pop.className = 'fb-pop';
            fields.forEach(f => {
                const row = document.createElement('div'); row.className = 'fb-pop__row';
                const lbl = document.createElement('label');
                lbl.textContent = f.getAttribute('aria-label') || f.dataset.label ||
                    (f.tagName === 'SELECT' && f.options[0] ? f.options[0].textContent : (f.placeholder || 'Filtro'));
                row.append(lbl, f);
                pop.appendChild(row);
            });
            const foot = document.createElement('div'); foot.className = 'fb-pop__foot';
            if (clearBtn) foot.appendChild(clearBtn);
            const done = document.createElement('button'); done.type = 'button';
            done.className = 'btn btn--primary btn--sm'; done.textContent = 'Applica';
            done.addEventListener('click', () => pop.classList.remove('open'));
            foot.appendChild(done);
            pop.appendChild(foot);
            fWrap.append(fBtn, pop);
            fBtn.addEventListener('click', (e) => { e.stopPropagation(); pop.classList.toggle('open'); });
            right.appendChild(fWrap);
        } else if (clearBtn) {
            right.appendChild(clearBtn);
        }

        // Sort — client-side reorder of the current results
        const sortWrap = document.createElement('div'); sortWrap.className = 'fb-ctrl';
        const sortBtn = document.createElement('button'); sortBtn.type = 'button'; sortBtn.className = 'fb-btn';
        sortBtn.innerHTML = REF_ICONS.sort + '<span class="fb-sort-label">Più recenti</span><span class="fb-chev">' + REF_ICONS.chev + '</span>';
        const sortLabel = sortBtn.querySelector('.fb-sort-label');
        const sortMenu = document.createElement('div'); sortMenu.className = 'fb-menu';
        [['recent', 'Più recenti'], ['old', 'Meno recenti'], ['az', 'A → Z'], ['za', 'Z → A']].forEach(([k, lab], i) => {
            const b = document.createElement('button'); b.type = 'button'; b.dataset.sort = k;
            b.innerHTML = '<span>' + lab + '</span>'; if (i === 0) b.classList.add('is-active');
            sortMenu.appendChild(b);
        });
        sortWrap.append(sortBtn, sortMenu);
        sortBtn.addEventListener('click', (e) => { e.stopPropagation(); sortMenu.classList.toggle('open'); });
        right.appendChild(sortWrap);

        controls.classList.add('fb-ref');
        controls.append(left, right);
        controls.dataset.refBuilt = '1';

        function applySort(kind) {
            const grid = findResultsContainer(bar); if (!grid) return;
            const items = [...grid.children].filter(n => n.nodeType === 1 &&
                !n.classList.contains('entity-loading') && !n.classList.contains('table-empty'));
            if (items.length < 2) return;
            const num = el => { const v = parseInt(el.dataset.id || el.getAttribute('data-id') || '0', 10); return isNaN(v) ? 0 : v; };
            const txt = el => (el.textContent || '').trim().toLowerCase();
            items.sort((a, b) =>
                kind === 'recent' ? num(b) - num(a) :
                kind === 'old'    ? num(a) - num(b) :
                kind === 'az'     ? txt(a).localeCompare(txt(b)) :
                                    txt(b).localeCompare(txt(a)));
            items.forEach(n => grid.appendChild(n));
        }
        sortMenu.addEventListener('click', (e) => {
            const b = e.target.closest('button[data-sort]'); if (!b) return;
            sortMenu.querySelectorAll('button').forEach(x => x.classList.remove('is-active'));
            b.classList.add('is-active');
            sortLabel.textContent = b.querySelector('span').textContent;
            sortMenu.classList.remove('open');
            applySort(b.dataset.sort);
        });

        function refreshBadge() {
            if (!filterBadge) return;
            const n = fields.filter(isFieldActive).length;
            filterBadge.hidden = n === 0; filterBadge.textContent = String(n);
        }
        bar.addEventListener('change', refreshBadge);
        bar.addEventListener('input', refreshBadge);
        refreshBadge();

        const readSaved  = () => { try { return JSON.parse(localStorage.getItem(pageKey) || '[]'); } catch { return []; } };
        const writeSaved = v  => { try { localStorage.setItem(pageKey, JSON.stringify(v)); } catch (_) {} };
        const savedFields = () => [searchInput, ...fields].filter(Boolean);
        function snapshot() { const s = {}; savedFields().forEach((f, i) => { s[f.id || ('f' + i)] = f.value; }); return s; }
        function applySnapshot(s) {
            savedFields().forEach((f, i) => {
                const k = f.id || ('f' + i);
                if (k in s) { f.value = s[k]; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })); }
            });
            refreshBadge();
        }
        function renderSaveMenu() {
            const list = readSaved(); saveMenu.innerHTML = '';
            if (!list.length) { saveMenu.innerHTML = '<div class="fb-menu__empty">Nessuna ricerca salvata</div>'; return; }
            list.forEach((it, idx) => {
                const b = document.createElement('button'); b.type = 'button';
                const name = document.createElement('span'); name.textContent = it.name;
                const del = document.createElement('span'); del.textContent = '✕'; del.style.opacity = '.45';
                b.append(name, del);
                b.addEventListener('click', () => { applySnapshot(it.values); saveMenu.classList.remove('open'); });
                del.addEventListener('click', (e) => { e.stopPropagation(); const l = readSaved(); l.splice(idx, 1); writeSaved(l); renderSaveMenu(); });
                saveMenu.appendChild(b);
            });
        }
        saveBtn.addEventListener('click', (e) => { e.stopPropagation(); renderSaveMenu(); saveMenu.classList.toggle('open'); });
        saveIcon.addEventListener('click', () => {
            const name = prompt('Nome della ricerca salvata:'); if (!name) return;
            const l = readSaved(); l.push({ name: name.slice(0, 40), values: snapshot() }); writeSaved(l);
        });

        document.addEventListener('click', (e) => {
            if (!bar.contains(e.target)) bar.querySelectorAll('.fb-pop.open, .fb-menu.open').forEach(p => p.classList.remove('open'));
        });

        return true;
    }

    function setupBar(bar) {
        if (!hasFilters(bar)) return;
        if (bar.dataset.filterBarBound === '1') return;
        bar.dataset.filterBarBound = '1';

        ensureLayout(bar);

        const controls = bar.querySelector('.filter-bar__controls');
        let btn = controls.querySelector('.btn-clear-filters');
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn--ghost btn--sm btn-clear-filters';
            btn.setAttribute('aria-label', 'Azzera filtri');
            btn.innerHTML = '&#10005; Azzera filtri';
            // Always the last item in the filter row, pushed to the far side.
            controls.appendChild(btn);
        }

        // Reflow list toolbars into the reference layout (search + saved searches
        // | view toggle + Filtri popover + sort). Guarded: any failure falls back
        // to the original, working bar + the mobile collapse toggle.
        let refApplied = false;
        if (bar.classList.contains('toolbar') || bar.classList.contains('filter-bar')) {
            try { refApplied = buildRefBar(bar, controls, btn); } catch (_) { refApplied = false; }
        }
        if (!refApplied) setupCollapsible(bar);

        const updateVisibility = () => {
            btn.hidden = !isBarActive(bar);
        };

        btn.addEventListener('click', () => {
            const fields = bar.querySelectorAll(
                'input:not([type="hidden"]):not([type="file"]), select, textarea'
            );

            fields.forEach(clearField);
            const tabsHandled = resetTabGroups(bar);
            fireFilterEvents(fields, tabsHandled);
            updateVisibility();
        });

        // Re-evaluate visibility whenever a filter changes.
        bar.addEventListener('input', updateVisibility);
        bar.addEventListener('change', updateVisibility);
        bar.addEventListener('click', (e) => {
            if (e.target.closest('.comm-tab, .forecast-period')) {
                // Tab classes update after their own handlers — defer.
                setTimeout(updateVisibility, 0);
            }
        });

        updateVisibility();
    }

    // On scroll-down, the filter bar becomes ONE with the top bar: it pins over
    // the topbar (fixed) instead of sitting under it — matching the property-
    // profile sub-nav. A spacer holds its place so content doesn't jump.
    /**
     * On scroll, merge the page's local filter toolbar UP into the global-search
     * topbar so search + filters read as one bar. Scrolling back drops it home.
     *
     * We portal the actual <div class="toolbar"> element (not a clone), so every
     * input keeps its id and its bound listeners — the page modules keep working.
     */
    function setupMergeToTopbar(bar) {
        if (bar._mergeBound) return;
        // Skip toolbars nested in their own scroll context (modals, side panels)
        // or inside a card — those are inline form rows, not page-level filter bars.
        if (bar.closest('.modal, .modal-overlay, .chat-sidebar, .card, [data-no-sticky]')) return;
        const topbar   = document.querySelector('.topbar');
        const slot     = document.getElementById('topbar-filters');
        const scroller = document.getElementById('app-content');
        if (!topbar || !slot || !scroller) return;
        bar._mergeBound = true;

        // The "Filtri" collapse toggle (if any) sits right before the bar; hide it
        // while merged so it doesn't dangle in the page with the fields gone.
        let toggle = bar.previousElementSibling;
        if (!toggle || !toggle.classList.contains('toolbar-toggle')) toggle = null;

        // Anchor marks the home position; spacer holds the vacated height so the
        // scroll position doesn't jump when the (open) toolbar leaves the flow.
        const anchor = document.createComment('toolbar-home');
        bar.parentNode.insertBefore(anchor, bar);
        const spacer = document.createElement('div');
        spacer.className = 'toolbar-spacer';
        spacer.hidden = true;
        bar.parentNode.insertBefore(spacer, bar);

        let merged = false;
        const onScroll = () => {
            if (!document.body.contains(anchor)) { scroller.removeEventListener('scroll', onScroll); return; }
            const th  = topbar.getBoundingClientRect().bottom;
            const ref = merged ? spacer.getBoundingClientRect().top : bar.getBoundingClientRect().top;
            if (!merged && ref <= th) {
                const mb = parseFloat(getComputedStyle(bar).marginBottom) || 0;
                spacer.style.height = (bar.offsetHeight + mb) + 'px';
                spacer.hidden = false;
                slot.appendChild(bar);
                bar.classList.add('toolbar--merged');
                topbar.classList.add('topbar--has-filters');
                if (toggle) toggle.hidden = true;
                merged = true;
            } else if (merged && ref > th) {
                anchor.parentNode.insertBefore(bar, anchor.nextSibling);
                bar.classList.remove('toolbar--merged');
                if (!slot.children.length) topbar.classList.remove('topbar--has-filters');
                spacer.hidden = true;
                if (toggle) toggle.hidden = false;
                merged = false;
            }
        };
        scroller.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
    }

    window.FilterBar = {
        setupIn(root) {
            const scope = root || document;
            // New view: a toolbar merged from the previous view would be stranded in
            // the topbar slot (it lives outside #app-content). Clear it first.
            const slot = document.getElementById('topbar-filters');
            if (slot && slot.children.length) slot.innerHTML = '';
            const topbar = document.querySelector('.topbar');
            if (topbar) topbar.classList.remove('topbar--has-filters');

            scope.querySelectorAll(BAR_SELECTORS).forEach(setupBar);
            scope.querySelectorAll('.toolbar').forEach(setupMergeToTopbar);
        },
    };
})();
