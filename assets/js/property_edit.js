/**
 * Property create / edit — dedicated page (replaces the old modal).
 * Reads window.App.viewParams.propertyId for edit mode; absent => create mode.
 *
 * The form mirrors the immobiliare.it insertion sheet ("Descrizione immobile"):
 * same sections, same fields, so listings can be exported 1:1 to the portal
 * feed (api/property_export.php).
 */
(function () {
    'use strict';

    const API         = 'api/properties.php';
    const CLIENTS_API = 'api/clients.php';

    const propertyId = window.App?.viewParams?.propertyId || null;
    const isEdit     = !!propertyId;

    function $(id) { return document.getElementById(id); }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str == null ? '' : str;
        return div.innerHTML;
    }

    function showAlert(message, type) {
        const el = $('pe-alert');
        if (!el) return;
        el.textContent = message;
        el.className = `alert alert--${type}`;
        el.style.display = 'block';
        clearTimeout(el._t);
        el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
    }
    // #pe-error is the last element before the action bar, i.e. ~4000px down the
    // page, while Salva is pinned to the bottom of the viewport. Submitting from
    // any section above the last one painted the failure off-screen and the save
    // looked like a no-op. FormGuard.reportError scrolls it into view.
    function showError(message) { window.FormGuard.reportError($('pe-error'), message); }
    function clearError() { window.FormGuard.clearError($('pe-error')); }

    function goBack() {
        if (!window.App) return;
        if (isEdit) window.App.navigateTo('property_profile', { propertyId });
        else window.App.navigateTo('properties');
    }
    // "Indietro"/"Annulla" ripercorrono il cammino fatto; la scheda (o l'elenco)
    // resta come ripiego quando il form e' la prima pagina aperta.
    function leave() {
        if (!window.App) return;
        // Forty filled-in fields used to disappear on one stray click.
        if (guard && !guard.confirmLeave()) return;
        if (guard) guard.detach();
        if (isEdit) window.App.back('property_profile', { propertyId });
        else window.App.back('properties');
    }

    async function loadClients(selectedId) {
        try {
            let list = [];
            if (window.Pagination?.fetchList) {
                list = await window.Pagination.fetchList(CLIENTS_API, { status: 'active' });
            } else {
                const res = await fetch(`${CLIENTS_API}?status=active&limit=1000`);
                const json = await res.json();
                list = json.data?.items || json.data || [];
            }
            const opts = list.map(c => `<option value="${c.id}">${escapeHtml(c.surname)} ${escapeHtml(c.name)}</option>`).join('');
            $('pe-client').innerHTML = '<option value="">— Seleziona proprietario —</option>' + opts;
            if (selectedId) {
                // The list is status=active only. A proprietario deactivated after
                // the immobile was filed has no <option>, so `.value = id` silently
                // resolved to "" and the next Salva wrote client_id: "" — the
                // immobile lost its owner just because someone opened the form.
                const label = await window.FormGuard.labelFor(
                    CLIENTS_API, selectedId,
                    c => [c.surname, c.name].filter(Boolean).join(' ') || c.company_name || ''
                );
                window.FormGuard.keepSelected($('pe-client'), selectedId, label);
            }
        } catch (err) {
            showAlert('Errore caricamento proprietari: ' + err.message, 'error');
        }
    }

    async function loadAgents(selectedId) {
        try {
            const res  = await fetch(`${CLIENTS_API}?action=agents`);
            const json = await res.json();
            const list = json.data || [];
            $('pe-agent').innerHTML = '<option value="">Scegli</option>' +
                list.map(a => `<option value="${a.id}">${escapeHtml(a.username)}</option>`).join('');
            // Same trap as loadClients: the endpoint returns is_active = 1 only,
            // so a since-deactivated agent would be silently unassigned on save.
            if (selectedId) window.FormGuard.keepSelected($('pe-agent'), selectedId);
            if (selectedId) $('pe-agent').value = selectedId;
        } catch (e) { /* dropdown resta vuoto, campo opzionale */ }
    }

    function setVal(id, v) { const el = $(id); if (el) el.value = (v ?? '') === null ? '' : (v ?? ''); }

    // ── Sì/No a due stati + "non specificato" (terzo stato: nessuno attivo) ──
    function ynInit() {
        document.querySelectorAll('.yn').forEach(box => {
            box.querySelectorAll('.yn__btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const active = btn.classList.contains('is-active');
                    box.querySelectorAll('.yn__btn').forEach(b => b.classList.remove('is-active'));
                    if (!active) btn.classList.add('is-active');
                });
            });
        });
    }
    function ynGet(id) {
        const el = $(id);
        const active = el ? el.querySelector('.yn__btn.is-active') : null;
        return active ? active.dataset.v : '';
    }
    function ynSet(id, v) {
        const el = $(id);
        if (!el) return;
        el.querySelectorAll('.yn__btn').forEach(b => {
            b.classList.toggle('is-active', v != null && v !== '' && String(b.dataset.v) === String(Number(v)));
        });
    }

    // ── Stepper +/- ──────────────────────────────────────────────────────────
    function stepperInit() {
        document.querySelectorAll('.stepper').forEach(box => {
            const input = box.querySelector('input');
            box.querySelectorAll('.stepper__btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const cur = parseInt(input.value, 10);
                    const next = (isNaN(cur) ? 0 : cur) + parseInt(btn.dataset.d, 10);
                    input.value = Math.max(0, next);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                });
            });
        });
    }

    // ── Totale locali = camere + altre stanze (calcolato, stile portale) ─────
    const LOCALI_LABELS = { 1: 'Monolocale', 2: 'Bilocale', 3: 'Trilocale', 4: 'Quadrilocale' };
    function updateLocali() {
        const rooms = parseInt($('pe-rooms').value, 10) || 0;
        const other = parseInt($('pe-other-rooms').value, 10) || 0;
        const tot = rooms + other;
        $('pe-locali').value = tot > 0 ? tot : '';
        $('pe-locali-label').textContent = tot > 0 ? (LOCALI_LABELS[tot] || 'Plurilocale') : '';
    }

    // ── Tipologia a cascata (Gruppo → Tipologia, tassonomia immobiliare.it) ──
    const TYPOLOGY_MAP = {
        appartamento: ['Appartamento', 'Attico', 'Loft', 'Mansarda', 'Open space', 'Appartamento in villa'],
        villa:        ['Villa unifamiliare', 'Villa bifamiliare', 'Villa a schiera', 'Villa plurifamiliare', 'Casale', 'Rustico'],
        ufficio:      ['Ufficio', 'Studio'],
        negozio:      ['Negozio', 'Locale commerciale', 'Capannone', 'Laboratorio', 'Magazzino'],
        box:          ['Box singolo', 'Box doppio', 'Posto auto'],
        terreno:      ['Terreno edificabile', 'Terreno agricolo'],
        altro:        ['Altro'],
    };
    function updateTypologyOptions(keepValue) {
        const group = $('pe-type').value;
        const options = TYPOLOGY_MAP[group] || ['Altro'];
        $('pe-typology').innerHTML = '<option value="">Scegli</option>' +
            options.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
        if (keepValue) $('pe-typology').value = keepValue;
    }

    // ── Superficie a righe (consistenza / % / commerciale, come il portale) ──
    const SURFACE_TYPES = [
        ['abitazione', 'Abitazione'], ['balcone', 'Balcone'], ['terrazzo', 'Terrazzo'],
        ['giardino', 'Giardino'], ['box', 'Box'], ['posto_auto', 'Posto auto'],
        ['cantina', 'Cantina'], ['mansarda', 'Mansarda'], ['taverna', 'Taverna'],
        ['soffitta', 'Soffitta'], ['seminterrato', 'Seminterrato'], ['altro', 'Altro'],
    ];
    // Percentuali di conteggio proposte per consistenza (modificabili riga per riga).
    const SURFACE_DEFAULT_PCT = {
        abitazione: 100, balcone: 30, terrazzo: 30, giardino: 10, box: 50, posto_auto: 20,
        cantina: 25, mansarda: 50, taverna: 40, soffitta: 25, seminterrato: 50, altro: 100,
    };
    const fmt1 = (n) => (Math.round(n * 10) / 10).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

    function addSurfaceRow(data) {
        const wrap = document.createElement('div');
        wrap.className = 'surface-row';
        wrap.innerHTML = `
            <select class="form-select sr-type">${SURFACE_TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
            <input type="text" class="form-input sr-floor" maxlength="40" placeholder="es. piano terra">
            <input type="number" class="form-input sr-sqm" min="0" step="0.1" placeholder="m²">
            <input type="number" class="form-input sr-pct" min="0" max="100" step="0.1">
            <input type="text" class="form-input sr-comm" readonly tabindex="-1">
            <label class="sr-acc-label"><input type="checkbox" class="sr-acc"></label>
            <button type="button" class="btn btn--sm btn--danger sr-del" title="Rimuovi riga"><i data-lucide="trash-2"></i></button>`;
        $('pe-surfaces').appendChild(wrap);

        const type = wrap.querySelector('.sr-type');
        const pct  = wrap.querySelector('.sr-pct');
        if (data) {
            type.value = data.surface_type || 'abitazione';
            wrap.querySelector('.sr-floor').value = data.floor_label || '';
            wrap.querySelector('.sr-sqm').value = data.sqm != null && data.sqm !== '' ? Number(data.sqm) : '';
            pct.value = data.weight_percent != null ? Number(data.weight_percent) : 100;
            wrap.querySelector('.sr-acc').checked = !!Number(data.is_accessory);
        } else {
            pct.value = SURFACE_DEFAULT_PCT[type.value] ?? 100;
        }

        type.addEventListener('change', () => {
            pct.value = SURFACE_DEFAULT_PCT[type.value] ?? 100;
            recalcSurfaces();
        });
        wrap.querySelectorAll('.sr-sqm, .sr-pct, .sr-acc').forEach(el =>
            el.addEventListener('input', recalcSurfaces));
        wrap.querySelector('.sr-del').addEventListener('click', () => { wrap.remove(); recalcSurfaces(); });

        recalcSurfaces();
        if (window.lucide) window.lucide.createIcons();
    }

    function recalcSurfaces() {
        let totMain = 0, totAll = 0;
        document.querySelectorAll('#pe-surfaces .surface-row').forEach(row => {
            const sqm = parseFloat(row.querySelector('.sr-sqm').value) || 0;
            const pct = parseFloat(row.querySelector('.sr-pct').value);
            const commercial = sqm * ((isNaN(pct) ? 100 : pct) / 100);
            row.querySelector('.sr-comm').value = sqm > 0 ? fmt1(commercial) : '';
            if (sqm > 0) {
                totAll += commercial;
                if (!row.querySelector('.sr-acc').checked) totMain += commercial;
            }
        });
        $('pe-surface-total-main').textContent = fmt1(totMain);
        $('pe-surface-total-all').textContent  = fmt1(totAll);
    }

    function collectSurfaces() {
        const rows = [];
        document.querySelectorAll('#pe-surfaces .surface-row').forEach(row => {
            rows.push({
                surface_type:   row.querySelector('.sr-type').value,
                floor_label:    row.querySelector('.sr-floor').value.trim(),
                sqm:            row.querySelector('.sr-sqm').value,
                weight_percent: row.querySelector('.sr-pct').value,
                is_accessory:   row.querySelector('.sr-acc').checked ? 1 : 0,
            });
        });
        return rows;
    }

    function surfaceTotalAll() {
        let tot = 0;
        document.querySelectorAll('#pe-surfaces .surface-row').forEach(row => {
            const sqm = parseFloat(row.querySelector('.sr-sqm').value) || 0;
            const pct = parseFloat(row.querySelector('.sr-pct').value);
            if (sqm > 0) tot += sqm * ((isNaN(pct) ? 100 : pct) / 100);
        });
        return Math.round(tot * 10) / 10;
    }

    // ── Descrizioni multilingua (tab con bandiere, contatore stile portale) ──
    const LANGS = [
        ['it', '🇮🇹 Italiano'], ['en', '🇬🇧 Inglese'], ['de', '🇩🇪 Tedesco'], ['fr', '🇫🇷 Francese'],
        ['es', '🇪🇸 Spagnolo'], ['pt', '🇵🇹 Portoghese'], ['ru', '🇷🇺 Russo'], ['el', '🇬🇷 Greco'],
    ];
    const DESC_MAX = 5000;

    function buildLangPanels() {
        $('pe-lang-tabs').innerHTML = LANGS.map(([code, label], i) =>
            `<button type="button" class="lang-tab${i === 0 ? ' is-active' : ''}" data-lang="${code}">${label}</button>`).join('');

        $('pe-lang-panels').innerHTML = LANGS.map(([code], i) => {
            const isIt = code === 'it';
            const titleId = isIt ? ' id="pe-listing-title"' : '';
            const descId  = isIt ? ' id="pe-description"'   : '';
            const aiBtn = isIt
                ? `<button type="button" class="btn btn--ghost btn--sm" id="pe-ai-describe" title="Genera titolo e descrizione con l'AI dai dati dell'immobile"><i data-lucide="sparkles"></i> Genera con AI</button>`
                : '';
            return `<div class="lang-panel${i === 0 ? ' is-active' : ''}" data-lang="${code}">
                <div class="form-group">
                    <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><span>Titolo</span>${aiBtn}</label>
                    <input type="text" class="form-input lang-title"${titleId} data-lang="${code}" maxlength="255">
                </div>
                <div class="form-group">
                    <textarea class="form-textarea lang-desc"${descId} data-lang="${code}" rows="7" maxlength="${DESC_MAX}"></textarea>
                    <p class="lang-counter text-muted" data-lang="${code}">Caratteri disponibili <strong>${DESC_MAX}</strong> su ${DESC_MAX} &nbsp;·&nbsp; Parole inserite <strong>0</strong></p>
                    ${isIt ? '<p id="pe-ai-hint" class="text-muted" style="font-size:12px;margin-top:4px;display:none"></p>' : ''}
                </div>
            </div>`;
        }).join('');

        $('pe-lang-tabs').querySelectorAll('.lang-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                $('pe-lang-tabs').querySelectorAll('.lang-tab').forEach(t => t.classList.remove('is-active'));
                tab.classList.add('is-active');
                $('pe-lang-panels').querySelectorAll('.lang-panel').forEach(p =>
                    p.classList.toggle('is-active', p.dataset.lang === tab.dataset.lang));
            });
        });

        $('pe-lang-panels').querySelectorAll('.lang-desc').forEach(ta => {
            ta.addEventListener('input', () => updateCounter(ta.dataset.lang));
        });
    }

    function updateCounter(lang) {
        const ta = document.querySelector(`.lang-desc[data-lang="${lang}"]`);
        const counter = document.querySelector(`.lang-counter[data-lang="${lang}"]`);
        if (!ta || !counter) return;
        const text = ta.value;
        const words = (text.trim().match(/\S+/g) || []).length;
        counter.innerHTML = `Caratteri disponibili <strong>${Math.max(0, DESC_MAX - text.length)}</strong> su ${DESC_MAX} &nbsp;·&nbsp; Parole inserite <strong>${words}</strong>`;
    }

    function setLangValue(lang, title, desc) {
        const t = document.querySelector(`.lang-title[data-lang="${lang}"]`);
        const d = document.querySelector(`.lang-desc[data-lang="${lang}"]`);
        if (t) t.value = title ?? '';
        if (d) d.value = desc ?? '';
        updateCounter(lang);
    }

    function collectDescriptions() {
        const out = {};
        LANGS.forEach(([code]) => {
            if (code === 'it') return; // l'italiano è il master su listing_title/description
            const t = document.querySelector(`.lang-title[data-lang="${code}"]`)?.value.trim() || '';
            const d = document.querySelector(`.lang-desc[data-lang="${code}"]`)?.value.trim() || '';
            if (t || d) out[code] = { title: t, description: d };
        });
        return out;
    }

    // ── Checkbox "nessuna spesa" ↔ campo a 0 ─────────────────────────────────
    function bindNoneCheckbox(checkId, inputId) {
        $(checkId).addEventListener('change', () => {
            const checked = $(checkId).checked;
            $(inputId).disabled = checked;
            if (checked) $(inputId).value = '';
        });
    }
    function syncNoneCheckbox(checkId, inputId, value) {
        const isZero = value != null && value !== '' && parseFloat(value) === 0;
        $(checkId).checked = isZero;
        $(inputId).disabled = isZero;
        $(inputId).value = isZero ? '' : (value ?? '');
    }

    // ── Certificazione energetica: classe ↔ esente / in attesa ──────────────
    function bindEnergyChecks() {
        const sync = () => {
            const exempt  = $('pe-energy-exempt').checked;
            const pending = $('pe-energy-pending').checked;
            $('pe-energy').disabled = exempt || pending;
            if (exempt || pending) $('pe-energy').value = '';
        };
        $('pe-energy-exempt').addEventListener('change', () => {
            if ($('pe-energy-exempt').checked) $('pe-energy-pending').checked = false;
            sync();
        });
        $('pe-energy-pending').addEventListener('change', () => {
            if ($('pe-energy-pending').checked) $('pe-energy-exempt').checked = false;
            sync();
        });
    }
    function collectEnergyClass() {
        if ($('pe-energy-exempt').checked) return 'esente';
        if ($('pe-energy-pending').checked) return 'in_attesa';
        return $('pe-energy').value;
    }
    function setEnergyClass(v) {
        $('pe-energy-exempt').checked  = v === 'esente';
        $('pe-energy-pending').checked = v === 'in_attesa';
        const locked = v === 'esente' || v === 'in_attesa';
        $('pe-energy').disabled = locked;
        $('pe-energy').value = locked ? '' : (v || '');
    }

    function updatePriceLabel() {
        $('pe-price-label').textContent = $('pe-price-type').value === 'affitto' ? 'Canone mensile' : 'Prezzo vendita';
    }

    function renderPriceHistory(history) {
        const section = $('pe-price-history-section');
        const container = $('pe-price-history');
        if (!history || !history.length) { section.hidden = true; return; }
        section.hidden = false;
        container.innerHTML = history.map(h => {
            const oldP = h.old_price != null ? `€ ${Number(h.old_price).toLocaleString('it-IT')}` : '—';
            const newP = h.new_price != null ? `€ ${Number(h.new_price).toLocaleString('it-IT')}` : '—';
            const date = window.Fmt.dateTime(h.changed_at);
            return `<div class="price-history-item">${date}: ${oldP} → <strong>${newP}</strong></div>`;
        }).join('');
    }

    async function loadProperty() {
        const res  = await fetch(`${API}?id=${propertyId}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        const p = json.data;

        await loadClients(p.client_id);
        await loadAgents(p.agent_id);
        $('pe-id').value = p.id;
        setVal('pe-status', p.status || 'available');
        setVal('pe-address', p.address);
        setVal('pe-city', p.city);
        setVal('pe-cap', p.cap);
        setVal('pe-province', p.province);
        setVal('pe-latitude', p.latitude);
        setVal('pe-longitude', p.longitude);
        if (p.latitude != null && p.longitude != null) setMapPoint(p.latitude, p.longitude);
        setVal('pe-geo-confidence-value', p.geo_confidence);

        // Tipologia
        setVal('pe-category', p.category || 'residenziale');
        setVal('pe-type', p.property_type || 'appartamento');
        updateTypologyOptions(p.typology || '');

        // Contratto, prezzo e costi
        setVal('pe-price-type', p.price_type || 'vendita');
        updatePriceLabel();
        setVal('pe-ownership', p.ownership_type);
        setVal('pe-price', p.price);
        $('pe-price-request').checked = !!Number(p.price_on_request);
        syncNoneCheckbox('pe-condo-none', 'pe-condo-fees', p.condo_fees);
        syncNoneCheckbox('pe-heating-costs-none', 'pe-heating-costs', p.heating_costs);
        ynSet('pe-libero', p.is_vacant);
        ynSet('pe-riscatto', p.rent_to_own);
        ynSet('pe-reddito', p.investment_property);

        // Superficie
        $('pe-surfaces').innerHTML = '';
        if (Array.isArray(p.surfaces) && p.surfaces.length) {
            p.surfaces.forEach(s => addSurfaceRow(s));
        } else if (p.sqm != null && p.sqm !== '' && parseFloat(p.sqm) > 0) {
            addSurfaceRow({ surface_type: 'abitazione', floor_label: p.floor || '', sqm: p.sqm, weight_percent: 100, is_accessory: 0 });
        } else {
            addSurfaceRow(null);
        }

        // Composizione
        setVal('pe-rooms', p.rooms);
        setVal('pe-other-rooms', p.other_rooms);
        updateLocali();
        if (p.locali != null && p.locali !== '' && !$('pe-locali').value) setVal('pe-locali', p.locali);
        setVal('pe-bathrooms', p.bathrooms);
        setVal('pe-kitchen', p.kitchen_type);
        setVal('pe-furnished', p.furnished);
        setVal('pe-garden', p.garden);
        setVal('pe-garage-type', p.garage_type);
        setVal('pe-parking', p.parking_spaces);
        setVal('pe-balconies', p.balconies);
        setVal('pe-terraces', p.terraces);
        setVal('pe-window-frames', p.window_frames);
        setVal('pe-tv-system', p.tv_system);
        setVal('pe-concierge', p.concierge);
        ynSet('pe-wardrobes', p.wardrobes);
        ynSet('pe-cellar', p.cellar);
        ynSet('pe-attic', p.attic_room);
        ynSet('pe-tavern', p.tavern);
        ynSet('pe-armored-door', p.armored_door);
        ynSet('pe-alarm', p.alarm_system);
        ynSet('pe-electric-gate', p.electric_gate);
        ynSet('pe-video-intercom', p.video_intercom);
        ynSet('pe-fiber', p.optical_fiber);
        ynSet('pe-fireplace', p.fireplace);
        ynSet('pe-jacuzzi', p.jacuzzi);
        ynSet('pe-pool', p.pool);
        ynSet('pe-tennis', p.tennis_court);

        // Caratteristiche
        setVal('pe-year-built', p.year_built);
        setVal('pe-property-class', p.property_class);
        setVal('pe-condition', p.condition_state);
        setVal('pe-floor', p.floor);
        $('pe-multi-level').checked = !!Number(p.multi_level);
        setVal('pe-total-floors', p.total_floors);
        setVal('pe-free-sides', p.free_sides);
        ynSet('pe-elevator', p.elevator);
        ynSet('pe-disabled-access', p.disabled_access);
        setVal('pe-overlooking', p.overlooking);
        setVal('pe-exposure', p.exposure);
        setVal('pe-heating', p.heating);
        setVal('pe-heating-system', p.heating_system);
        setVal('pe-heating-fuel', p.heating_fuel);
        setVal('pe-aircon', p.air_conditioning);
        setVal('pe-aircon-type', p.air_conditioning_type);

        // Certificazione energetica
        setEnergyClass(p.energy_class);
        setVal('pe-ipe', p.ipe_value);
        setVal('pe-ape-number', p.ape_number);
        setVal('pe-ape-issue', p.ape_issue_date ? String(p.ape_issue_date).substring(0, 10) : '');
        setVal('pe-ape-expiry', p.ape_expiry_date ? String(p.ape_expiry_date).substring(0, 10) : '');

        // Dati catastali
        setVal('pe-cat-sezione', p.cadastral_sezione);
        setVal('pe-cat-foglio', p.cadastral_foglio);
        setVal('pe-cat-particella', p.cadastral_particella);
        setVal('pe-cat-subalterno', p.cadastral_subalterno);
        setVal('pe-cat-category', p.cadastral_category);
        setVal('pe-cat-rendita', p.cadastral_rendita);
        setVal('pe-ownership-share', p.ownership_share);
        setVal('pe-cat-class', p.cadastral_class);
        setVal('pe-cat-comune', p.cadastral_comune);
        setVal('pe-cat-zone', p.cadastral_zone);
        setVal('pe-cat-other', p.cadastral_other);

        // Descrizioni portali
        setLangValue('it', p.listing_title, p.description);
        const descs = p.descriptions || {};
        Object.keys(descs).forEach(lang => setLangValue(lang, descs[lang].title, descs[lang].description));

        // Dati intermediazione + note
        setVal('pe-reference', p.reference_code);
        setVal('pe-collaboration', p.collaboration);
        setVal('pe-mandate-type', p.mandate_type);
        setVal('pe-notes', p.internal_notes);

        renderPriceHistory(p.price_history || []);
    }

    function collect() {
        return {
            client_id:           $('pe-client').value,
            address:             $('pe-address').value.trim(),
            city:                $('pe-city').value.trim(),
            cap:                 $('pe-cap').value.trim(),
            province:            $('pe-province').value.trim(),
            status:              $('pe-status').value,
            latitude:            $('pe-latitude').value,
            longitude:           $('pe-longitude').value,
            geo_confidence:      $('pe-geo-confidence-value').value || null,

            // Tipologia
            category:            $('pe-category').value,
            property_type:       $('pe-type').value,
            typology:            $('pe-typology').value,

            // Contratto, prezzo e costi di gestione
            price_type:          $('pe-price-type').value,
            ownership_type:      $('pe-ownership').value,
            price:               $('pe-price').value,
            price_on_request:    $('pe-price-request').checked ? 1 : 0,
            condo_fees:          $('pe-condo-none').checked ? 0 : $('pe-condo-fees').value,
            heating_costs:       $('pe-heating-costs-none').checked ? 0 : $('pe-heating-costs').value,
            is_vacant:           ynGet('pe-libero'),
            rent_to_own:         ynGet('pe-riscatto'),
            investment_property: ynGet('pe-reddito'),

            // Superficie — sqm segue il totale commerciale; l'API lo riallinea
            // comunque dalle righe, questo copre il caso "nessuna riga".
            surfaces:            collectSurfaces(),
            sqm:                 surfaceTotalAll() > 0 ? surfaceTotalAll() : '',

            // Composizione
            rooms:               $('pe-rooms').value,
            other_rooms:         $('pe-other-rooms').value,
            locali:              $('pe-locali').value,
            bathrooms:           $('pe-bathrooms').value,
            kitchen_type:        $('pe-kitchen').value,
            furnished:           $('pe-furnished').value,
            garden:              $('pe-garden').value,
            garage_type:         $('pe-garage-type').value,
            parking_spaces:      $('pe-parking').value,
            balconies:           $('pe-balconies').value,
            terraces:            $('pe-terraces').value,
            window_frames:       $('pe-window-frames').value,
            tv_system:           $('pe-tv-system').value,
            concierge:           $('pe-concierge').value,
            wardrobes:           ynGet('pe-wardrobes'),
            cellar:              ynGet('pe-cellar'),
            attic_room:          ynGet('pe-attic'),
            tavern:              ynGet('pe-tavern'),
            armored_door:        ynGet('pe-armored-door'),
            alarm_system:        ynGet('pe-alarm'),
            electric_gate:       ynGet('pe-electric-gate'),
            video_intercom:      ynGet('pe-video-intercom'),
            optical_fiber:       ynGet('pe-fiber'),
            fireplace:           ynGet('pe-fireplace'),
            jacuzzi:             ynGet('pe-jacuzzi'),
            pool:                ynGet('pe-pool'),
            tennis_court:        ynGet('pe-tennis'),

            // Caratteristiche
            year_built:          $('pe-year-built').value,
            property_class:      $('pe-property-class').value,
            condition_state:     $('pe-condition').value,
            floor:               $('pe-floor').value.trim(),
            multi_level:         $('pe-multi-level').checked ? 1 : 0,
            total_floors:        $('pe-total-floors').value,
            free_sides:          $('pe-free-sides').value,
            elevator:            ynGet('pe-elevator'),
            disabled_access:     ynGet('pe-disabled-access'),
            overlooking:         $('pe-overlooking').value,
            exposure:            $('pe-exposure').value.trim(),
            heating:             $('pe-heating').value,
            heating_system:      $('pe-heating-system').value,
            heating_fuel:        $('pe-heating-fuel').value,
            air_conditioning:    $('pe-aircon').value,
            air_conditioning_type: $('pe-aircon-type').value,

            // Certificazione energetica
            energy_class:        collectEnergyClass(),
            ipe_value:           $('pe-ipe').value,
            ape_number:          $('pe-ape-number').value.trim(),
            ape_issue_date:      $('pe-ape-issue').value || null,
            ape_expiry_date:     $('pe-ape-expiry').value || null,

            // Dati catastali
            cadastral_sezione:    $('pe-cat-sezione').value.trim(),
            cadastral_foglio:     $('pe-cat-foglio').value.trim(),
            cadastral_particella: $('pe-cat-particella').value.trim(),
            cadastral_subalterno: $('pe-cat-subalterno').value.trim(),
            cadastral_category:   $('pe-cat-category').value.trim(),
            cadastral_rendita:    $('pe-cat-rendita').value,
            ownership_share:      $('pe-ownership-share').value.trim(),
            cadastral_class:      $('pe-cat-class').value.trim(),
            cadastral_comune:     $('pe-cat-comune').value.trim(),
            cadastral_zone:       $('pe-cat-zone').value.trim(),
            cadastral_other:      $('pe-cat-other').value.trim(),

            // Descrizione portali (IT = master)
            listing_title:       document.querySelector('.lang-title[data-lang="it"]').value.trim(),
            description:         document.querySelector('.lang-desc[data-lang="it"]').value.trim(),
            descriptions:        collectDescriptions(),

            // Dati intermediazione + note
            reference_code:      $('pe-reference').value.trim(),
            agent_id:            $('pe-agent').value || null,
            collaboration:       $('pe-collaboration').value,
            mandate_type:        $('pe-mandate-type').value,
            internal_notes:      $('pe-notes').value.trim(),
        };
    }

    // ── AI listing description ────────────────────────────────────────────────
    async function aiDescribe() {
        const btn  = $('pe-ai-describe');
        const hint = $('pe-ai-hint');
        if (!btn) return;
        btn.disabled = true;
        const original = btn.innerHTML;
        btn.innerHTML = 'Generazione…';
        if (hint) hint.style.display = 'none';
        try {
            const res = await fetch('api/ai_describe.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ property: collect() }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Generazione non riuscita.');
            if (json.data && json.data.description) {
                $('pe-description').value = json.data.description;
                if (json.data.title && !$('pe-listing-title').value.trim()) {
                    $('pe-listing-title').value = json.data.title;
                }
                updateCounter('it');
                if (hint) {
                    hint.textContent = 'Descrizione generata: rileggi e personalizza prima di salvare.';
                    hint.style.display = 'block';
                }
            }
        } catch (err) {
            if (hint) { hint.textContent = err.message; hint.style.display = 'block'; }
        } finally {
            btn.disabled = false; btn.innerHTML = original;
            if (window.lucide) window.lucide.createIcons();
        }
    }

    async function save(e) {
        e.preventDefault();
        clearError();
        const id  = $('pe-id').value;
        const btn = $('pe-save');
        saving = true;
        btn.disabled = true; btn.textContent = 'Salvataggio...';
        try {
            const res = await fetch(id ? `${API}?id=${id}` : API, {
                method: id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(collect()),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const newId = id || json.data?.id;
            if (guard) { guard.markClean(); guard.detach(); }
            if (window.App && newId) window.App.navigateTo('property_profile', { propertyId: Number(newId) });
            else if (window.App) window.App.navigateTo('properties');
        } catch (err) {
            saving = false;
            showError(err.message);
            btn.disabled = false; btn.textContent = 'Salva';
        }
    }

    // Automatic geocoding: coordinates resolve themselves as the address is
    // typed (Geocode.bindAuto) — no manual "Trova" button.
    function applyGeocodeHit(hit) {
        $('pe-latitude').value = hit.lat;
        $('pe-longitude').value = hit.lng;
        $('pe-geo-confidence-value').value = hit.confidence || '';
        setMapPoint(hit.lat, hit.lng);
        if (hit.suggested_province && !$('pe-province').value.trim()) {
            $('pe-province').value = hit.suggested_province.replace(/^Provincia di\s+/i, '').slice(0, 10);
        }
        const conf = (Geocode.CONFIDENCE_LABELS && Geocode.CONFIDENCE_LABELS[hit.confidence]) || '';
        showAlert(`${conf} (${hit.source}): ${hit.label}`, hit.confidence === 'exact' ? 'success' : 'info');
    }

    function setupAutoGeocode() {
        if (typeof Geocode === 'undefined' || !Geocode.bindAuto) return;
        Geocode.bindAuto(
            { address: 'pe-address', city: 'pe-city', cap: 'pe-cap', province: 'pe-province' },
            applyGeocodeHit,
            (state, msg) => { if (state === 'error') showAlert('Geocodifica: ' + msg, 'info'); }
        );
    }

    async function generateMandato() {
        const cid = $('pe-client').value;
        if (!propertyId || !cid) { showAlert('Salva prima l\'immobile con un proprietario associato.', 'error'); return; }
        try {
            const res = await fetch('api/generate_pdf.php', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'mandato', property_id: Number(propertyId), client_id: Number(cid) }),
            });
            const json = await res.json();
            if (json.success) window.open(json.data.download, '_blank');
            else showAlert(json.error || 'Errore generazione mandato', 'error');
        } catch (err) { showAlert(err.message, 'error'); }
    }

    // ── Live address autocomplete (Google-Maps style) ────────────────────────
    let peMap = null, peMarker = null;

    function setMapPoint(lat, lng) {
        const el = $('pe-map');
        if (!el || typeof L === 'undefined') return;
        lat = parseFloat(lat); lng = parseFloat(lng);
        if (isNaN(lat) || isNaN(lng)) return;
        el.hidden = false;
        if (!peMap) {
            peMap = L.map(el, { scrollWheelZoom: false }).setView([lat, lng], 16);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(peMap);
            peMarker = L.marker([lat, lng], { draggable: true }).addTo(peMap);
            peMarker.on('dragend', () => {
                const p = peMarker.getLatLng();
                setVal('pe-latitude', p.lat.toFixed(7));
                setVal('pe-longitude', p.lng.toFixed(7));
                setVal('pe-geo-confidence-value', 'exact');
            });
        } else {
            peMarker.setLatLng([lat, lng]);
            peMap.setView([lat, lng], 16);
        }
        setTimeout(() => peMap && peMap.invalidateSize(), 60);
    }

    function setupAddressAutocomplete() {
        const input = $('pe-address');
        const box = $('pe-addr-suggestions');
        if (!input || !box) return;
        const esc = (s) => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; };
        let timer = null, items = [], activeIdx = -1, lastQ = '';

        const close = () => { box.hidden = true; box.innerHTML = ''; activeIdx = -1; };

        const render = () => {
            if (!items.length) { close(); return; }
            box.innerHTML = items.map((c, i) =>
                `<button type="button" class="addr-sug${i === activeIdx ? ' is-active' : ''}" data-i="${i}">
                    <span class="addr-sug__line">${esc(c.address)}</span>
                    <span class="addr-sug__meta">${esc(c.city)}${c.cap ? ' · ' + esc(c.cap) : ''}${c.province ? ' (' + esc(c.province) + ')' : ''}</span>
                 </button>`).join('');
            box.hidden = false;
            box.querySelectorAll('.addr-sug').forEach(b => b.addEventListener('mousedown', (e) => {
                e.preventDefault(); // select before the input blurs
                choose(items[parseInt(b.dataset.i, 10)]);
            }));
        };

        const choose = (c) => {
            input.value = c.address;
            setVal('pe-city', c.city);
            setVal('pe-cap', c.cap);
            if (c.province) setVal('pe-province', c.province);
            if (c.lat != null && c.lng != null) {
                setVal('pe-latitude', c.lat);
                setVal('pe-longitude', c.lng);
                setVal('pe-geo-confidence-value', c.confidence || 'exact');
                setMapPoint(c.lat, c.lng);
            } else {
                // No coords on the suggestion: nudge the auto-geocoder
                // (programmatic .value writes don't fire input events).
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            close();
        };

        const search = async (q) => {
            try {
                const res = await fetch('api/geocode_autocomplete.php?q=' + encodeURIComponent(q));
                const json = await res.json();
                if (!json.success) return;
                items = json.data.candidates || [];
                activeIdx = -1;
                render();
            } catch (e) { /* fail soft — auto-geocode still runs on the typed fields */ }
        };

        input.addEventListener('input', () => {
            const q = input.value.trim();
            clearTimeout(timer);
            if (q.length < 4) { close(); return; }
            timer = setTimeout(() => { if (q !== lastQ) { lastQ = q; search(q); } }, 300);
        });
        input.addEventListener('keydown', (e) => {
            if (box.hidden) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, items.length - 1); render(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); render(); }
            else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); choose(items[activeIdx]); }
            else if (e.key === 'Escape') { close(); }
        });
        input.addEventListener('blur', () => setTimeout(close, 150));
    }

    // Watches the form for edits so leaving with a half-filled immobile asks first.
    // Assigned in init(); every exit path goes through leave().
    let guard = null;
    let saving = false;

    async function init() {
        buildLangPanels();
        updateTypologyOptions('');
        ynInit();
        stepperInit();
        bindEnergyChecks();
        bindNoneCheckbox('pe-condo-none', 'pe-condo-fees');
        bindNoneCheckbox('pe-heating-costs-none', 'pe-heating-costs');
        $('pe-type').addEventListener('change', () => updateTypologyOptions(''));
        $('pe-price-type').addEventListener('change', updatePriceLabel);
        $('pe-rooms').addEventListener('input', updateLocali);
        $('pe-other-rooms').addEventListener('input', updateLocali);
        $('pe-surface-add').addEventListener('click', () => addSurfaceRow(null));

        $('pe-back').addEventListener('click', leave);
        $('pe-cancel').addEventListener('click', leave);
        $('pe-form').addEventListener('submit', save);
        // Un campo obbligatorio dentro una sezione chiusa non e' focalizzabile:
        // il browser segnala l'errore puntando a un elemento invisibile.
        $('pe-form').addEventListener('invalid', (e) => {
            window.FormGuard.revealField(e.target);
        }, true);
        guard = window.FormGuard.guardUnsaved($('pe-form'), { isSaving: () => saving });
        setupAutoGeocode();
        $('pe-mandato').addEventListener('click', generateMandato);
        setupAddressAutocomplete();
        const aiBtn = $('pe-ai-describe');
        if (aiBtn) aiBtn.addEventListener('click', aiDescribe);

        if (isEdit) {
            $('pe-title').textContent = 'Modifica Immobile';
            $('pe-mandato').hidden = false;
            try { await loadProperty(); }
            catch (err) { showAlert('Impossibile caricare l\'immobile: ' + err.message, 'error'); }
        } else {
            $('pe-title').textContent = 'Nuovo Immobile';
            await loadClients(window.App?.viewParams?.clientId);
            await loadAgents(null);
            addSurfaceRow(null);
            updatePriceLabel();
            $('pe-address').focus();
        }

        if (window.lucide) window.lucide.createIcons();
    }

    init();
})();
