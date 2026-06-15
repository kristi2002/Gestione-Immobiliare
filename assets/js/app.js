/**
 * Gestionale Immobiliare — AJAX Router & App Bootstrap
 */

(function () {
    'use strict';

    const originalFetch = window.fetch.bind(window);
    window.fetch = async function (url, options) {
        const response = await originalFetch(url, options);
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

        /** Human-readable titles for each view */
        viewTitles: {
            dashboard:      'Dashboard',
            clients:        'Proprietari',
            properties:     'Immobili',
            documents:      'Documenti',
            communications: 'Comunicazioni',
            reminders:      'Promemoria',
            social:         'Social Media',
            tenants:        'Inquilini',
            settings:       'Impostazioni',
        },

        init() {
            this.contentEl = document.getElementById('app-content');
            this.titleEl   = document.getElementById('page-title');

            this.bindNavigation();
            this.bindSidebarToggle();

            // Load dashboard on startup
            this.loadView('view.php?name=dashboard', 'dashboard');
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

        /** Mobile sidebar toggle + backdrop */
        bindSidebarToggle() {
            const toggle   = document.getElementById('sidebar-toggle');
            const sidebar  = document.getElementById('sidebar');
            const backdrop = document.getElementById('sidebar-backdrop');

            if (!toggle || !sidebar) return;

            toggle.addEventListener('click', () => {
                if (sidebar.classList.contains('open')) {
                    this.closeSidebar();
                } else {
                    sidebar.classList.add('open');
                    if (backdrop) backdrop.hidden = false;
                    document.body.classList.add('nav-open');
                }
            });

            if (backdrop) {
                backdrop.addEventListener('click', () => this.closeSidebar());
            }
        },

        closeSidebar() {
            const sidebar  = document.getElementById('sidebar');
            const backdrop = document.getElementById('sidebar-backdrop');
            if (sidebar) sidebar.classList.remove('open');
            if (backdrop) backdrop.hidden = true;
            document.body.classList.remove('nav-open');
        },

        setActiveNav(activeLink) {
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            activeLink.classList.add('active');
        },

        /**
         * Fetch a view partial and inject it into #app-content.
         * Executes any <script> tags found in the loaded HTML.
         */
        async loadView(url, viewKey) {
            this.currentView = viewKey;
            this.showLoading();

            if (this.titleEl && this.viewTitles[viewKey]) {
                this.titleEl.textContent = this.viewTitles[viewKey];
            }

            try {
                const response = await fetch(url);

                if (response.status === 401) {
                    window.location.href = 'login.php';
                    return;
                }

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const html = await response.text();
                this.contentEl.innerHTML = html;
                this.executeScripts(this.contentEl);

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

        /** Re-run inline scripts injected via innerHTML */
        executeScripts(container) {
            container.querySelectorAll('script').forEach(oldScript => {
                const newScript = document.createElement('script');
                if (oldScript.src) {
                    newScript.src = oldScript.src;
                } else {
                    newScript.textContent = oldScript.textContent;
                }
                oldScript.parentNode.replaceChild(newScript, oldScript);
            });
        },

        /** Navigate to a view programmatically (e.g. from client profile) */
        navigateTo(viewKey, params = {}) {
            this.viewParams = params;
            const link = document.querySelector(`.nav-link[data-view="${viewKey}"]`);
            if (!link) return;

            if (viewKey !== this.currentView) {
                this.setActiveNav(link);
            }
            this.loadView(link.getAttribute('href'), viewKey);
        },
    };

    document.addEventListener('DOMContentLoaded', () => App.init());

    // Expose App globally so view scripts can call back into the router
    window.App = App;
})();
