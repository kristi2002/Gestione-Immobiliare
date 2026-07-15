/**
 * Leads — genuinely pure helpers (input → output). Stateless.
 */

export function formatBudget(min, max) {
    if (min == null && max == null) return '';
    const f = n => Number(n).toLocaleString('it-IT');
    if (min != null && max != null) return `${f(min)} – ${f(max)} €`;
    if (min != null) return `da ${f(min)} €`;
    return `fino a ${f(max)} €`;
}

export function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}
