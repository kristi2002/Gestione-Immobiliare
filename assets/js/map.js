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
    const markerById = {};   // property id -> Leaflet marker
    let statusFilter = '';   // '' = all
    let searchTerm = '';

    function init() {
        els.alert = document.getElementById('map-alert');
        els.geocodeBtn = document.getElementById('btn-geocode');
        els.regeocodeBtn = document.getElementById('btn-regeocode');
        els.list = document.getElementById('map-list');
        els.count = document.getElementById('map-count');
        els.search = document.getElementById('map-search');
        els.filters = document.getElementById('map-filters');

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

    // Teardrop pin marker (matches the mockup) coloured by status.
    function pinIcon(color) {
        return L.divIcon({
            className: 'map-pin-icon',
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

    function renderMarkers() {
        markers.forEach(m => map.removeLayer(m));
        markers = [];
        Object.keys(markerById).forEach(k => delete markerById[k]);
        const list = Array.isArray(properties) ? properties : [];

        list.forEach(p => {
            if (p.latitude == null || p.longitude == null) return;
            const lat = parseFloat(p.latitude), lng = parseFloat(p.longitude);
            if (isNaN(lat) || isNaN(lng)) return;

            const color = STATUS_COLORS[p.status] || '#64748b';
            const marker = L.marker([lat, lng], { icon: pinIcon(color) });

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
                        <button class="btn btn--sm btn--primary map-open-btn" data-id="${p.id}">Vedi scheda</button>
                    </div>
                </div>`, { minWidth: 220, className: 'map-popup-wrap' });
            marker.on('popupopen', (e) => {
                const btn = e.popup.getElement().querySelector('.map-open-btn');
                if (btn) btn.addEventListener('click', () => window.App && window.App.navigateTo('property_profile', { propertyId: Number(p.id) }));
            });
            markerById[p.id] = marker;
        });

        applyFilter();

        const missing = list.filter(p => (p.latitude == null || p.longitude == null) && p.status !== 'archived').length;
        if (missing > 0) {
            showAlert(`${missing} immobili senza coordinate. Usa "Geocodifica".`, 'info');
        }
    }

    function matchesFilter(p) {
        if (statusFilter && p.status !== statusFilter) return false;
        if (searchTerm) {
            const hay = `${p.address || ''} ${p.city || ''} ${p.cap || ''}`.toLowerCase();
            if (!hay.includes(searchTerm)) return false;
        }
        return true;
    }

    // Show/hide markers to match the current filter, refit bounds, and re-render the side list.
    function applyFilter() {
        markers.forEach(m => map.removeLayer(m));
        markers = [];
        const bounds = [];
        const list = Array.isArray(properties) ? properties : [];

        list.forEach(p => {
            const marker = markerById[p.id];
            if (!marker || !matchesFilter(p)) return;
            marker.addTo(map);
            markers.push(marker);
            bounds.push(marker.getLatLng());
        });

        if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
        renderList();
    }

    function renderList() {
        if (!els.list) return;
        const list = (Array.isArray(properties) ? properties : []).filter(matchesFilter);
        if (els.count) els.count.textContent = list.length;

        if (!list.length) {
            els.list.innerHTML = '<div class="map-list__empty">Nessun immobile.</div>';
            return;
        }

        els.list.innerHTML = list.map(p => {
            const geo = !(p.latitude == null || p.longitude == null);
            const cover = p.cover_url
                ? `<div class="map-card__img" style="background-image:url('${escapeHtml(mediaUrl(p.cover_url))}')"></div>`
                : `<div class="map-card__img map-card__img--empty"><i data-lucide="home"></i></div>`;
            return `
            <div class="map-card${geo ? '' : ' map-card--nogeo'}" data-id="${p.id}" tabindex="0" role="button">
                ${cover}
                <div class="map-card__body">
                    <div class="map-card__addr">${escapeHtml(p.address)}</div>
                    <div class="map-card__meta"><span class="map-card__price">${priceLabel(p)}</span>
                        <span class="map-card__status"><i class="map-dot map-dot--${escapeHtml(p.status)}"></i>${escapeHtml(STATUS_LABELS[p.status] || p.status)}</span></div>
                </div>
            </div>`;
        }).join('');

        els.list.querySelectorAll('.map-card').forEach(card => {
            card.addEventListener('click', () => {
                const m = markerById[card.dataset.id];
                if (m) { map.setView(m.getLatLng(), Math.max(map.getZoom(), 15)); m.openPopup(); }
            });
        });
        if (window.lucide) window.lucide.createIcons();
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
