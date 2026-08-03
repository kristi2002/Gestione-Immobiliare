(function () {
    'use strict';

    const API      = 'api/portal_sync.php';
    const PROP_API = 'api/properties.php';

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
    function fmtDateTime(str) { return window.Fmt.dateTime(str); }

    const PORTAL_LABEL = { immobiliare: 'Immobiliare.it', idealista: 'Idealista', casa: 'Casa.it', subito: 'Subito', sito_agenzia: 'Sito agenzia', altro: 'Altro' };
    const STATUS_LABEL = { draft: 'Bozza', publishing: 'In pubblicazione', published: 'Pubblicato', error: 'Errore', removed: 'Rimosso' };
    const STATUS_BADGE = { draft: 'badge', publishing: 'badge--warning', published: 'badge--success', error: 'badge--danger', removed: 'badge' };

    // Stati che dichiarano l'annuncio vivo sul portale: solo questi passano dal
    // pre-flight. Deve restare allineato a PORTAL_STATUSES_REQUIRING_PREFLIGHT
    // in lib/portal_validation.php — il server e' comunque l'autorita', questo
    // e' solo per non far scoprire il blocco al salvataggio.
    const PREFLIGHT_STATUSES = ['publishing', 'published'];

    let currentPage = 1;
    const PAGE_LIMIT = 25;
    let deleteTargetId = null;

    const els = {};

    function init() {
        els.alert      = document.getElementById('portal-alert');
        els.tbody      = document.getElementById('portal-tbody');
        els.pagination = document.getElementById('portal-pagination');
        els.search     = document.getElementById('portal-search');
        els.portalF    = document.getElementById('portal-portal-filter');
        els.statusF    = document.getElementById('portal-status-filter');
        els.modal      = document.getElementById('portal-modal');
        els.form       = document.getElementById('portal-form');
        els.delModal   = document.getElementById('portal-delete-modal');
        els.preflight  = document.getElementById('portal-preflight');
        els.preTitle   = document.getElementById('portal-preflight-title');
        els.preList    = document.getElementById('portal-preflight-list');
        els.feedNote   = document.getElementById('portal-feed-note');
        els.feedsModal = document.getElementById('portal-feeds-modal');
        els.fbModal    = document.getElementById('portal-feedback-modal');

        bindEvents();
        bindRowMenu();
        loadProperties();
        loadList();
    }

    function bindEvents() {
        document.getElementById('btn-new-portal').addEventListener('click', () => openModal());
        document.getElementById('portal-modal-close').addEventListener('click', closeModal);
        document.getElementById('portal-modal-cancel').addEventListener('click', closeModal);
        els.modal.addEventListener('click', e => { if (e.target === els.modal) closeModal(); });
        els.form.addEventListener('submit', handleSubmit);

        document.getElementById('portal-delete-close').addEventListener('click', closeDeleteModal);
        document.getElementById('portal-delete-cancel').addEventListener('click', closeDeleteModal);
        document.getElementById('portal-delete-confirm').addEventListener('click', confirmDelete);
        els.delModal.addEventListener('click', e => { if (e.target === els.delModal) closeDeleteModal(); });

        els.search.addEventListener('input', () => {
            clearTimeout(els._timer);
            els._timer = setTimeout(() => { currentPage = 1; loadList(); }, 400);
        });
        els.portalF.addEventListener('change', () => { currentPage = 1; loadList(); });
        els.statusF.addEventListener('change', () => { currentPage = 1; loadList(); });

        // Il pre-flight dipende da (immobile, portale) e serve solo se lo stato
        // dichiara l'annuncio vivo: qualunque di questi tre cambi lo rilancia.
        ['portal-property', 'portal-portal', 'portal-status'].forEach(id => {
            document.getElementById(id).addEventListener('change', runPreflight);
        });

        document.getElementById('btn-portal-feeds').addEventListener('click', openFeedsModal);
        document.getElementById('portal-feeds-close').addEventListener('click', () => { els.feedsModal.hidden = true; });
        document.getElementById('portal-feeds-cancel').addEventListener('click', () => { els.feedsModal.hidden = true; });

        document.getElementById('btn-portal-feedback').addEventListener('click', openFeedbackModal);
        document.getElementById('portal-feedback-close').addEventListener('click', () => { els.fbModal.hidden = true; });
        document.getElementById('portal-feedback-cancel').addEventListener('click', () => { els.fbModal.hidden = true; });
        document.getElementById('portal-feedback-form').addEventListener('submit', handleFeedbackImport);
    }

    // --- Feed di sindacazione ----------------------------------------------

    async function openFeedsModal() {
        els.feedsModal.hidden = false;
        const box = document.getElementById('portal-feeds-list');
        box.textContent = 'Caricamento…';
        try {
            const res  = await fetch(`${API}?action=feed_info`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            box.innerHTML = json.data.feeds.map(f => {
                // Gli esclusi sono la parte che conta: un feed che dimagrisce in
                // silenzio è il modo migliore per non accorgersi che metà
                // portafoglio non è più pubblicato.
                const excl = (f.esclusi || []).length
                    ? `<details style="margin-top:4px;"><summary class="text-muted" style="cursor:pointer;">${f.esclusi.length} immobili esclusi dal feed</summary>
                         <ul style="margin:6px 0 0;padding-left:18px;">${f.esclusi.map(e =>
                           `<li><strong>${esc(e.reference)}</strong>: ${esc((e.reasons || []).join(' · '))}</li>`).join('')}</ul>
                       </details>`
                    : '';
                return `<div class="form-group">
                    <label>${esc(f.label)} — <span class="badge badge--success">${f.inclusi} inclusi</span></label>
                    ${f.url ? `<input type="text" class="form-input" readonly value="${esc(f.url)}" onclick="this.select()">` : `<em class="text-muted">${esc(f.errore || 'non disponibile')}</em>`}
                    ${excl}
                </div>`;
            }).join('');
        } catch (err) {
            box.innerHTML = `<div class="alert alert--error">${esc(err.message)}</div>`;
        }
    }

    // --- Esiti dal portale --------------------------------------------------

    function openFeedbackModal() {
        document.getElementById('portal-feedback-form').reset();
        document.getElementById('portal-feedback-result').style.display = 'none';
        els.fbModal.hidden = false;
    }

    async function handleFeedbackImport(e) {
        e.preventDefault();
        const btn = document.getElementById('portal-feedback-save');
        const out = document.getElementById('portal-feedback-result');
        btn.disabled = true; btn.textContent = 'Importazione…';
        try {
            const res = await fetch(`${API}?action=import_feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    portal:  document.getElementById('portal-feedback-portal').value,
                    payload: document.getElementById('portal-feedback-payload').value,
                }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const d = json.data;
            const notes = [];
            if (d.senza_riferimento > 0) notes.push(`${d.senza_riferimento} righe senza riferimento (tracciato cambiato?)`);
            if ((d.non_agganciate || []).length) notes.push(`non agganciate: ${d.non_agganciate.join(', ')}`);

            out.className = 'alert alert--success';
            out.innerHTML = `${d.aggiornate} pubblicazioni aggiornate — ${d.pubblicate} confermate, ${d.in_errore} in errore.`
                + (notes.length ? `<br><small>${esc(notes.join(' · '))}</small>` : '');
            out.style.display = 'block';
            loadList();
        } catch (err) {
            out.className = 'alert alert--error';
            out.textContent = err.message;
            out.style.display = 'block';
        } finally {
            btn.disabled = false; btn.textContent = 'Importa';
        }
    }

    async function loadProperties() {
        try {
            const items = await window.Pagination.fetchList(PROP_API);
            const sel = document.getElementById('portal-property');
            items.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.address || `#${p.id}`;
                sel.appendChild(opt);
            });
        } catch (e) { /* non-critical */ }
    }

    async function loadList() {
        const params = new URLSearchParams();
        if (els.search.value.trim()) params.set('search', els.search.value.trim());
        if (els.portalF.value) params.set('portal', els.portalF.value);
        if (els.statusF.value) params.set('status', els.statusF.value);
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);

        softLoad(els.tbody, '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:2rem;">Caricamento…</td></tr>');
        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const parsed = window.Pagination.parseResponse(json);
            renderStats((json.data && json.data.stats) || {});
            renderRows(parsed.items);
            window.Pagination.render(els.pagination, parsed, p => { currentPage = p; loadList(); });
        } catch (err) {
            els.tbody.classList.remove('is-loading');
            els.tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--color-danger);padding:2rem;">${esc(err.message)}</td></tr>`;
        }
    }

    function renderStats(s) {
        document.getElementById('stat-portal-total').textContent     = s.total ?? '—';
        document.getElementById('stat-portal-published').textContent = s.published ?? '—';
        document.getElementById('stat-portal-pending').textContent   = s.pending ?? '—';
        document.getElementById('stat-portal-errors').textContent    = s.errors ?? '—';
    }

    function renderRows(items) {
        els.tbody.classList.remove('is-loading');
        if (!items.length) {
            els.tbody.innerHTML = '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:2rem;">Nessuna pubblicazione. Aggiungine una per tracciare lo stato sui portali.</td></tr>';
            return;
        }
        els.tbody.innerHTML = items.map(l => {
            const idCell = l.external_url
                ? `<a href="${esc(l.external_url)}" target="_blank" rel="noopener">${esc(l.external_id || 'apri')}</a>`
                : esc(l.external_id || '—');
            return `<tr>
                <td data-label="Immobile">${esc(l.property_address || `#${l.property_id}`)}<br><small class="text-muted">${esc(l.property_city || '')}</small></td>
                <td data-label="Portale">${esc(PORTAL_LABEL[l.portal] || l.portal)}${l.source === 'feed' ? '<br><small class="text-muted">da sindacazione</small>' : ''}</td>
                <td data-label="Stato"><span class="badge ${STATUS_BADGE[l.status] || 'badge'}">${esc(STATUS_LABEL[l.status] || l.status)}</span>${l.status === 'error' && l.error_message ? `<br><small class="text-muted">${esc(l.error_message)}</small>` : ''}</td>
                <td data-label="ID annuncio">${idCell}</td>
                <td data-label="Ultimo sync">${fmtDateTime(l.last_synced_at)}</td>
                <td data-label="Azioni" class="col-actions lt-actions">
                    ${window.RowMenu.button(l.id, 'Azioni pubblicazione')}
                </td>
            </tr>`;
        }).join('');

    }

    function bindRowMenu() {
        window.RowMenu.bind(els.tbody, btn => [
            { label: 'Modifica', icon: 'pencil', onClick: async () => {
                try {
                    const res  = await fetch(`${API}?id=${btn.dataset.id}`);
                    const json = await res.json();
                    if (!json.success) throw new Error(json.error);
                    openModal(Array.isArray(json.data) ? json.data[0] : json.data);
                } catch (e) { showAlert(e.message, 'error'); }
            } },
            { sep: true },
            { label: 'Elimina', icon: 'trash-2', danger: true,
              onClick: () => { deleteTargetId = btn.dataset.id; els.delModal.hidden = false; } },
        ]);
    }

    function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v ?? ''; }

    // --- Pre-flight ---------------------------------------------------------

    function hidePreflight() {
        els.preflight.style.display = 'none';
        els.preList.innerHTML = '';
    }

    /**
     * `blocking` distingue i due momenti: prima del salvataggio è un avviso
     * ("non potrai pubblicare finché…"), dopo un 422 è il motivo del rifiuto.
     */
    function renderViolations(violations, blocking) {
        if (!violations || !violations.length) { hidePreflight(); return; }
        els.preflight.className = blocking ? 'alert alert--error' : 'alert alert--warning';
        els.preTitle.textContent = blocking
            ? 'Pubblicazione bloccata: correggi questi punti'
            : 'Non pubblicabile su questo portale finché mancano:';
        els.preList.innerHTML = violations
            .map(v => `<li>${esc(v.message)}</li>`)
            .join('');
        els.preflight.style.display = 'block';
    }

    async function runPreflight() {
        const propertyId = document.getElementById('portal-property').value;
        const portal     = document.getElementById('portal-portal').value;
        const status     = document.getElementById('portal-status').value;

        // Su bozza non si controlla nulla: parcheggiare un annuncio incompleto
        // è proprio ciò a cui serve la bozza.
        if (!propertyId || !portal || !PREFLIGHT_STATUSES.includes(status)) {
            hidePreflight();
            return;
        }
        try {
            const res  = await fetch(`${API}?action=preflight&property_id=${encodeURIComponent(propertyId)}&portal=${encodeURIComponent(portal)}`);
            const json = await res.json();
            if (!json.success) return;         // silenzioso: è un aiuto, non un blocco
            renderViolations(json.data.violations, false);
        } catch (e) { /* la validazione vera resta comunque server-side */ }
    }

    // Campi che, su una riga scritta dal feed, appartengono al portale.
    const FEED_OWNED_FIELDS = ['portal-external-id', 'portal-external-url', 'portal-error'];

    function applyFeedOwnership(isFeed) {
        FEED_OWNED_FIELDS.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.readOnly = isFeed;
        });
        els.feedNote.style.display = isFeed ? 'block' : 'none';
    }

    function openModal(item = null) {
        els.form.reset();
        setVal('portal-id', '');
        hidePreflight();
        document.getElementById('portal-modal-title').textContent = item ? 'Modifica pubblicazione' : 'Nuova pubblicazione';
        if (item) {
            setVal('portal-id', item.id);
            setVal('portal-property', item.property_id || '');
            setVal('portal-portal', item.portal || 'immobiliare');
            setVal('portal-status', item.status || 'draft');
            setVal('portal-external-id', item.external_id);
            setVal('portal-external-url', item.external_url);
            setVal('portal-error', item.error_message);
            setVal('portal-notes', item.notes);
        }
        applyFeedOwnership(!!item && item.source === 'feed');
        els.modal.hidden = false;
        if (item) runPreflight();
    }

    function closeModal() { els.modal.hidden = true; }
    function closeDeleteModal() { els.delModal.hidden = true; deleteTargetId = null; }

    async function handleSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('portal-id').value;
        const btn = document.getElementById('portal-modal-save');
        btn.disabled = true; btn.textContent = 'Salvataggio…';
        const data = {
            property_id:  document.getElementById('portal-property').value,
            portal:       document.getElementById('portal-portal').value,
            status:       document.getElementById('portal-status').value,
            external_id:  document.getElementById('portal-external-id').value.trim(),
            external_url: document.getElementById('portal-external-url').value.trim(),
            error_message: document.getElementById('portal-error').value.trim(),
            notes:        document.getElementById('portal-notes').value.trim(),
        };
        try {
            const res  = await fetch(id ? `${API}?id=${id}` : API, {
                method: id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const json = await res.json();
            if (!json.success) {
                // 422 dal pre-flight: la modale resta aperta con l'elenco di
                // cosa correggere. Chiuderla perderebbe l'unica spiegazione.
                if (json.violations) {
                    renderViolations(json.violations, true);
                    return;
                }
                throw new Error(json.error);
            }
            closeModal();
            hidePreflight();
            showAlert('Pubblicazione salvata.', 'success');
            loadList();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Salva';
        }
    }

    async function confirmDelete() {
        if (!deleteTargetId) return;
        const btn = document.getElementById('portal-delete-confirm');
        btn.disabled = true;
        try {
            const res  = await fetch(`${API}?id=${deleteTargetId}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeDeleteModal();
            showAlert('Pubblicazione eliminata.', 'success');
            loadList();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    function showAlert(msg, type) {
        els.alert.textContent   = msg;
        els.alert.className     = `alert alert--${type}`;
        els.alert.style.display = 'block';
        clearTimeout(els.alert._t);
        els.alert._t = setTimeout(() => { els.alert.style.display = 'none'; }, 5000);
    }

    init();
})();
