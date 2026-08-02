/**
 * Payments (Scadenzario Affitti) — CRUD (Phase 10)
 */
(function () {
    'use strict';

    const API            = 'api/payments.php';

    const STATUS_LABELS = {
        pending:   'In attesa',
        paid:      'Pagato',
        late:      'In ritardo',
        cancelled: 'Annullato',
    };

    /**
     * "In ritardo" is derived server-side (payments.php SQL_IS_LATE) and returned
     * as `is_late`, because nothing routinely writes status='late' to the column.
     * Render from this — not p.status — or an overdue row shows the "In attesa"
     * badge while sitting inside the "In ritardo" filter.
     */
    function effStatus(p) {
        return (Number(p.is_late) === 1 && p.status !== 'paid' && p.status !== 'cancelled')
            ? 'late'
            : p.status;
    }

    let payments   = [];
    let currentPage = 1;
    const PAGE_LIMIT = 25;
    let schedaPaymentId = null;
    // Sapere se Stripe e' configurato PRIMA di disegnare il pulsante: altrimenti
    // l'unico modo di scoprirlo sarebbe premerlo e ricevere un 503.
    let stripeConfigured = false;

    const els = {};

    function init() {
        els.grid         = document.getElementById('payments-grid');
        els.alert        = document.getElementById('payments-alert');
        els.search       = document.getElementById('payment-search');
        els.statusFilter = document.getElementById('payment-status-filter');
        els.monthFilter  = document.getElementById('payment-month-filter');
        els.yearFilter   = document.getElementById('payment-year-filter');
        els.pagination   = document.getElementById('payments-pagination');

        bindEvents();
        loadStripeStatus()
            .then(() => loadPayments())
            .catch(err => {
                if (!els.alert?.isConnected) return;
                showAlert('Errore inizializzazione: ' + err.message, 'error');
            });
    }

    function bindEvents() {
        document.getElementById('btn-new-payment').addEventListener('click', () => {
            if (window.App) window.App.navigateTo('payment_edit');
        });

        bindSddExport();

        [els.statusFilter, els.monthFilter].forEach(el => el.addEventListener('change', () => { currentPage = 1; loadPayments(); }));
        [els.search, els.yearFilter].forEach(el => el.addEventListener('input', () => {
            clearTimeout(els._timer);
            els._timer = setTimeout(() => { currentPage = 1; loadPayments(); }, 400);
        }));

        // Scheda quick-view
        const schedaModal = document.getElementById('payment-scheda-modal');
        document.getElementById('payment-scheda-close').addEventListener('click', closeSchedaModal);
        document.getElementById('scheda-pay-close2').addEventListener('click', closeSchedaModal);
        schedaModal.addEventListener('click', (e) => { if (e.target === schedaModal) closeSchedaModal(); });
        document.getElementById('scheda-pay-edit').addEventListener('click', () => {
            const id = schedaPaymentId;
            closeSchedaModal();
            if (window.App) window.App.navigateTo('payment_edit', { paymentId: id });
        });
        document.getElementById('scheda-pay-paid').addEventListener('click', () => {
            const id = schedaPaymentId;
            closeSchedaModal();
            markPaid(id);
        });
        document.getElementById('scheda-pay-link').addEventListener('click', () => {
            createPaymentLink(schedaPaymentId);
        });
    }

    /**
     * L'incasso online e' lato agenzia: si genera il link e lo si manda
     * all'inquilino. Il portale inquilino NON ha un pulsante "Paga": l'endpoint
     * di checkout richiede una sessione admin, quindi un click dell'inquilino
     * finirebbe in 401.
     */
    async function loadStripeStatus() {
        try {
            const res  = await fetch('api/stripe_checkout.php');
            const json = await res.json();
            stripeConfigured = !!(json.success && json.data && json.data.configured);
        } catch {
            stripeConfigured = false;   // nel dubbio non si mostra il pulsante
        }
    }

    async function createPaymentLink(id) {
        const btn = document.getElementById('scheda-pay-link');
        if (!id || !btn) return;

        btn.disabled = true;
        const original = btn.innerHTML;
        btn.textContent = 'Generazione…';

        try {
            const base = window.location.origin + window.location.pathname;
            const res  = await fetch('api/stripe_checkout.php', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    payment_id:  id,
                    success_url: base + '?pagamento=ok',
                    cancel_url:  base + '?pagamento=annullato',
                }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Errore Stripe.');
            showPaymentLink(json.data.checkout_url);
        } catch (err) {
            showAlert('Link di pagamento non creato: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = original;
        }
    }

    /** Il link va copiato e inviato a mano: mostrarlo per intero, non troncato. */
    function showPaymentLink(url) {
        const body = document.getElementById('scheda-pay-body');
        if (!body) return;

        const box = document.createElement('div');
        box.className = 'scheda-rows';
        box.style.marginTop = '12px';
        box.innerHTML = `
            <div class="scheda-row">
                <span class="scheda-row__label"><i data-lucide="link"></i> Link di pagamento</span>
                <span class="scheda-row__value" style="word-break:break-all">${escapeHtml(url)}</span>
            </div>`;

        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'btn btn--ghost btn--sm';
        copy.textContent = 'Copia link';
        copy.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(url);
                copy.textContent = 'Copiato';
            } catch {
                copy.textContent = 'Copia non riuscita';
            }
        });
        box.appendChild(copy);

        body.querySelector('.stripe-link-box')?.remove();
        box.classList.add('stripe-link-box');
        body.appendChild(box);
        if (window.lucide) window.lucide.createIcons();
    }

    // -------------------------------------------------------------------------
    // List
    // -------------------------------------------------------------------------

    async function loadPayments() {
        const params = new URLSearchParams();
        if (els.search.value.trim()) params.set('search', els.search.value.trim());
        if (els.statusFilter.value) params.set('status', els.statusFilter.value);
        if (els.monthFilter.value)  params.set('month', els.monthFilter.value);
        if (els.yearFilter.value.trim()) params.set('year', els.yearFilter.value.trim());
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);

        const url = `${API}?${params}`;
        softLoad(els.grid, '<div class="entity-loading">Caricamento…</div>');

        try {
            const res  = await fetch(url);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const parsed = Pagination.parseResponse(json);
            payments = parsed.items;
            renderCards();
            Pagination.render(els.pagination, parsed, (p) => { currentPage = p; loadPayments(); });
        } catch (err) {
            els.grid.classList.remove('is-loading');
            els.grid.innerHTML = `<div class="entity-error">${escapeHtml(err.message)}</div>`;
        }
    }

    function renderCards() {
        els.grid.classList.remove('is-loading');
        if (payments.length === 0) {
            els.grid.innerHTML = '<div class="entity-empty">Nessun pagamento trovato.</div>';
            return;
        }

        els.grid.innerHTML = payments.map(p => {
            const st = effStatus(p);
            const markPaidBtn = window.canWrite !== false && (st === 'pending' || st === 'late')
                ? `<button class="btn btn--sm btn--ghost btn-paid" data-id="${p.id}" title="Segna come pagato"><i data-lucide="check"></i> Pagato</button>`
                : '';

            return `
            <div class="entity-card payment-card payment-card--${st} entity-card--clickable" data-id="${p.id}">
                <div class="entity-card__header">
                    <div class="entity-card__title-group">
                        <div class="entity-card__name">€ ${formatPrice(p.amount)}</div>
                        <span class="badge badge--payment-${st}">${STATUS_LABELS[st] || st}</span>
                    </div>
                </div>
                <div class="entity-card__body">
                    <div class="entity-card__info"><span class="entity-card__info-icon"><i data-lucide="key"></i></span>${escapeHtml(p.tenant_surname)} ${escapeHtml(p.tenant_name)}</div>
                    <div class="entity-card__info"><span class="entity-card__info-icon"><i data-lucide="building-2"></i></span>${escapeHtml(p.property_address)}, ${escapeHtml(p.property_city)}</div>
                    <div class="entity-card__info"><span class="entity-card__info-icon"><i data-lucide="calendar"></i></span>Scadenza: ${formatDate(p.due_date)}</div>
                    ${p.paid_date ? `<div class="entity-card__info"><span class="entity-card__info-icon"><i data-lucide="check-circle"></i></span>Pagato il: ${formatDate(p.paid_date)}</div>` : ''}
                    ${p.notes ? `<div class="entity-card__info text-muted">${escapeHtml(truncate(p.notes, 60))}</div>` : ''}
                </div>
                <div class="entity-card__footer">
                    <div class="entity-card__actions">
                        ${markPaidBtn}
                        ${window.canWrite !== false ? `<button class="btn btn--sm btn--ghost btn-edit" data-id="${p.id}" title="Modifica"><i data-lucide="pencil"></i></button>
                        <button class="btn btn--sm btn--ghost btn-cancel" data-id="${p.id}" title="Annulla"><i data-lucide="x"></i></button>` : ''}
                    </div>
                </div>
            </div>`;
        }).join('');

        els.grid.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (window.App) window.App.navigateTo('payment_edit', { paymentId: Number(btn.dataset.id) });
            });
        });

        els.grid.querySelectorAll('.btn-paid').forEach(btn => {
            btn.addEventListener('click', () => markPaid(btn.dataset.id));
        });

        els.grid.querySelectorAll('.btn-cancel').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (await confirmDialog('Vuoi annullare questo pagamento?', { title: 'Annulla pagamento', confirmText: 'Annulla pagamento', cancelText: 'Indietro' })) cancelPayment(btn.dataset.id);
            });
        });

        els.grid.querySelectorAll('.entity-card--clickable').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('button, a, input')) return;
                const p = payments.find(x => x.id == card.dataset.id);
                if (p) openSchedaModal(p);
            });
        });
    }

    // -------------------------------------------------------------------------
    // Scheda quick-view
    // -------------------------------------------------------------------------

    function openSchedaModal(p) {
        schedaPaymentId = p.id;
        const st = effStatus(p);
        document.getElementById('scheda-pay-amount').textContent = '€ ' + formatPrice(p.amount);
        document.getElementById('scheda-pay-badge').innerHTML =
            `<span class="badge badge--payment-${st}">${STATUS_LABELS[st] || st}</span>`;

        document.getElementById('scheda-pay-body').innerHTML = `
            <div class="scheda-rows">
                <div class="scheda-row"><span class="scheda-row__label"><i data-lucide="key"></i> Inquilino</span><span class="scheda-row__value">${escapeHtml(p.tenant_surname)} ${escapeHtml(p.tenant_name)}</span></div>
                <div class="scheda-row"><span class="scheda-row__label"><i data-lucide="building-2"></i> Immobile</span><span class="scheda-row__value">${escapeHtml(p.property_address)}, ${escapeHtml(p.property_city)}</span></div>
                <div class="scheda-row"><span class="scheda-row__label"><i data-lucide="calendar"></i> Scadenza</span><span class="scheda-row__value">${formatDate(p.due_date)}</span></div>
                ${p.paid_date ? `<div class="scheda-row"><span class="scheda-row__label"><i data-lucide="check-circle"></i> Pagato il</span><span class="scheda-row__value">${formatDate(p.paid_date)}</span></div>` : ''}
                ${p.notes ? `<div class="scheda-row"><span class="scheda-row__label"><i data-lucide="file-pen"></i> Note</span><span class="scheda-row__value">${escapeHtml(p.notes)}</span></div>` : ''}
            </div>`;

        const paidBtn = document.getElementById('scheda-pay-paid');
        paidBtn.hidden = !(window.canWrite !== false && (st === 'pending' || st === 'late'));

        const editBtn = document.getElementById('scheda-pay-edit');
        if (editBtn) editBtn.hidden = window.canWrite === false;

        // Il link si genera solo per un pagamento ancora da incassare, e solo se
        // Stripe e' davvero configurato: su un pagamento gia' saldato sarebbe un
        // invito a farsi pagare due volte.
        const linkBtn = document.getElementById('scheda-pay-link');
        if (linkBtn) {
            linkBtn.hidden = !(stripeConfigured && window.canWrite !== false
                               && (st === 'pending' || st === 'late'));
        }

        document.getElementById('payment-scheda-modal').hidden = false;
    }

    function closeSchedaModal() {
        schedaPaymentId = null;
        document.getElementById('payment-scheda-modal').hidden = true;
    }

    // -------------------------------------------------------------------------
    // Modal
    // -------------------------------------------------------------------------

    // -------------------------------------------------------------------------
    // CRUD
    // -------------------------------------------------------------------------

    async function savePayment(data, id) {
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

    async function markPaid(id) {
        const payment = payments.find(p => p.id == id);
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
            await savePayment(data, id);
            showAlert('Pagamento segnato come pagato.', 'success');
            loadPayments();
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    async function cancelPayment(id) {
        try {
            const res  = await fetch(`${API}?id=${id}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert('Pagamento annullato.', 'success');
            loadPayments();
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

    function formatPrice(value) {
        const n = Number(value);
        if (!isFinite(n)) return value;
        return window.Fmt.number(n, 2);
    }

    function formatDate(dateStr) { return window.Fmt.date(dateStr); }

    function truncate(str, len) {
        return str.length > len ? str.slice(0, len) + '…' : str;
    }

    function escapeHtml(str) {
        if (str == null) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    // ── SEPA SDD export ───────────────────────────────────────────────────────
    function bindSddExport() {
        const openBtn = document.getElementById('btn-export-sdd');
        const modal   = document.getElementById('sdd-modal');
        if (!openBtn || !modal) return;
        const monthInput = document.getElementById('sdd-month');
        const preview    = document.getElementById('sdd-preview');
        const dlBtn      = document.getElementById('sdd-download');

        function close() { modal.hidden = true; }
        openBtn.addEventListener('click', () => {
            monthInput.value = window.Fmt.today().slice(0, 7);
            preview.textContent = '';
            dlBtn.disabled = true;
            modal.hidden = false;
            checkSdd();
        });
        document.getElementById('sdd-modal-close').addEventListener('click', close);
        document.getElementById('sdd-modal-cancel').addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) close(); });
        monthInput.addEventListener('change', checkSdd);
        dlBtn.addEventListener('click', () => {
            if (monthInput.value) window.location.href = `api/generate_sdd.php?month=${monthInput.value}`;
        });

        async function checkSdd() {
            const month = monthInput.value;
            if (!month) return;
            preview.textContent = 'Verifica…';
            dlBtn.disabled = true;
            try {
                const res  = await fetch(`api/generate_sdd.php?month=${month}&check=1`);
                const json = await res.json();
                if (!json.success) throw new Error(json.error);
                const d = json.data;
                const eur = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n || 0);
                let msg = `${d.count} addebiti idonei · totale ${eur(d.total)}`;
                if (d.collection_date) msg += ` · addebito il ${formatDate(d.collection_date)}`;
                msg += '.';
                // I primi incassi su un mandato (FRST) sono quelli che la banca
                // respinge piu' spesso e che vogliono piu' preavviso: vanno detti
                // per nome prima di scaricare, non scoperti dalla ricevuta di scarto.
                if (d.first_count) {
                    msg += ` ℹ ${d.first_count} primo/i addebito/i su nuovo mandato (${d.first_debtors.join(', ')})`
                         + ' — verifica il preavviso richiesto dalla banca.';
                }
                if (d.missing && d.missing.length) msg += ` ⚠ Configura: ${d.missing.join(', ')}.`;
                if (d.skipped && d.skipped.length) msg += ` Esclusi (mandato/IBAN mancante o non valido): ${d.skipped.length}.`;
                // Blocking problems: these are exactly what the bank would reject.
                if (d.problems && d.problems.length) msg += ` ⛔ Da correggere: ${d.problems.join(' | ')}`;
                preview.textContent = msg;
                dlBtn.disabled = !d.ready;
            } catch (err) {
                preview.textContent = err.message;
                dlBtn.disabled = true;
            }
        }
    }

    init();
})();
