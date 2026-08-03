/**
 * Social Media controller — pure HTML-string builders (stateless).
 */

import { escapeHtml, truncate, formatDateTime } from './helpers.js';
import { PLATFORM_LABELS, STATUS_LABELS } from './constants.js';

export function renderPostRow(p) {
    const propertyLabel = p.property_id
        ? `${p.property_address}, ${p.property_city}`
        : null;

    const canEdit = p.status !== 'published';
    // Un post gia' pubblicato non si modifica ne' si ripubblica: al posto del
    // menu resta la constatazione.
    const actions = canEdit
        ? window.RowMenu.button(p.id, 'Azioni post')
        : `<span class="text-muted" title="${escapeHtml(p.facebook_post_id || '')}"><i data-lucide="check"></i> Pubblicato</span>`;

    return `
                <tr>
                    <td data-label="Didascalia">
                        <div class="post-caption-cell">
                            ${p.image_path ? '<span class="post-has-image" title="Con immagine"><i data-lucide="image"></i></span>' : ''}
                            <span title="${escapeHtml(p.caption)}">${escapeHtml(truncate(p.caption, 60))}</span>
                        </div>
                        ${p.error_message ? `<small class="text-muted post-error">${escapeHtml(truncate(p.error_message, 50))}</small>` : ''}
                    </td>
                    <td data-label="Piattaforma"><span class="badge badge--platform-${p.platform}">${PLATFORM_LABELS[p.platform]}</span></td>
                    <td data-label="Immobile">${propertyLabel ? escapeHtml(propertyLabel) : '<span class="text-muted">—</span>'}</td>
                    <td data-label="Programmato">${formatDateTime(p.scheduled_at)}</td>
                    <td data-label="Stato"><span class="badge badge--social-${p.status}">${STATUS_LABELS[p.status]}</span></td>
                    <td class="col-actions lt-actions" data-label="Azioni">${actions}</td>
                </tr>`;
}
