/**
 * Leads — pure HTML-string builders (data → string). Stateless.
 * Only genuinely pure templates live here; render functions that read
 * module state / bind events stay in index.js. Template whitespace is kept
 * byte-identical to the original inline literals.
 */
import { STATUS_LABELS, INTEREST_LABELS } from './constants.js';
import { escapeHtml, formatBudget } from './helpers.js';

export function kanbanCardHtml(l, status) {
    const initials = ((l.name && l.name[0]) || '') + ((l.surname && l.surname[0]) || '');
    const budget = formatBudget(l.budget_min, l.budget_max);
    const interest = INTEREST_LABELS[l.interest_type] || l.interest_type || '';
    const statusOptions = Object.entries(STATUS_LABELS)
        .map(([k, lab]) => `<option value="${k}"${k === status ? ' selected' : ''}>${lab}</option>`)
        .join('');
    return `
                <div class="kcard" data-id="${l.id}" draggable="true">
                    <div class="kcard__top">
                        <div class="kcard__name">${escapeHtml(l.surname || '')} ${escapeHtml(l.name || '')}</div>
                        <span class="kcard__avatar">${escapeHtml(initials.toUpperCase())}</span>
                    </div>
                    ${interest ? `<div class="kcard__interest"><i data-lucide="tag"></i> ${escapeHtml(interest)}</div>` : ''}
                    ${budget ? `<div class="kcard__budget">${escapeHtml(budget)}</div>` : ''}
                    <div class="kcard__foot">
                        <select class="kcard__status kcard__status--${status}" data-id="${l.id}" title="Sposta in un'altra fase">${statusOptions}</select>
                        ${l.agent_name ? `<span class="kcard__agent">${escapeHtml(l.agent_name)}</span>` : ''}
                    </div>
                </div>`;
}

export function matchItemHtml(p) {
    return `
                <div class="match-item">
                    <div>
                        <strong>${escapeHtml(p.address)}</strong>, ${escapeHtml(p.city)}<br>
                        <small class="text-muted">${p.rooms != null ? p.rooms + ' stanze · ' : ''}${p.sqm != null ? p.sqm + ' mq · ' : ''}${p.price != null ? '€ ' + p.price + ' (' + escapeHtml(p.price_type) + ')' : 'prezzo n.d.'}</small>
                    </div>
                    <button class="btn btn--sm btn--ghost btn-open-prop" data-prop-id="${p.id}">Apri</button>
                </div>`;
}
