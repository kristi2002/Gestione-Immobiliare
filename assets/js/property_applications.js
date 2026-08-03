(function () {
    'use strict';

    const API = 'api/property_applications.php';

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
    function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

    const STATUS_LABELS = { new: 'Nuova', contacted: 'Contattato', approved: 'Approvato', rejected: 'Rifiutato' };
    const STATUS_COLORS = {
        new:       'var(--color-primary,#3b82f6)',
        contacted: 'var(--color-warning,#e67e22)',
        approved:  'var(--color-success,#27ae60)',
        rejected:  'var(--color-danger,#c0392b)',
    };

    let currentPage   = 1;
    const PAGE_LIMIT  = 25;
    let activeItem    = null;
    const els         = {};

    // Read ?property_id= and ?status= from URL params on load
    const urlParams = new URLSearchParams(window.location.search);

    function init() {
        els.alert       = document.getElementById('property-applications-alert');
        els.tbody       = document.getElementById('pa-tbody');
        els.pagination  = document.getElementById('pa-pagination');
        els.statusFilter = document.getElementById('pa-status-filter');
        els.typeFilter  = document.getElementById('pa-type-filter');
        els.search      = document.getElementById('pa-search');
        els.detailModal = document.getElementById('pa-detail-modal');

        // Pre-fill filters from URL
        if (urlParams.get('status'))      els.statusFilter.value = urlParams.get('status');

        bindEvents();
        bindRowMenu();
        loadApplications();
    }

    function bindEvents() {
        document.getElementById('btn-pa-refresh').addEventListener('click', () => loadApplications());
        document.getElementById('btn-pa-new').addEventListener('click', () => openForm());
        els.statusFilter.addEventListener('change', () => { currentPage = 1; loadApplications(); });
        els.typeFilter.addEventListener('change', () => { currentPage = 1; loadApplications(); });
        els.search.addEventListener('input', debounce(() => { currentPage = 1; loadApplications(); }, 300));

        document.getElementById('pa-detail-close').addEventListener('click', closeDetail);
        document.getElementById('pa-detail-cancel').addEventListener('click', closeDetail);
        els.detailModal.addEventListener('click', e => { if (e.target === els.detailModal) closeDetail(); });

        document.getElementById('pa-detail-save-status').addEventListener('click', saveStatus);
        document.getElementById('pa-detail-convert-lead').addEventListener('click', convertToLead);
    }

    /**
     * La candidatura si registra su una pagina (entity_edit), non piu' in una
     * finestra: ha un suo indirizzo, entra nelle briciole di pane e il tasto
     * Indietro del browser ci torna sopra. L'elenco degli immobili non lo carica
     * piu' questo file — se ne occupa lib/lookups.js, che pagina oltre il
     * centesimo record invece di fermarsi li'. Il modulo e' descritto in
     * assets/js/entity_edit/schemas/applications.js.
     *
     * Se stiamo guardando le richieste di un solo immobile, quello e' anche
     * l'immobile della richiesta nuova: arriva al modulo gia' compilato.
     */
    function openForm() {
        if (!window.App) return;
        const params = { entity: 'applications' };
        const propId = urlParams.get('property_id');
        if (propId) params.property_id = propId;
        window.App.navigateTo('entity_edit', params);
    }

    async function loadApplications() {
        const params = new URLSearchParams();
        const search = els.search.value.trim();
        const status = els.statusFilter.value;
        const type   = els.typeFilter.value;
        const propId = urlParams.get('property_id');

        if (search)  params.set('search', search);
        if (status)  params.set('status', status);
        if (type)    params.set('type', type);
        if (propId)  params.set('property_id', propId);
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);

        softLoad(els.tbody, '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:2rem;">Caricamento…</td></tr>');

        try {
            const res  = await fetch(`${API}?${params}`);

            // Graceful degradation if API doesn't exist yet
            if (res.status === 404) {
                els.tbody.classList.remove('is-loading');
                els.tbody.innerHTML = '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:2rem;">API non ancora disponibile. Nessuna richiesta da mostrare.</td></tr>';
                return;
            }

            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Errore sconosciuto');

            const parsed = window.Pagination.parseResponse(json);
            renderRows(parsed.items);
            window.Pagination.render(els.pagination, parsed, p => { currentPage = p; loadApplications(); });
        } catch (err) {
            // Show friendly error — API may not exist yet
            els.tbody.classList.remove('is-loading');
            els.tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--color-danger);padding:2rem;">${esc(err.message)}</td></tr>`;
            showAlert('Impossibile caricare le richieste: ' + err.message, 'error');
        }
    }

    function renderRows(items) {
        els.tbody.classList.remove('is-loading');
        if (!items.length) {
            els.tbody.innerHTML = '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:2rem;">Nessuna richiesta trovata.</td></tr>';
            return;
        }

        els.tbody.innerHTML = items.map(a => {
            const statusLabel = STATUS_LABELS[a.status] || a.status || '—';
            const statusColor = STATUS_COLORS[a.status] || '#333';
            const propLabel   = a.property_address || a.property_title || `#${a.property_id}`;
            const applicant   = a.applicant_name || `${a.first_name || ''} ${a.last_name || ''}`.trim() || a.name || '—';

            return `<tr>
                <td data-label="Immobile">${esc(propLabel)}</td>
                <td data-label="Richiedente"><strong>${esc(applicant)}</strong></td>
                <td data-label="Email">${a.applicant_email ? `<a href="mailto:${esc(a.applicant_email)}">${esc(a.applicant_email)}</a>` : '—'}</td>
                <td data-label="Telefono">${esc(a.applicant_phone || '—')}</td>
                <td data-label="Tipo"><span class="badge">${esc(a.application_type || a.type || '—')}</span></td>
                <td data-label="Data">${formatDate(a.created_at || a.submitted_at)}</td>
                <td data-label="Stato"><span style="color:${statusColor};font-weight:600;">${esc(statusLabel)}</span></td>
                <td data-label="Azioni" class="col-actions lt-actions">
                    <button class="btn btn--sm btn--ghost btn-rail" data-id="${a.id}" title="Azioni" aria-label="Azioni richiesta" aria-haspopup="menu"><i data-lucide="more-vertical"></i></button>
                </td>
            </tr>`;
        }).join('');

        // Store items for detail lookup
        els.tbody._items = items;

        els.tbody.querySelectorAll('.btn-rail').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const item = (els.tbody._items || []).find(a => String(a.id) === String(btn.dataset.id));
                if (item) openRowMenu(btn, item);
            });
        });

        if (window.lucide) window.lucide.createIcons();
    }

    // ── Menu di riga (Dettagli / Converti in Lead / Elimina) ──────────
    // Stesso comportamento di Inquilini, Edifici e Proprietari: il menu vive
    // in <body> con posizione fissa, quindi non lo taglia l'overflow della
    // tabella; qualsiasi scroll o resize lo chiude invece di lasciarlo
    // orfano lontano dal suo pulsante.

    let rowMenuEl = null;

    function bindRowMenu() {
        const gone = () => !document.body.contains(els.tbody);
        function cleanup() {
            closeRowMenu();
            document.removeEventListener('click', onDocClick);
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('scroll', onAnyMove, true);
            window.removeEventListener('resize', onAnyMove);
        }
        function onDocClick(e) {
            if (gone()) { cleanup(); return; }
            if (rowMenuEl && !rowMenuEl.contains(e.target)) closeRowMenu();
        }
        function onKey(e) {
            if (gone()) { cleanup(); return; }
            if (e.key === 'Escape') closeRowMenu();
        }
        function onAnyMove() {
            if (gone()) { cleanup(); return; }
            closeRowMenu();
        }
        document.addEventListener('click', onDocClick);
        document.addEventListener('keydown', onKey);
        window.addEventListener('scroll', onAnyMove, true);
        window.addEventListener('resize', onAnyMove);
    }

    function closeRowMenu() {
        if (rowMenuEl) { rowMenuEl.remove(); rowMenuEl = null; }
    }

    function openRowMenu(btn, item) {
        if (rowMenuEl && String(rowMenuEl.dataset.id) === String(item.id)) { closeRowMenu(); return; }
        closeRowMenu();

        // Una richiesta già convertita non si riconverte (il server risponde
        // 409): meglio dirlo qui che farlo scoprire con un errore.
        const converted = !!item.converted_to_lead_id;

        const menu = document.createElement('div');
        menu.className = 'lt-menu';
        menu.dataset.id = item.id;
        menu.setAttribute('role', 'menu');
        menu.innerHTML = `
            <button type="button" class="lt-menu__item" data-act="view" role="menuitem">
                <i data-lucide="eye"></i> Dettagli
            </button>
            <button type="button" class="lt-menu__item" data-act="lead" role="menuitem" ${converted ? `disabled title="Già convertita (lead #${esc(item.converted_to_lead_id)})"` : ''}>
                <i data-lucide="user-plus"></i> ${converted ? 'Già convertita in Lead' : 'Converti in Lead'}
            </button>
            <div class="lt-menu__sep"></div>
            <button type="button" class="lt-menu__item lt-menu__item--danger" data-act="del" role="menuitem">
                <i data-lucide="trash-2"></i> Elimina
            </button>`;
        document.body.appendChild(menu);

        const r  = btn.getBoundingClientRect();
        const mw = menu.offsetWidth;
        const mh = menu.offsetHeight;
        const left = Math.min(r.right - mw, window.innerWidth - mw - 8);
        let   top  = r.bottom + 6;
        if (top + mh > window.innerHeight - 8) top = r.top - mh - 6;
        menu.style.left = Math.max(8, left) + 'px';
        menu.style.top  = Math.max(8, top) + 'px';

        menu.querySelector('[data-act="view"]').addEventListener('click', () => {
            closeRowMenu();
            openDetail(item);
        });

        const leadBtn = menu.querySelector('[data-act="lead"]');
        if (!leadBtn.disabled) {
            leadBtn.addEventListener('click', async () => {
                closeRowMenu();
                activeItem = item;
                await convertToLead();
            });
        }

        menu.querySelector('[data-act="del"]').addEventListener('click', async () => {
            closeRowMenu();
            const who = item.applicant_name || item.name || ('#' + item.id);
            if (!await confirmDialog(`Eliminare la richiesta di ${who}? L'operazione è irreversibile.`, { title: 'Elimina richiesta', confirmText: 'Elimina' })) return;
            try {
                const res  = await fetch(`${API}?id=${item.id}`, { method: 'DELETE' });
                const json = await res.json();
                if (!json.success) throw new Error(json.error || 'Errore');
                showAlert('Richiesta eliminata.', 'success');
                loadApplications();
            } catch (err) {
                showAlert('Errore eliminazione: ' + err.message, 'error');
            }
        });

        if (window.lucide) window.lucide.createIcons();
        rowMenuEl = menu;
    }

    function openDetail(item) {
        activeItem = item;
        const applicant = item.applicant_name || `${item.first_name || ''} ${item.last_name || ''}`.trim() || item.name || '—';
        document.getElementById('pa-detail-title').textContent = `Richiesta di ${applicant}`;
        document.getElementById('pa-detail-status-select').value = item.status || 'new';

        const propLabel = item.property_address || item.property_title || `#${item.property_id}`;

        document.getElementById('pa-detail-body').innerHTML = `
            <div class="form-row form-row--2" style="margin-bottom:1rem;">
                <div>
                    <p class="text-muted" style="margin:0 0 2px;font-size:0.8rem;">RICHIEDENTE</p>
                    <p style="margin:0;font-weight:600;">${esc(applicant)}</p>
                </div>
                <div>
                    <p class="text-muted" style="margin:0 0 2px;font-size:0.8rem;">IMMOBILE</p>
                    <p style="margin:0;font-weight:600;">${esc(propLabel)}</p>
                </div>
            </div>
            <div class="form-row form-row--2" style="margin-bottom:1rem;">
                <div>
                    <p class="text-muted" style="margin:0 0 2px;font-size:0.8rem;">EMAIL</p>
                    <p style="margin:0;">${item.applicant_email ? `<a href="mailto:${esc(item.applicant_email)}">${esc(item.applicant_email)}</a>` : '—'}</p>
                </div>
                <div>
                    <p class="text-muted" style="margin:0 0 2px;font-size:0.8rem;">TELEFONO</p>
                    <p style="margin:0;">${esc(item.applicant_phone || '—')}</p>
                </div>
            </div>
            <div class="form-row form-row--2" style="margin-bottom:1rem;">
                <div>
                    <p class="text-muted" style="margin:0 0 2px;font-size:0.8rem;">TIPO</p>
                    <p style="margin:0;"><span class="badge">${esc(item.application_type || item.type || '—')}</span></p>
                </div>
                <div>
                    <p class="text-muted" style="margin:0 0 2px;font-size:0.8rem;">DATA</p>
                    <p style="margin:0;">${formatDate(item.created_at || item.submitted_at)}</p>
                </div>
            </div>
            ${item.budget ? `
            <div style="margin-bottom:1rem;">
                <p class="text-muted" style="margin:0 0 2px;font-size:0.8rem;">BUDGET</p>
                <p style="margin:0;">${esc(item.budget)}</p>
            </div>` : ''}
            ${item.message || item.notes ? `
            <div style="margin-bottom:1rem;">
                <p class="text-muted" style="margin:0 0 2px;font-size:0.8rem;">MESSAGGIO</p>
                <p style="margin:0;background:var(--color-surface-alt,#f8f9fa);padding:0.75rem;border-radius:6px;">${esc(item.message || item.notes)}</p>
            </div>` : ''}
        `;

        const convertBtn = document.getElementById('pa-detail-convert-lead');
        if (convertBtn) {
            convertBtn.disabled = !!item.converted_to_lead_id;
            convertBtn.textContent = item.converted_to_lead_id
                ? `Già convertito (lead #${item.converted_to_lead_id})`
                : 'Converti in Lead';
        }

        els.detailModal.hidden = false;
    }

    function closeDetail() {
        els.detailModal.hidden = true;
        activeItem = null;
    }

    async function saveStatus() {
        if (!activeItem) return;
        const newStatus = document.getElementById('pa-detail-status-select').value;
        const btn = document.getElementById('pa-detail-save-status');
        btn.disabled = true; btn.textContent = 'Salvataggio…';

        try {
            const res  = await fetch(`${API}?id=${activeItem.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });

            if (res.status === 404) throw new Error('API non ancora disponibile');
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            activeItem.status = newStatus;
            showAlert('Stato aggiornato.', 'success');
            closeDetail();
            loadApplications();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Salva stato';
        }
    }

    async function convertToLead() {
        if (!activeItem) return;
        if (activeItem.converted_to_lead_id) {
            showAlert('Richiesta già convertita in lead.', 'error');
            return;
        }
        const btn = document.getElementById('pa-detail-convert-lead');
        if (btn) { btn.disabled = true; btn.textContent = 'Conversione…'; }

        try {
            // Use the server's own convert_lead action — it derives interest_type
            // from application_type, carries the property in the lead notes (leads
            // has no property_id column), and is transactional + idempotent
            // (409s if already converted). Do not rebuild this logic client-side.
            const res  = await fetch(`${API}?action=convert_lead&id=${activeItem.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            showAlert('Richiesta convertita in lead con successo.', 'success');
            closeDetail();
            if (window.App) window.App.navigateTo('leads');
        } catch (err) {
            showAlert('Errore conversione in lead: ' + err.message, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Converti in Lead'; }
        }
    }

    function showAlert(msg, type) {
        els.alert.textContent   = msg;
        els.alert.className     = `alert alert--${type}`;
        els.alert.style.display = 'block';
        clearTimeout(els.alert._t);
        els.alert._t = setTimeout(() => { els.alert.style.display = 'none'; }, 5000);
    }

    function formatDate(str) { return window.Fmt.date(str); }

    init();
})();
