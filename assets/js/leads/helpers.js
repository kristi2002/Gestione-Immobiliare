/**
 * Leads — genuinely pure helpers (input → output). Stateless.
 */

export function formatBudget(min, max) {
    if (min == null && max == null) return '';
    // Fmt.number, non Fmt.money: qui il simbolo sta in coda e una volta sola
    // ("618 – 2.000 €"), che e' l'unico punto dell'app scritto cosi'. Spostarlo
    // in testa sarebbe una scelta di design, non l'aggiunta del separatore.
    const f = n => window.Fmt.number(n);
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
