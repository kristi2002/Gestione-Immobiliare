/**
 * Scheda Inquilino — dedicated tenant profile view
 */
import {
    API, PROPS_API, DOCS_API, REM_API, CONT_API, PAY_API, COMM_API,
    STATUS_LABELS, FREQ_LABELS, PROP_STATUS, PROP_COLOR, PAY_STATUS, PAY_COLOR, DOC_ICONS, REM_ICONS,
} from './constants.js';
import { esc, fmtDate } from './helpers.js';

// Le schede non hanno impaginatore: mostrano UNA pagina. Chiedevano 200 righe
// a endpoint che ne concedono 100 (apiGetPagination) e poi contavano quelle
// arrivate, cosi' un inquilino con 270 pagamenti leggeva "100 pagamenti" e non
// c'era modo di accorgersene. Ora si chiede il tetto vero e, se il totale a DB
// e' piu' alto, la lista lo dichiara.
const TAB_LIMIT = window.Pagination.TAB_LIMIT;
const TAB_HINT  = 'Apri la pagina dedicata per l\'elenco completo.';

let tenant   = null;
let tenantId = null;
let tabsLoaded = new Set();

function init() {
    tenantId = window.App?.viewParams?.tenantId;
    if (!tenantId) {
        showAlert('ID inquilino non specificato. Torna all\'elenco e riprova.', 'error');
        return;
    }

    bindEvents();
    loadTenant();
}

function bindEvents() {
    document.getElementById('btn-profile-edit').addEventListener('click', () => {
        if (window.App) window.App.navigateTo('tenant_edit', { tenantId });
    });
    document.getElementById('btn-profile-new-contratto').addEventListener('click', () => {
        if (window.App) window.App.navigateTo('contract_edit', { tenantId, propertyId: tenant?.property_id || undefined });
    });
    document.getElementById('btn-profile-new-pagamento').addEventListener('click', () => {
        if (window.App) window.App.navigateTo('payment_edit', { tenantId });
    });
    document.getElementById('btn-profile-new-reminder').addEventListener('click', () => openReminderModal());
    document.getElementById('profile-messaggi-form')?.addEventListener('submit', sendMessaggio);

    // Tab switching
    document.querySelectorAll('.profile-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Reminder form
    document.getElementById('profile-reminder-close').addEventListener('click', closeReminderModal);
    document.getElementById('profile-reminder-cancel').addEventListener('click', closeReminderModal);
    document.getElementById('profile-reminder-modal').addEventListener('click', e => {
        if (e.target === document.getElementById('profile-reminder-modal')) closeReminderModal();
    });
    document.getElementById('profile-reminder-form').addEventListener('submit', saveReminder);

    // Document upload (attached to the tenant's current property, if any)
    document.getElementById('profile-doc-upload').addEventListener('change', uploadDocuments);
}

// ── Tenant load ──────────────────────────────────────────────────

async function loadTenant() {
    try {
        const res  = await fetch(`${API}?id=${tenantId}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        tenant = json.data;
        renderHero();
        loadTab('lease');
    } catch (err) {
        showAlert('Impossibile caricare l\'inquilino: ' + err.message, 'error');
    }
}

function renderHero() {
    const initials = ((tenant.name || '')[0] || '') + ((tenant.surname || '')[0] || '');
    document.getElementById('profile-avatar').textContent = initials.toUpperCase();
    document.getElementById('profile-name').textContent = `${tenant.name} ${tenant.surname}`;
    window.App?.setCrumb(`${tenant.name} ${tenant.surname}`);

    const badge = document.getElementById('profile-status-badge');
    badge.textContent = STATUS_LABELS[tenant.status] || tenant.status;
    badge.className = `badge badge--${tenant.status}`;

    const meta = [];
    if (tenant.phone) meta.push(`<span><i data-lucide="phone"></i> <a href="tel:${esc(tenant.phone)}">${esc(tenant.phone)}</a></span>`);
    if (tenant.email) meta.push(`<span><i data-lucide="mail"></i> <a href="mailto:${esc(tenant.email)}">${esc(tenant.email)}</a></span>`);
    if (tenant.codice_fiscale) meta.push(`<span><i data-lucide="id-card"></i> ${esc(tenant.codice_fiscale)}</span>`);
    if (tenant.property_address) meta.push(`<span><i data-lucide="building-2"></i> ${esc(tenant.property_address)}, ${esc(tenant.property_city || '')}</span>`);
    document.getElementById('profile-meta').innerHTML = meta.join('');

    const waEl = document.getElementById('profile-wa-action');
    if (waEl) waEl.innerHTML = (tenant.phone && window.WA) ? window.WA.buttonHtml(tenant.phone, '', { className: 'btn-wa--label', label: 'WhatsApp' }) : '';

    const notesEl = document.getElementById('profile-notes');
    if (tenant.notes && tenant.notes.trim()) {
        document.getElementById('profile-notes-text').textContent = tenant.notes;
        notesEl.hidden = false;
    } else {
        notesEl.hidden = true;
    }
}

// ── Tab logic ────────────────────────────────────────────────────

function switchTab(tab) {
    document.querySelectorAll('.profile-tab').forEach(t => {
        t.classList.toggle('profile-tab--active', t.dataset.tab === tab);
    });
    document.querySelectorAll('.profile-panel').forEach(p => {
        p.hidden = (p.id !== `profile-panel-${tab}`);
    });
    if (!tabsLoaded.has(tab)) loadTab(tab);
}

function loadTab(tab) {
    tabsLoaded.add(tab);
    if (tab === 'lease')            loadLease();
    else if (tab === 'contratti')   loadContratti();
    else if (tab === 'pagamenti')   loadPagamenti();
    else if (tab === 'documents')   loadDocuments();
    else if (tab === 'reminders')   loadReminders();
    else if (tab === 'messaggi')    loadMessaggi();
}

// ── Messaggi — il filo diretto con il portale inquilino ──────────
//
// Il canale 'portale' non spedisce niente: si legge dentro il portale. Per
// questo la scheda lo tiene separato da Comunicazioni, che e' il posto delle
// email e dei WhatsApp verso il PROPRIETARIO.

async function loadMessaggi() {
    const list    = document.getElementById('profile-messaggi-list');
    const countEl = document.getElementById('profile-messaggi-count');

    try {
        const j = await fetch(`${COMM_API}?tenant_id=${encodeURIComponent(tenantId)}`).then(r => r.json());
        if (!j.success) throw new Error(j.error);

        const msgs = j.data.messages || [];
        countEl.textContent = msgs.length
            ? `${msgs.length} messagg${msgs.length === 1 ? 'io' : 'i'}`
            : '';

        if (!msgs.length) {
            list.innerHTML = '<div class="entity-empty">Nessun messaggio. '
                + 'Puoi scrivere tu per primo: l\'inquilino lo legge nel portale.</div>';
            return;
        }

        // 'received' = arrivato dall'inquilino. Il verso e' sempre raccontato
        // dal punto di vista del gestionale, come nel resto della tabella.
        list.innerHTML = msgs.map(m => `
            <div class="tpm-msg tpm-msg--${m.direction === 'received' ? 'in' : 'out'}">
                <div class="tpm-msg__who">
                    ${m.direction === 'received'
                        ? esc(`${tenant?.name || ''} ${tenant?.surname || ''}`.trim() || 'Inquilino')
                        : 'Agenzia'}
                    <span class="tpm-msg__when">${fmtDate(m.created_at)}</span>
                </div>
                <div class="tpm-msg__body">${esc(m.body || '')}</div>
            </div>`).join('');

        list.scrollTop = list.scrollHeight;
    } catch (e) {
        list.innerHTML = `<div class="entity-empty">Impossibile caricare i messaggi: ${esc(e.message)}</div>`;
    }
}

async function sendMessaggio(ev) {
    ev.preventDefault();
    const textEl = document.getElementById('profile-messaggi-text');
    const btn    = document.getElementById('profile-messaggi-send');
    const body   = textEl.value.trim();

    if (!body) return;

    btn.disabled = true;
    try {
        const res = await fetch(`${COMM_API}?action=tenant_reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenant_id: tenantId, body }),
        });
        const j = await res.json();
        if (!j.success) throw new Error(j.error);
        textEl.value = '';
        loadMessaggi();
    } catch (e) {
        showAlert(e.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

// ── Locazione (current lease + property card) ────────────────────

async function loadLease() {
    const grid = document.getElementById('profile-lease-grid');
    const countEl = document.getElementById('profile-lease-count');
    if (!tenant.property_id) {
        countEl.textContent = '';
        grid.innerHTML = '<div class="entity-empty">Nessuna locazione attiva per questo inquilino.</div>';
        return;
    }
    grid.innerHTML = '<div class="entity-loading">Caricamento…</div>';
    try {
        const res  = await fetch(`${PROPS_API}?id=${tenant.property_id}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        const p = json.data;
        countEl.textContent = 'Locazione in corso';

        const photo = p.cover_url
            ? `<img src="${esc(p.cover_url)}" class="prop-card-thumb" alt="" loading="lazy" onerror="this.onerror=null;this.outerHTML='<div class=&quot;prop-card-thumb prop-card-thumb--empty&quot;>&#x1F3E2;</div>'">`
            : `<div class="prop-card-thumb prop-card-thumb--empty"><i data-lucide="building-2"></i></div>`;
        const color = PROP_COLOR[p.status] || '#94a3b8';
        const rent  = tenant.monthly_rent ? `<span class="profile-prop-rent">${window.Fmt.money(tenant.monthly_rent, { decimals: 'auto' })}/mese</span>` : '';
        const period = [tenant.lease_start ? fmtDate(tenant.lease_start) : null, tenant.lease_end ? fmtDate(tenant.lease_end) : null].filter(Boolean).join(' → ');

        grid.innerHTML = `
        <div class="entity-card profile-prop-card entity-card--clickable" data-prop-id="${p.id}" style="cursor:pointer;">
            <div class="prop-card-thumb-wrap">${photo}</div>
            <div class="entity-card__body">
                <div class="entity-card__name" style="font-size:14px;">${esc(p.address)}, ${esc(p.city)}</div>
                <div class="profile-prop-meta">
                    <span class="badge" style="background:${color}20;color:${color};border:1px solid ${color}40;">${PROP_STATUS[p.status] || p.status}</span>
                    ${p.sqm ? `<span class="text-muted" style="font-size:12px;">${esc(p.sqm)} m²</span>` : ''}
                    ${rent}
                </div>
                ${period ? `<div class="text-muted" style="font-size:12px;margin-top:6px;"><i data-lucide="calendar"></i> ${period}</div>` : ''}
            </div>
        </div>`;

        grid.querySelectorAll('[data-prop-id]').forEach(card => {
            card.addEventListener('click', () => {
                if (window.App) window.App.navigateTo('property_profile', { propertyId: parseInt(card.dataset.propId, 10) });
            });
        });
        if (window.lucide) window.lucide.createIcons();
    } catch (err) {
        grid.innerHTML = `<div class="entity-error">${esc(err.message)}</div>`;
    }
}

// ── Contratti ────────────────────────────────────────────────────

const CT_TYPE = { locazione: 'Locazione', compravendita: 'Compravendita', preliminare: 'Preliminare', mandato: 'Mandato', altro: 'Altro' };

function ctState(c) {
    const today = window.Fmt.today();
    if (c.status === 'cancelled') return { label: 'Annullato', color: '#94a3b8' };
    if (c.status === 'expired' || (c.end_date && c.end_date < today)) return { label: 'Scaduto', color: '#dc2626' };
    if (c.status === 'signed') {
        if (c.start_date && c.start_date > today) return { label: 'In attesa', color: '#d97706' };
        return { label: 'Attivo', color: '#16a34a' };
    }
    if (c.status === 'sent') return { label: 'Inviato', color: '#2563eb' };
    return { label: 'Bozza', color: '#94a3b8' };
}

async function loadContratti() {
    const list = document.getElementById('profile-contratti-list');
    list.innerHTML = '<div class="entity-loading">Caricamento…</div>';
    try {
        const res  = await fetch(`${CONT_API}?tenant_id=${tenantId}&limit=${TAB_LIMIT}&page=1`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        const { items, total } = window.Pagination.unwrap(json);
        document.getElementById('profile-contratti-count').textContent =
            total ? window.Pagination.countLabel(items.length, total, total === 1 ? 'contratto' : 'contratti') : '';

        if (!items.length) {
            list.innerHTML = '<div class="entity-empty">Nessun contratto per questo inquilino. Usa "Nuovo Contratto".</div>';
            return;
        }

        list.innerHTML = items.map(c => {
            const st = ctState(c);
            const type = CT_TYPE[c.contract_type] || c.contract_type;
            const where = c.property_address ? `${esc(c.property_address)}, ${esc(c.property_city)}` : '—';
            const rent = c.monthly_rent ? `${window.Fmt.money(c.monthly_rent, { decimals: 'auto' })}/mese` : '';
            const period = [c.start_date ? fmtDate(c.start_date) : null, c.end_date ? fmtDate(c.end_date) : null].filter(Boolean).join(' → ');
            return `
            <div class="doc-item">
                <span class="doc-item__icon"><i data-lucide="copy"></i></span>
                <div class="doc-item__info">
                    <div class="doc-item__name">${esc(c.title || type)} — ${where}</div>
                    <div class="doc-item__meta">
                        <span class="badge" style="background:${st.color}20;color:${st.color};border:1px solid ${st.color}40;font-size:11px;">${st.label}</span>
                        · ${type}${rent ? ' · ' + rent : ''}${period ? ' · ' + period : ''}
                    </div>
                </div>
            </div>`;
        }).join('');
        list.insertAdjacentHTML('beforeend', window.Pagination.truncationNote(items.length, total, 0, TAB_HINT));
    } catch (err) {
        list.innerHTML = `<div class="entity-error">${esc(err.message)}</div>`;
    }
}

// ── Pagamenti ────────────────────────────────────────────────────

async function loadPagamenti() {
    const list = document.getElementById('profile-pagamenti-list');
    list.innerHTML = '<div class="entity-loading">Caricamento…</div>';
    try {
        const res  = await fetch(`${PAY_API}?tenant_id=${tenantId}&limit=${TAB_LIMIT}&page=1`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        const { items, total } = window.Pagination.unwrap(json);
        document.getElementById('profile-pagamenti-count').textContent =
            total ? window.Pagination.countLabel(items.length, total, total === 1 ? 'pagamento' : 'pagamenti') : '';

        if (!items.length) {
            list.innerHTML = '<div class="entity-empty">Nessun pagamento registrato. Usa "Nuovo Pagamento" o genera lo scadenzario dal contratto.</div>';
            return;
        }

        list.innerHTML = items.map(p => {
            const color = PAY_COLOR[p.status] || '#94a3b8';
            const label = PAY_STATUS[p.status] || p.status;
            const amount = window.Fmt.money(p.amount || 0);
            return `
            <div class="doc-item">
                <span class="doc-item__icon"><i data-lucide="euro"></i></span>
                <div class="doc-item__info">
                    <div class="doc-item__name">€ ${amount} — scadenza ${fmtDate(p.due_date)}</div>
                    <div class="doc-item__meta">
                        <span class="badge" style="background:${color}20;color:${color};border:1px solid ${color}40;font-size:11px;">${label}</span>
                        ${p.paid_date ? ' · pagato il ' + fmtDate(p.paid_date) : ''}
                    </div>
                </div>
                <div class="doc-item__actions">
                    ${p.status === 'pending' || p.status === 'late'
                        ? `<button class="btn btn--sm btn--ghost btn-pay-mark" data-id="${p.id}" title="Segna come pagato"><i data-lucide="check"></i></button>`
                        : ''}
                </div>
            </div>`;
        }).join('');
        list.insertAdjacentHTML('beforeend', window.Pagination.truncationNote(items.length, total, 0, TAB_HINT));

        list.querySelectorAll('.btn-pay-mark').forEach(btn => {
            btn.addEventListener('click', () => markPaymentPaid(btn.dataset.id, items));
        });
    } catch (err) {
        list.innerHTML = `<div class="entity-error">${esc(err.message)}</div>`;
    }
}

async function markPaymentPaid(id, items) {
    const payment = items.find(p => p.id == id);
    if (!payment) return;
    const data = {
        tenant_id:   payment.tenant_id,
        property_id: payment.property_id,
        contract_id: payment.contract_id || null,
        amount:      payment.amount,
        due_date:    payment.due_date,
        paid_date:   window.Fmt.today(),
        status:      'paid',
        notes:       payment.notes || '',
    };
    try {
        const res  = await fetch(`${PAY_API}?id=${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        tabsLoaded.delete('pagamenti');
        loadPagamenti();
        showAlert('Pagamento segnato come pagato.', 'success');
    } catch (err) {
        showAlert(err.message, 'error');
    }
}

// ── Documenti (dell'immobile locato — condivisi con proprietario/altri inquilini) ──

async function loadDocuments() {
    const list = document.getElementById('profile-docs-list');
    const hint = document.getElementById('profile-docs-hint');
    const uploadLabel = document.getElementById('profile-doc-upload-label');
    if (!tenant.property_id) {
        hint.textContent = '';
        uploadLabel.style.display = 'none';
        list.innerHTML = '<div class="entity-empty">Nessuna locazione attiva: nessun immobile a cui allegare documenti.</div>';
        return;
    }
    uploadLabel.style.display = '';
    hint.textContent = 'Documenti associati all\'immobile locato — condivisi con il proprietario e visibili anche a eventuali altri inquilini dello stesso immobile.';
    list.innerHTML = '<div class="entity-loading">Caricamento…</div>';
    try {
        const res  = await fetch(`${DOCS_API}?property_id=${tenant.property_id}&limit=${TAB_LIMIT}&page=1`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        const { items, total } = window.Pagination.unwrap(json);
        document.getElementById('profile-docs-count').textContent =
            total ? window.Pagination.countLabel(items.length, total, total === 1 ? 'documento' : 'documenti') : '';

        if (!items.length) {
            list.innerHTML = '<div class="entity-empty">Nessun documento associato. Carica il primo con il pulsante sopra.</div>';
            return;
        }

        const DOC_TYPE_LABELS = { invoice: 'Fattura', contract: 'Contratto', id: 'Documento ID', other: 'Altro' };
        list.innerHTML = items.map(d => {
            const ext  = (d.original_name || d.title || '').split('.').pop().toLowerCase();
            const icon = DOC_ICONS[ext] || '<i data-lucide="paperclip"></i>';
            const name = d.title || d.original_name || 'Documento';
            return `
            <div class="doc-item">
                <span class="doc-item__icon">${icon}</span>
                <div class="doc-item__info">
                    <div class="doc-item__name">${esc(name)}</div>
                    <div class="doc-item__meta">${DOC_TYPE_LABELS[d.doc_type] || d.doc_type || ''} · ${fmtDate(d.created_at)}</div>
                </div>
                <div class="doc-item__actions">
                    <a href="api/download_document.php?id=${d.id}" class="btn btn--sm btn--ghost" target="_blank" title="Scarica"><i data-lucide="download"></i></a>
                </div>
            </div>`;
        }).join('');
        list.insertAdjacentHTML('beforeend', window.Pagination.truncationNote(items.length, total, 0, TAB_HINT));
    } catch (err) {
        list.innerHTML = `<div class="entity-error">${esc(err.message)}</div>`;
    }
}

async function uploadDocuments(e) {
    const files = [...e.target.files];
    if (!files.length || !tenant.property_id) return;
    let errors = 0;
    for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('title', file.name);
        fd.append('doc_type', 'other');
        fd.append('property_id', tenant.property_id);
        try {
            const res  = await fetch(DOCS_API, { method: 'POST', body: fd });
            const json = await res.json();
            if (!json.success) errors++;
        } catch { errors++; }
    }
    e.target.value = '';
    tabsLoaded.delete('documents');
    await loadDocuments();
    showAlert(errors ? `${files.length - errors} caricati, ${errors} errori.` : `${files.length} document${files.length === 1 ? 'o caricato' : 'i caricati'}.`, errors ? 'error' : 'success');
}

// ── Reminders ────────────────────────────────────────────────────

// Come nella scheda proprietario: RowMenu.bind() aggancia una volta sola, quindi
// la funzione che costruisce le voci deve leggere l'elenco corrente e non quello
// catturato al primo caricamento (altrimenti "Modifica" apre dati vecchi).
let remindersCache = [];

async function loadReminders() {
    const list = document.getElementById('profile-reminders-list');
    list.innerHTML = '<div class="entity-loading">Caricamento…</div>';
    let reminders = [];
    try {
        const res  = await fetch(`${REM_API}?tenant_id=${tenantId}&limit=100&page=1`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        reminders = json.data?.items ?? (Array.isArray(json.data) ? json.data : []);
        remindersCache = reminders;
        const cnt = reminders.length;
        document.getElementById('profile-reminders-count').textContent =
            cnt ? `${cnt} promemori${cnt === 1 ? 'o' : 'a'}` : '';

        if (!cnt) {
            list.innerHTML = '<div class="entity-empty">Nessun promemoria configurato. Creane uno con il pulsante sopra.</div>';
            return;
        }

        list.innerHTML = reminders.map(r => `
            <div class="reminder-item reminder-item--${r.status}">
                <span class="reminder-item__icon">${REM_ICONS[r.status] || '<i data-lucide="bell"></i>'}</span>
                <div class="reminder-item__info">
                    <div class="reminder-item__title">${esc(r.title)}</div>
                    <div class="reminder-item__meta">
                        ${r.reminder_date ? `<i data-lucide="calendar"></i> ${fmtDate(r.reminder_date)}` : ''}
                        ${r.frequency ? ` · ${FREQ_LABELS[r.frequency] || r.frequency}` : ''}
                    </div>
                </div>
                <div class="reminder-item__actions">
                    ${window.RowMenu.button(r.id, 'Azioni promemoria', { state: r.status })}
                </div>
            </div>`).join('');

        window.RowMenu.bind(list, btn => [
            btn.dataset.state === 'pending'
                ? { label: 'Segna completato', icon: 'check-circle', onClick: () => completeReminder(btn.dataset.id) }
                : null,
            { label: 'Modifica', icon: 'pencil', onClick: () => {
                const r = remindersCache.find(x => x.id == btn.dataset.id);
                if (r) openReminderModal(r);
            } },
            { sep: true },
            { label: 'Elimina', icon: 'trash-2', danger: true, onClick: () => deleteReminder(btn.dataset.id) },
        ]);
    } catch (err) {
        list.innerHTML = `<div class="entity-error">${esc(err.message)}</div>`;
    }
}

function openReminderModal(r = null) {
    document.getElementById('profile-reminder-title-el').textContent = r ? 'Modifica Promemoria' : 'Nuovo Promemoria';
    document.getElementById('profile-reminder-id').value    = r?.id || '';
    document.getElementById('profile-reminder-title').value = r?.title || '';
    document.getElementById('profile-reminder-freq').value  = r?.frequency || 'once';
    document.getElementById('profile-reminder-date').value  = (r?.reminder_date || '').slice(0, 10);
    document.getElementById('profile-reminder-notes').value = r?.description || '';
    document.getElementById('profile-reminder-modal').hidden = false;
    document.getElementById('profile-reminder-title').focus();
}

function closeReminderModal() {
    document.getElementById('profile-reminder-modal').hidden = true;
}

async function saveReminder(e) {
    e.preventDefault();
    const id   = document.getElementById('profile-reminder-id').value;
    const data = {
        title:          document.getElementById('profile-reminder-title').value.trim(),
        frequency:      document.getElementById('profile-reminder-freq').value,
        reminder_date:  document.getElementById('profile-reminder-date').value || null,
        description:    document.getElementById('profile-reminder-notes').value.trim(),
        tenant_id:      parseInt(tenantId, 10),
        status:         'pending',
    };
    const url    = id ? `${REM_API}?id=${id}` : REM_API;
    const method = id ? 'PUT' : 'POST';
    try {
        const res  = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        closeReminderModal();
        tabsLoaded.delete('reminders');
        loadReminders();
        showAlert('Promemoria salvato.', 'success');
    } catch (err) {
        showAlert(err.message, 'error');
    }
}

async function completeReminder(id) {
    const res  = await fetch(`${REM_API}?id=${id}&action=complete`, { method: 'PATCH' });
    const json = await res.json();
    if (json.success) {
        tabsLoaded.delete('reminders');
        loadReminders();
    } else {
        showAlert(json.error, 'error');
    }
}

async function deleteReminder(id) {
    if (!await confirmDialog('Eliminare questo promemoria?', { title: 'Elimina promemoria', confirmText: 'Elimina' })) return;
    const res  = await fetch(`${REM_API}?id=${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
        tabsLoaded.delete('reminders');
        loadReminders();
    } else {
        showAlert(json.error, 'error');
    }
}

// ── Utilities ────────────────────────────────────────────────────

function showAlert(msg, type) {
    const el = document.getElementById('profile-alert');
    el.textContent = msg;
    el.className   = `alert alert--${type}`;
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, 4500);
}

init();
