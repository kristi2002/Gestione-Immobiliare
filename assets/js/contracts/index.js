/**
 * Contracts (Contratti) — CRUD + lifecycle (Phase 10)
 */
import {
    API,
    PROPERTIES_API,
    ESIGN_API,
    TYPE_LABELS,
    STATUS_LABELS,
    PAGE_LIMIT,
} from './constants.js';
import {
    effectiveStatus,
    nextStatus,
    formatPrice,
    formatDate,
    escapeHtml,
} from './helpers.js';

// Allineati a CONTRACT_RENTAL_TYPES / CONTRACT_SALE_TYPES in api/contracts.php.
const RENTAL_TYPES = ['locazione'];
const SALE_TYPES   = ['compravendita', 'preliminare', 'mandato'];

/**
 * L'importo da mostrare in scheda ed elenco, con l'unita' giusta.
 *
 * Il «/mese» non e' una decorazione: su una compravendita trasformava un prezzo
 * di vendita in un canone ricorrente sotto gli occhi di chi leggeva la scheda.
 * Per questo su un contratto di vendita si mostra SOLO il prezzo — mai un
 * ripiego sul canone, che li' e' per definizione un residuo da correggere.
 *
 * Sta qui e non in helpers.js di proposito: solo lo script di INGRESSO della
 * vista viene caricato con `?t=` (app.js), mentre i moduli importati arrivano
 * dalla cache con `max-age=1y, immutable` (.htaccess). Aggiungere un export a
 * un sotto-modulo e importarlo da qui significa che, al primo deploy, chi ha
 * il vecchio helpers.js in cache riceve un modulo senza quell'export e la
 * pagina contratti muore in blocco.
 *
 * @returns {{label:string, text:string}|null} null = nessun importo da mostrare
 */
function contractAmount(c) {
    const has   = (v) => v != null && v !== '';
    const rent  = has(c.monthly_rent) ? { label: 'Canone', text: `€ ${formatPrice(c.monthly_rent)}/mese` } : null;
    const price = has(c.sale_price)   ? { label: 'Prezzo', text: `€ ${formatPrice(c.sale_price)}` } : null;

    if (SALE_TYPES.includes(c.contract_type))   return price;
    if (RENTAL_TYPES.includes(c.contract_type)) return rent;
    return rent || price; // 'altro': semantica ignota, si mostra cio' che c'e'
}

let contracts  = [];
let contractDocs = [];
let properties = [];
let currentPage = 1;
let schedaContractId = null;

const els = {};

function init() {
    els.grid           = document.getElementById('contracts-grid');
    els.alert          = document.getElementById('contracts-alert');
    els.search         = document.getElementById('contract-search');
    els.propFilter     = document.getElementById('contract-property-filter');
    els.typeFilter     = document.getElementById('contract-type-filter');
    els.pagination     = document.getElementById('contracts-pagination');

    bindEvents();
    Promise.all([loadProperties()])
        .then(() => loadContracts())
        .then(() => {
            // Legacy entry points now redirect to the dedicated contract page.
            // replace: un redirect non e' un passo del percorso — altrimenti
            // tornando indietro si ricade qui e si riapre subito il form.
            const vp = window.App?.viewParams || {};
            if (vp.contractId && window.App) window.App.navigateTo('contract_edit', { contractId: vp.contractId }, { replace: true });
            else if (vp.openNew && window.App) window.App.navigateTo('contract_edit', vp.clientId ? { clientId: vp.clientId } : {}, { replace: true });
        })
        .catch(err => {
            if (!els.alert?.isConnected) return;
            showAlert('Errore inizializzazione: ' + err.message, 'error');
        });
}

function bindEvents() {
    document.getElementById('btn-new-contract').addEventListener('click', () => {
        if (window.App) window.App.navigateTo('contract_edit');
    });

    let searchTimer = null;
    els.search.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { currentPage = 1; loadContracts(); }, 300);
    });

    [els.propFilter, els.typeFilter].forEach(el => el.addEventListener('change', () => { currentPage = 1; loadContracts(); }));

    // Status filter as horizontal colored pills (includes a dedicated "Scaduti").
    document.querySelectorAll('#contract-status-pills .filter-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            document.querySelectorAll('#contract-status-pills .filter-pill').forEach(p => p.classList.remove('is-active'));
            pill.classList.add('is-active');
            currentPage = 1;
            loadContracts();
        });
    });

    document.getElementById('esign-modal-close').addEventListener('click', closeEsignModal);
    document.getElementById('esign-modal-cancel').addEventListener('click', closeEsignModal);
    document.getElementById('esign-form').addEventListener('submit', generateEsignLink);

    // Rinnovo e disdetta
    document.getElementById('renew-modal-close')?.addEventListener('click', closeRenewModal);
    document.getElementById('renew-modal-cancel')?.addEventListener('click', closeRenewModal);
    document.getElementById('renew-form')?.addEventListener('submit', submitRenew);
    document.getElementById('terminate-modal-close')?.addEventListener('click', closeTerminateModal);
    document.getElementById('terminate-modal-cancel')?.addEventListener('click', closeTerminateModal);
    document.getElementById('terminate-form')?.addEventListener('submit', submitTerminate);
    document.getElementById('terminate-effective')?.addEventListener('change', describeTerminationImpact);
    document.getElementById('btn-copy-esign').addEventListener('click', () => {
        const url = document.getElementById('esign-link-url').value;
        navigator.clipboard.writeText(url).then(() => showAlert('Link copiato!', 'success'));
    });

    // Scheda quick-view
    const schedaModal = document.getElementById('contract-scheda-modal');
    document.getElementById('contract-scheda-close').addEventListener('click', closeSchedaModal);
    document.getElementById('scheda-ct-close2').addEventListener('click', closeSchedaModal);
    schedaModal.addEventListener('click', (e) => { if (e.target === schedaModal) closeSchedaModal(); });
    document.getElementById('scheda-ct-edit').addEventListener('click', () => {
        const id = schedaContractId;
        closeSchedaModal();
        if (window.App) window.App.navigateTo('contract_edit', { contractId: id });
    });
    document.getElementById('scheda-ct-esign').addEventListener('click', () => {
        const id = schedaContractId;
        closeSchedaModal();
        openEsignModal(id);
    });
    document.getElementById('scheda-ct-advance').addEventListener('click', () => {
        const id = schedaContractId;
        closeSchedaModal();
        advanceStatus(id);
    });
    document.getElementById('scheda-ct-generate').addEventListener('click', () => {
        const id = schedaContractId;
        closeSchedaModal();
        generatePayments(id);
    });
}

// -------------------------------------------------------------------------
// Reference data
// -------------------------------------------------------------------------

async function loadProperties() {
    properties = await Pagination.fetchList(PROPERTIES_API);
    const opts = properties.map(p =>
        `<option value="${p.id}">${escapeHtml(p.address)}, ${escapeHtml(p.city)}</option>`
    ).join('');
    if (els.propFilter) els.propFilter.innerHTML = '<option value="">Tutti gli immobili</option>' + opts;
}

// -------------------------------------------------------------------------
// List
// -------------------------------------------------------------------------

async function loadContracts() {
    const params = new URLSearchParams();
    if (els.search?.value.trim()) params.set('search', els.search.value.trim());
    if (els.propFilter.value)     params.set('property_id', els.propFilter.value);
    if (els.typeFilter.value)     params.set('type', els.typeFilter.value);
    const activeStatus = document.querySelector('#contract-status-pills .filter-pill.is-active')?.dataset.status || '';
    if (activeStatus === '__expired')     params.set('expired', '1');
    else if (activeStatus === '__active') params.set('active', '1');
    else if (activeStatus)                params.set('status', activeStatus);
    params.set('page', currentPage);
    params.set('limit', PAGE_LIMIT);

    const url = `${API}?${params}`;
    softLoad(els.grid, '<div class="entity-loading">Caricamento…</div>');

    try {
        const res  = await fetch(url);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        const parsed = Pagination.parseResponse(json);
        contracts = parsed.items;

        // Also surface uploaded contract files (documents) — only in the unfiltered
        // "Tutti" view on page 1, since files have no status/type to filter on.
        contractDocs = [];
        const activeStatus = document.querySelector('#contract-status-pills .filter-pill.is-active')?.dataset.status || '';
        if (currentPage === 1 && !activeStatus && !els.typeFilter.value) {
            const dp = new URLSearchParams({ doc_type: 'contract', limit: '100', page: '1' });
            if (els.propFilter.value) dp.set('property_id', els.propFilter.value);
            try {
                const dj = await fetch(`api/documents.php?${dp}`).then(r => r.json());
                let docs = dj.data?.items || dj.data || [];
                // Files attached to a contract record (contract_id set) are already
                // represented by that filterable record — don't duplicate them here as
                // standalone "File caricato" cards. Only truly loose files remain.
                docs = docs.filter(d => !d.contract_id);
                const q = (els.search?.value || '').trim().toLowerCase();
                if (q) docs = docs.filter(d => (d.original_name || '').toLowerCase().includes(q));
                contractDocs = docs;
            } catch (_) { contractDocs = []; }
        }

        renderCards();
        Pagination.render(els.pagination, parsed, (p) => { currentPage = p; loadContracts(); });
    } catch (err) {
        els.grid.classList.remove('is-loading');
        els.grid.innerHTML = `<div class="entity-error">${escapeHtml(err.message)}</div>`;
    }
}

function renderDocCard(d) {
    const prop = properties.find(p => p.id == d.property_id);
    const where = prop ? `${escapeHtml(prop.address)}, ${escapeHtml(prop.city)}` : '';
    return `
        <div class="entity-card contract-card contract-card--file">
            <div class="entity-card__header">
                <div class="entity-card__title-group">
                    <div class="entity-card__name">${escapeHtml(d.original_name || 'File contratto')}</div>
                    <div class="contract-card__badges">
                        <span class="badge badge--contract-type"><i data-lucide="paperclip"></i> File caricato</span>
                    </div>
                </div>
            </div>
            <div class="entity-card__body">
                ${where ? `<div class="entity-card__info"><span class="entity-card__info-icon"><i data-lucide="building-2"></i></span>${where}</div>` : ''}
                ${d.created_at ? `<div class="entity-card__info"><span class="entity-card__info-icon"><i data-lucide="calendar"></i></span>${formatDate(d.created_at)}</div>` : ''}
            </div>
            <div class="entity-card__footer">
                <div class="entity-card__actions">
                    ${RowMenu.button(d.id, 'Azioni file', { doc: '1', path: d.download_url })}
                </div>
            </div>
        </div>`;
}

function renderCards() {
    els.grid.classList.remove('is-loading');
    if (contracts.length === 0 && contractDocs.length === 0) {
        els.grid.innerHTML = '<div class="entity-empty">Nessun contratto trovato.</div>';
        return;
    }

    els.grid.innerHTML = contracts.map(c => {
        const who = c.tenant_surname
            ? `${escapeHtml(c.tenant_surname)} ${escapeHtml(c.tenant_name)}`
            : (c.client_surname ? `${escapeHtml(c.client_surname)} ${escapeHtml(c.client_name)}` : null);

        const dateRange = (c.start_date || c.end_date)
            ? `${formatDate(c.start_date)} → ${formatDate(c.end_date)}`
            : null;

        const eff    = effectiveStatus(c);
        const amount = contractAmount(c);
        return `
        <div class="entity-card contract-card contract-card--${eff} entity-card--clickable" data-id="${c.id}">
            <div class="entity-card__header">
                <div class="entity-card__title-group">
                    <div class="entity-card__name">${escapeHtml(c.title)}</div>
                    <div class="contract-card__badges">
                        <span class="badge badge--contract-type badge--contract-type-${c.contract_type}">${TYPE_LABELS[c.contract_type] || c.contract_type}</span>
                        <span class="badge badge--contract-${eff}">${STATUS_LABELS[eff] || eff}</span>
                    </div>
                </div>
            </div>
            <div class="entity-card__body">
                <div class="entity-card__info"><span class="entity-card__info-icon"><i data-lucide="building-2"></i></span>${escapeHtml(c.property_address)}, ${escapeHtml(c.property_city)}</div>
                ${who ? `<div class="entity-card__info"><span class="entity-card__info-icon"><i data-lucide="user"></i></span>${who}</div>` : ''}
                ${dateRange ? `<div class="entity-card__info"><span class="entity-card__info-icon"><i data-lucide="calendar"></i></span>${dateRange}</div>` : ''}
                ${amount ? `<div class="entity-card__info"><span class="entity-card__info-icon"><i data-lucide="euro"></i></span>${amount.text}</div>` : ''}
            </div>
            <div class="entity-card__footer">
                <div class="entity-card__actions">
                    ${RowMenu.button(c.id, 'Azioni contratto', { next: nextStatus(c.status) || '' })}
                </div>
            </div>
        </div>`;
    }).join('') + contractDocs.map(renderDocCard).join('');

    // Una scheda "file contratto" non e' un contratto: il suo id e' quello del
    // documento, e le sue uniche azioni sono aprirlo e cancellarlo.
    RowMenu.bind(els.grid, btn => {
        const id = btn.dataset.id;
        if (btn.dataset.doc === '1') {
            return [
                { label: 'Apri file', icon: 'external-link', href: btn.dataset.path, target: '_blank' },
                window.canWrite !== false ? { sep: true } : null,
                window.canWrite !== false
                    ? { label: 'Elimina file', icon: 'trash-2', danger: true, onClick: async () => {
                        if (await confirmDialog('Eliminare questo file contratto?', { title: 'Elimina file' })) deleteContractDoc(id);
                    } }
                    : null,
            ];
        }
        const next = btn.dataset.next;
        const c    = contractById(id);
        // Rinnovo e disdetta hanno senso su una locazione e su nient'altro:
        // una compravendita non si rinnova, e l'API le rifiuterebbe comunque.
        const isLease   = c && c.contract_type === 'locazione';
        const terminated = !!(c && c.termination_notice_date);
        const canWrite  = window.canWrite !== false;

        return [
            { label: 'Scarica contratto', icon: 'file-down', onClick: () => downloadContractPdf(id) },
            (canWrite && isLease && !terminated)
                ? { label: 'Rinnova contratto', icon: 'refresh-cw', onClick: () => openRenewModal(id) } : null,
            (canWrite && isLease && !terminated)
                ? { label: 'Registra disdetta', icon: 'file-x', onClick: () => openTerminateModal(id) } : null,
            (canWrite && isLease && terminated)
                ? { label: 'Annulla disdetta', icon: 'undo-2', onClick: () => cancelTermination(id) } : null,
            (window.canWrite !== false && next)
                ? { label: `Avanza a “${STATUS_LABELS[next] || next}”`, icon: 'arrow-right',
                    onClick: () => advanceStatus(id) }
                : null,
            window.canWrite !== false
                ? { label: 'Firma digitale', icon: 'pen-tool', onClick: () => openEsignModal(id) } : null,
            window.canWrite !== false
                ? { label: 'Modifica', icon: 'pencil', onClick: () => {
                    if (window.App) window.App.navigateTo('contract_edit', { contractId: Number(id) });
                } } : null,
            window.canWrite !== false ? { sep: true } : null,
            window.canWrite !== false
                ? { label: 'Elimina', icon: 'trash-2', danger: true, onClick: async () => {
                    if (await confirmDialog('Vuoi eliminare questo contratto?', { title: 'Elimina contratto' })) deleteContract(id);
                } } : null,
        ];
    });

    els.grid.querySelectorAll('.entity-card--clickable').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('button, a, input')) return;
            const c = contracts.find(x => x.id == card.dataset.id);
            if (c) openSchedaModal(c);
        });
    });
}

// -------------------------------------------------------------------------
// Scheda quick-view
// -------------------------------------------------------------------------

function openSchedaModal(c) {
    schedaContractId = c.id;
    const who = c.tenant_surname
        ? `${c.tenant_surname} ${c.tenant_name}`
        : (c.client_surname ? `${c.client_surname} ${c.client_name}` : '—');
    const dateRange = (c.start_date || c.end_date)
        ? `${formatDate(c.start_date)} → ${formatDate(c.end_date)}`
        : '—';

    document.getElementById('scheda-ct-title').textContent = c.title;
    const schedaEff    = effectiveStatus(c);
    const schedaAmount = contractAmount(c);
    // «Deposito» su una compravendita e' la caparra: stesso campo, nome diverso
    // a seconda del contratto (vedi phase79).
    const depositLabel = ['compravendita', 'preliminare', 'mandato'].includes(c.contract_type)
        ? 'Caparra'
        : 'Deposito';
    document.getElementById('scheda-ct-badges').innerHTML =
        `<span class="badge badge--contract-type badge--contract-type-${c.contract_type}">${TYPE_LABELS[c.contract_type] || c.contract_type}</span>
         <span class="badge badge--contract-${schedaEff}">${STATUS_LABELS[schedaEff] || schedaEff}</span>`;

    document.getElementById('scheda-ct-body').innerHTML = `
        <div class="scheda-rows">
            <div class="scheda-row"><span class="scheda-row__label"><i data-lucide="building-2"></i> Immobile</span><span class="scheda-row__value">${escapeHtml(c.property_address)}, ${escapeHtml(c.property_city)}</span></div>
            <div class="scheda-row"><span class="scheda-row__label"><i data-lucide="user"></i> Parte</span><span class="scheda-row__value">${escapeHtml(who)}</span></div>
            <div class="scheda-row"><span class="scheda-row__label"><i data-lucide="calendar"></i> Durata</span><span class="scheda-row__value">${escapeHtml(dateRange)}</span></div>
            ${schedaAmount ? `<div class="scheda-row"><span class="scheda-row__label"><i data-lucide="euro"></i> ${schedaAmount.label}</span><span class="scheda-row__value">${schedaAmount.text}</span></div>` : ''}
            ${c.deposit ? `<div class="scheda-row"><span class="scheda-row__label"><i data-lucide="lock"></i> ${depositLabel}</span><span class="scheda-row__value">€ ${formatPrice(c.deposit)}</span></div>` : ''}
            ${c.notes ? `<div class="scheda-row"><span class="scheda-row__label"><i data-lucide="file-pen"></i> Note</span><span class="scheda-row__value">${escapeHtml(c.notes)}</span></div>` : ''}
            <div class="scheda-row"><span class="scheda-row__label"><i data-lucide="paperclip"></i> Documenti</span><span class="scheda-row__value" id="scheda-ct-docs">Caricamento…</span></div>
        </div>`;

    const advBtn = document.getElementById('scheda-ct-advance');
    const ns = nextStatus(c.status);
    if (ns) {
        advBtn.textContent = `→ ${STATUS_LABELS[ns]}`;
        advBtn.hidden = false;
    } else {
        advBtn.hidden = true;
    }

    const genBtn = document.getElementById('scheda-ct-generate');
    genBtn.hidden = !(c.contract_type === 'locazione' && c.tenant_id && c.monthly_rent && c.start_date && c.end_date);

    document.getElementById('contract-scheda-modal').hidden = false;
    loadContractDocuments(c.id);
}

async function loadContractDocuments(contractId) {
    const el = document.getElementById('scheda-ct-docs');
    if (!el) return;
    try {
        const res  = await fetch(`api/documents.php?contract_id=${contractId}&limit=100`);
        const json = await res.json();
        const docs = json.success ? Pagination.parseResponse(json).items.filter(d => d.doc_type !== 'contratto') : [];
        el.innerHTML = docs.length
            ? docs.map(d => `<a href="${d.download_url}" target="_blank" rel="noopener" style="display:inline-block;margin-right:8px">${escapeHtml(d.title || d.original_name)}</a>`).join('')
            : '<span class="text-muted">Nessun documento allegato.</span>';
    } catch (err) {
        el.innerHTML = '<span class="text-muted">—</span>';
    }
}

function closeSchedaModal() {
    schedaContractId = null;
    document.getElementById('contract-scheda-modal').hidden = true;
}

async function generatePayments(id) {
    const c = contracts.find(x => x.id == id);
    if (!c) return;

    const msPerMonth    = 1000 * 60 * 60 * 24 * 30.44;
    const approxMonths  = Math.ceil((new Date(c.end_date) - new Date(c.start_date)) / msPerMonth);

    if (!await confirmDialog(
        `Verranno creati circa ${approxMonths} pagamenti da € ${formatPrice(c.monthly_rent)}/mese per questo contratto.\n\nProcedere?`,
        { title: 'Genera scadenzario pagamenti', confirmText: 'Genera', danger: false }
    )) return;

    try {
        const res  = await fetch(`${API}?action=generate_payments&id=${id}`, { method: 'POST' });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        // A rate gia' tutte presenti l'API non crea nulla e spiega perche'.
        // Buttare via quel messaggio per stampare "Scadenzario creato: 0
        // pagamenti." faceva leggere come un fallimento un'operazione riuscita.
        const created = Number(json.data.payments_created) || 0;
        showAlert(
            created > 0
                ? `Scadenzario creato: ${created} pagamenti.`
                : (json.data.message || 'Nessuna rata da aggiungere.'),
            created > 0 ? 'success' : 'info',
        );
    } catch (err) {
        showAlert(err.message, 'error');
    }
}

// -------------------------------------------------------------------------
// E-signature
// -------------------------------------------------------------------------

function openEsignModal(contractId) {
    document.getElementById('esign-contract-id').value = contractId;
    document.getElementById('esign-name').value = '';
    document.getElementById('esign-email').value = '';
    document.getElementById('esign-link-result').hidden = true;
    document.getElementById('esign-modal-submit').hidden = false;
    document.getElementById('esign-modal').hidden = false;
}

function closeEsignModal() {
    document.getElementById('esign-modal').hidden = true;
}

async function generateEsignLink(e) {
    e.preventDefault();
    const contractId = document.getElementById('esign-contract-id').value;
    const signerName  = document.getElementById('esign-name').value.trim();
    const signerEmail = document.getElementById('esign-email').value.trim();
    const btn = document.getElementById('esign-modal-submit');
    btn.disabled = true;
    btn.textContent = 'Generazione…';
    try {
        const res  = await fetch(ESIGN_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contract_id: parseInt(contractId, 10), signer_name: signerName, signer_email: signerEmail }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        const base = window.location.origin + window.location.pathname.replace(/index\.php.*/, '');
        const signUrl = `${base}sign.php?token=${json.data.token}`;
        document.getElementById('esign-link-url').value = signUrl;
        document.getElementById('esign-link-result').hidden = false;
        btn.hidden = true;
        const emailSent = json.data.email_sent;
        const alertMsg  = emailSent
            ? 'Link di firma generato e email inviata automaticamente al firmatario.'
            : 'Link di firma generato. Copia e invia il link manualmente al firmatario.';
        showAlert(alertMsg, emailSent ? 'success' : 'warning');
        const hintEl = document.getElementById('esign-link-hint');
        if (hintEl) hintEl.innerHTML = emailSent
            ? '<i data-lucide="mail"></i> Email di invito inviata automaticamente al firmatario.'
            : '<i data-lucide="alert-triangle"></i> Email non configurata — invia questo link al firmatario via email o WhatsApp.';
    } catch (err) {
        showAlert(err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Genera link';
    }
}

// -------------------------------------------------------------------------
// Modal
// -------------------------------------------------------------------------

// -------------------------------------------------------------------------
// CRUD
// -------------------------------------------------------------------------

async function saveContract(data, id) {
    const url    = id ? `${API}?id=${id}` : API;
    const method = id ? 'PUT' : 'POST';
    const res  = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    return json.data;
}

async function advanceStatus(id) {
    const c = contracts.find(x => x.id == id);
    if (!c) return;
    const next = nextStatus(c.status);
    if (!next) return;

    try {
        // Endpoint dedicato: manda SOLO lo stato.
        //
        // Prima questo pulsante rimandava indietro l'oggetto contratto cosi'
        // com'era in memoria — undici campi — a un UPDATE che ne scrive
        // ventiquattro. Le tredici colonne assenti venivano azzerate: prezzo di
        // vendita, registrazione RLI, cedolare secca e base ISTAT. Portare un
        // contratto da "inviato" a "firmato" cancellava proprio i dati che a
        // quel punto servono.
        const res = await fetch(`${API}?action=set_status&id=${id}`, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ status: next }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        showAlert('Stato aggiornato a: ' + STATUS_LABELS[next], 'success');
        loadContracts();
    } catch (err) {
        showAlert(err.message, 'error');
    }
}

async function deleteContract(id) {
    try {
        const res  = await fetch(`${API}?id=${id}`, { method: 'DELETE' });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        showAlert('Contratto eliminato.', 'success');
        loadContracts();
    } catch (err) {
        showAlert(err.message, 'error');
    }
}

async function downloadContractPdf(id) {
    const c = contracts.find(x => x.id == id);
    if (!c) return;
    // If the contract has an uploaded file attached (e.g. imported via "Carica"),
    // download that original file instead of generating a template PDF.
    try {
        const dRes  = await fetch(`api/documents.php?contract_id=${id}&doc_type=contract&limit=1`);
        const dJson = await dRes.json();
        const items = dJson.data?.items || dJson.data || [];
        const doc   = Array.isArray(items) ? items[0] : null;
        if (doc && doc.id) {
            window.open(doc.download_url || ('api/download_document.php?id=' + doc.id), '_blank');
            return;
        }
    } catch (_) { /* no attached file — fall through to PDF generation */ }
    try {
        const res = await fetch('api/generate_pdf.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'contract',
                // Senza contract_id il generatore non sa che contratto sia e
                // produceva sempre una locazione, anche su una compravendita.
                contract_id: c.id,
                property_id: c.property_id,
                client_id: c.client_id,
                tenant_id: c.tenant_id,
                monthly_rent: c.monthly_rent,
                lease_start: c.start_date,
                lease_end: c.end_date,
            }),
        });
        const json = await res.json();
        if (json.success) window.open(json.data.download, '_blank');
        else showAlert(json.error || 'Errore generazione PDF', 'error');
    } catch (err) {
        showAlert(err.message, 'error');
    }
}

async function deleteContractDoc(id) {
    try {
        const res  = await fetch(`api/documents.php?id=${id}`, { method: 'DELETE' });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        showAlert('File eliminato.', 'success');
        loadContracts();
    } catch (err) {
        showAlert(err.message, 'error');
    }
}

// -------------------------------------------------------------------------
// Rinnovo e disdetta
//
// Le due decisioni che chiudono una locazione. Fino a ieri il gestionale
// sapeva soltanto QUANDO un contratto scade — cosa succede a quella data era
// un fatto che viveva fuori dall'applicazione.
// -------------------------------------------------------------------------

function contractById(id) {
    return contracts.find(x => String(x.id) === String(id)) || null;
}

function openRenewModal(id) {
    const c = contractById(id);
    if (!c) return;

    document.getElementById('renew-contract-id').value = id;

    // La durata proposta e' quella del tipo di locazione; se il tipo non la
    // fissa (studenti: "per un periodo uguale al primo") arriva dal server
    // gia' calcolata sulla durata effettiva.
    const months = c.renewal_months_effective || '';
    document.getElementById('renew-months').value = months;

    document.getElementById('renew-current').textContent =
        `Scadenza attuale: ${formatDate(c.end_date)}.`
        + (Number(c.renewal_count) ? ` Già rinnovato ${c.renewal_count} volta/e.` : '');
    document.getElementById('renew-hint').textContent = months
        ? `Proposta dal tipo di contratto. Le rate dei mesi aggiunti vengono generate subito.`
        : 'Indica di quanti mesi prorogare.';

    document.getElementById('renew-modal').hidden = false;
}

function closeRenewModal() { document.getElementById('renew-modal').hidden = true; }

async function submitRenew(e) {
    e.preventDefault();
    const id  = document.getElementById('renew-contract-id').value;
    const raw = document.getElementById('renew-months').value;
    const btn = document.getElementById('renew-modal-submit');

    btn.disabled = true; btn.textContent = 'Rinnovo…';
    try {
        const res = await fetch(`${API}?id=${encodeURIComponent(id)}&action=renew`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ months: raw === '' ? null : Number(raw) }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        closeRenewModal();
        showAlert(json.data.message, 'success');
        loadContracts();
    } catch (err) {
        showAlert(err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Rinnova';
    }
}

function openTerminateModal(id) {
    const c = contractById(id);
    if (!c) return;

    document.getElementById('terminate-contract-id').value = id;
    document.getElementById('terminate-by').value = 'locatore';
    document.getElementById('terminate-notice').value = new Date().toISOString().substring(0, 10);
    // Il caso normale e' la disdetta ALLA scadenza: si propone quella, e chi
    // registra un recesso anticipato la sposta indietro.
    document.getElementById('terminate-effective').value = c.end_date
        ? String(c.end_date).substring(0, 10) : '';
    document.getElementById('terminate-reason').value = '';
    document.getElementById('terminate-modal').hidden = false;
    describeTerminationImpact();
}

function closeTerminateModal() { document.getElementById('terminate-modal').hidden = true; }

/**
 * Dice PRIMA quante rate verranno annullate.
 *
 * Anticipare la fine di una locazione cancella i canoni successivi: e' la
 * conseguenza piu' pesante di questa finestra, e scoprirla dopo aver premuto
 * "Registra" sarebbe una sorpresa sul dato con cui si riconcilia la cassa.
 */
function describeTerminationImpact() {
    const box = document.getElementById('terminate-warning');
    const hint = document.getElementById('terminate-effective-hint');
    const c = contractById(document.getElementById('terminate-contract-id').value);
    const eff = document.getElementById('terminate-effective').value;

    if (!c || !eff) { box.hidden = true; return; }

    const naturalEnd = c.end_date ? String(c.end_date).substring(0, 10) : null;
    hint.textContent = naturalEnd
        ? `Scadenza contrattuale: ${formatDate(naturalEnd)}.`
        : '';

    if (naturalEnd && eff < naturalEnd) {
        box.textContent = `La locazione finirà il ${formatDate(eff)}, prima della scadenza `
            + `contrattuale del ${formatDate(naturalEnd)}: le rate successive verranno annullate `
            + `(quelle già incassate restano).`;
        box.hidden = false;
    } else {
        box.hidden = true;
    }
}

async function submitTerminate(e) {
    e.preventDefault();
    const id  = document.getElementById('terminate-contract-id').value;
    const btn = document.getElementById('terminate-modal-submit');

    btn.disabled = true; btn.textContent = 'Registrazione…';
    try {
        const res = await fetch(`${API}?id=${encodeURIComponent(id)}&action=terminate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                terminated_by:              document.getElementById('terminate-by').value,
                termination_notice_date:    document.getElementById('terminate-notice').value,
                termination_effective_date: document.getElementById('terminate-effective').value,
                termination_reason:         document.getElementById('terminate-reason').value.trim(),
            }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        closeTerminateModal();
        showAlert(json.data.message, 'success');
        loadContracts();
    } catch (err) {
        showAlert(err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Registra disdetta';
    }
}

async function cancelTermination(id) {
    if (!await confirmDialog(
        'Annullare la disdetta registrata? La scadenza torna a quella contrattuale. '
        + 'Le rate annullate non si riattivano da sole: vanno rigenerate.',
        { title: 'Annulla disdetta' }
    )) return;

    try {
        const res  = await fetch(`${API}?id=${encodeURIComponent(id)}&action=cancel_termination`, { method: 'POST' });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        showAlert(json.data.message, 'success');
        loadContracts();
    } catch (err) {
        showAlert(err.message, 'error');
    }
}

// -------------------------------------------------------------------------
// Utilities
// -------------------------------------------------------------------------

function showAlert(message, type) {
    els.alert.textContent = message;
    els.alert.className   = `alert alert--${type}`;
    els.alert.style.display = 'block';
    clearTimeout(els.alert._t);
    els.alert._t = setTimeout(() => { els.alert.style.display = 'none'; }, 4000);
}

init();
