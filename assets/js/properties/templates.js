/**
 * Properties — pure HTML-string builders (data → string).
 * Stateless singleton module: no mutable state, no DOM reads.
 */

import { COVER_MEDIA_TYPES, MEDIA_LABELS } from './constants.js';
import { mediaUrl, isImageMedia, isVideoMedia, escapeHtml, truncate } from './helpers.js';

export function renderGalleryItem(m) {
    const url = mediaUrl(m.url);
    const isImage = isImageMedia(m) && m.mime_type !== 'application/pdf';
    const isVideo = isVideoMedia(m);
    const isPdf   = m.mime_type === 'application/pdf';
    const canCover = COVER_MEDIA_TYPES.has(m.media_type) && isImage && !isVideo;

    let preview;
    if (isVideo) {
        preview = `<video src="${escapeHtml(url)}" class="gallery-item__video" muted playsinline preload="metadata"></video><span class="gallery-item__play">▶</span>`;
    } else if (isImage) {
        preview = `<img src="${escapeHtml(url)}" alt="${escapeHtml(m.original_name)}" class="gallery-item__img">`;
    } else if (isPdf) {
        preview = `<div class="gallery-item__doc"><i data-lucide="file-text"></i> PDF</div>`;
    } else {
        preview = `<div class="gallery-item__doc"><i data-lucide="paperclip"></i> File</div>`;
    }

    return `
        <div class="gallery-item${m.is_cover ? ' gallery-item--cover' : ''}" data-id="${m.id}">
            <div class="gallery-item__preview" role="button" tabindex="0" title="Visualizza">
                ${preview}
                ${m.is_cover ? '<span class="gallery-item__cover-badge">Anteprima</span>' : ''}
            </div>
            <div class="gallery-item__meta">
                <span class="gallery-item__type">${MEDIA_LABELS[m.media_type] || m.media_type}</span>
                <span class="gallery-item__name" title="${escapeHtml(m.original_name)}">${escapeHtml(truncate(m.original_name, 22))}</span>
            </div>
            <div class="gallery-item__actions">
                ${canCover && !m.is_cover ? `<button type="button" class="btn btn--xs btn--ghost btn-set-cover" data-id="${m.id}" title="Usa come anteprima card"><i data-lucide="star"></i> Anteprima</button>` : ''}
                ${isVideo || isPdf || (!isImage && !isVideo) ? `<a href="${escapeHtml(url)}" class="btn btn--xs btn--ghost" target="_blank" rel="noopener"${isVideo || isPdf ? ' download' : ''}>${isVideo ? 'Apri' : 'Scarica'}</a>` : ''}
                <button type="button" class="gallery-item__delete btn-delete-media" data-id="${m.id}" title="Elimina">&times;</button>
            </div>
        </div>`;
}
