/**
 * Scheda Immobile — pure HTML/text-string builders (data → string).
 * Stateless singleton module: no mutable state, no page-DOM reads.
 */

import { esc } from './helpers.js';

export function buildGalleryHtml(photos) {
    if (photos.length === 0) {
        return '<div class="pp-gallery-placeholder"><span class="pp-gallery-placeholder__icon"><i data-lucide="image"></i></span><span>Nessuna foto disponibile</span></div>';
    }

    const coverIdx = photos.findIndex(p => p.is_cover == 1 || p.is_cover === true);
    const mainIdx = coverIdx >= 0 ? coverIdx : 0;
    const main = photos[mainIdx];
    const rest = photos.filter((_, i) => i !== mainIdx);

    if (photos.length === 1) {
        return `<div class="pp-gallery-single">
            <div class="pp-gallery-main-wrap" data-lightbox="0">
                <img src="${esc(main.file_path)}" alt="Foto principale" class="pp-gallery-main-img">
                <button class="pp-gallery-btn-all" data-lightbox-all="1"><i data-lucide="search"></i> Visualizza foto</button>
            </div>
        </div>`;
    }

    // show up to 4 thumbnails on right side
    const showCount = Math.min(rest.length, 4);
    const remaining = photos.length - 1 - showCount;

    let thumbsHtml = '';
    rest.slice(0, showCount).forEach((photo, i) => {
        const realIndex = photos.indexOf(photo);
        const isLast = i === showCount - 1;
        const overlay = isLast && remaining > 0
            ? `<div class="pp-gallery-thumb-overlay">+${remaining} foto</div>`
            : '';
        thumbsHtml += `<div class="pp-gallery-thumb" data-lightbox="${realIndex}">${overlay}<img src="${esc(photo.file_path)}" alt="Foto ${i + 2}"></div>`;
    });

    const gridClass = (showCount <= 2 ? 'pp-gallery-thumbs--col' : 'pp-gallery-thumbs--grid') + ' pp-gallery-thumbs--c' + showCount;

    return `<div class="pp-gallery-split">
        <div class="pp-gallery-main-wrap" data-lightbox="0">
            <img src="${esc(main.file_path)}" alt="Foto principale" class="pp-gallery-main-img">
            <button class="pp-gallery-btn-all" data-lightbox-all="1"><i data-lucide="images"></i> Tutte le foto (${photos.length})</button>
        </div>
        <div class="pp-gallery-thumbs ${gridClass}">
            ${thumbsHtml}
        </div>
    </div>`;
}

export function buildSocialCaption(p) {
    const TYPE = { appartamento:'Appartamento', villa:'Villa', ufficio:'Ufficio', negozio:'Negozio', box:'Box/Garage', terreno:'Terreno', altro:'Immobile' };
    const lines = [];
    lines.push(`✨ ${TYPE[p.property_type] || 'Immobile'} in ${p.price_type === 'vendita' ? 'vendita' : 'affitto'}${p.city ? ' — ' + p.city : ''}`);
    lines.push('');
    if (p.address) lines.push(`📍 ${p.address}${p.city ? ', ' + p.city : ''}`);
    const specs = [];
    if (p.sqm) specs.push(`${p.sqm} m²`);
    if (p.locali) specs.push(`${p.locali} locali`);
    if (p.rooms) specs.push(`${p.rooms} camere`);
    if (p.bathrooms) specs.push(`${p.bathrooms} bagni`);
    if (specs.length) lines.push(`🏠 ${specs.join(' · ')}`);
    if (p.energy_class) lines.push(`⚡ Classe energetica ${String(p.energy_class).toUpperCase()}`);
    if (p.price) lines.push(`💶 € ${Number(p.price).toLocaleString('it-IT')}${p.price_type === 'affitto' ? '/mese' : ''}`);
    if (p.description) { lines.push(''); lines.push(p.description); }
    lines.push('');
    lines.push('📞 Contattaci per maggiori informazioni!');
    return lines.join('\n');
}

export function docFilesHtml(docs, reload) {
    if (!docs.length) return '';
    return docs.map(d => `
        <div class="pp-side-item pp-side-item--file">
            <a href="${esc(d.download_url || ('api/download_document.php?id=' + d.id))}" target="_blank" class="pp-side-item__name"><i data-lucide="paperclip"></i> ${esc(d.original_name || 'File')}</a>
            <button class="btn btn--xs btn--danger" data-del-doc="${d.id}" title="Elimina"><i data-lucide="trash-2"></i></button>
        </div>`).join('');
}
