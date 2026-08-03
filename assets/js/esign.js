/**
 * Firme digitali — elenco, sollecito, revoca.
 *
 * api/esign.php sapeva creare una richiesta di firma e riceverla firmata, ma
 * niente la sapeva mostrare: una volta inviata usciva dal gestionale. Se
 * l'email non arrivava, o il firmatario spariva, non restava un posto dove
 * accorgersene. Questa pagina e' quel posto.
 */
(function () {
    'use strict';

    const API = 'api/esign.php';

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
    function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

    /** '2026-07-30 14:03:00' -> '30/07/2026'. Le date nulle restano un trattino. */
    function fmtDate(v) {
        if (!v) return '—';
        const d = new Date(String(v).replace(' ', 'T'));
        if (isNaN(d)) return '—';
        return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
    function fmtDateTime(v) {
        if (!v) return '—';
        const d = new Date(String(v).replace(' ', 'T'));
        if (isNaN(d)) return '—';
        return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
            ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    }

    /** Giorni che mancano alla scadenza (negativi = gia' passata). */
    function daysUntil(v) {
        if (!v) return null;
        const d = new Date(String(v).replace(' ', 'T'));
        if (isNaN(d)) return null;
        return Math.ceil((d - new Date()) / 86400000);
    }

    let currentPage = 1;
    const PAGE_LIMIT = 25;
    let revokeTarget = null;
    const els = {};

    function init() {
        els.alert      = document.getElementById('esign-alert');
        els.tbody      = document.getElementById('esign-tbody');
        els.pagination = document.getElementById('esign-pagination');
        els.search     = document.getElementById('esign-search');
        els.status     = document.getElementById('esign-status-filter');
        els.revokeModal = document.getElementById('esign-revoke-modal');
        els.linkModal   = document.getElementById('esign-link-modal');

        bindEvents();
        load();
    }

    function bindEvents() {
        els.search.addEventListener('input', debounce(() => { currentPage = 1; load(); }, 300));
        els.status.addEventListener('change', () => { currentPage = 1; load(); });

        document.getElementById('esign-revoke-close').addEventListener('click', closeRevoke);
        document.getElementById('esign-revoke-cancel').addEventListener('click', closeRevoke);
        document.getElementById('esign-revoke-confirm').addEventListener('click', confirmRevoke);
        els.revokeModal.addEventListener('click', e => { if (e.target === els.revokeModal) closeRevoke(); });

        document.getElementById('esign-link-close').addEventListener('click', closeLink);
        document.getElementById('esign-link-done').addEventListener('click', closeLink);
        document.getElementById('esign-link-copy').addEventListener('click', copyLink);
        els.linkModal.addEventListener('click', e => { if (e.target === els.linkModal) closeLink(); });

        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape') return;
            if (!els.revokeModal.hidden) closeRevoke();
            if (!els.linkModal.hidden) closeLink();
        });

        // Un solo ascoltatore sul corpo della tabella: le righe si ridisegnano a
        // ogni ricerca, e riagganciarle una per una lascia indietro i listener.
        // Stessa ragione per cui RowMenu delega invece di legarsi al singolo ⋮.
        bindRowMenu();
    }

    async function load() {
        const params = new URLSearchParams();
        const q = els.search.value.trim();
        if (q) params.set('search', q);
        if (els.status.value) params.set('status', els.status.value);
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);

        els.tbody.innerHTML = '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:2rem;">Caricamento…</td></tr>';

        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const parsed = window.Pagination.parseResponse(json);
            render(parsed.items);
            window.Pagination.render(els.pagination, parsed, p => { currentPage = p; load(); });
        } catch (err) {
            els.tbody.innerHTML = `<tr><td colspan="6" style="color:var(--color-danger);padding:2rem;text-align:center;">${esc(err.message)}</td></tr>`;
        }
    }

    /** Cosa si sta firmando: il documento allegato, oppure il contratto. */
    function subjectHtml(r) {
        if (r.document_title) {
            return `<div>${esc(r.document_title)}</div>` +
                (r.document_type ? `<div class="text-muted" style="font-size:.8rem;">${esc(r.document_type)}</div>` : '');
        }
        if (r.contract_id) {
            const title = r.contract_title || `Contratto #${r.contract_id}`;
            const where = [r.property_address, r.property_city].filter(Boolean).join(', ');
            return `<div>${esc(title)}</div>` +
                (where ? `<div class="text-muted" style="font-size:.8rem;">${esc(where)}</div>` : '');
        }
        // Il documento collegato e' stato cancellato: la richiesta resta, e va
        // detto invece di mostrare una cella vuota.
        return '<span class="text-muted">Documento non piu\' disponibile</span>';
    }

    function statusBadge(r) {
        if (r.status === 'signed')  return '<span class="badge badge--success">Firmata</span>';
        if (r.status === 'expired') return '<span class="badge badge--muted">Scaduta</span>';
        const left = daysUntil(r.expires_at);
        if (left !== null && left <= 3) {
            return `<span class="badge badge--warning">In attesa · ${left <= 0 ? 'ultimo giorno' : left + 'g'}</span>`;
        }
        return '<span class="badge badge--info">In attesa</span>';
    }

    function deadlineHtml(r) {
        if (r.status === 'signed') {
            return `<div>${esc(fmtDateTime(r.signed_at))}</div>` +
                (r.ip_address ? `<div class="text-muted" style="font-size:.78rem;">IP ${esc(r.ip_address)}</div>` : '');
        }
        return `<div>${esc(fmtDate(r.expires_at))}</div>`;
    }

    function render(items) {
        if (!items.length) {
            const filtered = els.search.value.trim() || els.status.value;
            els.tbody.innerHTML = `<tr><td colspan="6" class="text-muted" style="text-align:center;padding:2.5rem;">${
                filtered
                    ? 'Nessuna richiesta con questi criteri.'
                    : 'Nessuna richiesta di firma. Se ne crea una dalla scheda di un contratto.'
            }</td></tr>`;
            return;
        }

        const canWrite = window.canWrite !== false;

        els.tbody.innerHTML = items.map(r => {
            const pending = r.status === 'pending';
            return `
            <tr>
                <td data-label="Firmatario">
                    <div>${esc(r.signer_name)}</div>
                    <div class="text-muted" style="font-size:.8rem;">${esc(r.signer_email)}</div>
                </td>
                <td data-label="Documento">${subjectHtml(r)}</td>
                <td data-label="Stato">${statusBadge(r)}</td>
                <td data-label="Inviata">${esc(fmtDate(r.created_at))}</td>
                <td data-label="Scadenza / Firma">${deadlineHtml(r)}</td>
                <td class="col-actions lt-actions" data-label="Azioni">
                    ${(pending || r.status === 'expired') && canWrite
                        ? window.RowMenu.button(r.id, 'Azioni richiesta di firma', { name: r.signer_name, state: r.status })
                        : ''}
                    ${r.status === 'signed' ? '<span class="text-muted" style="font-size:.8rem;">documento firmato</span>' : ''}
                </td>
            </tr>`;
        }).join('');

        if (window.lucide) window.lucide.createIcons();
    }

    function bindRowMenu() {
        window.RowMenu.bind(els.tbody, btn => {
            const id   = btn.dataset.id;
            const name = btn.dataset.name || '';
            // Una richiesta scaduta non si sollecita e non ha piu' un link
            // valido da mostrare: resta solo da toglierla di mezzo.
            if (btn.dataset.state === 'expired') {
                return [{ label: 'Elimina richiesta scaduta', icon: 'trash-2', danger: true,
                          onClick: () => openRevoke(id, name) }];
            }
            return [
                { label: 'Mostra link di firma', icon: 'link',  onClick: () => showLink(id) },
                { label: 'Sollecita via email',  icon: 'send',  onClick: () => resend(id) },
                { sep: true },
                { label: 'Revoca richiesta', icon: 'trash-2', danger: true,
                  onClick: () => openRevoke(id, name) },
            ];
        });
    }

    // Niente pulsante da disabilitare durante l'invio: era una voce di menu e
    // al click il menu si chiude. L'esito lo dice l'avviso.
    async function resend(id) {
        try {
            const res  = await fetch(`${API}?action=resend&id=${encodeURIComponent(id)}`, { method: 'POST' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            // L'API distingue "inviato" da "l'invio email e' spento": qui si
            // riporta quella distinzione, invece di dire sempre "inviato".
            showAlert(json.data.message, json.data.sent ? 'success' : 'warning');
            if (!json.data.sent && json.data.sign_link) showLinkModal(json.data.sign_link, '');
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    async function showLink(id) {
        try {
            const res  = await fetch(`${API}?action=link&id=${encodeURIComponent(id)}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showLinkModal(json.data.sign_link, json.data.signer_name);
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    function showLinkModal(url, signer) {
        document.getElementById('esign-link-url').value = url;
        document.getElementById('esign-link-signer').textContent = signer || 'il firmatario';
        els.linkModal.hidden = false;
        document.getElementById('esign-link-copy').focus();
    }
    function closeLink() { els.linkModal.hidden = true; }

    function copyLink() {
        const input = document.getElementById('esign-link-url');
        const btn   = document.getElementById('esign-link-copy');
        const done  = () => { const o = btn.textContent; btn.textContent = 'Copiato'; setTimeout(() => { btn.textContent = o; }, 1200); };
        if (navigator.clipboard) { navigator.clipboard.writeText(input.value).then(done).catch(done); }
        else { input.select(); try { document.execCommand('copy'); } catch (_) {} done(); }
    }

    function openRevoke(id, name) {
        revokeTarget = id;
        document.getElementById('esign-revoke-name').textContent = name;
        els.revokeModal.hidden = false;
    }
    function closeRevoke() { els.revokeModal.hidden = true; revokeTarget = null; }

    async function confirmRevoke() {
        if (!revokeTarget) return;
        const btn = document.getElementById('esign-revoke-confirm');
        btn.disabled = true;
        try {
            const res  = await fetch(`${API}?id=${encodeURIComponent(revokeTarget)}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeRevoke();
            showAlert(json.data.message || 'Richiesta revocata.', 'success');
            load();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    function showAlert(msg, type) {
        els.alert.textContent = msg;
        els.alert.className = `alert alert--${type}`;
        els.alert.style.display = 'block';
        clearTimeout(els.alert._t);
        els.alert._t = setTimeout(() => { els.alert.style.display = 'none'; }, 7000);
    }

    init();
})();
