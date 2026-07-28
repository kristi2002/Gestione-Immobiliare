/**
 * Scheda Cliente — pure helper functions (input → output, stateless).
 */

export function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
}

export function fmtDate(d) { return window.Fmt.date(d); }

export function fmtDateTime(d) { return window.Fmt.dateTime(d); }
