/**
 * Scheda Cliente — dedicated client profile view
 */
import {
    API, PROPS_API, DOCS_API, COMM_API, REM_API, RPT_API, INV_API, CONT_API,
    STATUS_LABELS, FREQ_LABELS, PROP_STATUS, PROP_COLOR, DOC_ICONS, REM_ICONS,
} from './constants.js';
import { esc, fmtDate, fmtDateTime } from './helpers.js';
import { clientDocFilesHtml } from './templates.js';

// Le schede non hanno impaginatore: mostrano UNA pagina. Chiedevano 200 righe
// a endpoint che ne concedono 100 (apiGetPagination) e poi contavano quelle
// arrivate, cosi' un proprietario con 300 documenti ne leggeva "100" senza un
// segno che la lista fosse tagliata. Ora si chiede il tetto vero e, quando il
// totale a DB e' piu' alto, l'elenco lo dichiara.
const TAB_LIMIT = window.Pagination.TAB_LIMIT;
const TAB_HINT  = 'Apri la pagina dedicata per l\'elenco completo.';
const trunc     = (shown, total) => window.Pagination.truncationNote(shown, total, 0, TAB_HINT);

let client   = null;
let clientId = null;
let remindersTotal = 0;
let tabsLoaded = new Set();

function init() {
    clientId = window.App?.viewParams?.clientId;
    if (!clientId) {
        showAlert('ID proprietario non specificato. Torna all\'elenco e riprova.', 'error');
        return;
    }

    bindEvents();
    loadClient();
}

function bindEvents() {
    document.getElementById('btn-profile-edit').addEventListener('click', () => {
        if (window.App) window.App.navigateTo('client_edit', { clientId });
    });
    document.getElementById('btn-profile-report').addEventListener('click', openReportModal);
    document.getElementById('btn-profile-new-property').addEventListener('click', () => {
        if (window.App) window.App.navigateTo('property_edit', { clientId });
    });
    document.getElementById('btn-profile-new-fattura').addEventListener('click', () => {
        if (window.App) window.App.navigateTo('invoice_edit', { clientId });
    });
    document.getElementById('btn-profile-new-contratto')?.addEventListener('click', () => {
        if (window.App) window.App.navigateTo('contract_edit', { clientId });
    });
    document.getElementById('btn-profile-new-reminder').addEventListener('click', () => openReminderModal());

    // Upload fattura / contratto files from PC (#3)
    document.getElementById('profile-fattura-upload')?.addEventListener('change', (e) => uploadTypedDoc(e, 'invoice', loadFatture, 'fatture'));
    document.getElementById('profile-contratto-upload')?.addEventListener('change', (e) => uploadTypedDoc(e, 'contract', loadContratti, 'contratti'));

    // Tab switching
    document.querySelectorAll('.profile-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Dati personali: api/gdpr.php e' requireRole('super_admin') — il ruolo che
    // in un'agenzia fa da titolare/responsabile del trattamento. Agli altri la
    // linguetta non compare affatto, invece di comparire e rispondere 403.
    if (window.userRole === 'super_admin') {
        const gdprTab = document.getElementById('profile-tab-gdpr');
        if (gdprTab) gdprTab.hidden = false;
        document.getElementById('gdpr-export')?.addEventListener('click', gdprExport);
        document.getElementById('gdpr-erase')?.addEventListener('click', gdprErase);
    }

    document.getElementById('portal-save-email')?.addEventListener('click', savePortalEmail);
    document.getElementById('portal-send-link')?.addEventListener('click', sendPortalLink);

    // Reminder form
    document.getElementById('profile-reminder-close').addEventListener('click', closeReminderModal);
    document.getElementById('profile-reminder-cancel').addEventListener('click', closeReminderModal);
    document.getElementById('profile-reminder-modal').addEventListener('click', e => {
        if (e.target === document.getElementById('profile-reminder-modal')) closeReminderModal();
    });
    document.getElementById('profile-reminder-form').addEventListener('submit', saveReminder);

    // Report
    document.getElementById('profile-report-close').addEventListener('click', closeReportModal);
    document.getElementById('profile-report-cancel').addEventListener('click', closeReportModal);
    document.getElementById('profile-report-generate').addEventListener('click', generateReport);
    document.getElementById('profile-fiscal-generate').addEventListener('click', generateFiscalStatement);

    // Document upload
    document.getElementById('profile-doc-upload').addEventListener('change', uploadDocuments);

    // Compose email
    document.getElementById('profile-compose-form').addEventListener('submit', sendEmail);
}

// ── Client load ──────────────────────────────────────────────────

async function loadClient() {
    try {
        const res  = await fetch(`${API}?id=${clientId}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        client = json.data;
        renderHero();
        loadTab('properties');
    } catch (err) {
        showAlert('Impossibile caricare il proprietario: ' + err.message, 'error');
    }
}

function renderHero() {
    const initials = ((client.name || '')[0] || '') + ((client.surname || '')[0] || '');
    document.getElementById('profile-avatar').textContent = initials.toUpperCase();
    document.getElementById('profile-name').textContent = `${client.name} ${client.surname}`;
    window.App?.setCrumb(`${client.name} ${client.surname}`);

    const badge = document.getElementById('profile-status-badge');
    badge.textContent = STATUS_LABELS[client.status] || client.status;
    badge.className = `badge badge--${client.status}`;

    const meta = [];
    if (client.phone) meta.push(`<span><i data-lucide="phone"></i> <a href="tel:${esc(client.phone)}">${esc(client.phone)}</a></span>`);
    if (client.email) meta.push(`<span><i data-lucide="mail"></i> <a href="mailto:${esc(client.email)}">${esc(client.email)}</a></span>`);
    if (client.creation_date) meta.push(`<span><i data-lucide="calendar"></i> Cliente dal ${fmtDate(client.creation_date)}</span>`);
    const cnt = parseInt(client.property_count, 10) || 0;
    if (cnt > 0) meta.push(`<span><i data-lucide="building-2"></i> ${cnt} immobil${cnt === 1 ? 'e' : 'i'}</span>`);
    document.getElementById('profile-meta').innerHTML = meta.join('');

    const waEl = document.getElementById('profile-wa-action');
    if (waEl) waEl.innerHTML = (client.phone && window.WA) ? window.WA.buttonHtml(client.phone, '', { className: 'btn-wa--label', label: 'WhatsApp' }) : '';

    const notesEl = document.getElementById('profile-notes');
    if (client.internal_notes && client.internal_notes.trim()) {
        document.getElementById('profile-notes-text').textContent = client.internal_notes;
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
    if (tab === 'properties')          loadProperties();
    else if (tab === 'fatture')        loadFatture();
    else if (tab === 'contratti')      loadContratti();
    else if (tab === 'documents')      loadDocuments();
    else if (tab === 'communications') loadCommunications();
    else if (tab === 'reminders')      loadReminders();
    else if (tab === 'gdpr')           loadGdpr();
    else if (tab === 'portale')        loadPortal();
}

// ── Properties ───────────────────────────────────────────────────

async function loadProperties() {
    const grid = document.getElementById('profile-props-grid');
    grid.innerHTML = '<div class="entity-loading">Caricamento…</div>';
    try {
        const res  = await fetch(`${PROPS_API}?client_id=${clientId}&limit=${TAB_LIMIT}&page=1`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        const { items, total } = window.Pagination.unwrap(json);
        document.getElementById('profile-props-count').textContent = total
            ? window.Pagination.countLabel(items.length, total, total === 1 ? 'immobile associato' : 'immobili associati')
            : '';

        if (!items.length) {
            grid.innerHTML = '<div class="entity-empty">Nessun immobile associato a questo proprietario.</div>';
            return;
        }

        grid.innerHTML = items.map(p => {
            const photo = p.cover_url
                ? `<img src="${esc(p.cover_url)}" class="prop-card-thumb" alt="" loading="lazy" onerror="this.onerror=null;this.outerHTML='<div class=&quot;prop-card-thumb prop-card-thumb--empty&quot;>&#x1F3E2;</div>'">`
                : `<div class="prop-card-thumb prop-card-thumb--empty"><i data-lucide="building-2"></i></div>`;
            const color = PROP_COLOR[p.status] || '#94a3b8';
            const price = p.price ? `<span class="profile-prop-rent">€ ${Number(p.price).toLocaleString('it-IT')}${p.price_type === 'affitto' ? '/mese' : ''}</span>` : '';
            return `
            <div class="entity-card profile-prop-card entity-card--clickable" data-prop-id="${p.id}" style="cursor:pointer;">
                <div class="prop-card-thumb-wrap">${photo}</div>
                <div class="entity-card__body">
                    <div class="entity-card__name" style="font-size:14px;">${esc(p.address)}, ${esc(p.city)}</div>
                    <div class="profile-prop-meta">
                        <span class="badge" style="background:${color}20;color:${color};border:1px solid ${color}40;">${PROP_STATUS[p.status] || p.status}</span>
                        ${p.sqm ? `<span class="text-muted" style="font-size:12px;">${esc(p.sqm)} m²</span>` : ''}
                        ${price}
                    </div>
                </div>
            </div>`;
        }).join('');
        grid.insertAdjacentHTML('beforeend', trunc(items.length, total));

        grid.querySelectorAll('[data-prop-id]').forEach(card => {
            card.addEventListener('click', () => {
                if (window.App) window.App.navigateTo('property_profile', { propertyId: parseInt(card.dataset.propId, 10) });
            });
        });
    } catch (err) {
        grid.innerHTML = `<div class="entity-error">${esc(err.message)}</div>`;
    }
}

// ── Fatture ──────────────────────────────────────────────────────

function bindClientDocDeletes(list, reload, tabKey) {
    list.querySelectorAll('.btn-cdoc-del').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!confirm('Eliminare questo file?')) return;
            fetch(`${DOCS_API}?id=${btn.dataset.id}`, { method: 'DELETE' })
                .then(r => r.json())
                .then(j => { if (!j.success) throw new Error(); if (tabKey) tabsLoaded.delete(tabKey); reload(); })
                .catch(() => showAlert('Impossibile eliminare il file.', 'error'));
        });
    });
}

async function uploadTypedDoc(e, docType, reload, tabKey) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('title', file.name);
    fd.append('doc_type', docType);
    fd.append('client_id', clientId);
    try {
        const res  = await fetch(DOCS_API, { method: 'POST', body: fd });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Errore');
        showAlert('File caricato.', 'success');
        if (tabKey) tabsLoaded.delete(tabKey);
        await reload();
    } catch (err) {
        showAlert('Caricamento non riuscito: ' + (err.message || ''), 'error');
    }
}

async function loadFatture() {
    const list = document.getElementById('profile-fatture-list');
    list.innerHTML = '<div class="entity-loading">Caricamento…</div>';
    try {
        const [invJson, docJson] = await Promise.all([
            fetch(`${INV_API}?client_id=${clientId}&limit=${TAB_LIMIT}&page=1`).then(r => r.json()),
            fetch(`${DOCS_API}?client_id=${clientId}&doc_type=invoice&limit=${TAB_LIMIT}&page=1`).then(r => r.json()).catch(() => ({})),
        ]);
        if (!invJson.success) throw new Error(invJson.error);
        const inv   = window.Pagination.unwrap(invJson);
        const docsW = window.Pagination.unwrap(docJson);
        const items = inv.items, docs = docsW.items;
        const cnt   = items.length + docs.length;
        const cntTotal = inv.total + docsW.total;
        document.getElementById('profile-fatture-count').textContent =
            cntTotal ? window.Pagination.countLabel(cnt, cntTotal, cntTotal === 1 ? 'elemento' : 'elementi') : '';

        if (!cnt) {
            list.innerHTML = '<div class="entity-empty">Nessuna fattura. Usa "Carica fattura" per allegare un file o "Nuova Fattura".</div>';
            return;
        }

        const invToday = window.Fmt.today();
        // State derived from status + due date (scaduta = non pagata e oltre scadenza).
        const invState = (i) => {
            if (i.status === 'paid') return { label: 'Pagata', color: '#16a34a' };
            if (i.status === 'cancelled') return { label: 'Annullata', color: '#94a3b8' };
            if (i.due_date && i.due_date < invToday) return { label: 'Scaduta', color: '#dc2626' };
            if (i.status === 'sent') return { label: 'Inviata', color: '#2563eb' };
            return { label: 'Bozza', color: '#94a3b8' };
        };
        let html = items.map(i => {
            const st = invState(i);
            const color  = st.color;
            const label  = st.label;
            const total  = Number(i.total || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const desc   = (i.description || '').length > 60 ? i.description.slice(0, 60) + '…' : (i.description || '');
            return `
            <div class="doc-item">
                <span class="doc-item__icon"><i data-lucide="euro"></i></span>
                <div class="doc-item__info">
                    <div class="doc-item__name">${esc(i.invoice_number)} — € ${total}</div>
                    <div class="doc-item__meta">
                        <span class="badge" style="background:${color}20;color:${color};border:1px solid ${color}40;font-size:11px;">${label}</span>
                        · ${fmtDate(i.issue_date)}${desc ? ' · ' + esc(desc) : ''}
                    </div>
                </div>
                <div class="doc-item__actions">
                    <button class="btn btn--sm btn--ghost btn-fattura-pdf" data-id="${i.id}" title="PDF fattura"><i data-lucide="file-text"></i></button>
                </div>
            </div>`;
        }).join('');
        html += clientDocFilesHtml(docs);
        html += trunc(cnt, cntTotal);
        list.innerHTML = html;

        list.querySelectorAll('.btn-fattura-pdf').forEach(btn => {
            btn.addEventListener('click', () => downloadFatturaPdf(btn.dataset.id));
        });
        bindClientDocDeletes(list, loadFatture, 'fatture');
    } catch (err) {
        list.innerHTML = `<div class="entity-error">${esc(err.message)}</div>`;
    }
}

async function downloadFatturaPdf(id) {
    try {
        const res  = await fetch('api/generate_invoice_pdf.php', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ invoice_id: parseInt(id, 10) }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        window.open(json.data.download, '_blank');
    } catch (err) {
        showAlert('Errore generazione PDF: ' + err.message, 'error');
    }
}

// ── Contratti ────────────────────────────────────────────────────

async function loadContratti() {
    const list = document.getElementById('profile-contratti-list');
    list.innerHTML = '<div class="entity-loading">Caricamento…</div>';
    try {
        const [ctJson, docJson] = await Promise.all([
            fetch(`${CONT_API}?client_id=${clientId}&limit=${TAB_LIMIT}&page=1`).then(r => r.json()),
            fetch(`${DOCS_API}?client_id=${clientId}&doc_type=contract&limit=${TAB_LIMIT}&page=1`).then(r => r.json()).catch(() => ({})),
        ]);
        if (!ctJson.success) throw new Error(ctJson.error);
        const ct    = window.Pagination.unwrap(ctJson);
        const docsW = window.Pagination.unwrap(docJson);
        const items = ct.items, docs = docsW.items;
        const cnt   = items.length + docs.length;
        const cntTotal = ct.total + docsW.total;
        document.getElementById('profile-contratti-count').textContent =
            cntTotal ? window.Pagination.countLabel(cnt, cntTotal, cntTotal === 1 ? 'elemento' : 'elementi') : '';

        if (!cnt) {
            list.innerHTML = '<div class="entity-empty">Nessun contratto. Usa "Carica contratto" per allegare un file o "Nuovo Contratto".</div>';
            return;
        }

        const CT_TYPE   = { locazione: 'Locazione', compravendita: 'Compravendita', preliminare: 'Preliminare', mandato: 'Mandato', altro: 'Altro' };
        const ctToday = window.Fmt.today();
        // State derived from status + start/end dates.
        const ctState = (c) => {
            if (c.status === 'cancelled') return { label: 'Annullato', color: '#94a3b8' };
            if (c.status === 'expired' || (c.end_date && c.end_date < ctToday)) return { label: 'Scaduto', color: '#dc2626' };
            if (c.status === 'signed') {
                if (c.start_date && c.start_date > ctToday) return { label: 'In attesa', color: '#d97706' };
                return { label: 'Attivo', color: '#16a34a' };
            }
            if (c.status === 'sent') return { label: 'Inviato', color: '#2563eb' };
            return { label: 'Bozza', color: '#94a3b8' };
        };

        let html = items.map(c => {
            const st = ctState(c);
            const color  = st.color;
            const label  = st.label;
            const type   = CT_TYPE[c.contract_type] || c.contract_type;
            const where  = c.property_address ? `${esc(c.property_address)}, ${esc(c.property_city)}` : '—';
            const tenant = c.tenant_name ? `${esc(c.tenant_name)} ${esc(c.tenant_surname)}` : '';
            const rent   = c.monthly_rent ? `€ ${Number(c.monthly_rent).toLocaleString('it-IT')}/mese` : '';
            const period = [c.start_date ? fmtDate(c.start_date) : null, c.end_date ? fmtDate(c.end_date) : null].filter(Boolean).join(' → ');
            return `
            <div class="doc-item">
                <span class="doc-item__icon"><i data-lucide="copy"></i></span>
                <div class="doc-item__info">
                    <div class="doc-item__name">${esc(c.title || type)} — ${where}</div>
                    <div class="doc-item__meta">
                        <span class="badge" style="background:${color}20;color:${color};border:1px solid ${color}40;font-size:11px;">${label}</span>
                        · ${type}${tenant ? ' · <i data-lucide="user"></i> ' + tenant : ''}${rent ? ' · ' + rent : ''}${period ? ' · ' + period : ''}
                    </div>
                </div>
            </div>`;
        }).join('');
        html += clientDocFilesHtml(docs);
        html += trunc(cnt, cntTotal);
        list.innerHTML = html;
        bindClientDocDeletes(list, loadContratti, 'contratti');
    } catch (err) {
        list.innerHTML = `<div class="entity-error">${esc(err.message)}</div>`;
    }
}

// ── Documents ────────────────────────────────────────────────────

async function loadDocuments() {
    const list = document.getElementById('profile-docs-list');
    list.innerHTML = '<div class="entity-loading">Caricamento…</div>';
    try {
        const res  = await fetch(`${DOCS_API}?client_id=${clientId}&limit=${TAB_LIMIT}&page=1`);
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
                    ${RowMenu.button(d.id, `Azioni documento ${name}`)}
                </div>
            </div>`;
        }).join('');
        list.insertAdjacentHTML('beforeend', trunc(items.length, total));

        RowMenu.bind(list, btn => [
            { label: 'Scarica', icon: 'download',
              href: `api/download_document.php?id=${btn.dataset.id}`, target: '_blank' },
            { sep: true },
            { label: 'Elimina', icon: 'trash-2', danger: true,
              onClick: () => deleteDocument(btn.dataset.id) },
        ]);
    } catch (err) {
        list.innerHTML = `<div class="entity-error">${esc(err.message)}</div>`;
    }
}

async function uploadDocuments(e) {
    const files = [...e.target.files];
    if (!files.length) return;
    let errors = 0;
    for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('title', file.name);
        fd.append('doc_type', 'other');
        fd.append('client_id', clientId);
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

async function deleteDocument(docId) {
    if (!await confirmDialog('Eliminare questo documento?', { title: 'Elimina documento', confirmText: 'Elimina' })) return;
    const res  = await fetch(`${DOCS_API}?id=${docId}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
        tabsLoaded.delete('documents');
        loadDocuments();
        showAlert('Documento eliminato.', 'success');
    } else {
        showAlert(json.error, 'error');
    }
}

// ── Communications ───────────────────────────────────────────────

async function loadCommunications() {
    const container = document.getElementById('profile-chat-messages');
    container.innerHTML = '<div class="entity-loading">Caricamento…</div>';
    try {
        const res  = await fetch(`${COMM_API}?client_id=${clientId}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        const msgs = json.data?.messages ?? [];

        if (!msgs.length) {
            container.innerHTML = '<div class="chat-empty">Nessuna comunicazione ancora. Invia il primo messaggio qui sotto.</div>';
            return;
        }

        container.innerHTML = msgs.map(m => {
            const sent = m.direction === 'sent';
            return `
            <div class="chat-bubble chat-bubble--${sent ? 'sent' : 'received'}">
                <div class="chat-bubble__head">
                    <span>${sent ? '↗ Inviata' : '↙ Ricevuta'}</span>
                    <span>${fmtDateTime(m.created_at)}</span>
                </div>
                ${m.subject ? `<div class="chat-bubble__subject"><i data-lucide="mail"></i> ${esc(m.subject)}</div>` : ''}
                <div class="chat-bubble__body">${esc(m.body)}</div>
            </div>`;
        }).join('');

        container.scrollTop = container.scrollHeight;
    } catch (err) {
        container.innerHTML = `<div class="entity-error">${esc(err.message)}</div>`;
    }
}

async function sendEmail(e) {
    e.preventDefault();
    const subject = document.getElementById('profile-compose-subject').value.trim();
    const body    = document.getElementById('profile-compose-body').value.trim();
    if (!body) return;
    if (!client?.email) {
        showAlert("Il proprietario non ha un'email registrata.", 'error');
        return;
    }
    const btn = document.getElementById('btn-send-email');
    btn.disabled = true;
    try {
        const res  = await fetch(COMM_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: parseInt(clientId, 10), channel: 'email', direction: 'sent', subject, body }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        document.getElementById('profile-compose-subject').value = '';
        document.getElementById('profile-compose-body').value = '';
        showAlert('Email inviata con successo.', 'success');
        tabsLoaded.delete('communications');
        loadCommunications();
    } catch (err) {
        showAlert(err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

// ── Reminders ────────────────────────────────────────────────────

async function loadReminders() {
    const list = document.getElementById('profile-reminders-list');
    list.innerHTML = '<div class="entity-loading">Caricamento…</div>';
    let reminders = [];
    try {
        const res  = await fetch(`${REM_API}?client_id=${clientId}&limit=${TAB_LIMIT}&page=1`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        const remW = window.Pagination.unwrap(json);
        reminders  = remW.items;
        const cnt  = reminders.length;
        remindersTotal = remW.total;
        document.getElementById('profile-reminders-count').textContent =
            remW.total ? window.Pagination.countLabel(cnt, remW.total, remW.total === 1 ? 'promemoria' : 'promemoria') : '';

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
                    ${RowMenu.button(r.id, 'Azioni promemoria', { state: r.status })}
                </div>
            </div>`).join('');
        list.insertAdjacentHTML('beforeend', trunc(reminders.length, remindersTotal));

        RowMenu.bind(list, btn => [
            btn.dataset.state === 'pending'
                ? { label: 'Segna completato', icon: 'check-circle', onClick: () => completeReminder(btn.dataset.id) }
                : null,
            { label: 'Modifica', icon: 'pencil', onClick: () => {
                const r = reminders.find(x => x.id == btn.dataset.id);
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
        client_id:      parseInt(clientId, 10),
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

// ── Owner report ─────────────────────────────────────────────────

function openReportModal() {
    document.getElementById('profile-report-month').value = '';
    document.getElementById('profile-report-year').value  = new Date().getFullYear();
    document.getElementById('profile-report-modal').hidden = false;
}

function closeReportModal() {
    document.getElementById('profile-report-modal').hidden = true;
}

async function generateReport() {
    const btn = document.getElementById('profile-report-generate');
    btn.disabled = true; btn.textContent = 'Generazione...';
    try {
        const res  = await fetch(RPT_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: parseInt(clientId, 10),
                month: document.getElementById('profile-report-month').value || null,
                year:  document.getElementById('profile-report-year').value,
            }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        closeReportModal();
        window.open(json.data.download, '_blank');
    } catch (err) {
        showAlert(err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Genera rendiconto';
    }
}

async function generateFiscalStatement() {
    const btn = document.getElementById('profile-fiscal-generate');
    btn.disabled = true; btn.textContent = 'Generazione...';
    try {
        const res  = await fetch('api/owner_fiscal_statement.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: parseInt(clientId, 10),
                year:  document.getElementById('profile-report-year').value,
            }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        closeReportModal();
        window.open(json.data.download, '_blank');
    } catch (err) {
        showAlert(err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Prospetto fiscale';
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

// ── Dati personali (GDPR) ────────────────────────────────────────
//
// api/gdpr.php era completo e non aveva un solo bottone: esportazione Art. 15/20,
// richiesta di cancellazione Art. 17, registro dei consensi, tracciato degli
// accessi. Un diritto che l'interessato non puo' esercitare non e' un diritto.

const GDPR_API = 'api/gdpr.php';

/** Il tracciato salva il verbo tecnico; qui si legge in italiano. */
const ACCESS_LABELS = {
    export: 'Esportazione dei dati',
    view:   'Consultazione',
    erase:  'Cancellazione',
    update: 'Modifica',
    consent: 'Consenso registrato',
};

/** Chiave del soggetto: qui la scheda e' sempre di un proprietario. */
function gdprSubject() {
    return `subject_type=client&subject_id=${encodeURIComponent(clientId)}`;
}

async function gdprExport() {
    const btn = document.getElementById('gdpr-export');
    const old = btn.innerHTML;
    btn.disabled = true; btn.textContent = 'Preparazione…';
    try {
        const res  = await fetch(`${GDPR_API}?action=export&${gdprSubject()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);

        // Il file si scarica dal browser: il contenuto e' gia' qui e passare da
        // un secondo endpoint significherebbe registrare due accessi per una
        // sola richiesta dell'interessato.
        const name = [client?.surname, client?.name].filter(Boolean).join('_') || `cliente_${clientId}`;
        const blob = new Blob([JSON.stringify(json.data, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url;
        a.download = `dati-personali_${name}_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);

        showAlert("Esportazione scaricata. La richiesta e stata registrata.", 'success');
        tabsLoaded.delete('gdpr'); loadGdpr();   // l'accesso appena registrato deve comparire
    } catch (err) {
        showAlert(err.message, 'error');
    } finally {
        btn.disabled = false; btn.innerHTML = old;
        if (window.lucide) window.lucide.createIcons();
    }
}

async function gdprErase() {
    const who = [client?.name, client?.surname].filter(Boolean).join(' ') || `#${clientId}`;
    const reason = window.prompt(
        [
            `Richiesta di cancellazione per ${who}.`,
            '',
            'Viene REGISTRATA, non eseguita: la cancellazione effettiva è un\'azione separata,',
            'perché fatture e contratti hanno obblighi di conservazione fiscale che il diritto',
            'all\'oblio non supera.',
            '',
            'Motivo della richiesta:',
        ].join('\n')
    );
    if (reason === null) return;   // annullato

    const btn = document.getElementById('gdpr-erase');
    btn.disabled = true;
    try {
        const res = await fetch(`${GDPR_API}?action=erase`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // confirm:false = registra la richiesta e basta. L'esecuzione vera
            // passa da una decisione umana, non da un bottone in una scheda.
            body: JSON.stringify({ subject_type: 'client', subject_id: Number(clientId), reason: reason.trim() || null, confirm: false }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        showAlert('Richiesta di cancellazione registrata.', 'success');
    } catch (err) {
        showAlert(err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

async function loadGdpr() {
    const consentsEl = document.getElementById('gdpr-consents');
    const logEl      = document.getElementById('gdpr-log');
    if (!consentsEl || !logEl) return;

    const render = (el, rows, empty, line) => {
        if (!rows || !rows.length) { el.innerHTML = `<p class="text-muted">${empty}</p>`; return; }
        el.innerHTML = rows.map(line).join('');
    };

    try {
        const [c, l] = await Promise.all([
            fetch(`${GDPR_API}?action=consents&${gdprSubject()}`).then(r => r.json()),
            fetch(`${GDPR_API}?action=log&${gdprSubject()}`).then(r => r.json()),
        ]);

        // Entrambe le azioni rispondono con `data` = array nudo
        // (api/gdpr.php:99 e :123 fanno apiSuccess($stmt->fetchAll())).
        render(consentsEl, c.success ? (c.data ?? []) : [],
            'Nessun consenso registrato per questa persona.',
            r => `<div class="gdpr-row">
                    <span class="gdpr-row__main">${esc(r.purpose || '—')}</span>
                    <span class="badge ${Number(r.granted) ? 'badge--success' : 'badge--muted'}">${Number(r.granted) ? 'Concesso' : 'Revocato'}</span>
                    <span class="text-muted">${esc(r.legal_basis || '')}</span>
                    <span class="text-muted">${fmtDate(r.created_at)}</span>
                  </div>`);

        // Campi reali del tracciato: action, detail, actor_label, ip_address.
        render(logEl, l.success ? (l.data ?? []) : [],
            'Nessun accesso registrato.',
            r => `<div class="gdpr-row">
                    <span class="gdpr-row__main">${esc(ACCESS_LABELS[r.action] || r.action || '—')}</span>
                    <span class="text-muted">${esc(r.actor_label || '')}</span>
                    <span class="text-muted">${esc(r.detail || '')}</span>
                    <span class="text-muted">${fmtDateTime(r.created_at)}</span>
                  </div>`);
    } catch (err) {
        consentsEl.innerHTML = `<p class="text-muted">Impossibile caricare: ${esc(err.message)}</p>`;
        logEl.innerHTML = '';
    }
}

// ── Accesso al portale proprietario ──────────────────────────────
//
// Il portale (owner/index.php) e la sua API esistevano da tempo, ma non c'era
// una sola schermata da cui attivarlo per qualcuno: un proprietario non poteva
// entrarci, e nessuno poteva farcelo entrare.
//
// Il portale non si apre digitando una password. api/owner_portal.php lo
// permetterebbe, ma significherebbe che l'agenzia conosce la password con cui
// quella persona apre i propri contratti e documenti — e se il portale venisse
// aperto da qualcun altro, non ci sarebbe modo di sostenere che l'agenzia non
// c'entri. Si manda un link a uso singolo: l'agente invia, l'interessato
// sceglie, nessuno dei due vede la password dell'altro.

function loadPortal() {
    const state = document.getElementById('portal-state');
    const email = document.getElementById('portal-email');
    if (!state || !email) return;

    // `portal_enabled` è un booleano calcolato dall'API: l'hash della password
    // non lascia più il server (api/clients.php:163).
    const attivo = !!client?.portal_enabled;
    state.textContent = attivo
        ? 'Attivo: il proprietario può entrare nel portale.'
        : 'Non ancora attivo: il proprietario non ha una password.';
    state.className = attivo ? 'text-muted' : 'text-muted';
    email.value = client?.portal_email || client?.email || '';
}

async function savePortalEmail() {
    const email = document.getElementById('portal-email').value.trim();
    if (!email) { showAlert('Inserisci l\u2019indirizzo del portale.', 'error'); return; }

    const btn = document.getElementById('portal-save-email');
    btn.disabled = true;
    try {
        // portal_email è un campo di `clients`: si salva dall'endpoint dei
        // proprietari, che fa sovrascrittura completa — quindi si rimanda il
        // record intero con il solo indirizzo cambiato.
        const res = await fetch(`${API}?id=${clientId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...client, portal_email: email }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        client = json.data || client;
        showAlert('Indirizzo del portale salvato.', 'success');
        loadPortal();
    } catch (err) {
        showAlert(err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

async function sendPortalLink() {
    const btn  = document.getElementById('portal-send-link');
    const hint = document.getElementById('portal-link-hint');
    btn.disabled = true;
    try {
        const res = await fetch('api/password_reset.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject_type: 'owner', subject_id: Number(clientId) }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);

        if (json.data?.simulated) {
            // In sviluppo l'email non parte davvero: dirlo, e mostrare il link,
            // invece di far cercare per mezz'ora un messaggio che non esiste.
            hint.hidden = false;
            hint.textContent = 'Invio simulato (email non attiva). Link: ' + (json.data.link || '—');
            showAlert('Invio simulato: l\u2019email non è attiva in questo ambiente.', 'warning');
        } else {
            hint.hidden = true;
            showAlert('Link inviato. Scade il ' + fmtDateTime(json.data?.expires_at), 'success');
        }
    } catch (err) {
        showAlert(err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}
