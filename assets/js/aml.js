(function () {
    'use strict';

    const API = 'api/aml.php';

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
    function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
    function fmtDate(str) { return window.Fmt.date(str); }

    const RISK_BADGE = { basso: 'badge--success', medio: 'badge--warning', alto: 'badge--danger' };
    const STATUS_LABEL = { da_completare: 'Da completare', completata: 'Completata', sospesa: 'Sospesa' };
    const STATUS_BADGE = { da_completare: 'badge--warning', completata: 'badge--success', sospesa: 'badge' };

    let currentPage = 1;
    const PAGE_LIMIT = 25;
    let deleteTargetId = null;

    const els = {};

    /**
     * La pratica si compila in una pagina, non in un modale: entity_edit +
     * assets/js/entity_edit/schemas/aml.js. Qui resta solo l'elenco, quindi
     * niente più fetch di proprietari e immobili all'apertura della vista —
     * le tendine se le carica il form, e solo se serve.
     */
    function openForm(id) {
        if (!window.App) return;
        window.App.navigateTo('entity_edit', id ? { entity: 'aml', id: Number(id) } : { entity: 'aml' });
    }

    /** Il fascicolo: campi, avvisi di conformità e copie allegate. */
    function openProfile(id) {
        if (!window.App) return;
        window.App.navigateTo('aml_profile', { amlId: Number(id) });
    }

    function init() {
        els.alert       = document.getElementById('aml-alert');
        els.tbody       = document.getElementById('aml-tbody');
        els.pagination  = document.getElementById('aml-pagination');
        els.search      = document.getElementById('aml-search');
        els.statusF     = document.getElementById('aml-status-filter');
        els.riskF       = document.getElementById('aml-risk-filter');
        els.expiringChk = document.getElementById('aml-expiring-toggle');
        els.delModal    = document.getElementById('aml-delete-modal');

        bindEvents();
        loadList();
    }

    function bindEvents() {
        document.getElementById('btn-new-aml').addEventListener('click', () => openForm());

        document.getElementById('aml-delete-close').addEventListener('click', closeDeleteModal);
        document.getElementById('aml-delete-cancel').addEventListener('click', closeDeleteModal);
        document.getElementById('aml-delete-confirm').addEventListener('click', confirmDelete);
        els.delModal.addEventListener('click', e => { if (e.target === els.delModal) closeDeleteModal(); });

        els.search.addEventListener('input', debounce(() => { currentPage = 1; loadList(); }, 300));
        els.statusF.addEventListener('change', () => { currentPage = 1; loadList(); });
        els.riskF.addEventListener('change', () => { currentPage = 1; loadList(); });
        els.expiringChk.addEventListener('change', () => { currentPage = 1; loadList(); });
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

            // La copia del documento (art. 31) non è un dettaglio della scheda:
            // una pratica chiusa senza allegato è la contestazione più probabile
            // in ispezione, e va vista dall'elenco.
            const docs = Number(a.document_count) || 0;
            const clip = docs
                ? ` <span class="badge" title="${docs} ${docs === 1 ? 'copia allegata' : 'copie allegate'}">📎 ${docs}</span>`
                : (a.status === 'completata'
                    ? ' <span class="badge badge--danger" title="Pratica completata senza copia del documento (art. 31)">senza copia</span>'
                    : '');

            // Il nominativo è un link vero: ha un URL condivisibile e si
            // raggiunge col tab. Il click sulla riga è solo una comodità in più
            // — da solo lascerebbe il fascicolo irraggiungibile da tastiera.
            const href = `index.php?view=aml_profile&amlId=${a.id}`;

            return `<tr class="row-clickable" data-aml-id="${a.id}">
                <td data-label="Soggetto"><a href="${href}" class="aml-open" data-id="${a.id}"><strong>${esc(a.subject_name)}</strong></a>${pep}${clip}<br><small class="text-muted">${esc(a.codice_fiscale || a.partita_iva || '')}</small></td>
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

        // Niente più GET della singola pratica per riempire il modale: la
        // pagina di modifica carica da sé il record dall'id.
        // La riga apre il fascicolo. I bottoni in coda restano scorciatoie, ma
        // devono fermare la risalita dell'evento o si finisce sempre in scheda.
        els.tbody.querySelectorAll('a.aml-open').forEach(a => {
            a.addEventListener('click', e => {
                // L'href resta valido per "apri in una nuova scheda"; qui però
                // la navigazione la fa la SPA, senza ricaricare tutto.
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                openProfile(a.dataset.id);
            });
        });
        els.tbody.querySelectorAll('tr[data-aml-id]').forEach(tr => {
            tr.addEventListener('click', () => openProfile(tr.dataset.amlId));
        });
        els.tbody.querySelectorAll('.col-actions').forEach(td => {
            td.addEventListener('click', e => e.stopPropagation());
        });

        els.tbody.querySelectorAll('.btn-aml-edit').forEach(btn => {
            btn.addEventListener('click', () => openForm(btn.dataset.id));
        });
        els.tbody.querySelectorAll('.btn-aml-del').forEach(btn => {
            btn.addEventListener('click', () => {
                deleteTargetId = btn.dataset.id;
                document.getElementById('aml-delete-name').textContent = btn.dataset.name;
                els.delModal.hidden = false;
            });
        });
    }

    function closeDeleteModal() { els.delModal.hidden = true; deleteTargetId = null; }

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
