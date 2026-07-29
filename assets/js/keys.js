/**
 * Gestione chiavi — lista, rientro rapido e registro di custodia.
 *
 * Il form non è più qui: "Registra chiavi" e "Modifica" aprono la pagina
 * entity_edit, che costruisce il modulo dallo schema in
 * assets/js/entity_edit/schemas/keys.js. In questo file restano la lista, il
 * rientro in un click, lo storico e la scansione del portachiavi.
 */
(function () {
    'use strict';

    const API = 'api/property_keys.php';

    const STATUS_LABELS = { out: 'In possesso', in_office: 'In ufficio', lost: 'Smarrite' };
    const KEY_TYPE_LABELS = { portone: 'Portone principale', appartamento: 'Appartamento', cantina: 'Cantina', box: 'Box auto', cancello: 'Cancello / telecomando', altro: 'Altro' };
    const KEY_TYPE_ICONS  = { portone: 'door-open', appartamento: 'home', cantina: 'archive', box: 'car', cancello: 'radio', altro: 'key' };

    const HOLDER_TYPE_LABELS = {
        agente: 'Agente', fornitore: 'Fornitore', inquilino: 'Inquilino',
        proprietario: 'Proprietario', lead: 'Cliente / lead', altro: 'Occasionale',
    };
    const EVENT_LABELS = {
        created: 'Scheda creata', handover: 'Chiavi consegnate', return: 'Chiavi rientrate',
        status_change: 'Stato aggiornato', lost: 'Chiavi smarrite',
        overdue: 'Ritardo rilevato', deleted: 'Scheda eliminata',
    };

    let keys = [];
    let currentPage = 1;
    const PAGE_LIMIT = 25;
    let searchTimer = null;
    let scanStream = null;
    const els = {};

    function init() {
        els.grid = document.getElementById('keys-grid');
        els.pagination = document.getElementById('keys-pagination');
        els.search = document.getElementById('key-search');
        els.statusFilter = document.getElementById('key-status-filter');
        els.alert = document.getElementById('keys-alert');
        els.historyModal = document.getElementById('key-history-modal');
        els.historyBody = document.getElementById('key-history-body');
        els.historyTitle = document.getElementById('key-history-title');
        els.scanModal = document.getElementById('key-scan-modal');
        els.scanVideo = document.getElementById('key-scan-video');
        els.scanHint = document.getElementById('key-scan-hint');

        bindEvents();
        setupScanner();
        loadKeys();
    }

    function bindEvents() {
        document.getElementById('btn-new-key').addEventListener('click', () => openForm());
        els.search.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => { currentPage = 1; loadKeys(); }, 300);
        });
        els.statusFilter.addEventListener('change', () => { currentPage = 1; loadKeys(); });

        document.getElementById('key-history-close').addEventListener('click', closeHistory);
        els.historyModal.addEventListener('click', e => { if (e.target === els.historyModal) closeHistory(); });
        document.getElementById('key-scan-close').addEventListener('click', stopScan);
        els.scanModal.addEventListener('click', e => { if (e.target === els.scanModal) stopScan(); });
    }

    /** Il modulo è una pagina, non una modale: immobili e detentori li carica lo schema. */
    function openForm(id) {
        window.App.navigateTo('entity_edit', id ? { entity: 'keys', id } : { entity: 'keys' });
    }

    async function loadKeys() {
        const params = new URLSearchParams();
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);
        if (els.search.value.trim()) params.set('search', els.search.value.trim());
        // "In ritardo" non è uno stato in tabella ma una condizione derivata:
        // il filtro va su un parametro diverso da status.
        if (els.statusFilter.value === 'overdue') params.set('overdue', '1');
        else if (els.statusFilter.value) params.set('status', els.statusFilter.value);

        softLoad(els.grid, '<div class="entity-loading">Caricamento…</div>');
        try {
            const res = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const parsed = Pagination.parseResponse(json);
            keys = parsed.items;
            renderCards();
            Pagination.render(els.pagination, parsed, p => { currentPage = p; loadKeys(); });
        } catch (err) {
            els.grid.classList.remove('is-loading');
            els.grid.innerHTML = `<div class="entity-error">${escapeHtml(err.message)}</div>`;
        }
    }

    function renderCards() {
        els.grid.classList.remove('is-loading');
        if (!keys.length) {
            els.grid.innerHTML = '<div class="entity-empty">Nessun registro chiavi.</div>';
            return;
        }
        els.grid.innerHTML = keys.map(k => {
            const typeIcon  = KEY_TYPE_ICONS[k.key_type] || 'key';
            const typeLabel = KEY_TYPE_LABELS[k.key_type] || 'Altro';
            const qty       = parseInt(k.quantity, 10) || 1;
            const overdue   = Number(k.is_overdue) === 1;
            const late      = parseInt(k.days_overdue, 10);
            const holder    = k.holder_display || 'Nessun detentore';
            const holderTag = k.holder_type ? HOLDER_TYPE_LABELS[k.holder_type] || k.holder_type : '';
            return `
            <div class="entity-card key-card${overdue ? ' is-overdue' : ''}">
                <div class="entity-card__header">
                    <strong><i data-lucide="${typeIcon}"></i> ${escapeHtml(k.address)}, ${escapeHtml(k.city)}</strong>
                    <span class="badge badge--key-${overdue ? 'overdue' : k.status}">${overdue ? 'In ritardo' : (STATUS_LABELS[k.status] || k.status)}</span>
                </div>
                <div class="key-card__tags">
                    <span class="badge key-card__type">${escapeHtml(typeLabel)}</span>
                    ${qty > 1 ? `<span class="badge key-card__qty">× ${qty} copie</span>` : ''}
                    ${k.key_code ? `<span class="key-card__code" title="Codice portachiavi">${escapeHtml(k.key_code)}</span>` : ''}
                </div>
                <div class="entity-card__body">
                    <div class="entity-card__info"><i data-lucide="user"></i> ${escapeHtml(holder)}${holderTag ? ` <span class="text-muted">· ${escapeHtml(holderTag)}</span>` : ''}</div>
                    ${k.location ? `<div class="entity-card__info text-muted"><i data-lucide="map-pin"></i> ${escapeHtml(k.location)}</div>` : ''}
                    ${k.handed_at ? `<div class="entity-card__info text-muted"><i data-lucide="calendar-check"></i> Consegnate: ${formatDate(k.handed_at)}</div>` : ''}
                    ${k.due_back_at ? `<div class="entity-card__info${overdue ? ' key-card__overdue' : ' text-muted'}"><i data-lucide="calendar-clock"></i> Rientro previsto: ${formatDate(k.due_back_at)}${overdue && late > 0 ? ` — ${late} giorn${late === 1 ? 'o' : 'i'} di ritardo` : ''}</div>` : ''}
                    ${k.returned_at ? `<div class="entity-card__info text-muted"><i data-lucide="calendar-x"></i> Restituite: ${formatDate(k.returned_at)}</div>` : ''}
                </div>
                <div class="entity-card__footer">
                    ${k.status === 'out' ? `<button class="btn btn--sm btn--ghost btn-return-key" data-id="${k.id}">Registra rientro</button>` : ''}
                    <button class="btn btn--sm btn--ghost btn-history-key" data-id="${k.id}" title="Storico custodia"><i data-lucide="history"></i></button>
                    <button class="btn btn--sm btn--ghost btn-edit-key" data-id="${k.id}">Modifica</button>
                    <button class="btn btn--sm btn--ghost btn-del-key" data-id="${k.id}" title="Elimina"><i data-lucide="trash-2"></i></button>
                </div>
            </div>`;
        }).join('');

        els.grid.querySelectorAll('.btn-edit-key').forEach(btn => {
            btn.addEventListener('click', () => openForm(btn.dataset.id));
        });
        els.grid.querySelectorAll('.btn-del-key').forEach(btn => {
            btn.addEventListener('click', () => deleteKey(btn.dataset.id));
        });
        els.grid.querySelectorAll('.btn-return-key').forEach(btn => {
            btn.addEventListener('click', () => returnKey(btn.dataset.id));
        });
        els.grid.querySelectorAll('.btn-history-key').forEach(btn => {
            btn.addEventListener('click', () => openHistory(btn.dataset.id));
        });
        // Le icone le idrata l'observer globale di app.js: chiamare qui
        // createIcons() rimpiazzerebbe nodi a metà click (vedi app.js).
    }

    async function deleteKey(id) {
        const item  = keys.find(x => x.id == id);
        const label = item ? `${item.address || ''} (${item.holder_display || '—'})` : ('#' + id);
        if (!await confirmDialog(
            `Eliminare il registro chiavi per ${label}? Lo storico delle consegne resta archiviato.`,
            { title: 'Elimina chiavi', confirmText: 'Elimina' }
        )) return;
        try {
            const res  = await fetch(`${API}?id=${id}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert('Registro chiavi eliminato.', 'success');
            loadKeys();
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    /** Rientro in un click: è il gesto che al bancone si fa dieci volte al giorno. */
    async function returnKey(id) {
        const item = keys.find(x => x.id == id);
        if (!await confirmDialog(
            `Registrare il rientro delle chiavi${item && item.holder_display ? ` da ${item.holder_display}` : ''}?`,
            { title: 'Rientro chiavi', confirmText: 'Registra rientro' }
        )) return;
        try {
            const res = await fetch(`${API}?id=${id}&action=return`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ returned_at: todayISO() }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert('Rientro registrato.', 'success');
            loadKeys();
        } catch (err) {
            showAlert(err.message, 'error');
        }
    }

    // -------------------------------------------------------------------------
    // Storico
    // -------------------------------------------------------------------------

    async function openHistory(id) {
        const item = keys.find(x => x.id == id);
        els.historyTitle.textContent = item ? `Storico custodia — ${item.address}` : 'Storico custodia';
        els.historyBody.innerHTML = '<div class="entity-loading">Caricamento…</div>';
        els.historyModal.hidden = false;
        try {
            const res = await fetch(`${API}?id=${id}&action=history`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            renderHistory(json.data || []);
        } catch (err) {
            els.historyBody.innerHTML = `<div class="entity-error">${escapeHtml(err.message)}</div>`;
        }
    }

    function renderHistory(events) {
        if (!events.length) {
            els.historyBody.innerHTML = '<div class="entity-empty">Nessun movimento registrato.</div>';
            return;
        }
        els.historyBody.innerHTML = '<ul class="key-timeline">' + events.map(e => {
            const title = EVENT_LABELS[e.event_type] || e.event_type;
            const when  = e.event_date ? formatDate(e.event_date) : formatDateTime(e.created_at);
            const bits  = [];
            if (e.holder_label) {
                const tag = e.holder_type ? ` (${HOLDER_TYPE_LABELS[e.holder_type] || e.holder_type})` : '';
                bits.push(`Detentore: ${escapeHtml(e.holder_label)}${escapeHtml(tag)}`);
            } else if (e.event_type === 'return') {
                bits.push('Rientrate in ufficio');
            }
            if (e.prev_holder_label && e.prev_holder_label !== e.holder_label) {
                bits.push(`Prima: ${escapeHtml(e.prev_holder_label)}`);
            }
            if (e.due_back_at) bits.push(`Rientro previsto: ${formatDate(e.due_back_at)}`);
            if (e.appointment_date) bits.push(`Appuntamento del ${formatDateTime(e.appointment_date)}`);
            // Il promemoria agganciato a un evento 'overdue' è l'avviso stesso,
            // non un ordine di lavoro: chiamarlo "Intervento" sarebbe falso.
            if (e.reminder_title && e.reminder_request_type !== 'key_overdue') {
                bits.push(`Intervento: ${escapeHtml(e.reminder_title)}`);
            }
            bits.push(`Registrato da ${escapeHtml(e.admin_username || 'utente non tracciato')}`);
            // La data mostrata è quella dell'evento; quando la registrazione è
            // avvenuta in un altro giorno, il registro deve dirlo.
            if (e.event_date && e.created_at && !String(e.created_at).startsWith(e.event_date)) {
                bits.push(`registrato il ${formatDateTime(e.created_at)}`);
            }
            if (e.notes) bits.push(escapeHtml(e.notes));

            return `
            <li class="key-timeline__item key-timeline__item--${escAttr(e.event_type)}">
                <div class="key-timeline__head">
                    <span class="key-timeline__title">${escapeHtml(title)}</span>
                    <span class="key-timeline__date">${when}</span>
                </div>
                <div class="key-timeline__meta">${bits.join(' · ')}</div>
            </li>`;
        }).join('') + '</ul>';
    }

    function closeHistory() { els.historyModal.hidden = true; }

    // -------------------------------------------------------------------------
    // Scansione codice portachiavi
    // -------------------------------------------------------------------------

    /**
     * Il lettore USB da bancone si comporta già come una tastiera e digita nel
     * campo di ricerca: nulla da fare. Questo copre l'altro caso, la fotocamera
     * dello smartphone, e solo dove il browser espone BarcodeDetector (Chrome/
     * Edge, desktop e Android). Altrove i pulsanti restano nascosti invece di
     * mostrare una funzione che fallisce.
     */
    function setupScanner() {
        const supported = 'BarcodeDetector' in window &&
            navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
        if (!supported) return;

        // #btn-scan-code lived inside the create/edit modal and left with it —
        // scanning straight into the "Codice portachiavi" field belongs to the
        // form page now. Here the scanner only drives the list search.
        const btnSearch = document.getElementById('btn-scan-key');
        if (!btnSearch) return;
        btnSearch.hidden = false;
        btnSearch.addEventListener('click', () => startScan('search'));
    }

    async function startScan(target) {
        scanTarget = target;
        els.scanHint.textContent = 'Inquadra il codice a barre o il QR sull\'etichetta.';
        els.scanModal.hidden = false;
        try {
            scanStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' },
            });
            els.scanVideo.srcObject = scanStream;
            await els.scanVideo.play();
            detectLoop(new window.BarcodeDetector());
        } catch (err) {
            els.scanHint.textContent = 'Fotocamera non disponibile: ' + err.message;
        }
    }

    function detectLoop(detector) {
        if (!scanStream) return;
        detector.detect(els.scanVideo).then(codes => {
            if (codes && codes.length) {
                applyScannedCode(codes[0].rawValue);
                return;
            }
            requestAnimationFrame(() => detectLoop(detector));
        }).catch(() => {
            // Un frame non decodificabile non è un errore: si riprova.
            requestAnimationFrame(() => detectLoop(detector));
        });
    }

    function applyScannedCode(code) {
        stopScan();
        els.search.value = code;
        currentPage = 1;
        loadKeys();
    }

    function stopScan() {
        if (scanStream) {
            scanStream.getTracks().forEach(t => t.stop());
            scanStream = null;
        }
        els.scanVideo.srcObject = null;
        els.scanModal.hidden = true;
    }

    function showAlert(msg, type) {
        els.alert.textContent = msg;
        els.alert.className = `alert alert--${type}`;
        els.alert.style.display = 'block';
        setTimeout(() => { els.alert.style.display = 'none'; }, 4000);
    }

    function todayISO() {
        const d = new Date();
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function formatDate(d) { return window.Fmt.date(d); }

    function formatDateTime(d) { return window.Fmt.dateTime(d); }

    function escapeHtml(s) {
        if (!s) return '';
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    function escAttr(s) {
        return escapeHtml(s).replace(/"/g, '&quot;');
    }

    init();
})();
