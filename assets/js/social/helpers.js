/**
 * Social Media controller — pure utilities (stateless).
 */

// `new Date(dateStr)` non bastava: i DATETIME di MySQL arrivano con lo spazio e
// su alcuni browser diventano Invalid Date, cioe' un campo riempito con
// "NaN-aN-aNTaN:aN".
export function toDatetimeLocal(dateStr) { return window.Fmt.toInputDateTime(dateStr); }

export function formatDateTime(dateStr) { return window.Fmt.dateTime(dateStr); }

export function truncate(str, len) {
    return str.length > len ? str.slice(0, len) + '…' : str;
}

export function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}
