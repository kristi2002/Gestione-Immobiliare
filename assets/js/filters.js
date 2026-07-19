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
        toggle.innerHTML = '<span>Filtri</span><span class="toggle-icon">â–¼</span>';
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
        layers: svgIco('<path d="m12 2 9 4.9-9 4.9-9-4.9L12 2z"/><path d="m3 12 9 4.9 9-4.9"/><path d="m3 17 9 4.9 9-4.9"/>'),
    };

    // Styled replacement for the native prompt() used to name a saved search.
    // One shared overlay, rebuilt lazily; reuses the app's modal classes.
    function askSaveName(onConfirm) {
        let ov = document.getElementById('fb-save-modal');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'fb-save-modal';
            ov.className = 'modal-overlay';
            ov.hidden = true;
            ov.innerHTML =
                '<div class="modal modal--sm" role="dialog" aria-labelledby="fb-save-title">' +
                    '<div class="modal-header"><h3 id="fb-save-title">Salva ricerca</h3>' +
                    '<button type="button" class="modal-close" aria-label="Chiudi">&times;</button></div>' +
                    '<form class="modal-body" id="fb-save-form">' +
                        '<div class="form-group"><label for="fb-save-name">Nome della ricerca</label>' +
                        '<input type="text" id="fb-save-name" class="form-input" maxlength="40" ' +
                        'placeholder="Es. Bilocali Civitanova" autocomplete="off" required></div>' +
                    '</form>' +
                    '<div class="modal-footer">' +
                        '<button type="button" class="btn btn--ghost" data-act="cancel">Annulla</button>' +
                        '<button type="submit" form="fb-save-form" class="btn btn--primary">Salva</button>' +
                    '</div>' +
                '</div>';
            document.body.appendChild(ov);
        }
        const input = ov.querySelector('#fb-save-name');
        const close = () => { ov.hidden = true; ov._confirm = null; };
        if (!ov._bound) {
            ov._bound = true;
            ov.addEventListener('click', (e) => {
                if (e.target === ov || e.target.closest('.modal-close, [data-act="cancel"]')) close();
            });
            ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
            ov.querySelector('#fb-save-form').addEventListener('submit', (e) => {
                e.preventDefault();
                const name = input.value.trim();
                if (!name) { input.focus(); return; }
                const cb = ov._confirm; close();
                if (cb) cb(name);
            });
        }
        ov._confirm = onConfirm;
        input.value = '';
        ov.hidden = false;
        input.focus();
    }

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

        // Panels are position:fixed and placed via JS so they escape the toolbar's
        // overflow:hidden and any stacking context â€” never render behind the list.
        function closeAllPanels() { bar.querySelectorAll('.fb-pop.open, .fb-menu.open').forEach(p => p.classList.remove('open')); }
        function placePanel(btn, panel, align) {
            const pw = panel.offsetWidth || 250;
            const r = btn.getBoundingClientRect();
            let leftPx = align === 'right' ? (r.right - pw) : r.left;
            leftPx = Math.max(8, Math.min(leftPx, window.innerWidth - pw - 8));
            panel.style.position = 'fixed';
            panel.style.left = leftPx + 'px';
            panel.style.top = (r.bottom + 6) + 'px';
            panel.style.right = 'auto';
        }
        function togglePanel(btn, panel, align) {
            const willOpen = !panel.classList.contains('open');
            closeAllPanels();
            if (willOpen) { panel.classList.add('open'); placePanel(btn, panel, align); }
        }
        const _fbScroller = document.getElementById('app-content');
        if (_fbScroller) _fbScroller.addEventListener('scroll', closeAllPanels, { passive: true });
        window.addEventListener('resize', closeAllPanels);

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

        // Bulk Action dropdown â€” wraps the page's existing .bulk-toolbar (its
        // buttons/checkbox keep their ids, so the page's bulk JS keeps working).
        const bulk = bar.parentElement && bar.parentElement.querySelector('.bulk-toolbar');
        if (bulk) {
            const bWrap = document.createElement('div'); bWrap.className = 'fb-ctrl';
            const bBtn = document.createElement('button'); bBtn.type = 'button'; bBtn.className = 'fb-btn';
            bBtn.innerHTML = REF_ICONS.layers + '<span>Azioni</span><span class="fb-chev">' + REF_ICONS.chev + '</span>';
            const bMenu = document.createElement('div'); bMenu.className = 'fb-menu fb-menu--bulk';
            [...bulk.childNodes].forEach(n => bMenu.appendChild(n));
            bulk.classList.add('bulk-moved');
            // The page's bulk JS toggles the (now empty) toolbar's [hidden] on
            // selection changes; mirror that state onto the moved buttons so
            // they are disabled when nothing is selected.
            const syncBulkButtons = () => {
                bMenu.querySelectorAll('button').forEach(b => { b.disabled = bulk.hidden; });
            };
            new MutationObserver(syncBulkButtons)
                .observe(bulk, { attributes: true, attributeFilter: ['hidden'] });
            syncBulkButtons();
            bWrap.append(bBtn, bMenu);
            bBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePanel(bBtn, bMenu, 'right'); });
            right.appendChild(bWrap);
        }

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
            fBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePanel(fBtn, pop, 'right'); });
            right.appendChild(fWrap);
        }

        // Sort â€” client-side reorder of the current results
        const sortWrap = document.createElement('div'); sortWrap.className = 'fb-ctrl';
        const sortBtn = document.createElement('button'); sortBtn.type = 'button'; sortBtn.className = 'fb-btn';
        sortBtn.innerHTML = REF_ICONS.sort + '<span class="fb-sort-label">PiÃ¹ recenti</span><span class="fb-chev">' + REF_ICONS.chev + '</span>';
        const sortLabel = sortBtn.querySelector('.fb-sort-label');
        const sortMenu = document.createElement('div'); sortMenu.className = 'fb-menu';
        [['recent', 'PiÃ¹ recenti'], ['old', 'Meno recenti'], ['az', 'A â†’ Z'], ['za', 'Z â†’ A']].forEach(([k, lab], i) => {
            const b = document.createElement('button'); b.type = 'button'; b.dataset.sort = k;
            b.innerHTML = '<span>' + lab + '</span>'; if (i === 0) b.classList.add('is-active');
            sortMenu.appendChild(b);
        });
        sortWrap.append(sortBtn, sortMenu);
        sortBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePanel(sortBtn, sortMenu, 'right'); });
        right.appendChild(sortWrap);

        // No Filtri popover to host it â†’ "Azzera" closes the row, after Ordina.
        if (!fields.length && clearBtn) right.appendChild(clearBtn);

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
                const del = document.createElement('span'); del.textContent = 'âœ•'; del.style.opacity = '.45';
                b.append(name, del);
                b.addEventListener('click', () => { applySnapshot(it.values); saveMenu.classList.remove('open'); });
                del.addEventListener('click', (e) => { e.stopPropagation(); const l = readSaved(); l.splice(idx, 1); writeSaved(l); renderSaveMenu(); });
                saveMenu.appendChild(b);
            });
        }
        saveBtn.addEventListener('click', (e) => { e.stopPropagation(); renderSaveMenu(); togglePanel(saveBtn, saveMenu, 'left'); });
        saveIcon.addEventListener('click', () => {
            askSaveName((name) => {
                const l = readSaved(); l.push({ name: name.slice(0, 40), values: snapshot() }); writeSaved(l);
            });
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
        // | bulk action + view toggle + Filtri popover + sort). Main bars are then
        // always shown (no collapse toggle); reports/chat bars keep collapsing.
        // Guarded: any failure leaves the original controls, still shown.
        const isMainBar = bar.classList.contains('toolbar') || bar.classList.contains('filter-bar');
        if (isMainBar) {
            try { buildRefBar(bar, controls, btn); } catch (_) { /* keep original bar */ }
            bar.classList.add('is-open');
        } else {
            setupCollapsible(bar);
        }

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
                // Tab classes update after their own handlers â€” defer.
                setTimeout(updateVisibility, 0);
            }
        });

        updateVisibility();
    }

    // On scroll-down, the filter bar becomes ONE with the top bar: it pins over
    // the topbar (fixed) instead of sitting under it â€” matching the property-
    // profile sub-nav. A spacer holds its place so content doesn't jump.
    /**
     * On scroll, merge the page's local filter toolbar UP into the global-search
     * topbar so search + filters read as one bar. Scrolling back drops it home.
     *
     * We portal the actual <div class="toolbar"> element (not a clone), so every
     * input keeps its id and its bound listeners â€” the page modules keep working.
     */
    function setupMergeToTopbar(bar) {
        if (bar._mergeBound) return;
        // Skip toolbars nested in their own scroll context (modals, side panels)
        // or inside a card â€” those are inline form rows, not page-level filter bars.
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

    // Unified page anatomy: merge the view's floating action row
    // (.view-header__actions — "+ Nuovo X", view toggles, export/import…) into
    // the main filter bar's right group, then hoist that bar to the top of the
    // view. Every list page then reads the same way:
    // topbar → control band (filters | actions) → stats → content.
    function unifyPageBar(scope) {
        const viewRoot = scope.firstElementChild;
        if (!viewRoot) return;

        const bar = [...viewRoot.querySelectorAll('.toolbar')].find(b =>
            b.dataset.filterBarBound === '1' &&
            !b.closest('.modal, .modal-overlay, .chat-sidebar, [data-no-sticky]'));
        if (!bar) return;                       // no page-level filter bar → leave the view alone

        const header  = viewRoot.querySelector(':scope > .view-header');
        const actions = header && header.querySelector('.view-header__actions');
        if (actions && actions.childElementCount) {
            const host = bar.querySelector('.fb-group--right') ||
                         bar.querySelector('.filter-bar__controls') || bar;
            const cluster = document.createElement('div');
            cluster.className = 'fb-actions';
            [...actions.childNodes].forEach(n => cluster.appendChild(n));
            host.appendChild(cluster);
        }
        if (header) header.classList.add('view-header--merged');

        // Same position on every page: the band is the first block of the view
        // (right after the now-hidden header), even if it was inside a card.
        const target = header ? header.nextElementSibling : viewRoot.firstElementChild;
        if (bar !== target) viewRoot.insertBefore(bar, target);
        bar.classList.add('toolbar--pagebar');
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
            try { unifyPageBar(scope); } catch (_) { /* keep the view's own layout */ }
            scope.querySelectorAll('.toolbar').forEach(setupMergeToTopbar);
        },
    };
})();
