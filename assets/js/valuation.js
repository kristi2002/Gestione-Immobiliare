(function () {
    'use strict';

    const API      = 'api/valuation.php';
    const PROP_API = 'api/properties.php';

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
    function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
    function eur(n) { return n == null ? '—' : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n); }
    function eur2(n) { return n == null ? '—' : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n); }

    let currentPage = 1;
    const PAGE_LIMIT = 25;
    let deleteTargetId = null;
    // Il CSV letto dal disco: si tiene qui fra l'anteprima e la conferma, così
    // l'import definitivo lavora esattamente sul file già validato.
    let importCsv = null;

    const els = {};

    function init() {
        els.alert      = document.getElementById('val-alert');
        els.tbody      = document.getElementById('omi-tbody');
        els.pagination = document.getElementById('omi-pagination');
        els.search     = document.getElementById('omi-search');
        els.delModal   = document.getElementById('omi-delete-modal');
        els.importModal= document.getElementById('omi-import-modal');
        els.estResult  = document.getElementById('val-estimate-result');

        bindEvents();
        loadProperties();
        loadOmi();
    }

    function bindEvents() {
        document.getElementById('btn-new-omi').addEventListener('click', () => openForm());

        document.getElementById('omi-delete-close').addEventListener('click', closeDeleteModal);
        document.getElementById('omi-delete-cancel').addEventListener('click', closeDeleteModal);
        document.getElementById('omi-delete-confirm').addEventListener('click', confirmDelete);
        els.delModal.addEventListener('click', e => { if (e.target === els.delModal) closeDeleteModal(); });

        document.getElementById('btn-estimate').addEventListener('click', runEstimate);
        els.search.addEventListener('input', debounce(() => { currentPage = 1; loadOmi(); }, 300));

        document.getElementById('btn-import-omi').addEventListener('click', openImportModal);
        document.getElementById('omi-import-close').addEventListener('click', closeImportModal);
        document.getElementById('omi-import-cancel').addEventListener('click', closeImportModal);
        document.getElementById('omi-import-preview').addEventListener('click', () => runImport(true));
        document.getElementById('omi-import-confirm').addEventListener('click', () => runImport(false));
        els.importModal.addEventListener('click', e => { if (e.target === els.importModal) closeImportModal(); });
        // Cambiare file invalida l'anteprima: confermare un import su un report
        // riferito al file precedente scriverebbe righe che nessuno ha visto.
        document.getElementById('omi-import-file').addEventListener('change', resetImportPreview);
        document.getElementById('omi-import-period').addEventListener('input', resetImportPreview);
    }

    // ── Import listino ufficiale ────────────────────────────────────────────

    function openImportModal() {
        document.getElementById('omi-import-file').value = '';
        document.getElementById('omi-import-period').value = els.currentPeriod || '';
        resetImportPreview();
        els.importModal.hidden = false;
    }

    function closeImportModal() { els.importModal.hidden = true; importCsv = null; }

    function resetImportPreview() {
        importCsv = null;
        document.getElementById('omi-import-confirm').disabled = true;
        document.getElementById('omi-import-report').innerHTML = '';
    }

    async function runImport(dryRun) {
        const fileInput = document.getElementById('omi-import-file');
        const period    = document.getElementById('omi-import-period').value.trim();
        const reportEl  = document.getElementById('omi-import-report');

        if (!fileInput.files || !fileInput.files.length) {
            reportEl.innerHTML = '<div class="alert alert--error">Seleziona il file CSV.</div>';
            return;
        }
        if (!period) {
            reportEl.innerHTML = '<div class="alert alert--error">Indica il semestre di riferimento (es. 2026-S1).</div>';
            return;
        }

        const previewBtn = document.getElementById('omi-import-preview');
        const confirmBtn = document.getElementById('omi-import-confirm');
        previewBtn.disabled = true; confirmBtn.disabled = true;
        reportEl.innerHTML = '<p class="text-muted">Lettura del file…</p>';

        try {
            if (importCsv === null) {
                importCsv = await fileInput.files[0].text();
            }
            const res = await fetch(`${API}?action=import`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ csv: importCsv, period, dry_run: dryRun }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            renderImportReport(json.data, dryRun);
            if (dryRun) {
                confirmBtn.disabled = json.data.rows_ready === 0;
            } else {
                showAlert(json.data.message, 'success');
                closeImportModal();
                loadOmi();
            }
        } catch (err) {
            reportEl.innerHTML = `<div class="alert alert--error">${esc(err.message)}</div>`;
            importCsv = null;
        } finally {
            previewBtn.disabled = false;
        }
    }

    function renderImportReport(r, dryRun) {
        const reportEl = document.getElementById('omi-import-report');
        if (!dryRun) { reportEl.innerHTML = ''; return; }

        let html = `<div class="alert alert--info" style="margin-bottom:10px;">
            <strong>${r.rows_ready}</strong> quotazioni pronte per il semestre <strong>${esc(r.period)}</strong>
            su ${r.rows_in_file} righe lette.</div>`;

        const notes = [];
        if (r.skipped_manual)   notes.push(`${r.skipped_manual} righe saltate perché corrette a mano (override conservati)`);
        if (r.skipped_typology) notes.push(`${r.skipped_typology} righe con tipologia non gestita (es. capannoni)`);
        if (r.skipped_novalue)  notes.push(`${r.skipped_novalue} righe senza valori`);
        if (r.non_normal_state) notes.push(`${r.non_normal_state} righe in stato non NORMALE (usate solo dove manca la base standard)`);
        if (notes.length) {
            html += '<ul class="val-panel__list" style="margin-bottom:10px;">' + notes.map(n => `<li>${esc(n)}</li>`).join('') + '</ul>';
        }

        if (r.comuni && r.comuni.length) {
            html += `<p class="text-muted" style="margin:0 0 8px;">Comuni: ${esc(r.comuni.join(', '))}</p>`;
        }

        if (r.preview && r.preview.length) {
            html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>Comune</th><th>Zona</th><th>Tipologia</th><th>Vendita €/m²</th><th>Affitto €/m²</th></tr></thead><tbody>';
            html += r.preview.map(p => `<tr>
                <td>${esc(p.comune)}</td><td>${esc(p.cadastral_zone || '—')}</td><td>${esc(p.property_type)}</td>
                <td>${eur2(p.price_min_sqm)} – ${eur2(p.price_max_sqm)}</td>
                <td>${eur2(p.rent_min_sqm)} – ${eur2(p.rent_max_sqm)}</td></tr>`).join('');
            html += '</tbody></table></div>';
            if (r.rows_ready > r.preview.length) {
                html += `<p class="text-muted">…e altre ${r.rows_ready - r.preview.length} righe.</p>`;
            }
        }

        reportEl.innerHTML = html;
    }

    async function loadProperties() {
        try {
            const items = await window.Pagination.fetchList(PROP_API);
            const sel = document.getElementById('val-property');
            items.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = (p.address || `#${p.id}`) + (p.city ? ' · ' + p.city : '');
                sel.appendChild(opt);
            });
        } catch (e) { /* non-critical */ }
    }

    async function runEstimate() {
        const propertyId = document.getElementById('val-property').value;
        if (!propertyId) { showAlert('Seleziona un immobile.', 'error'); return; }
        const btn = document.getElementById('btn-estimate');
        btn.disabled = true;
        els.estResult.innerHTML = '<p class="text-muted">Calcolo in corso…</p>';
        try {
            const res  = await fetch(`${API}?action=estimate&property_id=${propertyId}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            renderEstimate(json.data);
        } catch (err) {
            els.estResult.innerHTML = `<p style="color:var(--color-danger)">${esc(err.message)}</p>`;
        } finally {
            btn.disabled = false;
        }
    }

    // Badge di freschezza del semestre OMI. I livelli e le soglie li decide il
    // server (config/omi.php): qui si traduce solo in colore, così non esistono
    // due definizioni di "scaduto" che possono divergere.
    function periodBadge(level, label) {
        if (!level || level === 'current') return '';
        const cls = level === 'stale' ? 'badge--danger' : 'badge--warning';
        const icon = level === 'stale' ? '⚠️ ' : '';
        return ` <span class="badge ${cls}">${icon}${esc(label || level)}</span>`;
    }

    function renderEstimate(d) {
        const s = d.suggested || {};
        const omi = d.omi;
        const cmp = d.comparables;
        const coef = d.coefficients;

        let html = `<div class="val-result">
            <div class="val-result__figures">
                <div class="val-stat val-stat--lead">
                    <span class="val-stat__value">${eur(s.value)}</span>
                    <span class="val-stat__label">Valore stimato</span>
                </div>
                <div class="val-stat">
                    <span class="val-stat__value">${s.value_min != null ? eur(s.value_min) + ' – ' + eur(s.value_max) : '—'}</span>
                    <span class="val-stat__label">Intervallo</span>
                </div>
                <div class="val-stat">
                    <span class="val-stat__value">${eur(s.rent)}</span>
                    <span class="val-stat__label">Canone stimato/mese</span>
                </div>
                <div class="val-stat">
                    <span class="val-stat__value">${esc(s.basis || '—')}</span>
                    <span class="val-stat__label">Base di calcolo</span>
                </div>
            </div>`;

        // Il conto in chiaro: è quello che l'agente mostra al venditore per
        // giustificare la cifra. Senza, la stima è un numero senza argomenti.
        if (d.breakdown && d.breakdown.length) {
            html += '<div class="val-panel val-breakdown"><div class="val-panel__head">Come si ottiene</div><div class="val-panel__body">';
            html += '<ul class="val-breakdown__list">' + d.breakdown.map(b =>
                `<li><span class="val-breakdown__label">${esc(b.label)}</span><span class="val-breakdown__detail">${esc(b.detail)}</span></li>`
            ).join('') + '</ul>';
            if (coef && coef.capped) {
                html += '<p class="text-muted" style="margin-bottom:0;">Rettifiche limitate al ±35%.</p>';
            }
            html += '</div></div>';
        }

        html += '<div class="val-result__panels">';

        html += '<div class="val-panel"><div class="val-panel__head">Quotazione OMI</div><div class="val-panel__body">';
        if (omi) {
            html += `<p>Zona <strong>${esc(omi.zone || '—')}</strong>${omi.period ? ' · ' + esc(omi.period) : ''}${periodBadge(omi.period_level, omi.period_label)}<br>
                Vendita: ${eur(omi.value_min)} – ${eur(omi.value_max)}<br>
                Affitto: ${eur(omi.rent_min)} – ${eur(omi.rent_max)}/mese</p>`;
        } else {
            html += '<p class="text-muted">Nessuna quotazione OMI per questa zona/tipologia.</p>';
            // Il pannello resta vuoto anche quando la quotazione ESISTE ma
            // l'immobile non ha i m² (l'API compone `omi` solo con la
            // superficie): invitare a inserirla in quel caso creerebbe un
            // doppione sulla stessa chiave. Si propone solo quando la superficie
            // c'è e la riga manca davvero.
            if (d.sqm) {
                html += '<button type="button" class="btn btn--sm btn--secondary" id="btn-add-omi-here">'
                      + '<i data-lucide="plus"></i> Inserisci la quotazione mancante</button>';
            }
        }
        html += '</div></div>';

        html += '<div class="val-panel"><div class="val-panel__head">Rettifiche sull\'immobile</div><div class="val-panel__body">';
        if (coef && coef.items && coef.items.length) {
            html += '<ul class="val-panel__list">' + coef.items.map(i =>
                `<li>${esc(i.label)} <strong>${i.pct > 0 ? '+' : ''}${i.pct}%</strong></li>`).join('') + '</ul>';
        } else {
            html += '<p class="text-muted">Nessuna rettifica: l\'immobile corrisponde alle condizioni medie di zona.</p>';
        }
        html += '</div></div>';

        html += '<div class="val-panel"><div class="val-panel__head">Comparabili interni</div><div class="val-panel__body">';
        if (cmp && cmp.sample && cmp.sample.length) {
            html += `<p class="text-muted" style="margin-top:0;">${cmp.count} immobili · media ${cmp.sale_sqm_avg ? eur2(cmp.sale_sqm_avg) + '/m² (vendita)' : ''} ${cmp.rent_sqm_avg ? eur2(cmp.rent_sqm_avg) + '/m² (affitto)' : ''}</p>`;
            html += '<ul class="val-panel__list">' + cmp.sample.slice(0, 4).map(c =>
                `<li>${esc(c.address)} — ${eur(c.price)} (${c.sqm} m², ${eur2(c.price_sqm)}/m²)</li>`).join('') + '</ul>';
        } else {
            html += '<p class="text-muted">Comparabili interni insufficienti.</p>';
        }
        html += '</div></div></div>';

        if (d.warnings && d.warnings.length) {
            html += '<div class="alert alert--warning" style="margin-top:14px;">' + d.warnings.map(esc).join('<br>') + '</div>';
        }

        // Si può congelare solo una stima che ha una base OMI: senza, non
        // resterebbe nulla da rileggere fra otto mesi.
        if (omi && s.value != null) {
            html += `<div class="val-result__actions" style="margin-top:14px;">
                <button class="btn btn--secondary" id="btn-save-appraisal"><i data-lucide="save"></i> Salva sulla scheda immobile</button>
                <span class="text-muted" style="margin-left:10px;font-size:0.86rem;">Registra la stima con il semestre OMI e i coefficienti applicati.</span>
            </div>`;
        }

        html += '</div>';
        els.estResult.innerHTML = html;

        const saveBtn = document.getElementById('btn-save-appraisal');
        if (saveBtn) saveBtn.addEventListener('click', () => saveAppraisal(d.property_id, saveBtn));

        const addOmiBtn = document.getElementById('btn-add-omi-here');
        if (addOmiBtn) {
            addOmiBtn.addEventListener('click', () => openForm(null, {
                comune:        d.city || '',
                property_type: d.property_type || '',
            }));
        }

        if (window.lucide) window.lucide.createIcons();
    }

    async function saveAppraisal(propertyId, btn) {
        btn.disabled = true;
        const original = btn.innerHTML;
        btn.textContent = 'Salvataggio…';
        try {
            const res = await fetch(`${API}?action=save_appraisal`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ property_id: propertyId }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            showAlert(json.data.message || 'Valutazione salvata.', 'success');
            btn.textContent = 'Salvata ✓';
        } catch (err) {
            showAlert(err.message, 'error');
            btn.disabled = false;
            btn.innerHTML = original;
            if (window.lucide) window.lucide.createIcons();
        }
    }

    async function loadOmi() {
        const params = new URLSearchParams();
        if (els.search.value.trim()) params.set('search', els.search.value.trim());
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);
        softLoad(els.tbody, '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:2rem;">Caricamento…</td></tr>');
        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            // Il semestre corrente lo calcola il server: precompilare l'import
            // con un semestre dedotto dal browser rischierebbe di datare male
            // il listino se il fuso o l'orologio del client sono sfasati.
            if (json.data && json.data.current_period) els.currentPeriod = json.data.current_period;
            const parsed = window.Pagination.parseResponse(json);
            renderRows(parsed.items);
            window.Pagination.render(els.pagination, parsed, p => { currentPage = p; loadOmi(); });
        } catch (err) {
            els.tbody.classList.remove('is-loading');
            els.tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--color-danger);padding:2rem;">${esc(err.message)}</td></tr>`;
        }
    }

    function renderRows(items) {
        els.tbody.classList.remove('is-loading');
        if (!items.length) {
            els.tbody.innerHTML = '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:2rem;">Nessuna quotazione. Importa il listino OMI per abilitare le stime.</td></tr>';
            return;
        }
        const range = (a, b) => (a == null && b == null) ? '—' : `${eur2(a)} – ${eur2(b)}`;
        els.tbody.innerHTML = items.map(o => `<tr>
            <td data-label="Comune">${esc(o.comune)}</td>
            <td data-label="Zona">${esc(o.cadastral_zone || '—')}</td>
            <td data-label="Tipologia">${esc(o.property_type)}</td>
            <td data-label="Vendita €/m²">${range(o.price_min_sqm, o.price_max_sqm)}</td>
            <td data-label="Affitto €/m²">${range(o.rent_min_sqm, o.rent_max_sqm)}</td>
            <td data-label="Periodo">${esc(o.period || '—')}${periodBadge(o.period_level, o.period_level === 'stale' ? 'scaduta' : 'da verificare')}</td>
            <td data-label="Origine">${o.source === 'import' ? '<span class="badge badge--soft">listino</span>' : '<span class="badge badge--soft">override</span>'}</td>
            <td data-label="Azioni" class="col-actions" style="white-space:nowrap;">
                <button class="btn btn--sm btn--ghost btn-omi-edit" data-id="${o.id}" title="Modifica"><i data-lucide="pencil"></i></button>
                <button class="btn btn--sm btn--ghost btn-omi-del" data-id="${o.id}" title="Elimina"><i data-lucide="trash-2"></i></button>
            </td>
        </tr>`).join('');

        // La riga non si carica più qui: il modulo la rilegge da solo con l'id,
        // quindi una modifica aperta su un link incollato mostra sempre il dato
        // fresco invece di quello congelato nell'ultima paginazione.
        els.tbody.querySelectorAll('.btn-omi-edit').forEach(btn => {
            btn.addEventListener('click', () => openForm(btn.dataset.id));
        });
        els.tbody.querySelectorAll('.btn-omi-del').forEach(btn => {
            btn.addEventListener('click', () => { deleteTargetId = btn.dataset.id; els.delModal.hidden = false; });
        });
    }

    function closeDeleteModal() { els.delModal.hidden = true; deleteTargetId = null; }

    /**
     * La quotazione OMI è una pagina (entity_edit), non più una finestra: ha un
     * suo indirizzo, entra nelle briciole di pane e il tasto Indietro del browser
     * ci torna sopra. Il modulo è descritto in
     * assets/js/entity_edit/schemas/valuation.js.
     *
     * `prefill` serve alla stima che non trova il listino: comune e tipologia
     * dell'immobile arrivano già compilati, così la riga mancante si inserisce
     * senza ricopiarli a mano — ed è proprio la coppia che deve corrispondere
     * alla scheda, quindi meglio passarla che farla ridigitare.
     */
    function openForm(id, prefill) {
        if (!window.App) return;
        const params = Object.assign({ entity: 'valuation' }, prefill || {});
        if (id) params.id = id;
        window.App.navigateTo('entity_edit', params);
    }

    async function confirmDelete() {
        if (!deleteTargetId) return;
        const btn = document.getElementById('omi-delete-confirm');
        btn.disabled = true;
        try {
            const res  = await fetch(`${API}?id=${deleteTargetId}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeDeleteModal();
            showAlert('Quotazione eliminata.', 'success');
            loadOmi();
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
