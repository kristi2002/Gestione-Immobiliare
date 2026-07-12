/**
 * Property create / edit — dedicated page (replaces the old modal).
 * Reads window.App.viewParams.propertyId for edit mode; absent => create mode.
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
    function showError(message) { const el = $('pe-error'); if (el) { el.textContent = message; el.style.display = 'block'; } }
    function clearError() { const el = $('pe-error'); if (el) el.style.display = 'none'; }

    function goBack() {
        if (!window.App) return;
        if (isEdit) window.App.navigateTo('property_profile', { propertyId });
        else window.App.navigateTo('properties');
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
            if (selectedId) $('pe-client').value = selectedId;
        } catch (err) {
            showAlert('Errore caricamento proprietari: ' + err.message, 'error');
        }
    }

    function setVal(id, v) { const el = $(id); if (el) el.value = (v ?? '') === null ? '' : (v ?? ''); }

    function renderPriceHistory(history) {
        const section = $('pe-price-history-section');
        const container = $('pe-price-history');
        if (!history || !history.length) { section.hidden = true; return; }
        section.hidden = false;
        const typeLabels = { affitto: 'Affitto', vendita: 'Vendita' };
        container.innerHTML = history.map(h => {
            const oldP = h.old_price != null ? `€ ${Number(h.old_price).toLocaleString('it-IT')}` : '—';
            const newP = h.new_price != null ? `€ ${Number(h.new_price).toLocaleString('it-IT')}` : '—';
            const date = new Date(h.changed_at).toLocaleString('it-IT', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
            return `<div class="price-history-item">${date}: ${oldP} → <strong>${newP}</strong></div>`;
        }).join('');
    }

    async function loadProperty() {
        const res  = await fetch(`${API}?id=${propertyId}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        const p = json.data;

        await loadClients(p.client_id);
        $('pe-id').value = p.id;
        setVal('pe-status', p.status || 'available');
        setVal('pe-address', p.address);
        setVal('pe-city', p.city);
        setVal('pe-cap', p.cap);
        setVal('pe-province', p.province);
        setVal('pe-reference', p.reference_code);
        setVal('pe-floor', p.floor);
        setVal('pe-total-floors', p.total_floors);
        setVal('pe-exposure', p.exposure);
        setVal('pe-type', p.property_type || 'appartamento');
        setVal('pe-condition', p.condition_state);
        setVal('pe-year-built', p.year_built);
        setVal('pe-sqm', p.sqm);
        setVal('pe-locali', p.locali);
        setVal('pe-rooms', p.rooms);
        setVal('pe-bathrooms', p.bathrooms);
        setVal('pe-balconies', p.balconies);
        setVal('pe-terraces', p.terraces);
        setVal('pe-parking', p.parking_spaces);
        setVal('pe-garden', p.garden);
        setVal('pe-energy', p.energy_class);
        setVal('pe-heating', p.heating);
        setVal('pe-furnished', p.furnished);
        setVal('pe-elevator', p.elevator == null ? '' : String(p.elevator));
        setVal('pe-price', p.price);
        setVal('pe-price-type', p.price_type || 'affitto');
        setVal('pe-condo-fees', p.condo_fees);
        setVal('pe-latitude', p.latitude);
        setVal('pe-longitude', p.longitude);
        if (p.latitude != null && p.longitude != null) setMapPoint(p.latitude, p.longitude);
        setVal('pe-geo-confidence-value', p.geo_confidence);
        setVal('pe-cat-comune', p.cadastral_comune);
        setVal('pe-cat-category', p.cadastral_category);
        setVal('pe-cat-class', p.cadastral_class);
        setVal('pe-cat-foglio', p.cadastral_foglio);
        setVal('pe-cat-particella', p.cadastral_particella);
        setVal('pe-cat-subalterno', p.cadastral_subalterno);
        setVal('pe-cat-zone', p.cadastral_zone);
        setVal('pe-cat-rendita', p.cadastral_rendita);
        setVal('pe-ape-number', p.ape_number);
        setVal('pe-ape-issue', p.ape_issue_date ? String(p.ape_issue_date).substring(0, 10) : '');
        setVal('pe-ape-expiry', p.ape_expiry_date ? String(p.ape_expiry_date).substring(0, 10) : '');
        setVal('pe-ipe', p.ipe_value);
        setVal('pe-description', p.description);
        setVal('pe-features', p.additional_features);
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
            reference_code:      $('pe-reference').value.trim(),
            floor:               $('pe-floor').value.trim(),
            total_floors:        $('pe-total-floors').value,
            exposure:            $('pe-exposure').value.trim(),
            property_type:       $('pe-type').value,
            condition_state:     $('pe-condition').value,
            year_built:          $('pe-year-built').value,
            sqm:                 $('pe-sqm').value,
            locali:              $('pe-locali').value,
            rooms:               $('pe-rooms').value,
            bathrooms:           $('pe-bathrooms').value,
            balconies:           $('pe-balconies').value,
            terraces:            $('pe-terraces').value,
            parking_spaces:      $('pe-parking').value,
            garden:              $('pe-garden').value,
            energy_class:        $('pe-energy').value,
            heating:             $('pe-heating').value,
            furnished:           $('pe-furnished').value,
            elevator:            $('pe-elevator').value,
            price:               $('pe-price').value,
            price_type:          $('pe-price-type').value,
            condo_fees:          $('pe-condo-fees').value,
            latitude:            $('pe-latitude').value,
            longitude:           $('pe-longitude').value,
            geo_confidence:      $('pe-geo-confidence-value').value || null,
            description:         $('pe-description').value.trim(),
            additional_features: $('pe-features').value.trim(),
            internal_notes:      $('pe-notes').value.trim(),
            cadastral_comune:     $('pe-cat-comune').value.trim(),
            cadastral_category:   $('pe-cat-category').value.trim(),
            cadastral_class:      $('pe-cat-class').value.trim(),
            cadastral_foglio:     $('pe-cat-foglio').value.trim(),
            cadastral_particella: $('pe-cat-particella').value.trim(),
            cadastral_subalterno: $('pe-cat-subalterno').value.trim(),
            cadastral_zone:       $('pe-cat-zone').value.trim(),
            cadastral_rendita:    $('pe-cat-rendita').value,
            ape_number:           $('pe-ape-number').value.trim(),
            ape_issue_date:       $('pe-ape-issue').value || null,
            ape_expiry_date:      $('pe-ape-expiry').value || null,
            ipe_value:            $('pe-ipe').value,
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
                if (json.data.title && !$('pe-reference').value) {
                    // suggested title is informational; show it as a hint
                }
                if (hint) {
                    hint.textContent = json.data.title ? ('Titolo suggerito: ' + json.data.title) : 'Descrizione generata.';
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
            if (window.App && newId) window.App.navigateTo('property_profile', { propertyId: Number(newId) });
            else if (window.App) window.App.navigateTo('properties');
        } catch (err) {
            showError(err.message);
            btn.disabled = false; btn.textContent = 'Salva';
        }
    }

    async function geocode() {
        const btn = $('pe-geocode');
        const prop = {
            address: $('pe-address').value.trim(),
            city: $('pe-city').value.trim(),
            cap: $('pe-cap').value.trim(),
            province: $('pe-province').value.trim(),
        };
        btn.disabled = true; btn.textContent = '…';
        try {
            if (typeof Geocode === 'undefined') throw new Error('Modulo geocodifica non caricato.');
            const hit = await Geocode.resolve(prop);
            if (!hit) { showAlert('Indirizzo non trovato. Inserisci Lat/Lng manualmente.', 'error'); return; }
            $('pe-latitude').value = hit.lat;
            $('pe-longitude').value = hit.lng;
            $('pe-geo-confidence-value').value = hit.confidence || '';
            setMapPoint(hit.lat, hit.lng);
            if (hit.suggested_province && !prop.province) {
                $('pe-province').value = hit.suggested_province.replace(/^Provincia di\s+/i, '').slice(0, 10);
            }
            const conf = (Geocode.CONFIDENCE_LABELS && Geocode.CONFIDENCE_LABELS[hit.confidence]) || '';
            showAlert(`${conf} (${hit.source}): ${hit.label}`, hit.confidence === 'exact' ? 'success' : 'info');
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.innerHTML = '<i data-lucide="map-pin"></i> Trova';
        }
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
            } catch (e) { /* fail soft — the "Trova" button still works */ }
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

    async function init() {
        $('pe-back').addEventListener('click', goBack);
        $('pe-cancel').addEventListener('click', goBack);
        $('pe-form').addEventListener('submit', save);
        $('pe-geocode').addEventListener('click', geocode);
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
            $('pe-address').focus();
        }
    }

    init();
})();
