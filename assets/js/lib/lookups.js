/**
 * lookups.js — one loader for every dropdown in the app.
 *
 * Why this exists
 * ---------------
 * Every controller used to populate its own <select> of proprietari / immobili /
 * agenti / fornitori by hand: a fetch, a .map(), an innerHTML. Twenty copies of
 * the same fifteen lines, each with its own bugs. Two of those bugs were real:
 *
 *   1. `limit=500` does nothing. api_pagination.php's apiGetPagination() clamps
 *      to maxLimit=100 and says nothing about it, so every dropdown in the app
 *      silently stopped at the 100th record. An agency with 140 immobili simply
 *      could not pick the 101st in any form. We page through here instead of
 *      asking for a limit the server will quietly ignore.
 *
 *   2. Every controller re-fetched the same list on every open. Results are
 *      cached per key for the life of the page and invalidated explicitly.
 *
 * Options are normalised to { value, label, meta } so the form layer never has
 * to know which endpoint shaped them.
 */

const cache   = new Map();   // key -> Promise<Option[]>
const PAGE    = 100;         // the server's real ceiling — see apiGetPagination
const MAX_PAGES = 50;        // 5 000 rows; a hard stop so a broken API can't spin

/** Read {items,total} out of whichever envelope the endpoint used. */
function unwrap(json) {
    if (!json || json.success === false) throw new Error(json?.error || 'Errore di caricamento');
    const d = json.data ?? json;
    if (Array.isArray(d)) return { items: d, total: d.length };
    return { items: d.items || [], total: Number(d.total ?? (d.items || []).length) };
}

/**
 * Fetch every page of a list endpoint. Stops as soon as a page comes back short
 * or the reported total is reached, so the common case is a single request.
 */
async function fetchAll(url) {
    const out = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
        const sep  = url.includes('?') ? '&' : '?';
        const res  = await fetch(`${url}${sep}page=${page}&limit=${PAGE}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { items, total } = unwrap(await res.json());
        out.push(...items);
        if (items.length < PAGE || (total && out.length >= total)) break;
    }
    return out;
}

/**
 * Registry of every list the forms can offer. Adding a dropdown to a form is
 * adding a line here, not a fetch in a controller.
 *   url    — list endpoint (no page/limit; this module owns those)
 *   label  — row -> visible text
 *   meta   — row -> anything the form wants to keep (used for filtering)
 */
export const SOURCES = {
    clients: {
        url:   'api/clients.php',
        label: r => r.company_name || [r.name, r.surname].filter(Boolean).join(' ') || `#${r.id}`,
        meta:  r => ({ cf: r.codice_fiscale || '', type: r.client_type || '' }),
    },
    properties: {
        url:   'api/properties.php',
        label: r => [r.reference_code, r.address, r.city].filter(Boolean).join(' — ') || `#${r.id}`,
        meta:  r => ({ status: r.status || '', clientId: r.client_id || null }),
    },
    tenants: {
        url:   'api/tenants.php',
        label: r => [r.name, r.surname].filter(Boolean).join(' ') || `#${r.id}`,
        meta:  r => ({ cf: r.codice_fiscale || '' }),
    },
    contracts: {
        url: 'api/contracts.php',
        // There is no contract_number column — `title` is the human handle, and
        // the list endpoint joins the property address in as property_address.
        label: r => [r.title || `Contratto #${r.id}`, r.property_address].filter(Boolean).join(' — '),
        meta:  r => ({ propertyId: r.property_id || null, type: r.contract_type || '', status: r.status || '' }),
    },
    suppliers: {
        url:   'api/suppliers.php',
        label: r => r.name || `#${r.id}`,
        meta:  r => ({ category: r.category || '' }),
    },
    buildings: {
        url:   'api/buildings.php',
        label: r => [r.name, r.address].filter(Boolean).join(' — ') || `#${r.id}`,
        meta:  r => ({ city: r.city || '' }),
    },
    // Le categorie inventario NON sono una costante: vivono in
    // `inventory_categories` e l'API valida su quella tabella
    // (inventoryCategorySlugs). La chiave e' lo `slug`, non l'id — per questo
    // esiste il mapper `value` qui sotto.
    inventoryCategories: {
        url:   'api/inventory.php?action=categories',
        value: r => String(r.slug),
        label: r => r.name || r.label || r.slug,
        meta:  r => ({ slug: r.slug }),
    },
    agents: {
        // NOT api/admin_users.php — that endpoint is requireRole('super_admin'),
        // so an `admin` or `agent` asking for the agent list got a 403 and a
        // silently empty dropdown. (That is exactly why the required "Agente"
        // select on Provvigioni was blank for everyone but the super admin.)
        // leads.php?action=agents is the app's existing agent list and is
        // readable by any logged-in role; it returns a bare array, which
        // unwrap() handles.
        url:   'api/leads.php?action=agents',
        label: r => r.full_name || r.username || `#${r.id}`,
        meta:  r => ({ role: r.role || '' }),
    },
};

/**
 * Load one source. Returns [{value,label,meta}]. Concurrent callers share the
 * same in-flight promise, so ten fields asking for `properties` cost one fetch.
 */
export function load(sourceKey) {
    const src = SOURCES[sourceKey];
    if (!src) return Promise.reject(new Error(`Sorgente sconosciuta: ${sourceKey}`));

    if (!cache.has(sourceKey)) {
        const p = fetchAll(src.url)
            .then(rows => rows.map(r => ({
                // `value` di default e' l'id, ma non tutte le liste sono
                // indicizzate cosi': le categorie inventario si identificano
                // per slug, ed e' quello che l'API si aspetta indietro.
                value: src.value ? src.value(r) : String(r.id),
                label: src.label(r),
                meta:  src.meta ? src.meta(r) : {},
            })))
            // A failed load must not poison the cache: the next open retries.
            .catch(err => { cache.delete(sourceKey); throw err; });
        cache.set(sourceKey, p);
    }
    return cache.get(sourceKey);
}

/** Drop a cached list — call after creating a record the dropdowns should show. */
export function invalidate(sourceKey) {
    if (sourceKey) cache.delete(sourceKey); else cache.clear();
}

/** Warm several sources at once (fire-and-forget from a view's init). */
export function preload(keys) {
    (keys || []).forEach(k => { try { load(k); } catch (_) { /* registry typo — surfaces at render */ } });
}
