(function () {
    'use strict';

    const API      = 'api/aml.php';
    const CLI_API  = 'api/clients.php';
    const PROP_API = 'api/properties.php';

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
    function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
    function fmtDate(str) { return str ? new Date(str).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'; }

    const RISK_BADGE = { basso: 'badge--success', medio: 'badge--warning', alto: 'badge--danger' };
    const STATUS_LABEL = { da_completare: 'Da completare', completata: 'Completata', sospesa: 'Sospesa' };
    const STATUS_BADGE = { da_completare: 'badge--warning', completata: 'badge--success', sospesa: 'badge' };

    let currentPage = 1;
    const PAGE_LIMIT = 25;
    let deleteTargetId = null;

    const els = {};

    function init() {
        els.alert       = document.getElementById('aml-alert');
        els.tbody       = document.getElementById('aml-tbody');
        els.pagination  = document.getElementById('aml-pagination');
        els.search      = document.getElementById('aml-search');
        els.statusF     = document.getElementById('aml-status-filter');
        els.riskF       = document.getElementById('aml-risk-filter');
        els.expiringChk = document.getElementById('aml-expiring-toggle');
        els.modal       = document.getElementById('aml-modal');
        els.form        = document.getElementById('aml-form');
        els.delModal    = document.getElementById('aml-delete-modal');

        bindEvents();
        loadClients();
        loadProperties();
        loadList();
    }

    function bindEvents() {
        document.getElementById('btn-new-aml').addEventListener('click', () => openModal());
        document.getElementById('aml-modal-close').addEventListener('click', closeModal);
        document.getElementById('aml-modal-cancel').addEventListener('click', closeModal);
        els.modal.addEventListener('click', e => { if (e.target === els.modal) closeModal(); });
        els.form.addEventListener('submit', handleSubmit);

        document.getElementById('aml-delete-close').addEventListener('click', closeDeleteModal);
        document.getElementById('aml-delete-cancel').addEventListener('click', closeDeleteModal);
        document.getElementById('aml-delete-confirm').addEventListener('click', confirmDelete);
        els.delModal.addEventListener('click', e => { if (e.target === els.delModal) closeDeleteModal(); });

        els.search.addEventListener('input', debounce(() => { currentPage = 1; loadList(); }, 300));
        els.statusF.addEventListener('change', () => { currentPage = 1; loadList(); });
        els.riskF.addEventListener('change', () => { currentPage = 1; loadList(); });
        els.expiringChk.addEventListener('change', () => { currentPage = 1; loadList(); });
    }

    async function loadClients() {
        try {
            const items = await window.Pagination.fetchList(CLI_API);
            const sel = document.getElementById('aml-client');
            items.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = `${c.surname || ''} ${c.name || ''}`.trim() || `#${c.id}`;
                sel.appendChild(opt);
            });
        } catch (e) { /* non-critical */ }
    }

    async function loadProperties() {
        try {
            const items = await window.Pagination.fetchList(PROP_API);
            const sel = document.getElementById('aml-property');
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
        if (els.statusF.value) params.set('status', els.statusF.value);
        if (els.riskF.value) params.set('risk_level', els.riskF.value);
        if (els.expiringChk.checked) params.set('expiring', '1');
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);

        softLoad(els.tbody, '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:2rem;">Caricamento…</td></tr>');
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
            els.tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--color-danger);padding:2rem;">${esc(err.message)}</td></tr>`;
        }
    }

    function renderStats(s) {
        document.getElementById('stat-aml-total').textContent    = s.total ?? '—';
        document.getElementById('stat-aml-pending').textContent  = s.pending ?? '—';
        document.getElementById('stat-aml-highrisk').textContent = s.high_risk ?? '—';
        document.getElementById('stat-aml-expiring').textContent = s.expiring ?? '—';
    }

    function renderRows(items) {
        els.tbody.classList.remove('is-loading');
        if (!items.length) {
            els.tbody.innerHTML = '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:2rem;">Nessuna pratica trovata.</td></tr>';
            return;
        }
        els.tbody.innerHTML = items.map(a => {
            const opVal = a.operation_value != null
                ? new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(a.operation_value)
                : '';
            const pep = Number(a.is_pep) ? ' <span class="badge badge--danger" title="Persona Politicamente Esposta">PEP</span>' : '';
            return `<tr>
                <td data-label="Soggetto"><strong>${esc(a.subject_name)}</strong>${pep}<br><small class="text-muted">${esc(a.codice_fiscale || a.partita_iva || '')}</small></td>
                <td data-label="Operazione">${esc(a.operation_type)}${opVal ? `<br><small class="text-muted">${opVal}</small>` : ''}</td>
                <td data-label="Verifica">${esc(a.verification_type)}</td>
                <td data-label="Rischio"><span class="badge ${RISK_BADGE[a.risk_level] || 'badge'}">${esc(a.risk_level)}</span></td>
                <td data-label="Data verifica">${fmtDate(a.verification_date)}</td>
                <td data-label="Conservazione">${fmtDate(a.retention_until)}</td>
                <td data-label="Stato"><span class="badge ${STATUS_BADGE[a.status] || 'badge'}">${esc(STATUS_LABEL[a.status] || a.status)}</span></td>
                <td data-label="Azioni" class="col-actions" style="white-space:nowrap;">
                    <button class="btn btn--sm btn--ghost btn-aml-edit" data-id="${a.id}" title="Modifica"><i data-lucide="pencil"></i></button>
                    <button class="btn btn--sm btn--ghost btn-aml-del" data-id="${a.id}" data-name="${esc(a.subject_name)}" title="Elimina"><i data-lucide="trash-2"></i></button>
                </td>
            </tr>`;
        }).join('');

        els.tbody.querySelectorAll('.btn-aml-edit').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    const res  = await fetch(`${API}?id=${btn.dataset.id}`);
                    const json = await res.json();
                    if (!json.success) throw new Error(json.error);
                    openModal(Array.isArray(json.data) ? json.data[0] : json.data);
                } catch (e) { showAlert(e.message, 'error'); }
            });
        });
        els.tbody.querySelectorAll('.btn-aml-del').forEach(btn => {
            btn.addEventListener('click', () => {
                deleteTargetId = btn.dataset.id;
                document.getElementById('aml-delete-name').textContent = btn.dataset.name;
                els.delModal.hidden = false;
            });
        });
    }

    function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v ?? ''; }

    function openModal(item = null) {
        els.form.reset();
        setVal('aml-id', '');
        document.getElementById('aml-modal-title').textContent = item ? 'Modifica pratica' : 'Nuova pratica';
        if (item) {
            setVal('aml-id', item.id);
            setVal('aml-subject-name', item.subject_name);
            setVal('aml-subject-type', item.subject_type || 'persona_fisica');
            setVal('aml-cf', item.codice_fiscale);
            setVal('aml-piva', item.partita_iva);
            setVal('aml-verification-type', item.verification_type || 'ordinaria');
            setVal('aml-risk', item.risk_level || 'basso');
            setVal('aml-operation-type', item.operation_type || 'mediazione');
            setVal('aml-operation-value', item.operation_value);
            setVal('aml-client', item.client_id || '');
            setVal('aml-property', item.property_id || '');
            setVal('aml-doc-type', item.id_document_type);
            setVal('aml-doc-number', item.id_document_number);
            setVal('aml-doc-expiry', item.id_document_expiry ? String(item.id_document_expiry).substring(0, 10) : '');
            setVal('aml-beneficial-owner', item.beneficial_owner);
            document.getElementById('aml-pep').checked = !!Number(item.is_pep);
            setVal('aml-purpose', item.purpose);
            setVal('aml-verification-date', item.verification_date ? String(item.verification_date).substring(0, 10) : '');
            setVal('aml-retention', item.retention_until ? String(item.retention_until).substring(0, 10) : '');
            setVal('aml-status', item.status || 'da_completare');
            setVal('aml-notes', item.notes);
        }
        els.modal.hidden = false;
        document.getElementById('aml-subject-name').focus();
    }

    function closeModal() { els.modal.hidden = true; }
    function closeDeleteModal() { els.delModal.hidden = true; deleteTargetId = null; }

    async function handleSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('aml-id').value;
        const btn = document.getElementById('aml-modal-save');
        btn.disabled = true; btn.textContent = 'Salvataggio…';

        const data = {
            subject_name:       document.getElementById('aml-subject-name').value.trim(),
            subject_type:       document.getElementById('aml-subject-type').value,
            codice_fiscale:     document.getElementById('aml-cf').value.trim(),
            partita_iva:        document.getElementById('aml-piva').value.trim(),
            verification_type:  document.getElementById('aml-verification-type').value,
            risk_level:         document.getElementById('aml-risk').value,
            operation_type:     document.getElementById('aml-operation-type').value,
            operation_value:    document.getElementById('aml-operation-value').value || null,
            client_id:          document.getElementById('aml-client').value || null,
            property_id:        document.getElementById('aml-property').value || null,
            id_document_type:   document.getElementById('aml-doc-type').value.trim(),
            id_document_number: document.getElementById('aml-doc-number').value.trim(),
            id_document_expiry: document.getElementById('aml-doc-expiry').value || null,
            beneficial_owner:   document.getElementById('aml-beneficial-owner').value.trim(),
            is_pep:             document.getElementById('aml-pep').checked ? 1 : 0,
            purpose:            document.getElementById('aml-purpose').value.trim(),
            verification_date:  document.getElementById('aml-verification-date').value || null,
            retention_until:    document.getElementById('aml-retention').value || null,
            status:             document.getElementById('aml-status').value,
            notes:              document.getElementById('aml-notes').value.trim(),
        };

        try {
            const res  = await fetch(id ? `${API}?id=${id}` : API, {
                method: id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeModal();
            showAlert('Pratica salvata con successo.', 'success');
            loadList();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Salva';
        }
    }

    async function confirmDelete() {
        if (!deleteTargetId) return;
        const btn = document.getElementById('aml-delete-confirm');
        btn.disabled = true;
        try {
            const res  = await fetch(`${API}?id=${deleteTargetId}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeDeleteModal();
            showAlert('Pratica eliminata.', 'success');
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
