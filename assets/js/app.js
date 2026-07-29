/**
 * Gestionale Immobiliare — AJAX Router & App Bootstrap
 */

(function () {
    'use strict';

    // ── WhatsApp click-to-chat (free, no API) ──────────────────────────────────
    // Opens WhatsApp (app or web) with the contact + an optional pre-filled message.
    window.WA = {
        // WhatsApp brand glyph (inline SVG, inherits currentColor)
        icon: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.6 6.32A7.85 7.85 0 0 0 12.05 4a7.94 7.94 0 0 0-6.9 11.9L4 20l4.2-1.1a7.9 7.9 0 0 0 3.8 1h.01a7.94 7.94 0 0 0 5.59-13.58Zm-5.55 12.2h-.01a6.56 6.56 0 0 1-3.35-.92l-.24-.14-2.5.66.67-2.43-.16-.25a6.59 6.59 0 1 1 5.59 3.08Zm3.62-4.93c-.2-.1-1.17-.58-1.35-.64s-.31-.1-.44.1-.5.64-.62.77-.23.15-.43.05a5.4 5.4 0 0 1-1.59-.98 6 6 0 0 1-1.1-1.37c-.11-.2 0-.3.09-.4l.3-.35a1.36 1.36 0 0 0 .2-.33.37.37 0 0 0 0-.35c-.05-.1-.44-1.06-.6-1.45s-.32-.33-.44-.34h-.38a.72.72 0 0 0-.52.24 2.2 2.2 0 0 0-.68 1.63 3.82 3.82 0 0 0 .8 2.03 8.75 8.75 0 0 0 3.35 2.96c.47.2.83.32 1.11.41a2.69 2.69 0 0 0 1.23.08 2 2 0 0 0 1.32-.93 1.65 1.65 0 0 0 .11-.93c-.05-.08-.18-.13-.38-.23Z"/></svg>',
        // Normalize an Italian/other phone to wa.me digits (no +, spaces, dashes).
        normalize(phone) {
            let d = String(phone || '').replace(/\D+/g, '');
            if (!d) return '';
            if (d.startsWith('00')) d = d.slice(2);
            else if (d.startsWith('0')) d = '39' + d.slice(1);
            if (!d.startsWith('39') && d.length <= 10) d = '39' + d;
            return d;
        },
        // Direct-message link to a specific number.
        link(phone, text) {
            const n = this.normalize(phone);
            if (!n) return '';
            return 'https://wa.me/' + n + (text ? '?text=' + encodeURIComponent(text) : '');
        },
        // Share link (no number) — opens WhatsApp's contact picker with text.
        shareLink(text) {
            return 'https://api.whatsapp.com/send?text=' + encodeURIComponent(text || '');
        },
        // Returns an <a> button (or '' when there's no usable phone).
        buttonHtml(phone, text, opts) {
            const url = this.link(phone, text);
            if (!url) return '';
            const o = opts || {};
            const cls = 'btn-wa' + (o.className ? ' ' + o.className : '');
            const label = o.label ? '<span>' + o.label + '</span>' : '';
            return `<a href="${url}" target="_blank" rel="noopener" class="${cls}" title="Scrivi su WhatsApp" aria-label="Scrivi su WhatsApp">${this.icon}${label}</a>`;
        },
        open(phone, text) {
            const url = this.link(phone, text);
            if (url) window.open(url, '_blank', 'noopener');
            return !!url;
        },
    };

    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';

    const originalFetch = window.fetch.bind(window);
    window.fetch = async function (url, options = {}) {
        const opts = { ...options };
        const method = (opts.method || 'GET').toUpperCase();
        if (csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
            opts.headers = new Headers(opts.headers || {});
            if (!opts.headers.has('X-CSRF-Token')) {
                opts.headers.set('X-CSRF-Token', csrfToken);
            }
        }
        const response = await originalFetch(url, opts);
        if (response.status === 401 && !String(url).includes('login.php')) {
            window.location.href = 'login.php';
            throw new Error('Sessione scaduta');
        }
        return response;
    };

    const App = {
        contentEl:  null,
        titleEl:    null,
        subEl:      null,
        currentView: null,
        viewParams: {},
        _viewToken: 0,

        // ── Navigation trail ─────────────────────────────────────────────────
        // The app has no fixed page hierarchy: un immobile can be reached from
        // Immobili, from the scheda of its proprietario, from the mappa… so the
        // breadcrumb is the path actually walked, not a static parent chain.
        //   trail    — [{ view, params, label, seq }], oldest first
        //   trailIdx — where we are in it (always the last element)
        //   _seq     — how many history entries WE pushed in this document; each
        //              entry carries the seq it was written at, so a crumb click
        //              can be turned into a real history.go() delta.
        // The whole trail travels inside history.state, so Back/Forward and a
        // reload all restore the exact same path.
        trail: [],
        trailIdx: 0,
        _seq: 0,

        /** Human-readable titles for each view */
        viewTitles: {
            dashboard:      'Dashboard',
            clients:        'Proprietari',
            leads:          'Leads',
            properties:     'Immobili',
            contracts:      'Contratti',
            documents:      'Documenti',
            payments:       'Pagamenti',
            expenses:       'Spese',
            invoices:       'Fatture',
            communications: 'Comunicazioni',
            appointments:   'Appuntamenti',
            calendar:       'Calendario',
            map:            'Mappa',
            reminders:      'Promemoria',
            tenants:        'Inquilini',
            keys:           'Chiavi',
            agents:         'Portafoglio agenti',
            reports:        'Report',
            social:         'Social Media',
            activity_log:   'Log Attività',
            settings:       'Impostazioni',
            client_profile:        'Scheda Cliente',
            agent_profile:         'Scheda Agente',
            property_profile:      'Scheda Immobile',
            client_edit:           'Modifica Proprietario',
            property_edit:         'Modifica Immobile',
            contract_edit:         'Contratto',
            invoice_edit:          'Fattura',
            lead_edit:             'Lead',
            tenant_edit:           'Inquilino',
            tenant_profile:        'Scheda Inquilino',
            appointment_edit:      'Appuntamento',
            appointment_profile:   'Scheda Appuntamento',
            expense_edit:          'Spesa',
            payment_edit:          'Pagamento',
            automations:           'Automazioni Clienti',
            buildings:             'Edifici',
            building_profile:      'Scheda Edificio',
            insurance:             'Assicurazioni',
            meters:                'Contatori',
            suppliers:             'Fornitori',
            inventory:             'Inventario',
            commissions:           'Provvigioni',
            surveys:               'Sondaggi',
            forecast:              'Previsioni',
            maintenance_workflow:  'Manutenzione',
            whatsapp_inbox:        'WhatsApp Inbox',
            property_applications: 'Richieste immobili',
            aml:                   'Antiriciclaggio',
            scadenzario:           'Scadenzario Fiscale',
            portal_sync:           'Pubblicazioni Portali',
            valuation:             'Valutazioni OMI',
            // One route, many forms — the real label comes from entityFormTitles
            // below via resolveTitle(). This entry exists so parseUrl() accepts
            // the view on a reload or a pasted link.
            entity_edit:           'Scheda',
        },

        /**
         * Titles for the schema-driven form page. Keyed by the `entity` param,
         * because every one of those forms is served by the single entity_edit
         * route. Keep in sync with assets/js/entity_edit/schemas/index.js.
         */
        entityFormTitles: {
            suppliers:    { create: 'Nuovo Fornitore',    edit: 'Modifica Fornitore' },
            insurance:    { create: 'Nuova Polizza',      edit: 'Modifica Polizza' },
            commissions:  { create: 'Nuova Provvigione',  edit: 'Modifica Provvigione' },
            keys:         { create: 'Registra Chiavi',    edit: 'Modifica Chiavi' },
            buildings:    { create: 'Nuovo Edificio',     edit: 'Modifica Edificio' },
            aml:          { create: 'Nuova Verifica AML', edit: 'Modifica Verifica AML' },
            valuation:    { create: 'Nuova Valutazione',  edit: 'Modifica Valutazione' },
            applications: { create: 'Nuova Candidatura',  edit: 'Modifica Candidatura' },
        },

        // Edit views that serve BOTH create and edit: the static viewTitles label
        // ("Modifica …") is wrong in create mode. Pick by presence of the id param
        // (absent => create), matching the in-card h2 set by the view script.
        editTitles: {
            client_edit:      { create: 'Nuovo Proprietario',  edit: 'Modifica Proprietario',  idKey: 'clientId' },
            property_edit:    { create: 'Nuovo Immobile',      edit: 'Modifica Immobile',      idKey: 'propertyId' },
            appointment_edit: { create: 'Nuovo Appuntamento',  edit: 'Modifica Appuntamento',  idKey: 'appointmentId' },
        },

        resolveTitle(viewKey, params) {
            const p = params || this.viewParams;
            if (viewKey === 'entity_edit') {
                const t = this.entityFormTitles[p && p.entity];
                if (t) return (p && p.id) ? t.edit : t.create;
                return this.viewTitles.entity_edit;
            }
            const e = this.editTitles[viewKey];
            if (e) {
                return (p && p[e.idKey]) ? e.edit : e.create;
            }
            return this.viewTitles[viewKey] || null;
        },

        init() {
            this.contentEl = document.getElementById('app-content');
            this.titleEl   = document.getElementById('page-title');
            this.subEl     = document.getElementById('topbar-sub');

            this.bindNavigation();
            this.bindContentNavigation();
            this.bindTopbarLinks();
            this.bindGlobalSearch();
            this.bindSidebarToggle();
            this.bindCrumbs();

            // Render Lucide icons in the static chrome (sidebar, topbar) and keep
            // any dynamically-injected [data-lucide] elements rendered (cards, modals…).
            if (window.lucide) {
                window.lucide.createIcons();
                let iconTimer;
                // NOTE: createIcons() replaces every <i data-lucide> with an <svg>,
                // which is itself a DOM mutation. If the observer reacts to that, it
                // loops and keeps re-creating icon nodes — including the ones inside
                // buttons — which eats clicks (mousedown/mouseup land on a node that
                // got replaced mid-click). So we (a) skip when nothing is pending and
                // (b) disconnect while rendering so our own changes don't re-trigger us.
                const observer = new MutationObserver(() => {
                    clearTimeout(iconTimer);
                    iconTimer = setTimeout(() => {
                        if (!document.querySelector('[data-lucide]')) return;
                        observer.disconnect();
                        try { window.lucide.createIcons(); } catch (e) {}
                        observer.observe(document.body, { childList: true, subtree: true });
                    }, 80);
                });
                observer.observe(document.body, { childList: true, subtree: true });
            }

            window.addEventListener('popstate', (e) => this.onPopState(e));

            // A reload keeps history.state, so the trail (and the crumbs) survive
            // F5 on a page reached three steps deep.
            if (this.adoptState(history.state)) {
                this.enterCurrent();
                return;
            }

            // Fresh entry: one step, built from the URL (which carries the view +
            // any scalar params, e.g. clientId, so a bookmarked detail view works).
            const start = this.parseUrl() || { view: 'dashboard', params: {}, label: null };
            this.navigateTo(start.view, start.params, { root: true, replace: true });
        },

        /** Intercept sidebar link clicks and load views via fetch */
        bindNavigation() {
            document.querySelectorAll('.nav-link').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();

                    if (link.classList.contains('nav-link--disabled')) return;

                    const view = link.dataset.view;

                    if (view === this.currentView && this.trail.length <= 1) return;

                    // Route through navigateTo so the URL is kept in sync (clears
                    // any stale detail-view params like clientId from a profile).
                    // root: a sidebar entry is a destination, not a drill-down —
                    // it restarts the trail instead of extending the previous one.
                    this.navigateTo(view, {}, { root: true });
                    this.closeSidebar();
                });
            });
        },

        /** Intercept in-page links (dashboard quick actions, "Vedi tutti", etc.) */
        bindContentNavigation() {
            this.contentEl.addEventListener('click', (e) => {
                const link = e.target.closest('a[data-view]');
                if (!link || link.classList.contains('nav-link')) return;

                e.preventDefault();
                const view = link.dataset.view;
                if (!view || view === this.currentView) return;

                // Drill-down from inside a page ("Vedi tutti", quick actions):
                // extends the trail, so the crumbs show where we came from.
                this.navigateTo(view);
            });
        },

        /** Topbar quick links (messages / whatsapp / agent profile) — SPA navigation */
        bindTopbarLinks() {
            document.querySelectorAll('.topbar-link[data-view]').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    const view = link.dataset.view;
                    if (!view) return;
                    this.navigateTo(view, {}, { root: true });
                });
            });
        },

        /** Breadcrumb bar: back arrow + one clickable step per ancestor. */
        bindCrumbs() {
            document.getElementById('crumb-back')?.addEventListener('click', () => this.back());
            document.getElementById('crumbs')?.addEventListener('click', (e) => {
                const btn = e.target.closest('.crumb__link');
                if (btn) this.goToTrailIndex(Number(btn.dataset.i));
            });
        },

        /** Global topbar search — across proprietari / immobili / inquilini / lead */
        bindGlobalSearch() {
            const input = document.getElementById('global-search-input');
            const box = document.getElementById('global-search-results');
            if (!input || !box) return;
            const esc = (s) => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; };
            const self = this;
            let timer = null, flat = [], activeIdx = -1, lastQ = '';

            const close = () => { box.hidden = true; box.innerHTML = ''; activeIdx = -1; flat = []; };
            const paint = () => box.querySelectorAll('.gsr-item').forEach((b, i) => b.classList.toggle('is-active', i === activeIdx));

            // A search jump lands anywhere: it starts a new trail rather than
            // pretending the result hangs off the page we happened to be on.
            const go = (it) => { if (!it) return; close(); input.value = ''; self.navigateTo(it.view, it.params || {}, { root: true }); };

            const render = (groups) => {
                flat = [];
                if (!groups.length) { box.innerHTML = '<div class="gsr-empty">Nessun risultato.</div>'; box.hidden = false; return; }
                let html = '';
                groups.forEach(g => {
                    html += `<div class="gsr-group__label">${esc(g.label)}</div>`;
                    g.items.forEach(it => {
                        const i = flat.length; flat.push(it);
                        html += `<button type="button" class="gsr-item" data-i="${i}">
                            <span class="gsr-item__icon"><i data-lucide="${esc(g.icon)}"></i></span>
                            <span class="gsr-item__text"><span class="gsr-item__title">${esc(it.title)}</span><span class="gsr-item__sub">${esc(it.sub)}</span></span>
                        </button>`;
                    });
                });
                box.innerHTML = html;
                box.hidden = false;
                activeIdx = -1;
                if (window.lucide) window.lucide.createIcons();
                box.querySelectorAll('.gsr-item').forEach(b => b.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    go(flat[parseInt(b.dataset.i, 10)]);
                }));
            };

            const doSearch = async (q) => {
                try {
                    const res = await fetch('api/global_search.php?q=' + encodeURIComponent(q));
                    const json = await res.json();
                    if (json.success) render(json.data.groups || []);
                } catch (e) { /* fail soft */ }
            };

            input.addEventListener('input', () => {
                const q = input.value.trim();
                clearTimeout(timer);
                if (q.length < 2) { close(); return; }
                timer = setTimeout(() => { if (q !== lastQ) { lastQ = q; doSearch(q); } }, 250);
            });
            input.addEventListener('keydown', (e) => {
                if (box.hidden || !flat.length) {
                    if (e.key === 'Escape') input.blur();
                    return;
                }
                if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, flat.length - 1); paint(); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); paint(); }
                else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); go(flat[activeIdx]); }
                else if (e.key === 'Escape') { close(); }
            });
            input.addEventListener('blur', () => setTimeout(close, 150));
        },

        /** Sidebar toggle — desktop sidebar stays open permanently; mobile uses an overlay */
        bindSidebarToggle() {
            const toggle   = document.getElementById('sidebar-toggle');
            const sidebar  = document.getElementById('sidebar');
            const backdrop = document.getElementById('sidebar-backdrop');
            const closeBtn = document.getElementById('sidebar-close-btn');

            if (!toggle || !sidebar) return;

            // Desktop: the sidebar is always open. Clear any "collapsed" state saved by
            // older versions so it can never start hidden on a desktop viewport.
            document.body.classList.remove('sidebar-collapsed');
            try { localStorage.removeItem('sidebarCollapsed'); } catch(e) {}

            // The hamburger only acts on mobile (it is hidden on desktop via CSS).
            toggle.addEventListener('click', () => {
                if (window.innerWidth > 768) return;
                if (sidebar.classList.contains('open')) {
                    this.closeSidebar();
                } else {
                    this.openSidebar();
                }
            });

            if (backdrop) {
                backdrop.addEventListener('click', () => this.closeSidebar());
            }

            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.closeSidebar());
            }
        },

        openSidebar() {
            // Overlay "open" is a mobile-only concept; the desktop sidebar is always visible.
            const sidebar  = document.getElementById('sidebar');
            const backdrop = document.getElementById('sidebar-backdrop');
            if (!sidebar) return;
            if (window.innerWidth <= 768) {
                sidebar.classList.add('open');
                if (backdrop) backdrop.hidden = false;
                document.body.classList.add('nav-open');
            }
        },

        closeSidebar() {
            // Only collapses the mobile overlay. On desktop the sidebar never closes.
            const sidebar  = document.getElementById('sidebar');
            const backdrop = document.getElementById('sidebar-backdrop');
            if (sidebar) sidebar.classList.remove('open');
            if (backdrop) backdrop.hidden = true;
            document.body.classList.remove('nav-open');
        },

        setActiveNav(activeLink) {
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            activeLink.classList.add('active');
            const group = activeLink.closest('details.nav-group');
            if (group) group.open = true;
        },

        /**
         * Fetch a view partial and inject it into #app-content.
         * Executes any <script> tags found in the loaded HTML.
         */
        async loadView(url, viewKey) {
            const token = ++this._viewToken;
            this.currentView = viewKey;
            // Hide the compare bar when leaving the properties view
            if (viewKey !== 'properties') {
                const compareBar = document.getElementById('compare-float-bar');
                if (compareBar) compareBar.hidden = true;
            }
            this.showLoading();

            const pageTitle = this.resolveTitle(viewKey);
            if (this.titleEl && pageTitle) {
                this.titleEl.textContent = pageTitle;
            }

            try {
                const response = await fetch(url, {
                    headers: { 'X-App-Partial': '1' },
                });

                if (response.status === 401) {
                    window.location.href = 'login.php';
                    return;
                }

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const html = await response.text();
                if (token !== this._viewToken) return;

                this.contentEl.innerHTML = html;
                if (token !== this._viewToken) return;

                // The view's own one-line purpose description (markup source of
                // truth stays in views/*.html, kept invisible there — see
                // .view-header__text in theme-orlandi.css) replaces the topbar's
                // welcome line so every page says what it's for, not just its name.
                if (this.subEl) {
                    const desc = this.contentEl.querySelector('.view-header__text p');
                    this.subEl.textContent = desc ? desc.textContent.trim() : '';
                }

                this.injectStyles(this.contentEl);
                await this.executeScripts(this.contentEl);
                if (window.lucide) window.lucide.createIcons();
                if (window.FilterBar) {
                    FilterBar.setupIn(this.contentEl);
                }
                if (window.DatePicker) {
                    DatePicker.setupIn(this.contentEl);
                }

                // Hide write-only static controls for readonly users.
                // Dynamic card buttons are gated inside each module's renderCards().
                if (!window.canWrite) {
                    this.contentEl.querySelectorAll('[id^="btn-new-"]').forEach(el => {
                        el.hidden = true;
                    });
                }

            } catch (err) {
                this.contentEl.innerHTML = `
                    <div class="alert alert--error">
                        Impossibile caricare la vista. Verifica che il server sia attivo.
                        <br><small>${err.message}</small>
                    </div>`;
            }
        },

        showLoading() {
            this.contentEl.innerHTML = `
                <div class="loading-spinner">
                    <div class="spinner"></div>
                    <p>Caricamento...</p>
                </div>`;
        },

        /** Move stylesheet links from partials into <head> (innerHTML does not load them). */
        injectStyles(container) {
            const normalizeHref = (href) => {
                if (!href) return '';
                try {
                    return new URL(href, window.location.href).pathname;
                } catch {
                    return href.split('?')[0];
                }
            };

            container.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
                const href = link.getAttribute('href');
                if (!href) return;

                // Scope the dedupe to <head>: scanning the whole document also
                // matches this very link (the partial is already connected when
                // this runs), so every partial stylesheet looked "already there"
                // and got removed without a replacement.
                const hrefPath = normalizeHref(href);
                const already = [...document.head.querySelectorAll('link[rel="stylesheet"]')]
                    .some(l => normalizeHref(l.getAttribute('href')) === hrefPath);

                if (already) {
                    link.remove();
                } else {
                    // Move the node itself rather than cloning it: the sheet the
                    // parser already fetched stays applied, so there is no
                    // re-fetch and no flash of unstyled content on navigation.
                    document.head.appendChild(link);
                }
            });
        },

        /** Load view scripts in order (external scripts must finish before the next runs). */
        async executeScripts(container) {
            const scripts = [...container.querySelectorAll('script')];

            for (const oldScript of scripts) {
                await new Promise((resolve, reject) => {
                    const newScript = document.createElement('script');

                    // Propagate the type so ES modules (type="module") execute as
                    // modules; classic scripts have no type and are unaffected.
                    const scriptType = oldScript.getAttribute('type');
                    if (scriptType) newScript.type = scriptType;

                    if (oldScript.src) {
                        const src = oldScript.getAttribute('src');
                        const bust = src.includes('?') ? '&' : '?';
                        newScript.onload = () => resolve();
                        newScript.onerror = () => reject(new Error(`Impossibile caricare: ${src}`));
                        newScript.src = `${src}${bust}t=${Date.now()}`;
                        oldScript.parentNode.replaceChild(newScript, oldScript);
                    } else {
                        newScript.textContent = oldScript.textContent;
                        oldScript.parentNode.replaceChild(newScript, oldScript);
                        resolve();
                    }
                });
            }
        },

        /**
         * Navigate to a view programmatically (e.g. from client profile).
         *   opts.root    — a destination, not a drill-down: the trail restarts here
         *                  (sidebar, topbar links, global search).
         *   opts.replace — swap the current step instead of adding one (no new
         *                  history entry, so Back skips it).
         */
        navigateTo(viewKey, params = {}, opts = {}) {
            const entry = { view: viewKey, params: this.scalarParams(params), label: null };
            const key   = this.entryKey(entry);

            if (opts.root) {
                this.trail    = [entry];
                this.trailIdx = 0;
                this.writeHistory(opts.replace === true);
            } else {
                const seen = this.trail.findIndex(e => this.entryKey(e) === key);
                if (seen >= 0 && seen < this.trailIdx) {
                    // Walking back onto a step we already took (e.g. saving a form
                    // returns to the scheda it was opened from): rewind to it
                    // instead of stacking a second copy on top. Rewinding through
                    // the history — not pushing — is what keeps the browser's own
                    // Back button honest: after "Salva" it must leave the form
                    // behind, not step back into it.
                    this.goToTrailIndex(seen);
                    return;
                } else {
                    const cur = this.trail[this.trailIdx];
                    // An *_edit form is a step, not a place: once you leave it
                    // (saved or cancelled) it drops out of the trail, so Back from
                    // the result never lands you back inside the form.
                    const replace = opts.replace === true
                        || seen === this.trailIdx
                        || !!(cur && this.isTransient(cur.view) && cur.view !== viewKey);
                    this.trail = this.trail.slice(0, replace ? this.trailIdx : this.trailIdx + 1);
                    this.trail.push(entry);
                    this.trailIdx = this.trail.length - 1;
                    this.writeHistory(replace);
                }
            }

            this.enterCurrent();
        },

        /**
         * Step back the way the user came in — along the trail, not to a fixed
         * parent. fallbackView is used only when this is the first page opened.
         */
        back(fallbackView, fallbackParams) {
            if (this.trailIdx > 0) { this.goToTrailIndex(this.trailIdx - 1); return; }
            if (this._seq > 0) { history.back(); return; }
            if (fallbackView) this.navigateTo(fallbackView, fallbackParams || {}, { root: true });
        },

        /** Jump to an ancestor step (crumb click / back arrow). */
        goToTrailIndex(i) {
            const target = this.trail[i];
            if (!target || i === this.trailIdx) return;

            // Every pushed step owns exactly one history entry and seq counts them,
            // so the difference in seq IS the history delta. Going through history
            // keeps the browser's own Back/Forward honest instead of piling up
            // entries. If the step predates this document (no seq), re-walk it.
            const delta = (typeof target.seq === 'number' ? target.seq : NaN) - this._seq;
            if (delta < 0) {
                history.go(delta);
                // Se quella voce non è più nella cronologia della scheda, popstate
                // non arriva mai e il bottone resterebbe morto: ripercorriamo il
                // passo a mano. Il confronto evita il doppio salto quando invece
                // popstate e' arrivato.
                // _seq invariato = nessun popstate e nessuna altra navigazione:
                // solo allora rifacciamo il passo a mano.
                const at = this._seq;
                setTimeout(() => { if (this._seq === at) this.walkToTrailIndex(i); }, 400);
                return;
            }

            this.walkToTrailIndex(i);
        },

        /** Rewind the trail to step i without leaning on the history stack. */
        walkToTrailIndex(i) {
            if (!this.trail[i]) return;
            this.trail    = this.trail.slice(0, i + 1);
            this.trailIdx = i;
            this.writeHistory(false);
            this.enterCurrent();
        },

        /** Load whatever step the trail currently points at. */
        enterCurrent() {
            const entry = this.trail[this.trailIdx];
            if (!entry) return;
            this.viewParams = entry.params || {};
            this.renderCrumbs();
            const link = document.querySelector(`.nav-link[data-view="${entry.view}"]`);
            if (link) this.setActiveNav(link);
            this.loadView(this.hrefFor(entry.view, entry.params), entry.view);
        },

        onPopState(e) {
            if (this.adoptState(e.state)) { this.enterCurrent(); return; }
            // An entry we never wrote (the document's first one, or a foreign
            // page): rebuild a one-step trail out of the URL.
            const parsed = this.parseUrl();
            if (!parsed) return;
            this.trail    = [parsed];
            this.trailIdx = 0;
            this._seq     = 0;
            this.enterCurrent();
        },

        adoptState(st) {
            if (!st || st.app !== 'gi' || !Array.isArray(st.trail) || !st.trail[st.idx]) return false;
            this.trail    = st.trail;
            this.trailIdx = st.idx;
            this._seq     = st.seq || 0;
            return true;
        },

        /** Write the current step into the history entry + the URL. */
        writeHistory(replace) {
            const entry = this.trail[this.trailIdx];
            if (!entry) return;
            if (!replace) this._seq += 1;
            entry.seq = this._seq;
            const state = { app: 'gi', trail: this.trail, idx: this.trailIdx, seq: this._seq };
            try {
                history[replace ? 'replaceState' : 'pushState'](state, '', this.urlFor(entry.view, entry.params));
            } catch (e) { /* history API unavailable — non-fatal */ }
        },

        parseUrl() {
            const sp   = new URLSearchParams(window.location.search);
            const view = sp.get('view');
            if (!view || !this.viewTitles[view]) return null;
            const params = {};
            for (const [k, v] of sp.entries()) {
                if (k === 'view') continue;
                params[k] = /^-?\d+$/.test(v) ? Number(v) : v;
            }
            return { view, params, label: null };
        },

        hrefFor(view, params) {
            const link = document.querySelector(`.nav-link[data-view="${view}"]`);
            const base = link ? link.getAttribute('href') : `view.php?name=${encodeURIComponent(view)}`;
            // entity_edit is one route serving many entities, and view.php gates
            // it by the entity's own list-view permission — so the partial fetch
            // has to carry `entity`, which otherwise lives only in viewParams.
            if (view === 'entity_edit' && params && params.entity) {
                return `${base}${base.includes('?') ? '&' : '?'}entity=${encodeURIComponent(params.entity)}`;
            }
            return base;
        },

        /** Views that are a step in a task, not a place you navigate back to. */
        isTransient(view) { return /_edit$/.test(String(view || '')); },

        scalarParams(params) {
            const out = {};
            Object.entries(params || {}).forEach(([k, v]) => {
                if (v !== null && v !== undefined && typeof v !== 'object') out[k] = v;
            });
            return out;
        },

        /** Identity of a step: same view + same params = same page. */
        entryKey(entry) {
            const p = entry.params || {};
            return entry.view + '|' + Object.keys(p).sort().map(k => k + '=' + p[k]).join('&');
        },

        crumbLabel(entry) {
            return entry.label || this.resolveTitle(entry.view, entry.params) || entry.view;
        },

        renderCrumbs() {
            const bar  = document.getElementById('crumbbar');
            const list = document.getElementById('crumbs');
            if (!bar || !list) return;

            // A single step is not a path — no bar on a plain list page.
            if (this.trail.length < 2) {
                bar.hidden = true;
                list.innerHTML = '';
                return;
            }

            const esc = (s) => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; };
            list.innerHTML = this.trail.map((e, i) => {
                const label = esc(this.crumbLabel(e));
                return i === this.trailIdx
                    ? `<li class="crumb crumb--current" aria-current="page">${label}</li>`
                    : `<li class="crumb"><button type="button" class="crumb__link" data-i="${i}">${label}</button></li>`;
            }).join('');
            bar.hidden = false;
            // La lista scorre su una riga sola: la pagina corrente sta in fondo,
            // quindi va tenuta in vista quando il percorso è più largo della barra.
            list.scrollLeft = list.scrollWidth;
        },

        /**
         * Name the current step after the record it shows ("Mario Rossi" instead of
         * "Scheda Cliente"). Detail views call this once the record has loaded; the
         * label lives in the history entry, so it survives Back and a reload.
         */
        setCrumb(label) {
            const entry = this.trail[this.trailIdx];
            if (!entry) return;
            const text = String(label ?? '').trim();
            entry.label = text || null;
            this.renderCrumbs();
            try {
                history.replaceState(
                    { app: 'gi', trail: this.trail, idx: this.trailIdx, seq: this._seq },
                    '',
                    this.urlFor(entry.view, entry.params)
                );
            } catch (e) { /* non-fatal */ }
        },

        /**
         * Reflect the current view + its scalar params in the URL query string.
         * Detail views keep their id in memory only (App.viewParams); without
         * this, reloading or bookmarking e.g. a client profile loses the
         * clientId and the view errors with "ID proprietario non specificato".
         * Mirrored by parseUrl(), which reads these params back on load.
         */
        urlFor(view, params) {
            const qs = new URLSearchParams({ view });
            Object.entries(params || {}).forEach(([k, v]) => qs.set(k, String(v)));
            return 'index.php?' + qs.toString();
        },

    };

    document.addEventListener('DOMContentLoaded', () => App.init());

    // Expose App globally so view scripts can call back into the router
    window.App = App;
})();

/**
 * softLoad(el, spinnerHtml)
 * On first load (empty container): shows the spinner as usual.
 * On subsequent loads (filter/search): dims existing content instead of wiping it.
 * Call el.classList.remove('is-loading') after rendering the new content.
 */
window.softLoad = function (el, spinnerHtml) {
    if (!el) return;
    const isEmpty = !el.firstElementChild
        || !!el.querySelector('.entity-loading, .table-empty, [class*="entity-loading"]');
    if (isEmpty) {
        el.innerHTML = spinnerHtml;
    } else {
        el.classList.add('is-loading');
    }
};
