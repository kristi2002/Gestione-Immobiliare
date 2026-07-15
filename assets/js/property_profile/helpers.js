/**
 * Scheda Immobile — pure helper functions (input → output, stateless).
 * No module state, no page-DOM reads/writes.
 */

export function esc(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function ppFmtDate(d) { return d ? new Date(d).toLocaleDateString('it-IT') : ''; }

export function ppMoney(v) { return v != null && v !== '' ? '€ ' + Number(v).toLocaleString('it-IT') : ''; }

export function pciItNumber(raw) {
    if (!raw) return null;
    // Italian formatting: 1.200,50 → 1200.50
    let s = String(raw).trim().replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
}

export function pciItDate(raw) {
    if (!raw) return null;
    const m = String(raw).match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (!m) return null;
    let [, d, mo, y] = m;
    if (y.length === 2) y = (parseInt(y, 10) > 50 ? '19' : '20') + y;
    d = d.padStart(2, '0'); mo = mo.padStart(2, '0');
    if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
    return `${y}-${mo}-${d}`;
}

export function buildChips(p) {
    const chips = [];
    if (p.sqm) chips.push('📐 ' + p.sqm + ' mq');
    if (p.rooms) chips.push('🛏 ' + p.rooms + ' stanze');
    if (p.bathrooms) chips.push('🚿 ' + p.bathrooms + ' bagni');
    if (p.features) p.features.split(',').map(f => f.trim()).filter(Boolean).forEach(f => chips.push(f));
    return chips;
}
