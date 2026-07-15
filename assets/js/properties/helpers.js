/**
 * Properties — pure utility helpers (input → output only).
 * Stateless singleton module: no mutable state, no controller/DOM-widget state.
 * (escapeHtml uses document.createElement for HTML-escaping only.)
 */

export function pad2(n) { return String(n).padStart(2, '0'); }

export function nowLocalDatetime() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function truncate(str, len) {
    return str.length > len ? str.slice(0, len) + '…' : str;
}

export function csvCell(val) {
    const s = String(val ?? '');
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
}

export function mediaUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path) || path.startsWith('/')) return path;
    return '/' + String(path).replace(/^\.\//, '');
}

export function isVideoMedia(m) {
    return (m.mime_type && m.mime_type.startsWith('video/')) || m.media_type === 'video';
}

export function isImageMedia(m) {
    return (m.mime_type && m.mime_type.startsWith('image/'))
        || ['photo', 'floor_plan', 'house_map'].includes(m.media_type);
}

export function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

// ── Social post caption builder (pure: derives a string from a property) ──────
export function buildSocialCaption(p) {
    const TYPE = { appartamento:'Appartamento', villa:'Villa', ufficio:'Ufficio', negozio:'Negozio', box:'Box/Garage', terreno:'Terreno', altro:'Immobile' };
    const lines = [];
    const head = `${TYPE[p.property_type] || 'Immobile'} in ${p.price_type === 'vendita' ? 'vendita' : 'affitto'}`;
    lines.push(`✨ ${head}${p.city ? ' — ' + p.city : ''}`);
    lines.push('');
    if (p.address) lines.push(`📍 ${p.address}${p.city ? ', ' + p.city : ''}`);
    const specs = [];
    if (p.sqm) specs.push(`${p.sqm} m²`);
    if (p.locali) specs.push(`${p.locali} locali`);
    if (p.rooms) specs.push(`${p.rooms} camere`);
    if (p.bathrooms) specs.push(`${p.bathrooms} bagni`);
    if (specs.length) lines.push(`🏠 ${specs.join(' · ')}`);
    if (p.price) lines.push(`💶 € ${Number(p.price).toLocaleString('it-IT')}${p.price_type === 'affitto' ? '/mese' : ''}`);
    if (p.description) { lines.push(''); lines.push(p.description); }
    lines.push('');
    lines.push('📞 Contattaci per maggiori informazioni!');
    return lines.join('\n');
}
