/**
 * Contracts — pure helpers (stateless; input → output)
 */

import { STATUS_FLOW } from './constants.js';

// Time-aware state: a contract past its end date reads as "Scaduto" regardless
// of its stored status (unless it was cancelled). This keeps the badge and the
// filters consistent with the dates entered on the contract.
export function effectiveStatus(c) {
    if (c.status === 'cancelled') return 'cancelled';
    const today = window.Fmt.today();
    if (c.end_date && String(c.end_date).slice(0, 10) < today) return 'expired';
    // No manual status set = "Automatico" -> in force = Attivo.
    if (!c.status) return 'active';
    return c.status;
}

export function nextStatus(status) {
    const idx = STATUS_FLOW.indexOf(status);
    return idx >= 0 && idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx + 1] : null;
}

export function formatPrice(value) {
    const n = Number(value);
    if (!isFinite(n)) return value;
    return window.Fmt.number(n, 2);
}

export function formatDate(dateStr) { return window.Fmt.date(dateStr); }

export function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}
