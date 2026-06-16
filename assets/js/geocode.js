/**
 * Italian geocoding — server-side cascade (Google optional + Nominatim + Photon).
 */
(function () {
    'use strict';

    const API = 'api/geocode_resolve.php';

    const CONFIDENCE_LABELS = {
        exact: 'Indirizzo preciso',
        street: 'Via trovata (numero civico approssimato)',
        cap_area: 'Area CAP (posizione approssimativa)',
    };

    async function resolve(property) {
        const address = (property.address || '').trim();
        const city    = (property.city || '').trim();
        const cap     = (property.cap || '').trim();
        const province = (property.province || '').trim();

        if (!address || !city) {
            throw new Error('Indirizzo e Città sono obbligatori.');
        }
        if (!cap) {
            throw new Error('Il CAP è obbligatorio per geocodificare in tutta Italia.');
        }

        const params = new URLSearchParams({ address, city, cap });
        if (province) params.set('province', province);

        const res  = await fetch(`${API}?${params}`);
        const json = await res.json();
        if (!json.success) {
            throw new Error(json.error || 'Errore geocodifica');
        }

        const d = json.data;
        return {
            lat: d.lat,
            lng: d.lng,
            label: d.label || '',
            confidence: d.confidence || 'cap_area',
            source: d.source || 'nominatim',
            suggested_province: d.suggested_province || '',
            note: CONFIDENCE_LABELS[d.confidence] || '',
        };
    }

    window.Geocode = {
        resolve,
        CONFIDENCE_LABELS,
    };
})();
