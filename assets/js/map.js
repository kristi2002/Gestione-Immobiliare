/**
 * Mappa Immobili — Leaflet + Nominatim geocoding (Phase 11)
 */
(function () {
    'use strict';

    const API = 'api/properties.php';
    const STATUS_COLORS = { available: '#16a34a', rented: '#2563eb', sold: '#7c3aed' };
    const STATUS_LABELS = { available: 'Disponibile', rented: 'Affittato', sold: 'Venduto', archived: 'Archiviato' };

    let map = null;
    let markers = [];
    let properties = [];
    const els = {};

    function init() {
        els.alert = document.getElementById('map-alert');
        els.geocodeBtn = document.getElementById('btn-geocode');
        els.regeocodeBtn = document.getElementById('btn-regeocode');

        if (typeof L === 'undefined') {
            els.alert.textContent = 'Leaflet non caricato. Verifica la connessione.';
            els.alert.className = 'alert alert--error';
            els.alert.style.display = 'block';
            return;
        }

        map = L.map('leaflet-map').setView([41.9, 12.5], 6); // Italy
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap', maxZoom: 19,
        }).addTo(map);

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

        els.geocodeBtn.addEventListener('click', () => geocodeBatch(false));
        if (els.regeocodeBtn) {
            els.regeocodeBtn.addEventListener('click', async () => {
                if (await confirmDialog('Vuoi ricalcolare le coordinate di tutti gli immobili? Le posizioni attuali verranno sostituite.', { title: 'Ricalcola coordinate', confirmText: 'Ricalcola', danger: false, icon: 'map-pin' })) {
                    geocodeBatch(true);
                }
            });
        }
        loadProperties();
    }

    async function nominatimSearch(property) {
        return Geocode.resolve(property);
    }

    async function loadProperties() {
        try {
            properties = await Pagination.fetchList(API, { limit: '500' });
            if (!Array.isArray(properties)) properties = [];
            renderMarkers();
        } catch (err) {
            if (!els.alert?.isConnected) return;
            showAlert(err.message, 'error');
        }
    }

    function renderMarkers() {
        markers.forEach(m => map.removeLayer(m));
        markers = [];
        const bounds = [];
        const list = Array.isArray(properties) ? properties : [];

        list.forEach(p => {
            if (p.latitude == null || p.longitude == null) return;
            const lat = parseFloat(p.latitude), lng = parseFloat(p.longitude);
            if (isNaN(lat) || isNaN(lng)) return;

            const color = STATUS_COLORS[p.status] || '#64748b';
            const marker = L.circleMarker([lat, lng], {
                radius: 9, fillColor: color, color: '#fff', weight: 2, fillOpacity: 0.9,
            }).addTo(map);

            const price = p.price != null ? `€ ${escapeHtml(String(p.price))} (${escapeHtml(p.price_type || '')})` : 'prezzo n.d.';
            const conf  = p.geo_confidence && Geocode.CONFIDENCE_LABELS[p.geo_confidence]
                ? `<br><small class="text-muted">${escapeHtml(Geocode.CONFIDENCE_LABELS[p.geo_confidence])}</small>`
                : (p._geoConfidence && Geocode.CONFIDENCE_LABELS[p._geoConfidence]
                    ? `<br><small class="text-muted">${escapeHtml(Geocode.CONFIDENCE_LABELS[p._geoConfidence])}</small>`
                    : '');
            marker.bindPopup(`
                <div class="map-popup">
                    <strong>${escapeHtml(p.address)}</strong><br>
                    ${escapeHtml(p.city)}${p.cap ? ' · ' + escapeHtml(p.cap) : ''}<br>
                    Proprietario: ${escapeHtml((p.client_surname || '') + ' ' + (p.client_name || ''))}<br>
                    Stato: ${escapeHtml(STATUS_LABELS[p.status] || p.status)}<br>
                    Prezzo: ${price}<br>
                    <small class="text-muted">Lat ${lat.toFixed(5)}, Lng ${lng.toFixed(5)}</small>${conf}<br>
                    <button class="btn btn--sm btn--ghost map-open-btn">Apri</button>
                </div>`);
            marker.on('popupopen', (e) => {
                const btn = e.popup.getElement().querySelector('.map-open-btn');
                if (btn) btn.addEventListener('click', () => window.App.navigateTo('properties'));
            });
            markers.push(marker);
            bounds.push([lat, lng]);
        });

        if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });

        const missing = list.filter(p => (p.latitude == null || p.longitude == null) && p.status !== 'archived').length;
        if (missing > 0) {
            showAlert(`${missing} immobili senza coordinate. Usa "Geocodifica indirizzi".`, 'info');
        }
    }

    async function geocodeBatch(force = false) {
        const list = Array.isArray(properties) ? properties : [];
        const pending = list.filter(p => {
            if (p.status === 'archived') return false;
            if (force) return true;
            return p.latitude == null || p.longitude == null;
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
                const hit = await nominatimSearch(p);
                if (hit) {
                    const lat = hit.lat;
                    const lng = hit.lng;
                    await savePropertyCoords(p, lat, lng, hit.confidence);
                    p.latitude = lat;
                    p.longitude = lng;
                    p.geo_confidence = hit.confidence;
                    p._geoConfidence = hit.confidence;
                    matched++;
                } else {
                    failed.push(`${p.address}, ${p.city}`);
                }
            } catch (err) {
                failed.push(`${p.address}, ${p.city} (${err.message})`);
            }
            done++;
        }

        els.geocodeBtn.disabled = false;
        if (els.regeocodeBtn) els.regeocodeBtn.disabled = false;
        els.geocodeBtn.innerHTML = '<i data-lucide="map-pin"></i> Geocodifica indirizzi';

        let msg = `Geocodifica: ${matched}/${done} immobili posizionati.`;
        if (failed.length) {
            msg += ` Non trovati o ambigui: ${failed.slice(0, 3).join('; ')}${failed.length > 3 ? '…' : ''}. Verifica CAP (es. 41121 Modena) e usa le coordinate manuali se serve.`;
        }
        showAlert(msg, matched === done ? 'success' : 'info');
        renderMarkers();
    }

    async function savePropertyCoords(p, lat, lng, geoConfidence = null) {
        const body = {
            client_id: p.client_id, address: p.address, city: p.city, cap: p.cap || '',
            province: p.province || '',
            sqm: p.sqm ?? '', rooms: p.rooms ?? '', bathrooms: p.bathrooms ?? '',
            floor: p.floor || '', description: p.description || '',
            additional_features: p.additional_features || '', internal_notes: p.internal_notes || '',
            status: p.status, price: p.price ?? '', price_type: p.price_type || 'affitto',
            latitude: lat, longitude: lng,
            geo_confidence: geoConfidence || p.geo_confidence || null,
        };
        await fetch(`${API}?id=${p.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
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
