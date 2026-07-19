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

    /**
     * Automatic geocoding: watch the address fields and resolve as soon as the
     * user has typed a complete address (via + città + CAP) — no button needed.
     * Debounced; skips duplicate lookups; silent when the address is incomplete.
     *
     * @param {Object} ids    {address, city, cap, province} — input element ids
     * @param {Function} onHit    called with the resolved hit
     * @param {Function} [onState] called with ('searching'|'error'|'idle', message)
     */
    function bindAuto(ids, onHit, onState) {
        const el = k => document.getElementById(ids[k]);
        if (!el('address') || !el('city') || !el('cap')) return;
        let timer = null;
        let lastKey = '';
        let pending = 0;

        const read = () => ({
            address: el('address').value.trim(),
            city: el('city').value.trim(),
            cap: el('cap').value.trim(),
            province: ids.province && el('province') ? el('province').value.trim() : '',
        });

        const run = async () => {
            const p = read();
            if (!p.address || !p.city || !p.cap) return;          // incomplete: stay silent
            const key = [p.address, p.city, p.cap, p.province].join('|').toLowerCase();
            if (key === lastKey) return;                           // nothing changed
            lastKey = key;
            const ticket = ++pending;
            if (onState) onState('searching', 'Ricerca coordinate…');
            try {
                const hit = await resolve(p);
                if (ticket !== pending) return;                    // superseded by newer input
                if (hit) onHit(hit);
                if (onState) onState('idle', '');
            } catch (err) {
                if (ticket !== pending) return;
                if (onState) onState('error', err.message);
            }
        };

        ['address', 'city', 'cap', 'province'].forEach(k => {
            const f = ids[k] && el(k);
            if (!f) return;
            ['input', 'change'].forEach(ev => f.addEventListener(ev, () => {
                clearTimeout(timer);
                timer = setTimeout(run, 900);
            }));
        });
    }

    window.Geocode = {
        resolve,
        bindAuto,
        CONFIDENCE_LABELS,
    };
})();
