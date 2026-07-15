/**
 * Clients (Proprietari) — pure helpers. Stateless: input → output only.
 */

export function formatDateTime(dateStr) {
    return new Date(dateStr).toLocaleString('it-IT', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

export function truncate(str, len) {
    return str.length > len ? str.slice(0, len) + '…' : str;
}

export function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
}

// Initials for an agent's display name/username (e.g. "luca.rossi" -> "LR").
export function agentInitials(name) {
    const parts = String(name || '').split(/[.\s_@-]+/).filter(Boolean);
    const ini = ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
    return ini || (String(name || '')[0] || '?').toUpperCase();
}

export function parseCsv(text) {
    const rows = [];
    const lines = splitCsvLines(text);
    if (!lines.length) return rows;
    const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '') continue;
        const values = parseCsvLine(lines[i]);
        const obj = {};
        headers.forEach((h, idx) => { obj[h] = (values[idx] || '').trim(); });
        rows.push(obj);
    }
    return rows;
}

export function splitCsvLines(text) {
    text = text.replace(/^﻿/, '');
    const lines = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') inQuotes = !inQuotes;
        if ((ch === '\n' || ch === '\r') && !inQuotes) {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            lines.push(cur); cur = '';
        } else { cur += ch; }
    }
    if (cur !== '') lines.push(cur);
    return lines;
}

export function parseCsvLine(line) {
    const out = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
            else inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            out.push(cur); cur = '';
        } else { cur += ch; }
    }
    out.push(cur);
    return out;
}
