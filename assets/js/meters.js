(function () {
    'use strict';

    const API      = 'api/meter_readings.php';
    const PROP_API = 'api/properties.php';
    const DOC_API   = 'api/documents.php';
    const METER_API = 'api/meters.php';

    // Valore sentinella della select contatore: apre il censimento inline.
    const NEW_METER = '__new__';

    // Il codice ha un nome diverso per tipo — luce = POD, gas = PDR, il resto
    // matricola. Stessa mappa del server (decorateMeter): qui serve solo come
    // suggerimento mentre si digita, la verita' resta quella dell'API.
    const CODE_LABELS = { electricity: 'POD', gas: 'PDR', water: 'Matricola', heating: 'Matricola' };

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

    // Data locale, non `toISOString()`: fra mezzanotte e le 2 in Italia l'UTC e'
    // ancora al giorno prima e il campo si sarebbe aperto su ieri.
    function todayISO() {
        const d = new Date();
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }
    function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

    const TYPE_LABELS = { gas: 'Gas', electricity: 'Elettricità', water: 'Acqua', heating: 'Riscaldamento' };
    const TYPE_UNITS  = { gas: 'm³', electricity: 'kWh', water: 'm³', heating: 'kWh' };

    let currentPage    = 1;
    let registryPage   = 1;   // il censimento contatori ha la sua paginazione
    const PAGE_LIMIT   = 25;
    let deleteTargetId = null;
    const els          = {};

    function init() {
        els.alert      = document.getElementById('meters-alert');
        els.tbody      = document.getElementById('meters-tbody');
        els.pagination = document.getElementById('meters-pagination');
        els.search     = document.getElementById('meters-search');
        els.propFilter = document.getElementById('meters-property-filter');
        els.typeFilter = document.getElementById('meters-type-filter');
        els.modal      = document.getElementById('meters-modal');
        els.form       = document.getElementById('meters-form');
        els.delModal   = document.getElementById('meters-delete-modal');
        els.propSelect = document.getElementById('meters-property-id');
        els.meterSel   = document.getElementById('meters-meter-id');
        els.newMeter   = document.getElementById('meters-new-meter');

        els.registryBody       = document.getElementById('meters-registry-tbody');
        els.registryPagination = document.getElementById('meters-registry-pagination');
        els.showInactive       = document.getElementById('meters-show-inactive');
        els.pendingOnly        = document.getElementById('meters-pending-only');
        els.registryTodo       = document.getElementById('meters-registry-todo');

        bindEvents();
        bindRowMenu();
        bindRegistry();
        loadProperties();
        loadReadings();
        loadRegistry();
        loadRegistryTodo();
    }

    // I filtri in cima sono di TUTTA la pagina, non delle sole letture: cercare
    // un POD o scegliere un immobile e vedere il censimento qui sotto restare su
    // tutte e trecento le righe faceva sembrare rotto il collegamento fra le due
    // tabelle. La riga da completare c'era, a pagina sette, e nessun filtro la
    // avvicinava.
    function hasFilters() {
        return !!(els.search.value.trim() || els.propFilter.value || els.typeFilter.value);
    }

    function applyFilters() {
        currentPage  = 1;
        registryPage = 1;
        loadReadings();
        loadRegistry();
    }

    // ── Censimento contatori ─────────────────────────────────────────────────
    // Il contatore e' l'oggetto fisico; le letture sono un'altra cosa. Finora
    // se ne poteva solo creare uno al volo registrando una lettura: un POD
    // digitato male non si correggeva piu', un contatore sostituito non si
    // poteva disattivare, e il messaggio dell'API ("Disattivalo se non e' piu'
    // in uso") indicava un'azione che non esisteva in nessuna schermata.

    function bindRegistry() {
        document.getElementById('btn-new-meter')?.addEventListener('click', () => {
            window.App.navigateTo('entity_edit', { entity: 'meters' });
        });
        els.showInactive?.addEventListener('change', () => { registryPage = 1; loadRegistry(); });

        // Il pulsante dentro una cella vuota porta dove porta "Modifica": la
        // scheda del contatore. Serve perche' il campo mancante e la strada per
        // riempirlo devono stare nello stesso posto — chi guarda una colonna di
        // trattini non ha modo di sapere che si compilano dal menu della riga.
        els.registryBody?.addEventListener('click', e => {
            const btn = e.target.closest('[data-fill]');
            if (!btn) return;
            window.App.navigateTo('entity_edit', { entity: 'meters', id: btn.dataset.fill });
        });

        window.RowMenu.bind(els.registryBody, btn => {
            const active = btn.dataset.active === '1';
            return [
                { label: 'Modifica', icon: 'pencil', onClick: () => {
                    window.App.navigateTo('entity_edit', { entity: 'meters', id: btn.dataset.id });
                } },
                { label: active ? 'Disattiva' : 'Riattiva', icon: active ? 'power-off' : 'power',
                  onClick: () => setMeterActive(btn.dataset.id, !active) },
                { sep: true },
                { label: 'Elimina', icon: 'trash-2', danger: true,
                  onClick: () => deleteMeter(btn.dataset.id, btn.dataset.label) },
            ];
        });
    }

    async function loadRegistry() {
        if (!els.registryBody) return;
        const params = new URLSearchParams();
        // active=1 filtra i disattivati; senza il parametro li mostra tutti.
        if (!els.showInactive?.checked) params.set('active', '1');

        // Stessi filtri della barra in cima: l'API li accetta gia' tutti e tre
        // (search su codice, matricola, fornitore, ubicazione e indirizzo).
        const search = els.search.value.trim();
        if (search) params.set('search', search);
        if (els.propFilter.value) params.set('property_id', els.propFilter.value);
        if (els.typeFilter.value) params.set('meter_type', els.typeFilter.value);

        params.set('page', registryPage);
        params.set('limit', PAGE_LIMIT);

        try {
            const res  = await fetch(`${METER_API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            // Impaginato sul serio: l'API taglia comunque a 100 per pagina, e
            // con 300 contatori una tabella "senza paginazione" ne mostrerebbe
            // un terzo senza dirlo.
            const parsed = window.Pagination.parseResponse(json);
            renderRegistry(parsed.items);
            window.Pagination.render(els.registryPagination, parsed, p => { registryPage = p; loadRegistry(); });
        } catch (e) {
            els.registryBody.innerHTML =
                `<tr><td colspan="7" class="text-muted" style="text-align:center;padding:2rem;">${esc(e.message)}</td></tr>`;
        }
    }

    // Un campo del censimento che nessuno ha ancora compilato non e' un dato
    // assente: e' una riga da finire. I contatori nati dal backfill dello storico
    // letture hanno solo immobile e tipo — codice, fornitore e ubicazione
    // arrivano tutti vuoti — quindi un trattino muto qui e' la regola, non
    // l'eccezione, e non dice a chi guarda che quei campi si scrivono.
    function fillCell(meterId, label) {
        return `<button type="button" class="cell-fill" data-fill="${esc(meterId)}"
                        title="Compila la scheda del contatore">+ ${esc(label)}</button>`;
    }

    function renderRegistry(items) {
        if (!items.length) {
            const msg = hasFilters()
                ? 'Nessun contatore corrisponde ai filtri.'
                : 'Nessun contatore censito.';
            els.registryBody.innerHTML =
                `<tr><td colspan="7" class="text-muted" style="text-align:center;padding:2rem;">${msg}</td></tr>`;
            return;
        }
        els.registryBody.innerHTML = items.map(m => {
            const codeLabel = CODE_LABELS[m.meter_type] || 'Codice';
            const label     = `${TYPE_LABELS[m.meter_type] || m.meter_type} — ${m.code || m.serial_number || 'senza codice'}`;
            const active    = Number(m.is_active) === 1;
            const supplier  = m.supplier_display || m.supplier_name;
            // La citta' accanto all'indirizzo perche' due immobili con lo stesso
            // civico in comuni diversi altrimenti sono la stessa riga.
            const place     = [m.property_address, m.property_city].filter(Boolean).join(' · ');
            return `<tr${active ? '' : ' class="is-muted"'}>
                <td>${esc(place || ('#' + m.property_id))}</td>
                <td>${esc(TYPE_LABELS[m.meter_type] || m.meter_type || '—')}</td>
                <td>${m.code ? `<span class="text-muted">${esc(codeLabel)}</span> ${esc(m.code)}` : fillCell(m.id, codeLabel)}</td>
                <td>${supplier ? esc(supplier) : fillCell(m.id, 'Fornitore')}</td>
                <td>${m.location ? esc(m.location) : fillCell(m.id, 'Ubicazione')}</td>
                <td>${active ? '<span class="badge badge--success">Attivo</span>' : '<span class="badge">Disattivato</span>'}</td>
                <td>${window.RowMenu.button(m.id, 'Azioni contatore', { active: active ? '1' : '0', label })}</td>
            </tr>`;
        }).join('');
        if (window.lucide) window.lucide.createIcons();
    }

    // Quanti contatori sono ancora senza codice. Sta accanto al titolo di QUESTA
    // tabella e non fra le KPI in cima, perche' parla delle celle vuote qui
    // sotto, non delle letture.
    async function loadRegistryTodo() {
        if (!els.registryTodo) return;
        try {
            const json = await fetch(`${METER_API}?action=stats`).then(r => r.json());
            if (!json.success) return;
            const n = Number(json.data.no_code || 0);
            els.registryTodo.textContent   = n ? `${n} senza codice` : '';
            els.registryTodo.style.display = n ? '' : 'none';
        } catch (e) { /* non-critical */ }
    }

    async function setMeterActive(id, active) {
        try {
            // L'API riscrive tutte le colonne: si rilegge la riga e si rimanda
            // intera, altrimenti disattivare cancellerebbe fornitore e ubicazione.
            const cur = await fetch(`${METER_API}?id=${encodeURIComponent(id)}`).then(r => r.json());
            if (!cur.success) throw new Error(cur.error);
            const m = Array.isArray(cur.data) ? cur.data[0] : cur.data;

            const res = await fetch(`${METER_API}?id=${encodeURIComponent(id)}`, {
                method:  'PUT',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    property_id: m.property_id, meter_type: m.meter_type, code: m.code,
                    serial_number: m.serial_number, supplier_id: m.supplier_id,
                    supplier_name: m.supplier_name, location: m.location,
                    installed_on: m.installed_on, removed_on: m.removed_on,
                    notes: m.notes, is_active: active ? 1 : 0,
                }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert(active ? 'Contatore riattivato.' : 'Contatore disattivato: lo storico delle letture resta consultabile.', 'success');
            loadRegistry();
        } catch (e) { showAlert(e.message, 'error'); }
    }

    async function deleteMeter(id, label) {
        try {
            const res  = await fetch(`${METER_API}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
            const json = await res.json();
            // L'API rifiuta con 409 se ci sono letture e spiega di disattivare:
            // e' il messaggio giusto, si mostra e basta.
            if (!json.success) throw new Error(json.error);
            showAlert(`Contatore eliminato (${label}).`, 'success');
            loadRegistry();
        } catch (e) { showAlert(e.message, 'error'); }
    }

    function bindEvents() {
        document.getElementById('btn-new-reading').addEventListener('click', () => openModal());
        document.getElementById('meters-modal-close').addEventListener('click', closeModal);
        document.getElementById('meters-modal-cancel').addEventListener('click', closeModal);
        els.modal.addEventListener('click', e => { if (e.target === els.modal) closeModal(); });
        els.form.addEventListener('submit', handleSubmit);

        document.getElementById('meters-delete-close').addEventListener('click', closeDeleteModal);
        document.getElementById('meters-delete-cancel').addEventListener('click', closeDeleteModal);
        document.getElementById('meters-delete-confirm').addEventListener('click', confirmDelete);
        els.delModal.addEventListener('click', e => { if (e.target === els.delModal) closeDeleteModal(); });

        els.search.addEventListener('input', debounce(applyFilters, 400));
        els.propFilter.addEventListener('change', applyFilters);
        els.typeFilter.addEventListener('change', applyFilters);
        // Ricarica le sole letture: il censimento qui sotto non ha autoletture
        // da confermare, e svuotarlo direbbe una cosa falsa sui contatori.
        els.pendingOnly?.addEventListener('change', () => { currentPage = 1; loadReadings(); });

        els.propSelect.addEventListener('change', () => loadMetersFor(els.propSelect.value));
        els.meterSel.addEventListener('change', syncNewMeterFields);
        document.getElementById('meters-type').addEventListener('change', syncCodeHint);
    }

    // I contatori dipendono dall'immobile scelto: finche' non c'e' un immobile la
    // select resta vuota, e non elencare mai i contatori di un altro immobile.
    async function loadMetersFor(propertyId, selectedId) {
        els.meterSel.innerHTML = '';

        if (!propertyId) {
            els.meterSel.appendChild(new Option('— Seleziona prima l\'immobile —', ''));
            syncNewMeterFields();
            return;
        }

        els.meterSel.appendChild(new Option('Caricamento…', ''));

        try {
            const res  = await fetch(`${METER_API}?property_id=${encodeURIComponent(propertyId)}&active=1&limit=200`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const items = window.Pagination.parseResponse(json).items;
            els.meterSel.innerHTML = '';
            els.meterSel.appendChild(new Option(items.length ? '— Seleziona contatore —' : '— Nessun contatore censito —', ''));

            items.forEach(m => {
                const bits = [TYPE_LABELS[m.meter_type] || m.meter_type];
                if (m.code) bits.push(`${m.code_label} ${m.code}`);
                if (m.location) bits.push(m.location);
                els.meterSel.appendChild(new Option(bits.join(' · '), m.id));
            });

            els.meterSel.appendChild(new Option('＋ Registra nuovo contatore', NEW_METER));
            if (selectedId) els.meterSel.value = String(selectedId);
        } catch (e) {
            els.meterSel.innerHTML = '';
            els.meterSel.appendChild(new Option('Errore nel caricamento', ''));
            els.meterSel.appendChild(new Option('＋ Registra nuovo contatore', NEW_METER));
        }

        syncNewMeterFields();
    }

    function syncNewMeterFields() {
        const creating = els.meterSel.value === NEW_METER;
        els.newMeter.hidden = !creating;
        // `required` va tolto quando il fieldset e' nascosto, altrimenti il
        // browser blocca l'invio su un campo che nessuno puo' vedere.
        document.getElementById('meters-type').required = creating;
        syncCodeHint();
    }

    function syncCodeHint() {
        const type = document.getElementById('meters-type').value;
        const hint = document.getElementById('meters-code-hint');
        if (hint) hint.textContent = CODE_LABELS[type] ? `(${CODE_LABELS[type]})` : '';
    }

    async function loadProperties() {
        try {
            const items = await window.Pagination.fetchList(PROP_API);
            // populate both the filter and the modal select
            [els.propFilter, document.getElementById('meters-property-id')].forEach(sel => {
                if (!sel) return;
                items.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    // Stessa etichetta delle altre tendine (lookups.js): col solo
                    // indirizzo due immobili con lo stesso civico in comuni
                    // diversi diventano due voci identiche, e la lettura finisce
                    // sul contatore sbagliato senza che nulla lo segnali.
                    opt.textContent = [p.reference_code, p.address, p.city].filter(Boolean).join(' — ')
                        || p.title || `#${p.id}`;
                    sel.appendChild(opt);
                });
            });
        } catch (e) { /* non-critical */ }
    }

    async function loadReadings() {
        const params = new URLSearchParams();
        const search = els.search.value.trim();
        const prop   = els.propFilter.value;
        const type   = els.typeFilter.value;
        if (search) params.set('search', search);
        if (prop) params.set('property_id', prop);
        if (type) params.set('meter_type', type);
        if (els.pendingOnly?.checked) params.set('pending', '1');
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);

        softLoad(els.tbody, '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:2rem;">Caricamento…</td></tr>');

        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const parsed = window.Pagination.parseResponse(json);
            renderRows(parsed.items);
            window.Pagination.render(els.pagination, parsed, p => { currentPage = p; loadReadings(); });
        } catch (err) {
            els.tbody.classList.remove('is-loading');
            els.tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--color-danger);padding:2rem;">${esc(err.message)}</td></tr>`;
        }
    }

    // `consumption` null = prima lettura del contatore, non consumo zero: va detto,
    // non stampato come 0,00. Il segno conta — un delta negativo e' un contatore
    // sostituito o azzerato, e con la freccia sempre in su passava per un consumo.
    function renderConsumption(value, unit) {
        if (value == null || value === '') {
            return '<span class="text-muted" title="Prima lettura di questo contatore: nessun precedente con cui calcolare il consumo.">— <small>prima lettura</small></span>';
        }

        const n = Number(value);
        if (!isFinite(n)) return '<span class="text-muted">—</span>';

        if (n < 0) {
            return `<span style="color:var(--color-danger,#c0392b);" title="Lettura inferiore alla precedente: contatore sostituito, azzerato o lettura errata.">▼ ${esc(String(value))} ${esc(unit)}</span>`;
        }
        if (n === 0) {
            return `<span class="text-muted">0 ${esc(unit)}</span>`;
        }
        return `<span style="color:var(--color-warning,#e67e22);">▲ ${esc(String(value))} ${esc(unit)}</span>`;
    }

    // Una lettura senza foto non e' un errore, ma in una contestazione di fine
    // locazione e' la parola dell'agente contro quella dell'inquilino: va vista
    // a colpo d'occhio quali righe sono documentate e quali no.
    function renderPhotoCell(r) {
        const n = Number(r.photo_count || 0);
        if (!n) {
            return '<span class="text-muted" title="Nessuna prova fotografica allegata.">—</span>';
        }

        const first = (r.photos && r.photos[0]) || null;
        const label = n > 1 ? ` ${n}` : '';
        if (!first) return `<span class="badge">${esc(String(n))}</span>`;

        return `<a href="${esc(first.download_url)}" target="_blank" rel="noopener"
                   title="${esc(first.original_name)}${n > 1 ? ` (+${n - 1} altre)` : ''}"
                   style="display:inline-flex;align-items:center;gap:.25rem;">
                    <i data-lucide="camera"></i>${esc(label)}
                </a>`;
    }

    /**
     * Da dove viene il numero.
     *
     * phase98 ha separato la lettura fatta dall'agenzia dall'AUTOLETTURA
     * dichiarata dall'inquilino, e la seconda nasce non verificata. Finche' non
     * lo si vede in elenco, le due si leggono identiche: si conguaglia su un
     * numero che nessuno e' andato a controllare, credendo sia stato letto.
     */
    function renderOriginHtml(r) {
        if (r.source !== 'tenant') return '';

        const who = r.submitted_by_name ? ` da ${r.submitted_by_name}` : '';
        return r.verified_at
            ? `<div class="mtr-origin mtr-origin--ok" title="Autolettura${esc(who)}, confermata dall'agenzia">`
              + `<i data-lucide="check"></i> autolettura confermata</div>`
            : `<div class="mtr-origin mtr-origin--todo" title="Dichiarata dall'inquilino${esc(who)}: da confermare prima di usarla per un conguaglio">`
              + `<i data-lucide="clock"></i> autolettura da confermare</div>`;
    }

    function renderRows(items) {
        els.tbody.classList.remove('is-loading');
        if (!items.length) {
            // Con il filtro attivo "nessuna lettura trovata" si legge come un
            // guasto: qui zero e' la risposta giusta, e va detto cosi'.
            const msg = els.pendingOnly?.checked
                ? 'Nessuna autolettura in attesa: sono state confermate tutte.'
                : 'Nessuna lettura trovata.';
            els.tbody.innerHTML = `<tr><td colspan="7" class="text-muted" style="text-align:center;padding:2rem;">${msg}</td></tr>`;
            return;
        }

        els.tbody.innerHTML = items.map(r => {
            const typeLabel = TYPE_LABELS[r.meter_type] || r.meter_type || '—';
            const meterBits = [r.meter_code, r.meter_location].filter(Boolean).join(' · ');
            const unit      = TYPE_UNITS[r.meter_type] || '';
            const reading   = r.reading_value != null ? `${r.reading_value} ${unit}` : '—';
            const deltaHtml = renderConsumption(r.consumption, unit);

            return `<tr>
                <td data-label="Immobile">${esc(r.property_address || r.property_title || `#${r.property_id}`)}</td>
                <td data-label="Contatore">
                    <span class="badge">${esc(typeLabel)}</span>
                    ${meterBits ? `<div class="text-muted"><small>${esc(meterBits)}</small></div>` : ''}
                </td>
                <td data-label="Lettura">${esc(reading)}${renderOriginHtml(r)}</td>
                <td data-label="Consumo">${deltaHtml}</td>
                <td data-label="Data">${formatDate(r.reading_date)}</td>
                <td data-label="Prova">${renderPhotoCell(r)}</td>
                <td data-label="Azioni" class="col-actions lt-actions">
                    ${window.RowMenu.button(r.id, 'Azioni lettura')}
                </td>
            </tr>`;
        }).join('');

        // Le righe servono al menu, che deve sapere se questa lettura e' una
        // autolettura da confermare: `RowMenu.bind` aggancia una volta sola e
        // legge questa proprieta' all'apertura, non alla prima pagina.
        els.tbody._items = items;

        // Senza questa riga i `<i data-lucide>` disegnati adesso restano lettere
        // vuote: l'idratazione globale avviene al caricamento della vista, non a
        // ogni ridisegno della tabella.
        if (window.lucide) window.lucide.createIcons();
    }

    function bindRowMenu() {
        window.RowMenu.bind(els.tbody, btn => {
        const row = (els.tbody._items || []).find(x => String(x.id) === String(btn.dataset.id)) || {};
        const isTenantReading = row.source === 'tenant';

        return [
            // Solo sulle autoletture: una lettura dell'agenzia nasce gia' buona,
            // e l'API rifiuterebbe comunque di "confermarla".
            isTenantReading
                ? (row.verified_at
                    ? { label: 'Rimetti in attesa', icon: 'rotate-ccw',
                        onClick: () => setVerification(btn.dataset.id, 'unverify') }
                    : { label: 'Conferma autolettura', icon: 'check-circle',
                        onClick: () => setVerification(btn.dataset.id, 'verify') })
                : null,
            isTenantReading ? { sep: true } : null,
            { label: 'Modifica', icon: 'pencil', onClick: async () => {
                try {
                    const res  = await fetch(`${API}?id=${btn.dataset.id}`);
                    const json = await res.json();
                    if (!json.success) throw new Error(json.error);
                    const item = Array.isArray(json.data) ? json.data[0] : json.data;
                    openModal(item);
                } catch (e) { showAlert(e.message, 'error'); }
            } },
            { sep: true },
            { label: 'Elimina', icon: 'trash-2', danger: true, onClick: () => {
                deleteTargetId = btn.dataset.id;
                els.delModal.hidden = false;
            } },
        ];
        });
    }

    /**
     * Conferma o rimette in attesa un'autolettura.
     *
     * Non tocca il valore: se il numero e' sbagliato si corregge con «Modifica»
     * e poi si conferma, cosi' resta scritto che qualcuno l'ha guardato.
     */
    async function setVerification(id, action) {
        try {
            const res  = await fetch(`${API}?id=${encodeURIComponent(id)}&action=${action}`, { method: 'PATCH' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert(action === 'verify'
                ? 'Autolettura confermata: da adesso vale come una lettura dell\'agenzia.'
                : 'Autolettura rimessa in attesa di conferma.', 'success');
            loadReadings();
        } catch (e) {
            showAlert(e.message, 'error');
        }
    }

    function openModal(item = null) {
        els.form.reset();
        document.getElementById('meters-id').value = '';
        document.getElementById('meters-modal-title').textContent = item ? 'Modifica Lettura' : 'Inserisci Lettura';

        // Una lettura non puo' essere futura: il tetto va rimesso a ogni apertura
        // perche' la scheda resta in pagina anche a cavallo della mezzanotte.
        const today = todayISO();
        document.getElementById('meters-reading-date').max = today;

        // default date to today
        if (!item) {
            document.getElementById('meters-reading-date').value = today;
        }

        if (item) {
            document.getElementById('meters-id').value              = item.id;
            document.getElementById('meters-property-id').value     = item.property_id || '';
            document.getElementById('meters-reading-value').value   = item.reading_value || '';
            document.getElementById('meters-reading-date').value    = item.reading_date ? item.reading_date.substring(0, 10) : '';
            document.getElementById('meters-notes').value           = item.notes || '';
        }

        // Non atteso di proposito: la scheda si apre subito e la select dei
        // contatori si popola appena la risposta arriva.
        loadMetersFor(item ? item.property_id : '', item ? item.meter_id : null);
        renderExistingPhotos(item ? item.photos : []);

        els.modal.hidden = false;
        document.getElementById('meters-reading-value').focus();
    }

    function renderExistingPhotos(photos) {
        const box = document.getElementById('meters-photo-existing');
        if (!box) return;

        if (!photos || !photos.length) {
            box.innerHTML = '';
            return;
        }

        box.innerHTML = 'Già allegate: ' + photos.map(p =>
            `<a href="${esc(p.download_url)}" target="_blank" rel="noopener">${esc(p.original_name)}</a>`
        ).join(', ');
    }

    async function createMeterInline(propertyId) {
        const payload = {
            property_id:   propertyId,
            meter_type:    document.getElementById('meters-type').value,
            code:          document.getElementById('meters-code').value.trim(),
            supplier_name: document.getElementById('meters-supplier').value.trim(),
            location:      document.getElementById('meters-location').value.trim(),
        };

        if (!payload.meter_type) throw new Error('Seleziona il tipo del nuovo contatore.');

        const res  = await fetch(METER_API, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);

        return json.data.id;
    }

    // L'upload avviene DOPO il salvataggio perche' la foto si lega all'id della
    // lettura, che prima di salvare non esiste. Se il caricamento fallisce la
    // lettura resta salvata: si dice quali file non sono passati invece di far
    // credere che sia andato perso tutto.
    async function uploadPhotos(readingId, propertyId, files) {
        const failed = [];

        for (const file of files) {
            const fd = new FormData();
            fd.append('file', file);
            fd.append('doc_type', 'lettura_contatore');
            fd.append('meter_reading_id', readingId);
            if (propertyId) fd.append('property_id', propertyId);
            fd.append('title', `Foto contatore — lettura #${readingId}`);

            try {
                const res  = await fetch(DOC_API, { method: 'POST', body: fd });
                const json = await res.json();
                if (!json.success) throw new Error(json.error || 'errore sconosciuto');
            } catch (e) {
                failed.push(`${file.name} (${e.message})`);
            }
        }

        return failed;
    }

    function closeModal() { els.modal.hidden = true; }
    function closeDeleteModal() { els.delModal.hidden = true; deleteTargetId = null; }

    async function handleSubmit(e) {
        e.preventDefault();
        const id  = document.getElementById('meters-id').value;
        const btn = document.getElementById('meters-modal-save');
        btn.disabled = true; btn.textContent = 'Salvataggio…';

        const propertyId = els.propSelect.value;
        const data = {
            property_id:   propertyId,
            meter_id:      els.meterSel.value,
            reading_value: document.getElementById('meters-reading-value').value,
            reading_date:  document.getElementById('meters-reading-date').value,
            notes:         document.getElementById('meters-notes').value.trim(),
        };

        try {
            // Il contatore nuovo va creato prima: la lettura si appende al suo id.
            // Se il censimento fallisce ci si ferma qui, senza salvare una lettura
            // agganciata al contatore sbagliato.
            if (data.meter_id === NEW_METER) {
                data.meter_id = await createMeterInline(propertyId);
            }

            const res  = await fetch(id ? `${API}?id=${id}` : API, {
                method: id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const saved     = Array.isArray(json.data) ? json.data[0] : json.data;
            const readingId = saved && saved.id ? saved.id : id;
            const files     = Array.from(document.getElementById('meters-photo').files || []);

            let failed = [];
            if (readingId && files.length) {
                btn.textContent = 'Caricamento foto…';
                failed = await uploadPhotos(readingId, data.property_id, files);
            }

            closeModal();
            if (failed.length) {
                showAlert(`Lettura salvata, ma non è stato possibile allegare: ${failed.join('; ')}`, 'error');
            } else {
                showAlert('Lettura salvata con successo.', 'success');
            }
            loadReadings();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Salva';
        }
    }

    async function confirmDelete() {
        if (!deleteTargetId) return;
        const btn = document.getElementById('meters-delete-confirm');
        btn.disabled = true;
        try {
            const res  = await fetch(`${API}?id=${deleteTargetId}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeDeleteModal();
            showAlert('Lettura eliminata.', 'success');
            loadReadings();
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

    // Formattazione sulla stringa ISO, senza passare da `new Date()`: quello
    // interpreta "2026-07-03" come mezzanotte UTC (che a fusi negativi diventa il
    // giorno prima) e soprattutto stampa l'anno 26 come "26", mascherando in
    // tabella le date corrotte che la KPI invece mostra per intero ("0026").
    function formatDate(str) { return window.Fmt.date(str); }

    init();
})();
