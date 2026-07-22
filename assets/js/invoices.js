/**
 * Invoices (Fatture) — CRUD + PDF (Phase 11)
 */
(function () {
    'use strict';

    const API         = 'api/invoices.php';
    const PDF_API     = 'api/generate_invoice_pdf.php';
    const CLIENTS_API = 'api/clients.php';
    const LEADS_API   = 'api/leads.php';

    const STATUS_LABELS = { draft: 'Bozza', sent: 'Inviata', paid: 'Pagata', cancelled: 'Annullata' };

    let invoices = [];
    let currentPage = 1;
    const PAGE_LIMIT = 25;
    let schedaInvoiceId = null;
    const els = {};

    function init() {
        els.grid         = document.getElementById('invoices-grid');
        els.statusFilter = document.getElementById('invoice-status-filter');
        els.yearFilter   = document.getElementById('invoice-year-filter');
        els.alert        = document.getElementById('invoices-alert');
        els.clientSelect = document.getElementById('invoice-client');
        els.leadSelect   = document.getElementById('invoice-lead');
        els.pagination   = document.getElementById('invoices-pagination');

        bindEvents();
        Promise.all([loadClients(), loadLeads()]).then(() => {
            loadInvoices();
            // Legacy "+ Nuova Fattura" entry now redirects to the dedicated page.
            const vp = window.App?.viewParams;
            if (vp && vp.openNew && window.App) window.App.navigateTo('invoice_edit', vp.clientId ? { clientId: vp.clientId } : {});
        });
    }

    function bindEvents() {
        document.getElementById('btn-new-invoice').addEventListener('click', () => {
            if (window.App) window.App.navigateTo('invoice_edit');
        });
        els.statusFilter.addEventListener('change', () => { currentPage = 1; loadInvoices(); });
        els.yearFilter.addEventListener('input', () => { clearTimeout(els._t); els._t = setTimeout(() => { currentPage = 1; loadInvoices(); }, 300); });

        // Scheda quick-view
        const schedaModal = document.getElementById('invoice-scheda-modal');
        document.getElementById('invoice-scheda-close').addEventListener('click', closeSchedaModal);
        document.getElementById('scheda-inv-close2').addEventListener('click', closeSchedaModal);
        schedaModal.addEventListener('click', (e) => { if (e.target === schedaModal) closeSchedaModal(); });
        document.getElementById('scheda-inv-edit').addEventListener('click', () => {
            const id = schedaInvoiceId;
            closeSchedaModal();
            if (window.App) window.App.navigateTo('invoice_edit', { invoiceId: id });
        });
        document.getElementById('scheda-inv-pdf').addEventListener('click', () => {
            if (schedaInvoiceId) generatePdf(schedaInvoiceId);
        });
        document.getElementById('scheda-inv-send').addEventListener('click', () => {
            const id = schedaInvoiceId;
            closeSchedaModal();
            quickStatus(id, 'sent');
        });
        document.getElementById('scheda-inv-paid').addEventListener('click', () => {
            const id = schedaInvoiceId;
            closeSchedaModal();
            quickStatus(id, 'paid');
        });
    }

    async function loadClients() {
        const items = await Pagination.fetchList(CLIENTS_API, { status: 'active' });
        if (els.clientSelect) els.clientSelect.innerHTML = '<option value="">— Nessuno —</option>' +
            items.map(c => `<option value="${c.id}">${escapeHtml(c.surname)} ${escapeHtml(c.name)}</option>`).join('');
    }
    async function loadLeads() {
        const res = await fetch(`${LEADS_API}?limit=500&page=1`);
        const json = await res.json();
        if (json.success) {
            const items = Pagination.parseResponse(json).items;
            if (els.leadSelect) els.leadSelect.innerHTML = '<option value="">— Nessuno —</option>' +
                items.map(l => `<option value="${l.id}">${escapeHtml(l.surname)} ${escapeHtml(l.name)}</option>`).join('');
        }
    }

    async function loadInvoices() {
        const params = new URLSearchParams();
        if (els.statusFilter.value) params.set('status', els.statusFilter.value);
        if (els.yearFilter.value) params.set('year', els.yearFilter.value);
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);
        const url = `${API}?${params}`;
        softLoad(els.grid, '<div class="entity-loading">Caricamento…</div>');
        try {
            const res = await fetch(url);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const parsed = Pagination.parseResponse(json);
            invoices = parsed.items;
            renderCards();
            Pagination.render(els.pagination, parsed, (p) => { currentPage = p; loadInvoices(); });
        } catch (err) {
            els.grid.classList.remove('is-loading');
            els.grid.innerHTML = `<div class="entity-error">${escapeHtml(err.message)}</div>`;
        }
    }

    function renderCards() {
        els.grid.classList.remove('is-loading');
        if (invoices.length === 0) {
            els.grid.innerHTML = '<div class="entity-empty">Nessuna fattura trovata.</div>';
            return;
        }
        els.grid.innerHTML = invoices.map(i => {
            const who = i.client_id ? `${i.client_surname} ${i.client_name}` :
                        (i.lead_id ? `${i.lead_surname} ${i.lead_name}` : '—');
            return `
            <div class="entity-card invoice-card invoice-card--${i.status} entity-card--clickable" data-id="${i.id}">
                <div class="invoice-card__header">
                    <strong>${escapeHtml(i.invoice_number)}</strong>
                    <span class="badge badge--invoice-${i.status}">${STATUS_LABELS[i.status] || i.status}</span>
                </div>
                <div class="entity-card__body">
                    <div class="entity-card__info"><i data-lucide="user"></i> ${escapeHtml(who)}</div>
                    <div class="entity-card__info">Imponibile: € ${fmt(i.amount)} · IVA: € ${fmt(i.vat_amount)}</div>
                    <div class="entity-card__info"><strong>Totale: € ${fmt(i.total)}</strong></div>
                    <div class="entity-card__info text-muted">Emessa: ${formatDate(i.issue_date)}${i.due_date ? ' · Scad.: ' + formatDate(i.due_date) : ''}</div>
                </div>
                <div class="entity-card__footer">
                    <div class="entity-card__actions">
                        <button class="btn btn--sm btn--ghost btn-pdf" data-id="${i.id}" title="Anteprima PDF"><i data-lucide="file-text"></i></button>
                        <button class="btn btn--sm btn--ghost btn-xml" data-id="${i.id}" title="Scarica XML FatturaPA"><i data-lucide="file-code-2"></i></button>
                        <button class="btn btn--sm btn--ghost btn-sdi" data-id="${i.id}" data-num="${esc(i.invoice_number || '')}" title="Fattura elettronica / SdI"><i data-lucide="send-horizontal"></i></button>
                        ${i.status === 'draft' ? `<button class="btn btn--sm btn--ghost btn-send" data-id="${i.id}" title="Segna come inviata"><i data-lucide="send"></i></button>` : ''}
                        ${i.status !== 'paid' && i.status !== 'cancelled' ? `<button class="btn btn--sm btn--ghost btn-paid" data-id="${i.id}" title="Segna come pagata"><i data-lucide="check"></i></button>` : ''}
                        <button class="btn btn--sm btn--ghost btn-edit" data-id="${i.id}" title="Modifica"><i data-lucide="pencil"></i></button>
                        ${i.status === 'draft' ? `<button class="btn btn--sm btn--ghost btn-delete" data-id="${i.id}" title="Elimina"><i data-lucide="trash-2"></i></button>` : ''}
                    </div>
                </div>
            </div>`;
        }).join('');

        els.grid.querySelectorAll('.btn-edit').forEach(b => b.addEventListener('click', () => {
            if (window.App) window.App.navigateTo('invoice_edit', { invoiceId: b.dataset.id });
        }));
        els.grid.querySelectorAll('.btn-pdf').forEach(b => b.addEventListener('click', () => generatePdf(b.dataset.id)));
        els.grid.querySelectorAll('.btn-xml').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); downloadFatturaXml(b.dataset.id); }));
        els.grid.querySelectorAll('.btn-sdi').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); openSdiModal(b.dataset.id, b.dataset.num); }));
        els.grid.querySelectorAll('.btn-send').forEach(b => b.addEventListener('click', () => quickStatus(b.dataset.id, 'sent')));
        els.grid.querySelectorAll('.btn-paid').forEach(b => b.addEventListener('click', () => quickStatus(b.dataset.id, 'paid')));
        els.grid.querySelectorAll('.btn-delete').forEach(b => b.addEventListener('click', () => deleteInvoice(b.dataset.id)));

        els.grid.querySelectorAll('.entity-card--clickable').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('button, a, input')) return;
                const i = invoices.find(x => x.id == card.dataset.id);
                if (i) openSchedaModal(i);
            });
        });
    }

    function openSchedaModal(i) {
        schedaInvoiceId = i.id;
        const who = i.client_id
            ? `${i.client_surname} ${i.client_name}`
            : (i.lead_id ? `${i.lead_surname} ${i.lead_name}` : '—');

        document.getElementById('scheda-inv-number').textContent = i.invoice_number;
        document.getElementById('scheda-inv-badge').innerHTML =
            `<span class="badge badge--invoice-${i.status}">${STATUS_LABELS[i.status] || i.status}</span>`;

        document.getElementById('scheda-inv-body').innerHTML = `
            <div class="scheda-rows">
                <div class="scheda-row"><span class="scheda-row__label"><i data-lucide="user"></i> Intestatario</span><span class="scheda-row__value">${escapeHtml(who)}</span></div>
                <div class="scheda-row"><span class="scheda-row__label"><i data-lucide="euro"></i> Imponibile</span><span class="scheda-row__value">€ ${fmt(i.amount)}</span></div>
                <div class="scheda-row"><span class="scheda-row__label"><i data-lucide="bar-chart-3"></i> IVA (${i.vat_rate}%)</span><span class="scheda-row__value">€ ${fmt(i.vat_amount)}</span></div>
                <div class="scheda-row"><span class="scheda-row__label"><i data-lucide="wallet"></i> Totale</span><span class="scheda-row__value"><strong>€ ${fmt(i.total)}</strong></span></div>
                <div class="scheda-row"><span class="scheda-row__label"><i data-lucide="calendar"></i> Emessa</span><span class="scheda-row__value">${formatDate(i.issue_date)}${i.due_date ? ' · Scad. ' + formatDate(i.due_date) : ''}</span></div>
                ${i.paid_date ? `<div class="scheda-row"><span class="scheda-row__label"><i data-lucide="check-circle"></i> Pagata il</span><span class="scheda-row__value">${formatDate(i.paid_date)}</span></div>` : ''}
                ${i.description ? `<div class="scheda-row"><span class="scheda-row__label"><i data-lucide="file-pen"></i> Descrizione</span><span class="scheda-row__value">${escapeHtml(i.description)}</span></div>` : ''}
                ${i.notes ? `<div class="scheda-row"><span class="scheda-row__label"><i data-lucide="file-text"></i> Note</span><span class="scheda-row__value">${escapeHtml(i.notes)}</span></div>` : ''}
            </div>`;

        document.getElementById('scheda-inv-send').hidden = i.status !== 'draft';
        document.getElementById('scheda-inv-paid').hidden = i.status === 'paid' || i.status === 'cancelled';

        document.getElementById('invoice-scheda-modal').hidden = false;
    }

    function closeSchedaModal() {
        schedaInvoiceId = null;
        document.getElementById('invoice-scheda-modal').hidden = true;
    }

    async function quickStatus(id, status) {
        const inv = invoices.find(x => x.id == id);
        if (!inv) return;
        const data = {
            client_id: inv.client_id, lead_id: inv.lead_id, description: inv.description,
            amount: inv.amount, vat_rate: inv.vat_rate, status,
            issue_date: inv.issue_date, due_date: inv.due_date,
            paid_date: status === 'paid' ? (inv.paid_date || new Date().toISOString().slice(0, 10)) : inv.paid_date,
            notes: inv.notes,
        };
        try {
            const res = await fetch(`${API}?id=${id}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert('Fattura aggiornata.', 'success');
            loadInvoices();
        } catch (err) { showAlert(err.message, 'error'); }
    }

    async function generatePdf(id) {
        try {
            const res = await fetch(PDF_API, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ invoice_id: parseInt(id, 10) }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            window.open(json.data.download, '_blank');
        } catch (err) { showAlert(err.message, 'error'); }
    }

    async function downloadFatturaXml(id) {
        const XML_API = 'api/generate_fattura_xml.php';
        try {
            // Readiness check first — warn if the agency fiscal identity is incomplete.
            const res = await fetch(`${XML_API}?id=${id}&check=1`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            if (!json.data.ready) {
                showAlert('Completa i dati in Impostazioni → Fatturazione: ' + (json.data.missing || []).join(', '), 'error');
                return;
            }
            // Trigger the actual XML download.
            window.location.href = `${XML_API}?id=${id}`;
        } catch (err) { showAlert(err.message, 'error'); }
    }

    // ── FatturaPA / SdI lifecycle ─────────────────────────────────────────────
    const SDI_API = 'api/fattura_sdi.php';
    const SDI_STATUS = {
        generato:             { label: 'XML generato',        badge: 'badge' },
        trasmesso:            { label: 'Trasmessa allo SdI',  badge: 'badge--warning' },
        consegnato:           { label: 'Consegnata',          badge: 'badge--success' },
        messa_a_disposizione: { label: 'Messa a disposizione',badge: 'badge--warning' },
        scartato:             { label: 'Scartata',            badge: 'badge--danger' },
        accettato:            { label: 'Accettata',           badge: 'badge--success' },
        rifiutato:            { label: 'Rifiutata',           badge: 'badge--danger' },
        errore_invio:         { label: 'Errore invio',        badge: 'badge--danger' },
    };

    function ensureSdiModal() {
        let modal = document.getElementById('sdi-modal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'sdi-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal modal--md" role="dialog" aria-labelledby="sdi-modal-title">
                <div class="modal-header">
                    <h3 id="sdi-modal-title">Fattura elettronica</h3>
                    <button class="modal-close" id="sdi-modal-close" aria-label="Chiudi">&times;</button>
                </div>
                <div class="modal-body" id="sdi-modal-body"></div>
            </div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', e => { if (e.target === modal) modal.hidden = true; });
        modal.querySelector('#sdi-modal-close').addEventListener('click', () => { modal.hidden = true; });
        return modal;
    }

    let sdiCurrentInvoice = null;

    async function openSdiModal(invoiceId, number) {
        sdiCurrentInvoice = invoiceId;
        const modal = ensureSdiModal();
        modal.querySelector('#sdi-modal-title').textContent = 'Fattura elettronica — ' + (number || ('#' + invoiceId));
        const body = modal.querySelector('#sdi-modal-body');
        body.innerHTML = '<p class="text-muted" style="text-align:center;padding:1rem;">Caricamento…</p>';
        modal.hidden = false;
        await renderSdiBody(invoiceId, body);
    }

    async function renderSdiBody(invoiceId, body) {
        try {
            const res  = await fetch(`${SDI_API}?invoice_id=${invoiceId}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const d  = json.data;
            const ft = d.transmission;
            const st = ft ? (SDI_STATUS[ft.status] || { label: ft.status, badge: 'badge' }) : null;

            const channelNote = d.automatic
                ? `Invio automatico attivo (provider: ${esc(d.provider)}).`
                : 'Nessun intermediario configurato: dopo la generazione scarica l\'XML e caricalo sul tuo canale accreditato.';

            let html = '';
            html += `<p>${ft ? `Stato: <span class="badge ${st.badge}">${esc(st.label)}</span>` : 'Nessun file ancora generato.'}</p>`;
            if (ft) {
                html += '<ul style="list-style:none;padding:0;margin:0 0 12px 0;font-size:13px;">';
                if (ft.sdi_identificativo) html += `<li>Identificativo SdI: <strong>${esc(ft.sdi_identificativo)}</strong></li>`;
                if (ft.receipt_type) html += `<li>Ultima ricevuta: <strong>${esc(ft.receipt_type)}</strong></li>`;
                if (ft.receipt_message) html += `<li class="text-muted">${esc(ft.receipt_message)}</li>`;
                if (ft.sent_at) html += `<li class="text-muted">Inviata: ${esc(ft.sent_at)}</li>`;
                html += '</ul>';
            }
            html += `<p class="text-muted" style="font-size:12px;">${channelNote}</p>`;

            html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">';
            html += '<button class="btn btn--primary btn--sm" data-sdi-act="generate">Genera XML</button>';
            if (ft) {
                html += '<button class="btn btn--ghost btn--sm" data-sdi-act="download">Scarica XML</button>';
                if (!['consegnato','accettato','messa_a_disposizione'].includes(ft.status)) {
                    html += `<button class="btn btn--ghost btn--sm" data-sdi-act="transmit">${d.automatic ? 'Trasmetti allo SdI' : 'Segna come inviata'}</button>`;
                }
            }
            html += '</div>';

            // Receipt recording (manual entry of the SdI outcome)
            if (ft) {
                html += `<hr style="margin:14px 0;border:none;border-top:1px solid var(--border-color,#e5e7eb)">
                    <h4 style="margin:0 0 8px 0;">Registra ricevuta SdI</h4>
                    <div class="form-row form-row--2">
                        <div class="form-group">
                            <label for="sdi-receipt-type">Tipo ricevuta</label>
                            <select id="sdi-receipt-type" class="form-select">
                                <option value="RC">RC — Consegna</option>
                                <option value="MC">MC — Mancata consegna</option>
                                <option value="NS">NS — Scarto</option>
                                <option value="NE">NE — Esito (accetta/rifiuta)</option>
                                <option value="DT">DT — Decorrenza termini</option>
                                <option value="AT">AT — Attestazione</option>
                            </select>
                        </div>
                        <div class="form-group" id="sdi-ne-wrap" style="display:none;">
                            <label for="sdi-ne-outcome">Esito committente</label>
                            <select id="sdi-ne-outcome" class="form-select">
                                <option value="accettato">Accettata</option>
                                <option value="rifiutato">Rifiutata</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-row form-row--2">
                        <div class="form-group"><label for="sdi-identificativo">Identificativo SdI</label><input type="text" id="sdi-identificativo" class="form-input"></div>
                        <div class="form-group"><label for="sdi-receipt-msg">Note ricevuta</label><input type="text" id="sdi-receipt-msg" class="form-input"></div>
                    </div>
                    <button class="btn btn--ghost btn--sm" data-sdi-act="record">Registra ricevuta</button>`;
            }

            body.innerHTML = html;
            if (window.lucide) window.lucide.createIcons();

            const typeSel = body.querySelector('#sdi-receipt-type');
            if (typeSel) typeSel.addEventListener('change', () => {
                body.querySelector('#sdi-ne-wrap').style.display = typeSel.value === 'NE' ? '' : 'none';
            });

            body.querySelectorAll('[data-sdi-act]').forEach(btn => {
                btn.addEventListener('click', () => sdiAction(btn.dataset.sdiAct, invoiceId, body));
            });
        } catch (err) {
            body.innerHTML = `<p style="color:var(--color-danger);text-align:center;padding:1rem;">${esc(err.message)}</p>`;
        }
    }

    async function sdiAction(action, invoiceId, body) {
        if (action === 'download') {
            // Need the transmission id for the secure download; fetch status then stream.
            try {
                const res = await fetch(`${SDI_API}?invoice_id=${invoiceId}`).then(r => r.json());
                const ftId = res.success && res.data.transmission ? res.data.transmission.id : null;
                if (ftId) window.location.href = `${SDI_API}?action=download&id=${ftId}`;
            } catch (e) { showAlert(e.message, 'error'); }
            return;
        }

        let url = `${SDI_API}?action=${action}`;
        const payload = { invoice_id: parseInt(invoiceId, 10) };
        if (action === 'record') {
            url = `${SDI_API}?action=record_receipt`;
            payload.receipt_type = body.querySelector('#sdi-receipt-type').value;
            payload.ne_outcome   = body.querySelector('#sdi-ne-outcome')?.value;
            payload.sdi_identificativo = body.querySelector('#sdi-identificativo').value.trim();
            payload.message      = body.querySelector('#sdi-receipt-msg').value.trim();
        }
        body.innerHTML = '<p class="text-muted" style="text-align:center;padding:1rem;">Operazione in corso…</p>';
        try {
            const res  = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            await renderSdiBody(invoiceId, body);
            loadInvoices();
        } catch (err) {
            showAlert(err.message, 'error');
            await renderSdiBody(invoiceId, body);
        }
    }

    async function deleteInvoice(id) {
        if (!await confirmDialog('Vuoi eliminare questa bozza di fattura?', { title: 'Elimina fattura' })) return;
        try {
            const res = await fetch(`${API}?id=${id}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert('Fattura eliminata.', 'success');
            loadInvoices();
        } catch (err) { showAlert(err.message, 'error'); }
    }

    function fmt(n) { return Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function formatDate(d) { return d ? new Date(d).toLocaleDateString('it-IT') : ''; }
    function showAlert(message, type) {
        els.alert.textContent = message;
        els.alert.className = `alert alert--${type}`;
        els.alert.style.display = 'block';
        clearTimeout(els.alert._timer);
        els.alert._timer = setTimeout(() => { els.alert.style.display = 'none'; }, 4000);
    }
    function escapeHtml(str) {
        if (str == null) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }
    // The FatturaPA/SdI additions call esc() — alias it or every render throws.
    const esc = escapeHtml;

    init();
})();
