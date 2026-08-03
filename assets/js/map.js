/**
 * Mappa Immobili — Leaflet + Nominatim geocoding (Phase 11)
 *
 * Tre comportamenti da tenere a mente leggendo questo file:
 *
 * 1) I dati arrivano da `properties.php?view=map`, non dalla lista paginata.
 *    La lista si ferma a 500 righe (tetto di apiGetPagination) e oltre quella
 *    soglia la mappa mostrava un portafoglio incompleto senza dirlo.
 *
 * 2) La mappa NON si riposiziona da sola a ogni filtro. Prima ogni cambio di
 *    chip chiamava fitBounds() e strappava via l'inquadratura dell'agente;
 *    ora l'inquadratura è un gesto esplicito (pulsante "Inquadra").
 *
 * 3) L'elenco laterale può seguire il riquadro visibile ("Solo area visibile").
 *    È il verso giusto: prima era la mappa a inseguire l'elenco.
 */
(function () {
    'use strict';

    const API = 'api/properties.php';
    const STATUS_COLORS = { available: '#16a34a', rented: '#2563eb', sold: '#7c3aed' };
    const STATUS_LABELS = { available: 'Disponibile', rented: 'Affittato', sold: 'Venduto', archived: 'Archiviato' };

    let map = null;
    let cluster = null;         // markerClusterGroup, o layerGroup se il plugin manca
    let properties = [];
    const els = {};
    const markerById = {};      // property id -> Leaflet marker
    let statusFilter = '';      // '' = tutti
    let searchTerm = '';
    let viewportOnly = false;   // elenco limitato al riquadro visibile
    let didInitialFit = false;
    let meta = { total: 0, returned: 0, truncated: false };

    let selectionMode = false;
    const selected = new Set(); // property id (string) -> tappa dell'itinerario

    function init() {
        els.alert = document.getElementById('map-alert');
        els.geocodeBtn = document.getElementById('btn-geocode');
        els.regeocodeBtn = document.getElementById('btn-regeocode');
        els.routeBtn = document.getElementById('btn-route');
        els.list = document.getElementById('map-list');
        els.count = document.getElementById('map-count');
        els.search = document.getElementById('map-search');
        els.filters = document.getElementById('map-filters');
        els.viewportToggle = document.getElementById('map-viewport-only');
        els.fitBtn = document.getElementById('map-fit');
        els.selectionBar = document.getElementById('map-selection');

        if (els.search) {
            let t = null;
            els.search.addEventListener('input', () => {
                clearTimeout(t);
                t = setTimeout(() => { searchTerm = els.search.value.trim().toLowerCase(); applyFilter(); }, 200);
            });
        }
        if (els.filters) {
            els.filters.addEventListener('click', (e) => {
                const chip = e.target.closest('.map-chip');
                if (!chip) return;
                statusFilter = chip.dataset.status || '';
                els.filters.querySelectorAll('.map-chip').forEach(c => c.classList.toggle('active', c === chip));
                applyFilter();
            });
        }

        if (typeof L === 'undefined') {
            els.alert.textContent = 'Leaflet non caricato. Verifica la connessione.';
            els.alert.className = 'alert alert--error';
            els.alert.style.display = 'block';
            return;
        }

        map = L.map('leaflet-map').setView([41.9, 12.5], 6); // Italia
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap', maxZoom: 19,
        }).addTo(map);

        cluster = createClusterLayer().addTo(map);

        // Fix blank tiles when map container was hidden during init
        setTimeout(() => map.invalidateSize(), 100);

        // Keep the map fitted to its container when the window is resized/minimized,
        // so it never overflows the layout. Debounced + auto-detached when the view unmounts.
        const onResize = () => {
            if (!document.getElementById('leaflet-map')) {
                window.removeEventListener('resize', onResize);
                return;
            }
            clearTimeout(onResize._t);
            onResize._t = setTimeout(() => map && map.invalidateSize(), 150);
        };
        window.addEventListener('resize', onResize);

        // L'elenco segue il riquadro solo quando l'agente lo chiede. I marker
        // restano tutti: quelli fuori schermo non si vedono comunque, nasconderli
        // costerebbe solo lavoro inutile a ogni pan.
        map.on('moveend zoomend', () => { if (viewportOnly) renderList(); });

        if (els.viewportToggle) {
            els.viewportToggle.addEventListener('change', () => {
                viewportOnly = els.viewportToggle.checked;
                renderList();
            });
        }
        if (els.fitBtn) els.fitBtn.addEventListener('click', () => fitToFiltered(true));

        els.geocodeBtn.addEventListener('click', () => geocodeBatch(false));
        if (els.regeocodeBtn) {
            els.regeocodeBtn.addEventListener('click', async () => {
                if (await confirmDialog('Vuoi ricalcolare le coordinate di tutti gli immobili? Le posizioni attuali verranno sostituite.', { title: 'Ricalcola coordinate', confirmText: 'Ricalcola', danger: false, icon: 'map-pin' })) {
                    geocodeBatch(true);
                }
            });
        }
        if (els.routeBtn) els.routeBtn.addEventListener('click', toggleSelectionMode);

        loadProperties();
    }

    /**
     * Leaflet.markercluster se disponibile, altrimenti un layerGroup normale.
     * Il plugin arriva da CDN come Leaflet stesso: se la rete lo blocca la mappa
     * deve continuare a funzionare, solo senza raggruppamento.
     */
    function createClusterLayer() {
        if (typeof L.markerClusterGroup !== 'function') return L.layerGroup();
        return L.markerClusterGroup({
            showCoverageOnHover: false,
            maxClusterRadius: 55,
            spiderfyOnMaxZoom: true,
            disableClusteringAtZoom: 17,
            iconCreateFunction: (c) => {
                const n = c.getChildCount();
                const size = n < 10 ? 'sm' : (n < 50 ? 'md' : 'lg');
                // Quante tappe selezionate finiscono dentro questo gruppo. Senza
                // questo conteggio, in modalità itinerario le tappe scelte sono
                // invisibili finché non si zooma abbastanza da sciogliere il
                // cluster: l'agente seleziona alla cieca.
                const sel = c.getAllChildMarkers().filter(m => selected.has(m.propertyId)).length;
                return L.divIcon({
                    html: `<span>${n}${sel ? `<i>${sel}</i>` : ''}</span>`,
                    className: `map-cluster map-cluster--${size}${sel ? ' map-cluster--sel' : ''}`,
                    iconSize: L.point(40, 40),
                });
            },
        });
    }

    async function loadProperties() {
        try {
            const res = await fetch(`${API}?view=map`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Errore API');
            properties = Array.isArray(json.data?.items) ? json.data.items : [];
            meta = {
                total: json.data?.total ?? properties.length,
                returned: json.data?.returned ?? properties.length,
                truncated: !!json.data?.truncated,
            };
            renderMarkers();
        } catch (err) {
            if (!els.alert?.isConnected) return;
            showAlert(err.message, 'error');
        }
    }

    // Teardrop pin marker (matches the mockup) coloured by status.
    function pinIcon(color, isSelected) {
        return L.divIcon({
            className: `map-pin-icon${isSelected ? ' map-pin-icon--selected' : ''}`,
            html: `<svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
                <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 25 15 25s15-14.5 15-25C30 6.7 23.3 0 15 0z" fill="${color}"/>
                <circle cx="15" cy="15" r="6" fill="#fff"/></svg>`,
            iconSize: [30, 40], iconAnchor: [15, 40], popupAnchor: [0, -36],
        });
    }

    function mediaUrl(path) {
        if (!path) return '';
        if (/^https?:\/\//i.test(path) || path.startsWith('/')) return path;
        return '/' + String(path).replace(/^\.\//, '');
    }

    function priceLabel(p) {
        if (p.price == null || p.price === '') return 'Prezzo n.d.';
        const n = Number(p.price);
        const val = isNaN(n) ? p.price : n.toLocaleString('it-IT');
        return `€ ${val}${p.price_type === 'affitto' ? '/mese' : ''}`;
    }

    function hasCoords(p) {
        return !(p.latitude == null || p.longitude == null)
            && !isNaN(parseFloat(p.latitude)) && !isNaN(parseFloat(p.longitude));
    }

    function renderMarkers() {
        cluster.clearLayers();
        Object.keys(markerById).forEach(k => delete markerById[k]);
        const list = Array.isArray(properties) ? properties : [];

        list.forEach(p => {
            if (!hasCoords(p)) return;
            const lat = parseFloat(p.latitude), lng = parseFloat(p.longitude);

            const color = STATUS_COLORS[p.status] || '#64748b';
            const marker = L.marker([lat, lng], { icon: pinIcon(color, selected.has(String(p.id))) });
            marker.propertyId = String(p.id);   // letto da iconCreateFunction del cluster

            const cover = p.cover_url
                ? `<div class="map-popup__img" style="background-image:url('${escapeHtml(mediaUrl(p.cover_url))}')"></div>`
                : '';
            marker.bindPopup(`
                <div class="map-popup">
                    ${cover}
                    <div class="map-popup__body">
                        <strong>${escapeHtml(p.address)}</strong>
                        <div class="map-popup__city">${escapeHtml(p.city)}${p.cap ? ' · ' + escapeHtml(p.cap) : ''}</div>
                        <div class="map-popup__row"><span class="map-popup__price">${priceLabel(p)}</span>
                            <span class="badge badge--${escapeHtml(p.status)}">${escapeHtml(STATUS_LABELS[p.status] || p.status)}</span></div>
                        <div class="map-popup__actions">
                            <button class="btn btn--sm btn--primary map-open-btn" data-id="${p.id}">Vedi scheda</button>
                            <button class="btn btn--sm btn--ghost map-stop-btn" data-id="${p.id}">${selected.has(String(p.id)) ? 'Togli dall\'itinerario' : 'Aggiungi all\'itinerario'}</button>
                        </div>
                    </div>
                </div>`, { minWidth: 220, className: 'map-popup-wrap' });
            marker.on('popupopen', (e) => {
                const root = e.popup.getElement();
                const open = root.querySelector('.map-open-btn');
                if (open) open.addEventListener('click', () => window.App && window.App.navigateTo('property_profile', { propertyId: Number(p.id) }));
                const stop = root.querySelector('.map-stop-btn');
                if (stop) stop.addEventListener('click', () => { toggleStop(String(p.id)); map.closePopup(); });
            });
            markerById[p.id] = marker;
        });

        applyFilter();

        if (!didInitialFit) {
            didInitialFit = true;
            fitToFiltered(false);
        }
        refreshAlert();
    }

    function matchesFilter(p) {
        if (statusFilter && p.status !== statusFilter) return false;
        if (searchTerm) {
            const hay = `${p.address || ''} ${p.city || ''} ${p.cap || ''}`.toLowerCase();
            if (!hay.includes(searchTerm)) return false;
        }
        return true;
    }

    /** L'elenco può restringersi al riquadro visibile; i marker no. */
    function matchesList(p) {
        if (!matchesFilter(p)) return false;
        if (!viewportOnly) return true;
        if (!hasCoords(p)) return false;
        const m = markerById[p.id];
        return !!m && map.getBounds().contains(m.getLatLng());
    }

    /** Ridisegna i marker filtrati. NON tocca l'inquadratura: vedi nota in testa. */
    function applyFilter() {
        cluster.clearLayers();
        const list = Array.isArray(properties) ? properties : [];
        const layers = [];

        list.forEach(p => {
            const marker = markerById[p.id];
            if (!marker || !matchesFilter(p)) return;
            layers.push(marker);
        });

        if (typeof cluster.addLayers === 'function') cluster.addLayers(layers);
        else layers.forEach(m => cluster.addLayer(m));

        renderList();
    }

    /** Inquadra i marker filtrati. Gesto esplicito, non effetto collaterale di un filtro. */
    function fitToFiltered(announce) {
        const bounds = [];
        (properties || []).forEach(p => {
            const m = markerById[p.id];
            if (m && matchesFilter(p)) bounds.push(m.getLatLng());
        });
        if (!bounds.length) {
            if (announce) showAlert('Nessun immobile geolocalizzato con questi filtri.', 'info');
            return;
        }
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }

    function renderList() {
        if (!els.list) return;
        const list = (Array.isArray(properties) ? properties : []).filter(matchesList);
        if (els.count) els.count.textContent = list.length;

        if (!list.length) {
            els.list.innerHTML = viewportOnly
                ? '<div class="map-list__empty">Nessun immobile in quest\'area. Allarga la mappa o disattiva "Solo area visibile".</div>'
                : '<div class="map-list__empty">Nessun immobile.</div>';
            renderSelectionBar();
            return;
        }

        els.list.innerHTML = list.map(p => {
            const geo = hasCoords(p);
            const isSel = selected.has(String(p.id));
            const cover = p.cover_url
                ? `<div class="map-card__img" style="background-image:url('${escapeHtml(mediaUrl(p.cover_url))}')"></div>`
                : `<div class="map-card__img map-card__img--empty"><i data-lucide="home"></i></div>`;
            return `
            <div class="map-card${geo ? '' : ' map-card--nogeo'}${isSel ? ' map-card--selected' : ''}" data-id="${p.id}" tabindex="0" role="button">
                ${selectionMode ? `<input type="checkbox" class="map-card__check" data-check="${p.id}" ${isSel ? 'checked' : ''} ${geo ? '' : 'disabled'} aria-label="Aggiungi all'itinerario">` : ''}
                ${cover}
                <div class="map-card__body">
                    <div class="map-card__addr">${escapeHtml(p.address)}</div>
                    <div class="map-card__meta"><span class="map-card__price">${priceLabel(p)}</span>
                        <span class="map-card__status"><i class="map-dot map-dot--${escapeHtml(p.status)}"></i>${escapeHtml(STATUS_LABELS[p.status] || p.status)}</span></div>
                </div>
            </div>`;
        }).join('');

        els.list.querySelectorAll('.map-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (selectionMode) {
                    if (e.target.closest('.map-card__check')) return; // gestito dal change
                    toggleStop(card.dataset.id);
                    return;
                }
                focusProperty(card.dataset.id);
            });
        });
        els.list.querySelectorAll('[data-check]').forEach(cb => {
            cb.addEventListener('change', () => toggleStop(cb.dataset.check));
        });

        renderSelectionBar();
        if (window.lucide) window.lucide.createIcons();
    }

    /** Centra la mappa su un immobile; con il clustering va prima aperto il gruppo. */
    function focusProperty(id) {
        const m = markerById[id];
        if (!m) return;
        const show = () => { map.setView(m.getLatLng(), Math.max(map.getZoom(), 15)); m.openPopup(); };
        if (typeof cluster.zoomToShowLayer === 'function' && cluster.hasLayer(m)) {
            cluster.zoomToShowLayer(m, show);
        } else {
            show();
        }
    }

    // -----------------------------------------------------------------------
    // Itinerario
    // -----------------------------------------------------------------------

    function toggleSelectionMode() {
        selectionMode = !selectionMode;
        if (!selectionMode) selected.clear();
        els.routeBtn.classList.toggle('btn--primary', selectionMode);
        els.routeBtn.classList.toggle('btn--ghost', !selectionMode);
        refreshSelectedPins();
        renderList();
    }

    function toggleStop(id) {
        const key = String(id);
        const p = (properties || []).find(x => String(x.id) === key);
        if (!p || !hasCoords(p)) return;
        if (selected.has(key)) selected.delete(key);
        else selected.add(key);
        if (!selectionMode) {
            // Aggiunta dal popup: entra in modalità selezione così l'agente vede
            // subito la barra con il conteggio.
            selectionMode = true;
            els.routeBtn.classList.add('btn--primary');
            els.routeBtn.classList.remove('btn--ghost');
        }
        refreshSelectedPins();
        renderList();
    }

    function refreshSelectedPins() {
        (properties || []).forEach(p => {
            const m = markerById[p.id];
            if (!m) return;
            m.setIcon(pinIcon(STATUS_COLORS[p.status] || '#64748b', selected.has(String(p.id))));
        });
        // I marker raggruppati non hanno un'icona propria nel DOM: il conteggio
        // va ridisegnato sulla bolla del cluster.
        if (typeof cluster.refreshClusters === 'function') cluster.refreshClusters();
    }

    function renderSelectionBar() {
        if (!els.selectionBar) return;
        if (!selectionMode) {
            els.selectionBar.hidden = true;
            els.selectionBar.innerHTML = '';
            return;
        }
        els.selectionBar.hidden = false;
        els.selectionBar.innerHTML = `
            <span>${selected.size} tapp${selected.size === 1 ? 'a' : 'e'}</span>
            <button class="btn btn--sm btn--ghost" id="map-sel-clear" ${selected.size ? '' : 'disabled'}>Svuota</button>
            <button class="btn btn--sm btn--primary" id="map-sel-plan" ${selected.size >= 2 ? '' : 'disabled'}>Pianifica</button>`;

        els.selectionBar.querySelector('#map-sel-clear').addEventListener('click', () => {
            selected.clear();
            refreshSelectedPins();
            renderList();
        });
        els.selectionBar.querySelector('#map-sel-plan').addEventListener('click', openPlanner);
    }

    function openPlanner() {
        if (typeof RoutePlanner === 'undefined') {
            showAlert('Pianificatore non disponibile.', 'error');
            return;
        }
        const stops = (properties || [])
            .filter(p => selected.has(String(p.id)))
            .map(p => ({
                id: p.id,
                label: p.address,
                sublabel: `${p.city || ''}${p.cap ? ' · ' + p.cap : ''}`,
                lat: parseFloat(p.latitude),
                lng: parseFloat(p.longitude),
                time: null,                       // selezione libera: nessun orario promesso
                durationMinutes: null,
            }));
        RoutePlanner.open({
            title: 'Itinerario visite',
            subtitle: 'Nessun orario fissato: le tappe vengono riordinate per ridurre i chilometri.',
            stops,
        });
    }

    // -----------------------------------------------------------------------

    async function geocodeBatch(force = false) {
        const list = Array.isArray(properties) ? properties : [];
        const pending = list.filter(p => {
            if (p.status === 'archived') return false;
            if (force) return true;
            return !hasCoords(p);
        });

        if (!pending.length) {
            showAlert(force ? 'Nessun immobile da rigeocodificare.' : 'Tutti gli immobili sono già geolocalizzati.', 'success');
            return;
        }

        if (!force && !pending.every(p => p.city)) {
            showAlert('Verifica che ogni immobile abbia Città e CAP compilati per una geocodifica accurata.', 'info');
        }

        els.geocodeBtn.disabled = true;
        if (els.regeocodeBtn) els.regeocodeBtn.disabled = true;
        let done = 0;
        let matched = 0;
        const failed = [];

        for (const p of pending) {
            els.geocodeBtn.textContent = `Geocodifica… ${done + 1}/${pending.length}`;
            try {
                const hit = await Geocode.resolve(p);
                if (hit) {
                    const lat = hit.lat;
                    const lng = hit.lng;
                    await savePropertyCoords(p, lat, lng, hit.confidence);
                    p.latitude = lat;
                    p.longitude = lng;
                    p.geo_confidence = hit.confidence;
                    matched++;
                } else {
                    failed.push(`${p.address}, ${p.city}`);
                }
            } catch (err) {
                failed.push(`${p.address}, ${p.city} (${err.message})`);
            }
            done++;
            // Respect Nominatim's usage policy (max ~1 request/second) — the batch
            // proxies through the geocode endpoint, so space the calls out.
            if (done < pending.length) await sleep(1000);
        }

        els.geocodeBtn.disabled = false;
        if (els.regeocodeBtn) els.regeocodeBtn.disabled = false;
        els.geocodeBtn.innerHTML = '<i data-lucide="map-pin"></i> Geocodifica';
        if (window.lucide) window.lucide.createIcons();

        let msg = `Geocodifica: ${matched}/${done} immobili posizionati.`;
        if (failed.length) {
            msg += ` Non trovati o ambigui: ${failed.slice(0, 3).join('; ')}${failed.length > 3 ? '…' : ''}. Verifica CAP (es. 41121 Modena) e usa le coordinate manuali se serve.`;
        }
        showAlert(msg, matched === done ? 'success' : 'info');
        renderMarkers();
    }

    async function savePropertyCoords(p, lat, lng, geoConfidence = null) {
        // Coordinates-only update. Send the minimum the API requires to validate
        // (proprietario + indirizzo) plus the coords; every other column is
        // omitted so updateProperty preserves it. Sending the full record here
        // would blank the scheda fields the map list doesn't carry.
        const body = {
            client_id: p.client_id, address: p.address, city: p.city,
            latitude: lat, longitude: lng,
            geo_confidence: geoConfidence || p.geo_confidence || null,
        };
        await fetch(`${API}?id=${p.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
    }

    /** Un solo posto per i messaggi di stato: troncamento + coordinate mancanti. */
    function refreshAlert() {
        const list = Array.isArray(properties) ? properties : [];
        const missing = list.filter(p => !hasCoords(p) && p.status !== 'archived').length;
        const msgs = [];

        if (meta.truncated) {
            msgs.push(`Mappa parziale: mostrati ${meta.returned} immobili su ${meta.total}.`);
        }
        if (missing > 0) {
            msgs.push(`${missing} immobili senza coordinate. Usa "Geocodifica".`);
        }

        if (!msgs.length) {
            els.alert.style.display = 'none';
            return;
        }
        showAlert(msgs.join(' '), meta.truncated ? 'error' : 'info');
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function showAlert(message, type) {
        els.alert.textContent = message;
        els.alert.className = `alert alert--${type}`;
        els.alert.style.display = 'block';
    }
    function escapeHtml(str) {
        if (str == null) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    init();
})();
