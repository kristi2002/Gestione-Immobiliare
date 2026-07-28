/**
 * Pianificatore itinerario — ordina le tappe di una giornata e stima i tempi.
 *
 * Gira interamente nel browser. Non esiste un endpoint dedicato, e la scelta è
 * voluta:
 *   - è puro calcolo geometrico, non una scrittura: un utente 'readonly' deve
 *     poter pianificare la giornata, ma api_bootstrap.php blocca POST/PUT/DELETE
 *     per quel ruolo (e chiede il token CSRF);
 *   - in GET le coordinate degli immobili finirebbero nei log di accesso Apache;
 *   - senza round-trip il riordino è istantaneo mentre l'agente spunta le tappe.
 *
 * ATTENZIONE, i tempi sono STIME, non un instradamento reale: la distanza è
 * quella in linea d'aria corretta con un fattore di tortuosità, non un percorso
 * stradale, e non tiene conto del traffico. Serve a ordinare le tappe e a dire
 * "così non ci arrivi", non a promettere un orario. Per tempi reali servirebbe
 * un servizio di routing a pagamento (Google Routes / Mapbox), oggi fuori scope.
 */
(function () {
    'use strict';

    /** Km in linea d'aria × questo ≈ km su strada. Empirico per la viabilità
     *  provinciale italiana; sottostima in montagna, sovrastima in autostrada. */
    const DETOUR_FACTOR = 1.35;

    /** Minuti persi per tappa a prescindere dalla distanza (parcheggio, portone). */
    const PARKING_MINUTES = 5;

    /** Durata di default di una tappa quando l'appuntamento non la specifica. */
    const DEFAULT_STOP_MINUTES = 45;

    /** Oltre questo numero di tappe il 2-opt non vale il tempo di calcolo. */
    const MAX_STOPS = 25;

    /** Google Maps accetta origine + destinazione + 8 waypoint intermedi. */
    const GMAPS_MAX_WAYPOINTS = 8;

    const SPEED_PRESETS = [
        { value: 45, label: 'Strade scorrevoli (45 km/h)' },
        { value: 32, label: 'Traffico normale (32 km/h)' },
        { value: 22, label: 'Traffico intenso / centro storico (22 km/h)' },
    ];
    const DEFAULT_SPEED_KMH = 32;

    // -----------------------------------------------------------------------
    // Geometria
    // -----------------------------------------------------------------------

    function toRad(deg) { return deg * Math.PI / 180; }

    function haversineKm(a, b) {
        const R = 6371;
        const dLat = toRad(b.lat - a.lat);
        const dLng = toRad(b.lng - a.lng);
        const h = Math.sin(dLat / 2) ** 2
            + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    }

    function roadKm(a, b) { return haversineKm(a, b) * DETOUR_FACTOR; }

    function travelMinutes(km, speedKmh) {
        return (km / speedKmh) * 60 + PARKING_MINUTES;
    }

    /** Costo totale (km in linea d'aria) di una sequenza, opzionalmente da un punto di partenza. */
    function pathCost(seq, start, returnToStart) {
        if (!seq.length) return 0;
        let km = 0;
        let prev = start || seq[0];
        for (let i = start ? 0 : 1; i < seq.length; i++) {
            km += haversineKm(prev, seq[i]);
            prev = seq[i];
        }
        if (returnToStart && start) km += haversineKm(prev, start);
        return km;
    }

    /** Nearest-neighbour da un punto fissato. */
    function nearestNeighbour(stops, from) {
        const remaining = stops.slice();
        const out = [];
        let cur = from;
        while (remaining.length) {
            let bestIdx = 0;
            let bestKm = Infinity;
            remaining.forEach((s, i) => {
                const d = haversineKm(cur, s);
                if (d < bestKm) { bestKm = d; bestIdx = i; }
            });
            cur = remaining.splice(bestIdx, 1)[0];
            out.push(cur);
        }
        return out;
    }

    /**
     * Miglioramento 2-opt: inverte i segmenti finché nessuno scambio accorcia il
     * percorso. Toglie gli incroci che il nearest-neighbour si lascia dietro.
     */
    function twoOpt(seq, start, returnToStart) {
        let best = seq.slice();
        let bestKm = pathCost(best, start, returnToStart);
        let improved = true;
        let guard = 0;

        while (improved && guard++ < 50) {
            improved = false;
            for (let i = 0; i < best.length - 1; i++) {
                for (let j = i + 1; j < best.length; j++) {
                    const cand = best.slice(0, i)
                        .concat(best.slice(i, j + 1).reverse(), best.slice(j + 1));
                    const km = pathCost(cand, start, returnToStart);
                    if (km < bestKm - 1e-9) {
                        best = cand;
                        bestKm = km;
                        improved = true;
                    }
                }
            }
        }
        return best;
    }

    /**
     * Ordina per distanza. Senza punto di partenza il nearest-neighbour dipende
     * da quale tappa lo innesca, quindi le proviamo tutte e teniamo la migliore
     * (con ≤25 tappe il costo è irrilevante e il risultato molto più stabile).
     */
    function orderByDistance(stops, start, returnToStart) {
        if (stops.length <= 2) return stops.slice();

        if (start) {
            return twoOpt(nearestNeighbour(stops, start), start, returnToStart);
        }

        let best = null;
        let bestKm = Infinity;
        stops.forEach(seed => {
            const rest = stops.filter(s => s !== seed);
            const seq = [seed].concat(nearestNeighbour(rest, seed));
            const tuned = twoOpt(seq, null, false);
            const km = pathCost(tuned, null, false);
            if (km < bestKm) { bestKm = km; best = tuned; }
        });
        return best;
    }

    // -----------------------------------------------------------------------
    // Pianificazione
    // -----------------------------------------------------------------------

    function stopMinutes(s) {
        const n = Number(s.durationMinutes);
        return Number.isFinite(n) && n > 0 ? n : DEFAULT_STOP_MINUTES;
    }

    /**
     * @param {Array} stops   {id,label,sublabel,lat,lng,time:Date|null,durationMinutes}
     * @param {Object} opts   {start, speedKmh, returnToStart}
     * @returns {{strategy,legs,totalKm,totalTravelMinutes,warnings,skipped}}
     */
    function optimize(stops, opts) {
        const options = opts || {};
        const speed = Number(options.speedKmh) > 0 ? Number(options.speedKmh) : DEFAULT_SPEED_KMH;
        const start = options.start || null;
        const returnToStart = !!options.returnToStart;
        const warnings = [];

        const geo = [];
        const skipped = [];
        (stops || []).forEach(s => {
            const lat = parseFloat(s.lat);
            const lng = parseFloat(s.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) { skipped.push(s); return; }
            geo.push(Object.assign({}, s, { lat, lng }));
        });

        if (skipped.length) {
            const why = Array.from(new Set(skipped.map(s => s.flag || 'senza coordinate'))).join(', ');
            warnings.push(`${skipped.length} tapp${skipped.length === 1 ? 'a esclusa' : 'e escluse'} dal calcolo (${why}).`);
        }
        if (geo.length > MAX_STOPS) {
            warnings.push(`Troppe tappe (${geo.length}): calcolate solo le prime ${MAX_STOPS}.`);
            geo.length = MAX_STOPS;
        }
        if (!geo.length) {
            return { strategy: 'none', legs: [], totalKm: 0, totalTravelMinutes: 0, warnings, skipped };
        }

        // Se almeno due tappe hanno un orario fissato l'ordine NON è una scelta:
        // è già stato promesso al cliente. In quel caso non riordiniamo, ma
        // verifichiamo che la giornata stia in piedi.
        const timed = geo.filter(s => s.time instanceof Date && !isNaN(s.time));
        const strategy = timed.length >= 2 ? 'time' : 'distance';

        const seq = strategy === 'time'
            ? geo.slice().sort((a, b) => {
                const at = a.time instanceof Date && !isNaN(a.time) ? a.time.getTime() : Infinity;
                const bt = b.time instanceof Date && !isNaN(b.time) ? b.time.getTime() : Infinity;
                return at - bt;
            })
            : orderByDistance(geo, start, returnToStart);

        const legs = [];
        let totalKm = 0;
        let totalTravel = 0;
        let prev = start;
        // Orologio della giornata: in modalità 'time' parte dal primo orario
        // fissato, altrimenti resta null e mostriamo solo i tempi relativi.
        let clock = strategy === 'time' && seq[0].time instanceof Date && !isNaN(seq[0].time)
            ? new Date(seq[0].time)
            : null;

        seq.forEach((s, i) => {
            let km = null;
            let mins = null;
            if (prev) {
                km = roadKm(prev, s);
                mins = travelMinutes(km, speed);
                totalKm += km;
                totalTravel += mins;
            }

            const leg = {
                stop: s,
                index: i + 1,
                km,
                travelMinutes: mins,
                scheduled: s.time instanceof Date && !isNaN(s.time) ? s.time : null,
                earliestArrival: null,
                conflictMinutes: 0,
            };

            if (strategy === 'time') {
                if (i === 0) {
                    leg.earliestArrival = clock ? new Date(clock) : null;
                } else if (clock) {
                    // Partenza dalla tappa precedente = suo orario + durata.
                    const departure = new Date(clock.getTime() + stopMinutes(seq[i - 1]) * 60000);
                    const arrival = new Date(departure.getTime() + (mins || 0) * 60000);
                    leg.earliestArrival = arrival;
                    if (leg.scheduled && arrival.getTime() > leg.scheduled.getTime()) {
                        leg.conflictMinutes = Math.round((arrival - leg.scheduled) / 60000);
                    }
                }
                // L'orologio avanza sull'orario promesso quando esiste: uno
                // sforamento non deve propagarsi come se l'agente fosse in orario.
                clock = leg.scheduled || leg.earliestArrival || clock;
            }

            legs.push(leg);
            prev = s;
        });

        if (returnToStart && start && prev) {
            const km = roadKm(prev, start);
            totalKm += km;
            totalTravel += travelMinutes(km, speed);
        }

        const conflicts = legs.filter(l => l.conflictMinutes > 0);
        if (conflicts.length) {
            warnings.push(`${conflicts.length} appuntament${conflicts.length === 1 ? 'o' : 'i'} non raggiungibil${conflicts.length === 1 ? 'e' : 'i'} in tempo con questi orari.`);
        }

        return {
            strategy,
            legs,
            totalKm,
            totalTravelMinutes: totalTravel,
            warnings,
            skipped,
        };
    }

    // -----------------------------------------------------------------------
    // Handoff verso Google Maps
    // -----------------------------------------------------------------------

    /**
     * Costruisce l'URL di navigazione. Passiamo SOLO coordinate: nomi di clienti
     * o indirizzi completi finirebbero in un URL verso un servizio terzo, e non
     * servono a Google per instradare.
     */
    function directionsUrl(legs, start) {
        const points = legs.map(l => `${l.stop.lat.toFixed(6)},${l.stop.lng.toFixed(6)}`);
        if (!points.length) return null;

        const origin = start
            ? `${Number(start.lat).toFixed(6)},${Number(start.lng).toFixed(6)}`
            : points.shift();
        const destination = points.length ? points.pop() : origin;
        const waypoints = points.slice(0, GMAPS_MAX_WAYPOINTS);

        const qs = new URLSearchParams({
            api: '1',
            origin,
            destination,
            travelmode: 'driving',
        });
        if (waypoints.length) qs.set('waypoints', waypoints.join('|'));
        return {
            url: `https://www.google.com/maps/dir/?${qs.toString()}`,
            dropped: Math.max(0, points.length - GMAPS_MAX_WAYPOINTS),
        };
    }

    // -----------------------------------------------------------------------
    // Punto di partenza "Agenzia"
    // -----------------------------------------------------------------------

    const AGENCY_CACHE_KEY = 'gi_agency_coords';

    /** "Via D'Annunzio 49, 62012 Civitanova Marche" → {address, cap, city} */
    function parseAgencyAddress(raw) {
        const parts = String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
        if (parts.length < 2) return null;
        const tail = parts[parts.length - 1];
        const m = tail.match(/^(\d{5})\s+(.+)$/);
        if (!m) return null;
        return { address: parts.slice(0, -1).join(', '), cap: m[1], city: m[2] };
    }

    async function agencyStart() {
        let raw = '';
        try {
            const res = await fetch('api/settings.php?public=1');
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Impostazioni non disponibili');
            raw = json.data.agency_address || '';
        } catch (e) {
            throw new Error('Impossibile leggere l\'indirizzo agenzia.');
        }

        const parsed = parseAgencyAddress(raw);
        if (!parsed) {
            throw new Error('Indirizzo agenzia incompleto o senza CAP. Impostalo in Impostazioni → Agenzia.');
        }

        try {
            const cached = JSON.parse(localStorage.getItem(AGENCY_CACHE_KEY) || 'null');
            if (cached && cached.raw === raw) {
                return { lat: cached.lat, lng: cached.lng, label: raw };
            }
        } catch (e) { /* cache illeggibile — si rigeocodifica */ }

        if (typeof Geocode === 'undefined') throw new Error('Geocoder non disponibile.');
        const hit = await Geocode.resolve(parsed);
        try {
            localStorage.setItem(AGENCY_CACHE_KEY, JSON.stringify({ raw, lat: hit.lat, lng: hit.lng }));
        } catch (e) { /* storage pieno o disabilitato — non è fatale */ }
        return { lat: hit.lat, lng: hit.lng, label: raw };
    }

    function currentPositionStart() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocalizzazione non supportata dal browser.'));
                return;
            }
            navigator.geolocation.getCurrentPosition(
                pos => resolve({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    label: 'Posizione attuale',
                }),
                () => reject(new Error('Posizione non disponibile (permesso negato o HTTPS assente).')),
                { timeout: 8000, maximumAge: 60000 }
            );
        });
    }

    // -----------------------------------------------------------------------
    // UI
    // -----------------------------------------------------------------------

    function esc(str) {
        if (str == null) return '';
        const d = document.createElement('div');
        d.textContent = String(str);
        return d.innerHTML;
    }

    function fmtTime(d) {
        return d instanceof Date && !isNaN(d)
            ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
            : '—';
    }

    function fmtMinutes(m) {
        const t = Math.round(m);
        return t >= 60 ? `${Math.floor(t / 60)}h ${String(t % 60).padStart(2, '0')}m` : `${t} min`;
    }

    let overlay = null;

    function close() {
        if (overlay) { overlay.remove(); overlay = null; }
    }

    /**
     * @param {Object} cfg {title, subtitle, stops}
     */
    function open(cfg) {
        const config = cfg || {};
        const stops = (config.stops || []).slice();
        close();

        overlay = document.createElement('div');
        overlay.className = 'modal-overlay route-modal';
        overlay.innerHTML = `
            <div class="modal modal--lg" role="dialog" aria-labelledby="route-title" aria-modal="true">
                <div class="modal-header">
                    <h3 id="route-title">${esc(config.title || 'Itinerario')}</h3>
                    <button class="modal-close" type="button" data-route-close aria-label="Chiudi">&times;</button>
                </div>
                <div class="modal-body">
                    ${config.subtitle ? `<p class="text-muted route-sub">${esc(config.subtitle)}</p>` : ''}
                    <div class="route-controls">
                        <label class="route-field">
                            <span>Punto di partenza</span>
                            <select id="route-start" class="form-select">
                                <option value="first">Dalla prima tappa</option>
                                <option value="agency">Dall'agenzia</option>
                                <option value="current">Dalla mia posizione</option>
                            </select>
                        </label>
                        <label class="route-field">
                            <span>Andatura stimata</span>
                            <select id="route-speed" class="form-select">
                                ${SPEED_PRESETS.map(p => `<option value="${p.value}"${p.value === DEFAULT_SPEED_KMH ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}
                            </select>
                        </label>
                        <label class="route-check">
                            <input type="checkbox" id="route-return"> Rientro al punto di partenza
                        </label>
                    </div>

                    <div class="route-stops" id="route-stops"></div>
                    <div class="route-result" id="route-result"></div>
                </div>
                <div class="modal-footer">
                    <span class="route-status" id="route-status"></span>
                    <button class="btn btn--ghost" type="button" data-route-close>Chiudi</button>
                    <button class="btn btn--ghost" type="button" id="route-gmaps" disabled>
                        <i data-lucide="navigation"></i> Apri in Google Maps
                    </button>
                    <button class="btn btn--primary" type="button" id="route-calc">Calcola itinerario</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const $ = id => overlay.querySelector('#' + id);
        overlay.querySelectorAll('[data-route-close]').forEach(b => b.addEventListener('click', close));
        overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
        const onKey = e => {
            if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
        };
        document.addEventListener('keydown', onKey);

        const selected = new Set(stops.filter(s => s.lat != null && s.lng != null).map(s => String(s.id)));

        function renderStops() {
            const box = $('route-stops');
            if (!stops.length) {
                box.innerHTML = '<div class="route-empty">Nessuna tappa disponibile.</div>';
                return;
            }
            box.innerHTML = `
                <div class="route-stops__head">
                    <strong>Tappe</strong>
                    <span class="text-muted">${selected.size} selezionat${selected.size === 1 ? 'a' : 'e'} su ${stops.length}</span>
                </div>
                ${stops.map(s => {
                    const geo = s.lat != null && s.lng != null;
                    const id = esc(String(s.id));
                    return `
                    <label class="route-stop${geo ? '' : ' route-stop--nogeo'}">
                        <input type="checkbox" data-stop="${id}" ${selected.has(String(s.id)) ? 'checked' : ''} ${geo ? '' : 'disabled'}>
                        <span class="route-stop__body">
                            <span class="route-stop__label">${esc(s.label)}</span>
                            <span class="route-stop__sub">${esc(s.sublabel || '')}${
                                s.time instanceof Date && !isNaN(s.time) ? ` · ${fmtTime(s.time)}` : ''
                            }</span>
                        </span>
                        ${geo ? '' : `<span class="route-stop__flag" title="Esclusa dal calcolo del percorso">${esc(s.flag || 'no GPS')}</span>`}
                    </label>`;
                }).join('')}`;

            box.querySelectorAll('[data-stop]').forEach(cb => {
                cb.addEventListener('change', () => {
                    if (cb.checked) selected.add(cb.dataset.stop);
                    else selected.delete(cb.dataset.stop);
                    renderStops();
                    $('route-result').innerHTML = '';
                    $('route-gmaps').disabled = true;
                });
            });
        }

        let lastPlan = null;
        let lastStart = null;

        async function resolveStart() {
            const mode = $('route-start').value;
            if (mode === 'agency') return agencyStart();
            if (mode === 'current') return currentPositionStart();
            return null;
        }

        async function calculate() {
            const status = $('route-status');
            const chosen = stops.filter(s => selected.has(String(s.id)));
            if (chosen.length < 2) {
                status.textContent = 'Seleziona almeno due tappe.';
                status.className = 'route-status route-status--warn';
                return;
            }

            $('route-calc').disabled = true;
            status.textContent = 'Calcolo…';
            status.className = 'route-status';

            let start = null;
            try {
                start = await resolveStart();
            } catch (err) {
                status.textContent = err.message;
                status.className = 'route-status route-status--warn';
                $('route-calc').disabled = false;
                return;
            }

            const plan = optimize(chosen, {
                start,
                speedKmh: Number($('route-speed').value),
                returnToStart: $('route-return').checked,
            });

            lastPlan = plan;
            lastStart = start;
            renderResult(plan, start);
            $('route-calc').disabled = false;
            $('route-gmaps').disabled = plan.legs.length < 2;
            status.textContent = '';
        }

        function renderResult(plan, start) {
            const box = $('route-result');
            if (!plan.legs.length) {
                box.innerHTML = '<div class="route-empty">Nessuna tappa con coordinate.</div>';
                return;
            }

            const strategyNote = plan.strategy === 'time'
                ? 'Gli orari sono già fissati con i clienti, quindi l\'ordine resta cronologico: qui sotto controlliamo che la giornata regga.'
                : 'Nessun orario fissato: le tappe sono state riordinate per ridurre i chilometri.';

            box.innerHTML = `
                <div class="route-summary">
                    <div><strong>${plan.totalKm.toFixed(1)} km</strong><span>percorso stimato</span></div>
                    <div><strong>${fmtMinutes(plan.totalTravelMinutes)}</strong><span>in auto</span></div>
                    <div><strong>${plan.legs.length}</strong><span>tappe</span></div>
                </div>
                <p class="route-note">${esc(strategyNote)}</p>
                ${plan.warnings.map(w => `<div class="route-warn">${esc(w)}</div>`).join('')}
                <ol class="route-legs">
                    ${start ? `<li class="route-leg route-leg--start"><span class="route-leg__num"><i data-lucide="flag"></i></span>
                        <span class="route-leg__body"><strong>Partenza</strong><span class="text-muted">${esc(start.label || '')}</span></span></li>` : ''}
                    ${plan.legs.map(l => `
                        <li class="route-leg${l.conflictMinutes > 0 ? ' route-leg--conflict' : ''}">
                            <span class="route-leg__num">${l.index}</span>
                            <span class="route-leg__body">
                                <strong>${esc(l.stop.label)}</strong>
                                <span class="text-muted">${esc(l.stop.sublabel || '')}</span>
                                ${l.km != null ? `<span class="route-leg__travel">${l.km.toFixed(1)} km · ${fmtMinutes(l.travelMinutes)} di viaggio</span>` : ''}
                                ${l.conflictMinutes > 0
                                    ? `<span class="route-leg__conflict">Arrivo stimato ${fmtTime(l.earliestArrival)} — ${l.conflictMinutes} min oltre l'appuntamento delle ${fmtTime(l.scheduled)}.</span>`
                                    : ''}
                            </span>
                            ${l.scheduled ? `<span class="route-leg__time">${fmtTime(l.scheduled)}</span>` : ''}
                        </li>`).join('')}
                </ol>
                <p class="route-disclaimer">Distanze stimate in linea d'aria con correzione stradale (×${DETOUR_FACTOR}) e ${PARKING_MINUTES} min di sosta per tappa. Non tiene conto del traffico reale.</p>`;

            if (window.lucide) window.lucide.createIcons();
        }

        $('route-calc').addEventListener('click', calculate);
        $('route-gmaps').addEventListener('click', () => {
            if (!lastPlan) return;
            const res = directionsUrl(lastPlan.legs, lastStart);
            if (!res) return;
            if (res.dropped > 0) {
                $('route-status').textContent = `Google Maps accetta ${GMAPS_MAX_WAYPOINTS} tappe intermedie: ${res.dropped} esclus${res.dropped === 1 ? 'a' : 'e'}.`;
                $('route-status').className = 'route-status route-status--warn';
            }
            window.open(res.url, '_blank', 'noopener');
        });

        renderStops();
        if (window.lucide) window.lucide.createIcons();
    }

    window.RoutePlanner = { open, close, optimize, directionsUrl, DEFAULT_STOP_MINUTES };
})();
