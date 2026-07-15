/**
 * Scheda Cliente — pure HTML-string builders (data → string, stateless).
 */

import { esc, fmtDate } from './helpers.js';

// Renders uploaded files (from the documents table) as list rows.
export function clientDocFilesHtml(docs) {
    if (!docs.length) return '';
    return docs.map(d => `
        <div class="doc-item">
            <span class="doc-item__icon"><i data-lucide="paperclip"></i></span>
            <div class="doc-item__info">
                <a class="doc-item__name" href="${esc(d.file_path)}" target="_blank">${esc(d.original_name || d.title || 'File')}</a>
                <div class="doc-item__meta">File caricato${d.created_at ? ' · ' + fmtDate(d.created_at) : ''}</div>
            </div>
            <div class="doc-item__actions">
                <button class="btn btn--sm btn--danger btn-cdoc-del" data-id="${d.id}" title="Elimina"><i data-lucide="trash-2"></i></button>
            </div>
        </div>`).join('');
}
