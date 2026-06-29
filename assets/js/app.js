/**
 * Gestionale Immobiliare — AJAX Router & App Bootstrap
 */

(function () {
    'use strict';

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
        currentView: null,
        viewParams: {},
        _viewToken: 0,

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
            appointments:   'Visite',
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
            client_edit:           'Modifica Proprietario',
            property_edit:         'Modifica Immobile',
            automations:           'Automazioni Clienti',
            buildings:             'Edifici',
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
        },

        init() {
            this.contentEl = document.getElementById('app-content');
            this.titleEl   = document.getElementById('page-title');

            this.bindNavigation();
            this.bindContentNavigation();
            this.bindSidebarToggle();

            // Render Lucide icons in the static chrome (sidebar, topbar).
            if (window.lucide) window.lucide.createIcons();

            const startView = new URLSearchParams(window.location.search).get('view');
            if (startView && this.viewTitles[startView]) {
                this.navigateTo(startView);
            } else {
                this.loadView('view.php?name=dashboard', 'dashboard');
            }
        },

        /** Intercept sidebar link clicks and load views via fetch */
        bindNavigation() {
            document.querySelectorAll('.nav-link').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();

                    const href  = link.getAttribute('href');
                    const view  = link.dataset.view;

                    if (view === this.currentView) return;

                    this.setActiveNav(link);
                    this.loadView(href, view);
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

                const navLink = document.querySelector(`.nav-link[data-view="${view}"]`);
                if (navLink) this.setActiveNav(navLink);
                this.loadView(link.getAttribute('href'), view);
            });
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

            if (this.titleEl && this.viewTitles[viewKey]) {
                this.titleEl.textContent = this.viewTitles[viewKey];
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
                this.injectStyles(this.contentEl);
                await this.executeScripts(this.contentEl);
                if (window.lucide) window.lucide.createIcons();
                if (window.FilterBar) {
                    FilterBar.setupIn(this.contentEl);
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

                const hrefPath = normalizeHref(href);
                const already = [...document.querySelectorAll('link[rel="stylesheet"]')]
                    .some(l => normalizeHref(l.getAttribute('href')) === hrefPath);

                if (!already) {
                    const el = document.createElement('link');
                    el.rel = 'stylesheet';
                    const bust = href.includes('?') ? '&' : '?';
                    el.href = `${href}${bust}v=${Date.now()}`;
                    if (link.crossOrigin) el.crossOrigin = link.crossOrigin;
                    document.head.appendChild(el);
                }
                link.remove();
            });
        },

        /** Load view scripts in order (external scripts must finish before the next runs). */
        async executeScripts(container) {
            const scripts = [...container.querySelectorAll('script')];

            for (const oldScript of scripts) {
                await new Promise((resolve, reject) => {
                    const newScript = document.createElement('script');

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

        /** Navigate to a view programmatically (e.g. from client profile) */
        navigateTo(viewKey, params = {}) {
            this.viewParams = params;
            const link = document.querySelector(`.nav-link[data-view="${viewKey}"]`);
            const href = link
                ? link.getAttribute('href')
                : `view.php?name=${encodeURIComponent(viewKey)}`;

            if (link && viewKey !== this.currentView) {
                this.setActiveNav(link);
            }
            this.loadView(href, viewKey);
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
