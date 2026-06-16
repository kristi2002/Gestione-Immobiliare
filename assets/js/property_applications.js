(function () {
    'use strict';

    const API      = 'api/property_applications.php';
    const LEADS_API = 'api/leads.php';

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
        loadApplications();
    }

    function bindEvents() {
        document.getElementById('btn-pa-refresh').addEventListener('click', () => loadApplications());
        els.statusFilter.addEventListener('change', () => { currentPage = 1; loadApplications(); });
        els.typeFilter.addEventListener('change', () => { currentPage = 1; loadApplications(); });
        els.search.addEventListener('input', debounce(() => { currentPage = 1; loadApplications(); }, 300));

        document.getElementById('pa-detail-close').addEventListener('click', closeDetail);
        document.getElementById('pa-detail-cancel').addEventListener('click', closeDetail);
        els.detailModal.addEventListener('click', e => { if (e.target === els.detailModal) closeDetail(); });

        document.getElementById('pa-detail-save-status').addEventListener('click', saveStatus);
        document.getElementById('pa-detail-convert-lead').addEventListener('click', convertToLead);
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

        els.tbody.innerHTML = '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:2rem;">Caricamento…</td></tr>';

        try {
            const res  = await fetch(`${API}?${params}`);

            // Graceful degradation if API doesn't exist yet
            if (res.status === 404) {
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
            els.tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--color-danger);padding:2rem;">${esc(err.message)}</td></tr>`;
            showAlert('Impossibile caricare le richieste: ' + err.message, 'error');
        }
    }

    function renderRows(items) {
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
                <td>${esc(propLabel)}</td>
                <td><strong>${esc(applicant)}</strong></td>
                <td>${a.applicant_email ? `<a href="mailto:${esc(a.applicant_email)}">${esc(a.applicant_email)}</a>` : '—'}</td>
                <td>${esc(a.applicant_phone || '—')}</td>
                <td><span class="badge">${esc(a.application_type || a.type || '—')}</span></td>
                <td>${formatDate(a.created_at || a.submitted_at)}</td>
                <td><span style="color:${statusColor};font-weight:600;">${esc(statusLabel)}</span></td>
                <td style="white-space:nowrap;">
                    <button class="btn btn--sm btn--ghost btn-pa-view" data-id="${a.id}" title="Visualizza">👁️ Dettagli</button>
                    <button class="btn btn--sm btn--ghost btn-pa-lead" data-id="${a.id}" title="Converti in lead" style="color:var(--color-primary,#3b82f6);">→ Lead</button>
                </td>
            </tr>`;
        }).join('');

        // Store items for detail lookup
        els.tbody._items = items;

        els.tbody.querySelectorAll('.btn-pa-view').forEach(btn => {
            btn.addEventListener('click', () => {
                const item = (els.tbody._items || []).find(a => String(a.id) === String(btn.dataset.id));
                if (item) openDetail(item);
            });
        });

        els.tbody.querySelectorAll('.btn-pa-lead').forEach(btn => {
            btn.addEventListener('click', () => {
                const item = (els.tbody._items || []).find(a => String(a.id) === String(btn.dataset.id));
                if (item) { activeItem = item; convertToLead(); }
            });
        });
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
        const btn = document.getElementById('pa-detail-convert-lead');
        if (btn) { btn.disabled = true; btn.textContent = 'Conversione…'; }

        const applicant = activeItem.applicant_name || `${activeItem.first_name || ''} ${activeItem.last_name || ''}`.trim() || activeItem.name || '';
        const nameParts = applicant.trim().split(/\s+/);
        const firstName = nameParts[0] || applicant;
        const lastName  = nameParts.slice(1).join(' ') || '-';

        try {
            const res  = await fetch(LEADS_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name:        firstName,
                    surname:     lastName,
                    email:       activeItem.applicant_email || '',
                    phone:       activeItem.applicant_phone || '',
                    property_id: activeItem.property_id || null,
                    source:      'application',
                    notes:       `Convertito da richiesta #${activeItem.id}`,
                }),
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

    function formatDate(str) {
        if (!str) return '—';
        return new Date(str).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    init();
})();
