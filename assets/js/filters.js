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

    function setupBar(bar) {
        if (!hasFilters(bar)) return;
        if (bar.dataset.filterBarBound === '1') return;
        bar.dataset.filterBarBound = '1';

        setupCollapsible(bar);
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

    window.FilterBar = {
        setupIn(root) {
            (root || document).querySelectorAll(BAR_SELECTORS).forEach(setupBar);
        },
    };
})();
