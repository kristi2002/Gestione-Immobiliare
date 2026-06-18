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
        els.modal        = document.getElementById('invoice-modal');
        els.form         = document.getElementById('invoice-form');
        els.modalTitle   = document.getElementById('invoice-modal-title');
        els.clientSelect = document.getElementById('invoice-client');
        els.leadSelect   = document.getElementById('invoice-lead');
        els.pagination   = document.getElementById('invoices-pagination');

        bindEvents();
        Promise.all([loadClients(), loadLeads()]).then(loadInvoices);
    }

    function bindEvents() {
        document.getElementById('btn-new-invoice').addEventListener('click', () => openModal());
        document.getElementById('invoice-modal-close').addEventListener('click', closeModal);
        document.getElementById('invoice-modal-cancel').addEventListener('click', closeModal);
        els.form.addEventListener('submit', handleFormSubmit);
        els.statusFilter.addEventListener('change', () => { currentPage = 1; loadInvoices(); });
        els.yearFilter.addEventListener('input', () => { clearTimeout(els._t); els._t = setTimeout(() => { currentPage = 1; loadInvoices(); }, 300); });
        els.modal.addEventListener('click', (e) => { if (e.target === els.modal) closeModal(); });

        // Scheda quick-view
        const schedaModal = document.getElementById('invoice-scheda-modal');
        document.getElementById('invoice-scheda-close').addEventListener('click', closeSchedaModal);
        document.getElementById('scheda-inv-close2').addEventListener('click', closeSchedaModal);
        schedaModal.addEventListener('click', (e) => { if (e.target === schedaModal) closeSchedaModal(); });
        document.getElementById('scheda-inv-edit').addEventListener('click', () => {
            const id = schedaInvoiceId;
            closeSchedaModal();
            const i = invoices.find(x => x.id === id);
            if (i) openModal(i);
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
        els.clientSelect.innerHTML = '<option value="">— Nessuno —</option>' +
            items.map(c => `<option value="${c.id}">${escapeHtml(c.surname)} ${escapeHtml(c.name)}</option>`).join('');
    }
    async function loadLeads() {
        const res = await fetch(`${LEADS_API}?limit=500&page=1`);
        const json = await res.json();
        if (json.success) {
            const items = Pagination.parseResponse(json).items;
            els.leadSelect.innerHTML = '<option value="">— Nessuno —</option>' +
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
                    <div class="entity-card__info">👤 ${escapeHtml(who)}</div>
                    <div class="entity-card__info">Imponibile: € ${fmt(i.amount)} · IVA: € ${fmt(i.vat_amount)}</div>
                    <div class="entity-card__info"><strong>Totale: € ${fmt(i.total)}</strong></div>
                    <div class="entity-card__info text-muted">Emessa: ${formatDate(i.issue_date)}${i.due_date ? ' · Scad.: ' + formatDate(i.due_date) : ''}</div>
                </div>
                <div class="entity-card__footer">
                    <div class="entity-card__actions">
                        <button class="btn btn--sm btn--ghost btn-pdf" data-id="${i.id}" title="Anteprima PDF">📄</button>
                        ${i.status === 'draft' ? `<button class="btn btn--sm btn--ghost btn-send" data-id="${i.id}" title="Segna come inviata">📤</button>` : ''}
                        ${i.status !== 'paid' && i.status !== 'cancelled' ? `<button class="btn btn--sm btn--ghost btn-paid" data-id="${i.id}" title="Segna come pagata">✓</button>` : ''}
                        <button class="btn btn--sm btn--ghost btn-edit" data-id="${i.id}" title="Modifica">✏️</button>
                        ${i.status === 'draft' ? `<button class="btn btn--sm btn--ghost btn-delete" data-id="${i.id}" title="Elimina">🗑️</button>` : ''}
                    </div>
                </div>
            </div>`;
        }).join('');

        els.grid.querySelectorAll('.btn-edit').forEach(b => b.addEventListener('click', () => {
            const i = invoices.find(x => x.id == b.dataset.id); if (i) openModal(i);
        }));
        els.grid.querySelectorAll('.btn-pdf').forEach(b => b.addEventListener('click', () => generatePdf(b.dataset.id)));
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
                <div class="scheda-row"><span class="scheda-row__label">👤 Intestatario</span><span class="scheda-row__value">${escapeHtml(who)}</span></div>
                <div class="scheda-row"><span class="scheda-row__label">💶 Imponibile</span><span class="scheda-row__value">€ ${fmt(i.amount)}</span></div>
                <div class="scheda-row"><span class="scheda-row__label">📊 IVA (${i.vat_rate}%)</span><span class="scheda-row__value">€ ${fmt(i.vat_amount)}</span></div>
                <div class="scheda-row"><span class="scheda-row__label">💰 Totale</span><span class="scheda-row__value"><strong>€ ${fmt(i.total)}</strong></span></div>
                <div class="scheda-row"><span class="scheda-row__label">📅 Emessa</span><span class="scheda-row__value">${formatDate(i.issue_date)}${i.due_date ? ' · Scad. ' + formatDate(i.due_date) : ''}</span></div>
                ${i.paid_date ? `<div class="scheda-row"><span class="scheda-row__label">✅ Pagata il</span><span class="scheda-row__value">${formatDate(i.paid_date)}</span></div>` : ''}
                ${i.description ? `<div class="scheda-row"><span class="scheda-row__label">📝 Descrizione</span><span class="scheda-row__value">${escapeHtml(i.description)}</span></div>` : ''}
                ${i.notes ? `<div class="scheda-row"><span class="scheda-row__label">📄 Note</span><span class="scheda-row__value">${escapeHtml(i.notes)}</span></div>` : ''}
            </div>`;

        document.getElementById('scheda-inv-send').hidden = i.status !== 'draft';
        document.getElementById('scheda-inv-paid').hidden = i.status === 'paid' || i.status === 'cancelled';

        document.getElementById('invoice-scheda-modal').hidden = false;
    }

    function closeSchedaModal() {
        schedaInvoiceId = null;
        document.getElementById('invoice-scheda-modal').hidden = true;
    }

    function openModal(inv = null) {
        els.form.reset();
        document.getElementById('invoice-id').value = '';
        document.getElementById('invoice-vat').value = 22;
        if (inv) {
            els.modalTitle.textContent = 'Modifica Fattura ' + inv.invoice_number;
            document.getElementById('invoice-id').value = inv.id;
            els.clientSelect.value = inv.client_id || '';
            els.leadSelect.value = inv.lead_id || '';
            document.getElementById('invoice-description').value = inv.description;
            document.getElementById('invoice-amount').value = inv.amount;
            document.getElementById('invoice-vat').value = inv.vat_rate;
            document.getElementById('invoice-status').value = inv.status;
            document.getElementById('invoice-issue').value = inv.issue_date;
            document.getElementById('invoice-due').value = inv.due_date || '';
            document.getElementById('invoice-paid').value = inv.paid_date || '';
            document.getElementById('invoice-notes').value = inv.notes || '';
        } else {
            els.modalTitle.textContent = 'Nuova Fattura';
            document.getElementById('invoice-issue').value = new Date().toISOString().slice(0, 10);
        }
        els.modal.hidden = false;
    }
    function closeModal() { els.modal.hidden = true; }

    async function handleFormSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('invoice-id').value;
        const data = {
            client_id: els.clientSelect.value || null,
            lead_id: els.leadSelect.value || null,
            description: document.getElementById('invoice-description').value.trim(),
            amount: document.getElementById('invoice-amount').value,
            vat_rate: document.getElementById('invoice-vat').value,
            status: document.getElementById('invoice-status').value,
            issue_date: document.getElementById('invoice-issue').value,
            due_date: document.getElementById('invoice-due').value,
            paid_date: document.getElementById('invoice-paid').value,
            notes: document.getElementById('invoice-notes').value.trim(),
        };
        const btn = document.getElementById('invoice-modal-save');
        btn.disabled = true; btn.textContent = 'Salvataggio...';
        try {
            const url = id ? `${API}?id=${id}` : API;
            const res = await fetch(url, {
                method: id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeModal();
            showAlert('Fattura salvata.', 'success');
            loadInvoices();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Salva';
        }
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

    init();
})();
