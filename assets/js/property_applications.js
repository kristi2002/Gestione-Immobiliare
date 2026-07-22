(function () {
    'use strict';

    const API        = 'api/property_applications.php';
    const LEADS_API  = 'api/leads.php';
    const PROPS_API  = 'api/properties.php';

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
        els.newModal    = document.getElementById('pa-new-modal');
        els.newForm     = document.getElementById('pa-new-form');

        // Pre-fill filters from URL
        if (urlParams.get('status'))      els.statusFilter.value = urlParams.get('status');

        bindEvents();
        loadProperties();
        loadApplications();
    }

    function bindEvents() {
        document.getElementById('btn-pa-refresh').addEventListener('click', () => loadApplications());
        document.getElementById('btn-pa-new').addEventListener('click', openNewModal);
        els.statusFilter.addEventListener('change', () => { currentPage = 1; loadApplications(); });
        els.typeFilter.addEventListener('change', () => { currentPage = 1; loadApplications(); });
        els.search.addEventListener('input', debounce(() => { currentPage = 1; loadApplications(); }, 300));

        document.getElementById('pa-detail-close').addEventListener('click', closeDetail);
        document.getElementById('pa-detail-cancel').addEventListener('click', closeDetail);
        els.detailModal.addEventListener('click', e => { if (e.target === els.detailModal) closeDetail(); });

        document.getElementById('pa-detail-save-status').addEventListener('click', saveStatus);
        document.getElementById('pa-detail-convert-lead').addEventListener('click', convertToLead);

        document.getElementById('pa-new-close').addEventListener('click', closeNewModal);
        document.getElementById('pa-new-cancel').addEventListener('click', closeNewModal);
        els.newModal.addEventListener('click', e => { if (e.target === els.newModal) closeNewModal(); });
        els.newForm.addEventListener('submit', handleNewSubmit);
    }

    async function loadProperties() {
        try {
            const items = await window.Pagination.fetchList(PROPS_API);
            const sel = document.getElementById('pa-new-property');
            items.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = `${p.address}, ${p.city}`;
                sel.appendChild(opt);
            });
        } catch (_) { /* non-critical */ }
    }

    function openNewModal() {
        els.newForm.reset();
        els.newModal.hidden = false;
        document.getElementById('pa-new-name').focus();
    }

    function closeNewModal() {
        els.newModal.hidden = true;
    }

    async function handleNewSubmit(e) {
        e.preventDefault();
        const btn = document.getElementById('pa-new-save');
        btn.disabled = true; btn.textContent = 'Salvataggio…';

        const data = {
            property_id:      document.getElementById('pa-new-property').value,
            applicant_name:   document.getElementById('pa-new-name').value.trim(),
            applicant_email:  document.getElementById('pa-new-email').value.trim(),
            applicant_phone:  document.getElementById('pa-new-phone').value.trim(),
            application_type: document.getElementById('pa-new-type').value,
            message:          document.getElementById('pa-new-message').value.trim(),
        };

        try {
            const res  = await fetch(API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeNewModal();
            showAlert('Richiesta creata con successo.', 'success');
            loadApplications();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Salva richiesta';
        }
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
                <td data-label="Azioni" class="col-actions" style="white-space:nowrap;">
                    <button class="btn btn--sm btn--ghost btn-pa-view" data-id="${a.id}" title="Visualizza"><i data-lucide="eye"></i> Dettagli</button>
                    <button class="btn btn--sm btn--ghost btn-pa-lead" data-id="${a.id}" title="Converti in lead" style="color:var(--color-primary,#3b82f6);">→ Lead</button>
                    <button class="btn btn--sm btn--ghost btn-pa-del" data-id="${a.id}" title="Elimina" style="color:var(--color-danger,#dc2626);"><i data-lucide="trash-2"></i></button>
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
            btn.addEventListener('click', async () => {
                const item = (els.tbody._items || []).find(a => String(a.id) === String(btn.dataset.id));
                if (!item) return;
                activeItem = item;
                btn.disabled = true; btn.textContent = '…';
                await convertToLead();
                btn.disabled = false; btn.textContent = '→ Lead';
            });
        });

        els.tbody.querySelectorAll('.btn-pa-del').forEach(btn => {
            btn.addEventListener('click', async () => {
                const item = (els.tbody._items || []).find(a => String(a.id) === String(btn.dataset.id));
                const who  = item ? (item.applicant_name || item.name || ('#' + item.id)) : ('#' + btn.dataset.id);
                if (!await confirmDialog(`Eliminare la richiesta di ${who}? L'operazione è irreversibile.`, { title: 'Elimina richiesta', confirmText: 'Elimina' })) return;
                try {
                    const res  = await fetch(`${API}?id=${btn.dataset.id}`, { method: 'DELETE' });
                    const json = await res.json();
                    if (!json.success) throw new Error(json.error || 'Errore');
                    showAlert('Richiesta eliminata.', 'success');
                    loadApplications();
                } catch (err) {
                    showAlert('Errore eliminazione: ' + err.message, 'error');
                }
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
                    source:      'web',
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
