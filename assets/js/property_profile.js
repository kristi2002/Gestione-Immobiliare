(function () {
    'use strict';

    const propertyId = window.App?.viewParams?.propertyId;
    let currentProperty = null;
    let allMedia = [];
    let lightboxIndex = 0;

    // ── Bootstrap ────────────────────────────────────────────────────────────

    function init() {
        if (!propertyId) {
            showAlert('ID immobile non specificato. Torna all\'elenco e riprova.', 'error');
            return;
        }
        bindStaticEvents();
        loadProperty();
    }

    // ── Data loading ─────────────────────────────────────────────────────────

    function loadProperty() {
        fetch('api/properties.php?id=' + propertyId)
            .then(r => r.json())
            .then(json => {
                if (!json.success) throw new Error(json.error || 'Errore caricamento');
                currentProperty = json.data;
                renderTitle(currentProperty);
                renderGalleryHero([]);   // show placeholder while media loads
                renderInfoSection(currentProperty);
                renderSummaryCard(currentProperty);
                renderHighlights(currentProperty);
                loadContracts();
                loadInvoices();
                loadSideReminders();
                document.getElementById('property-profile-tabs').hidden = false;
                switchTab('media');
                loadMedia();
                renderPriceHistory(currentProperty.price_history || []);
            })
            .catch(err => showAlert('Impossibile caricare l\'immobile: ' + err.message, 'error'));
    }

    function loadMedia() {
        fetch('api/property_media.php?property_id=' + propertyId)
            .then(r => r.json())
            .then(json => {
                if (!json.success) throw new Error(json.error || 'Errore');
                allMedia = Array.isArray(json.data) ? json.data : (json.data?.items || []);
                renderGalleryHero(allMedia);
                renderGalleryGrid(allMedia);
                document.getElementById('pp-media-count').textContent = allMedia.length + ' file caricati';
            })
            .catch(() => {
                renderGalleryHero([]);
            });
    }

    // ── Title section ─────────────────────────────────────────────────────────

    function renderTitle(p) {
        const sec = document.getElementById('pp-title-section');
        document.getElementById('pp-address-heading').textContent = p.address || 'Immobile senza indirizzo';

        const badge = document.getElementById('pp-status-badge');
        const statusMap = { available: ['Disponibile', 'badge--success'], rented: ['Affittato', 'badge--warning'], sold: ['Venduto', 'badge--error'], archived: ['Archiviato', 'badge--neutral'] };
        const [label, cls] = statusMap[p.status] || ['—', ''];
        badge.textContent = label;
        badge.className = 'badge ' + cls;

        const loc = [p.city, p.province ? '(' + p.province + ')' : ''].filter(Boolean).join(' ');
        document.getElementById('pp-title-meta').textContent = loc;
        sec.hidden = false;
    }

    // ── Booking.com gallery ───────────────────────────────────────────────────

    function renderGalleryHero(media) {
        const photos = media.filter(m => !m.media_type || m.media_type === 'photo' || m.media_type === 'image');
        const container = document.getElementById('pp-gallery');
        container.className = 'pp-gallery';
        container.innerHTML = buildGalleryHtml(photos);
        container.querySelectorAll('[data-lightbox]').forEach(el => {
            el.addEventListener('click', () => openLightbox(parseInt(el.dataset.lightbox, 10)));
        });
        container.querySelector('[data-lightbox-all]')?.addEventListener('click', () => openLightbox(0));
    }

    function buildGalleryHtml(photos) {
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

    // ── Info section (below gallery) ──────────────────────────────────────────

    // Left column: description + features + internal notes.
    function renderInfoSection(p) {
        const sec = document.getElementById('pp-info-section');
        const features = (p.additional_features || p.features || '')
            .split(',').map(f => f.trim()).filter(Boolean);
        const featuresHtml = features.length
            ? `<div class="pp-feature-tags">${features.map(f => `<span class="chip">${esc(f)}</span>`).join('')}</div>` : '';

        const hasBody = p.description || features.length || p.internal_notes || p.notes;
        sec.innerHTML = `
        <div class="pp-info-card">
            <h3 class="pp-section-title">Descrizione</h3>
            ${p.description ? `<p class="pp-info-description">${esc(p.description)}</p>`
                            : `<p class="text-muted" style="margin:0 0 8px;">Nessuna descrizione inserita.</p>`}
            ${featuresHtml ? `<h4 class="pp-section-subtitle">Caratteristiche</h4>${featuresHtml}` : ''}
            ${(p.internal_notes || p.notes) ? `<p class="pp-info-notes"><strong>Note interne:</strong> ${esc(p.internal_notes || p.notes)}</p>` : ''}
        </div>`;
        sec.hidden = false;
    }

    // Right column (sticky): price, status, owner, quick facts, actions.
    function renderSummaryCard(p) {
        const card = document.getElementById('pp-summary-card');
        if (!card) return;
        const TYPE = { appartamento:'Appartamento', villa:'Villa', ufficio:'Ufficio', negozio:'Negozio', box:'Box / Garage', terreno:'Terreno', altro:'Altro' };
        const STATUS = { available:'Disponibile', rented:'Affittato', sold:'Venduto', archived:'Archiviato' };
        const ownerName = p.client_name ? `${p.client_name} ${p.client_surname || ''}`.trim() : (p.owner_name || '—');
        const ownerId = p.client_id || p.owner_id;
        const priceFormatted = p.price ? '€ ' + parseFloat(p.price).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : null;
        const priceTypeLabel = p.price_type === 'affitto' ? ' /mese' : '';

        const facts = [];
        facts.push(['Tipologia', TYPE[p.property_type] || p.property_type || '—']);
        if (p.floor) facts.push(['Piano', p.floor]);
        if (p.cap) facts.push(['CAP', p.cap]);
        if (p.reference_code) facts.push(['Riferimento', p.reference_code]);
        if (p.condo_fees) facts.push(['Spese cond.', '€ ' + Number(p.condo_fees).toLocaleString('it-IT') + '/mese']);

        card.innerHTML = `
            <div class="pp-summary-price">
                ${priceFormatted ? `${priceFormatted}<span class="pp-summary-price__type">${priceTypeLabel || ' ' + (p.price_type === 'vendita' ? 'vendita' : '')}</span>` : '<span class="text-muted" style="font-size:1rem;">Prezzo non indicato</span>'}
            </div>
            <span class="badge badge--${esc(p.status || 'available')} pp-summary-badge">${esc(STATUS[p.status] || p.status || '')}</span>

            <div class="pp-summary-owner">
                <span class="pp-summary-label">Proprietario</span>
                ${ownerId ? `<button class="btn-link pp-summary-owner-btn" data-owner-id="${ownerId}">${esc(ownerName)}</button>` : `<span>${esc(ownerName)}</span>`}
            </div>

            <dl class="pp-summary-facts">
                ${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(String(v))}</dd></div>`).join('')}
            </dl>

            <div class="pp-summary-actions">
                <button class="btn btn--primary" id="btn-pp-edit"><i data-lucide="pencil"></i> Modifica</button>
                <button class="btn btn--ghost" id="btn-pp-pdf"><i data-lucide="file-text"></i> Scheda PDF</button>
                <button class="btn btn--ghost" id="btn-pp-mandato"><i data-lucide="file-pen-line"></i> Mandato agenzia</button>
                <button class="btn btn--ghost" id="btn-pp-qr"><i data-lucide="qr-code"></i> QR Code</button>
                <button class="btn btn--ghost" id="btn-pp-social"><i data-lucide="megaphone"></i> Pubblica post</button>
                ${window.WA ? `<a href="${window.WA.shareLink((p.address || 'Immobile') + (p.city ? ', ' + p.city : '') + (p.price ? ' — € ' + Number(p.price).toLocaleString('it-IT') : '') + '\n' + window.location.origin + '/property/' + propertyId)}" target="_blank" rel="noopener" class="btn btn--whatsapp">${window.WA.icon} Condividi su WhatsApp</a>` : ''}
                <button class="btn btn--danger" id="btn-pp-archive"><i data-lucide="archive"></i> Archivia</button>
            </div>`;

        if (ownerId) {
            card.querySelector('.pp-summary-owner-btn')?.addEventListener('click', () => {
                if (window.App) window.App.navigateTo('client_profile', { clientId: ownerId });
            });
        }
        document.getElementById('btn-pp-edit')?.addEventListener('click', () => {
            if (window.App) window.App.navigateTo('property_edit', { propertyId });
        });
        document.getElementById('btn-pp-pdf')?.addEventListener('click', generatePdf);
        document.getElementById('btn-pp-mandato')?.addEventListener('click', generateMandato);
        document.getElementById('btn-pp-qr')?.addEventListener('click', openQrModal);
        document.getElementById('btn-pp-social')?.addEventListener('click', openSocialPublish);
        document.getElementById('btn-pp-archive')?.addEventListener('click', () => { document.getElementById('pp-archive-modal').hidden = false; });
    }

    // ── Social: confirm + publish now (listing info only — never fatture/contratti) ──
    function buildSocialCaption(p) {
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

    function propertyImages() {
        return (allMedia || []).filter(m => (m.mime_type || '').startsWith('image/') || ['photo', 'image'].includes(m.media_type));
    }

    function openSocialPublish() {
        if (!currentProperty) return;
        const imgs = propertyImages();
        const first = imgs[0] || null;

        document.getElementById('pp-social-caption').textContent = buildSocialCaption(currentProperty);
        const imgEl = document.getElementById('pp-social-image');
        imgEl.innerHTML = first
            ? `<img src="${esc(first.file_path)}" alt="">${imgs.length > 1 ? `<span class="pp-social-count">+${imgs.length - 1}</span>` : ''}`
            : '<div class="pp-social-preview__noimg">Nessuna foto disponibile — il post andrà solo su Facebook.</div>';

        const fotoTxt = imgs.length === 0 ? 'senza foto'
            : imgs.length === 1 ? 'con 1 foto'
            : `con tutte le ${imgs.length} foto`;
        document.getElementById('pp-social-intro').innerHTML =
            `Vuoi pubblicare questo immobile ${fotoTxt} su <strong>Facebook${first ? ' e Instagram' : ''}</strong> adesso?`;

        // Reset to the confirm view each time it opens.
        document.getElementById('pp-social-error').style.display = 'none';
        document.getElementById('pp-social-confirm-view').hidden = false;
        document.getElementById('pp-social-success').hidden = true;
        const pubBtn = document.getElementById('pp-social-publish');
        pubBtn.style.display = '';
        pubBtn.disabled = false;
        pubBtn.innerHTML = '<i data-lucide="megaphone"></i> Pubblica ora';
        document.getElementById('pp-social-cancel').textContent = 'Annulla';
        document.getElementById('pp-social-modal').hidden = false;
    }

    function closeSocialPublish() {
        document.getElementById('pp-social-modal').hidden = true;
    }

    async function confirmSocialPublish() {
        const btn = document.getElementById('pp-social-publish');
        const errEl = document.getElementById('pp-social-error');
        errEl.style.display = 'none';
        const imgs = propertyImages();
        const platform = imgs.length ? 'both' : 'facebook';
        const d = new Date();
        const pad = n => String(n).padStart(2, '0');
        const now = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

        btn.disabled = true; btn.textContent = 'Pubblicazione…';
        try {
            const fd = new FormData();
            fd.append('platform', platform);
            fd.append('property_id', propertyId);
            fd.append('caption', buildSocialCaption(currentProperty));
            fd.append('scheduled_at', now);
            fd.append('status', 'scheduled');
            if (imgs[0]) fd.append('property_media_id', imgs[0].id);

            const res = await fetch('api/social_posts.php', { method: 'POST', body: fd });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Errore creazione post.');

            // Publish now, posting ALL the property's photos (all_media=1).
            if (json.data?.id) {
                const pub = await fetch(`api/social_posts.php?id=${json.data.id}&action=publish&all_media=1`, { method: 'PATCH' });
                const pj = await pub.json();
                if (!pj.success) throw new Error(pj.error || 'Pubblicazione non riuscita.');
                if (pj.data && pj.data.status === 'failed') throw new Error(pj.data.error_message || 'Pubblicazione non riuscita.');
            }

            // Show an explicit success confirmation inside the modal.
            document.getElementById('pp-social-confirm-view').hidden = true;
            document.getElementById('pp-social-success').hidden = false;
            document.getElementById('pp-social-success-text').textContent =
                (imgs.length > 1 ? `Post con ${imgs.length} foto pubblicato` : 'Post pubblicato') +
                (platform === 'both' ? ' su Facebook e Instagram!' : ' su Facebook!');
            btn.style.display = 'none';
            document.getElementById('pp-social-cancel').textContent = 'Chiudi';
            showAlert('Post pubblicato sui social.', 'success');
        } catch (err) {
            errEl.textContent = err.message; errEl.style.display = 'block';
            btn.disabled = false; btn.innerHTML = '<i data-lucide="megaphone"></i> Pubblica ora';
        }
    }

    function generateMandato() {
        if (!currentProperty) return;
        const cid = currentProperty.client_id || currentProperty.owner_id;
        if (!cid) { showAlert('Nessun proprietario associato all\'immobile.', 'error'); return; }
        fetch('api/generate_pdf.php', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'mandato', property_id: propertyId, client_id: cid }),
        })
            .then(r => r.json())
            .then(j => { if (j.success) window.open(j.data.download, '_blank'); else showAlert(j.error || 'Errore generazione mandato', 'error'); })
            .catch(() => showAlert('Errore generazione mandato', 'error'));
    }

    function buildChips(p) {
        const chips = [];
        if (p.sqm) chips.push('📐 ' + p.sqm + ' mq');
        if (p.rooms) chips.push('🛏 ' + p.rooms + ' stanze');
        if (p.bathrooms) chips.push('🚿 ' + p.bathrooms + ' bagni');
        if (p.features) p.features.split(',').map(f => f.trim()).filter(Boolean).forEach(f => chips.push(f));
        return chips;
    }

    // ── Highlights under gallery (#8) ─────────────────────────────────────────
    function renderHighlights(p) {
        const el = document.getElementById('pp-highlights');
        if (!el) return;
        const FURN = { no: 'Non arredato', si: 'Arredato', parziale: 'Parz. arredato' };
        const GARD = { no: 'No', privato: 'Privato', comune: 'Comune' };
        const COND = { nuovo: 'Nuovo', ottimo: 'Ottimo', buono: 'Buono', da_ristrutturare: 'Da ristrutturare' };
        const HEAT = { autonomo: 'Autonomo', centralizzato: 'Centralizzato', assente: 'Assente' };
        const num = v => v !== null && v !== undefined && v !== '' && Number(v) > 0;
        const items = [];
        const add = (cond, icon, value, label) => { if (cond) items.push({ icon, value, label }); };

        add(num(p.sqm), 'ruler', p.sqm + ' m²', 'Superficie');
        add(num(p.locali), 'layout-grid', p.locali, p.locali == 1 ? 'Locale' : 'Locali');
        add(num(p.rooms), 'bed', p.rooms, p.rooms == 1 ? 'Camera' : 'Camere');
        add(num(p.bathrooms), 'bath', p.bathrooms, p.bathrooms == 1 ? 'Bagno' : 'Bagni');
        add(num(p.balconies), 'blinds', p.balconies, p.balconies == 1 ? 'Balcone' : 'Balconi');
        add(num(p.terraces), 'sun', p.terraces, p.terraces == 1 ? 'Terrazzo' : 'Terrazzi');
        add(num(p.parking_spaces), 'car', p.parking_spaces, 'Posti auto');
        add(!!p.floor, 'building', p.floor + (num(p.total_floors) ? '/' + p.total_floors : ''), 'Piano');
        add(p.elevator !== null && p.elevator !== undefined && p.elevator !== '', 'move-vertical', Number(p.elevator) ? 'Sì' : 'No', 'Ascensore');
        add(!!p.energy_class, 'zap', String(p.energy_class || '').toUpperCase(), 'Classe en.');
        add(!!p.heating, 'flame', HEAT[p.heating] || p.heating, 'Riscaldamento');
        add(!!p.furnished, 'sofa', FURN[p.furnished] || p.furnished, 'Arredamento');
        add(!!p.garden && p.garden !== 'no', 'trees', GARD[p.garden] || p.garden, 'Giardino');
        add(num(p.year_built), 'calendar', p.year_built, 'Anno');
        add(!!p.condition_state, 'wrench', COND[p.condition_state] || p.condition_state, 'Stato');
        add(num(p.condo_fees), 'receipt', '€ ' + Number(p.condo_fees).toLocaleString('it-IT'), 'Spese cond.');

        if (!items.length) { el.hidden = true; return; }
        el.innerHTML = items.map(it =>
            `<div class="pp-hl"><span class="pp-hl__icon"><i data-lucide="${it.icon}"></i></span>` +
            `<span class="pp-hl__value">${esc(String(it.value))}</span>` +
            `<span class="pp-hl__label">${esc(it.label)}</span></div>`
        ).join('');
        el.hidden = false;
    }

    // ── Contratti & Fatture side sections (#6, #7, #9) ────────────────────────
    function ppFmtDate(d) { return d ? new Date(d).toLocaleDateString('it-IT') : ''; }
    function ppMoney(v) { return v != null && v !== '' ? '€ ' + Number(v).toLocaleString('it-IT') : ''; }

    function docFilesHtml(docs, reload) {
        if (!docs.length) return '';
        return docs.map(d => `
            <div class="pp-side-item pp-side-item--file">
                <a href="${esc(d.download_url || ('api/download_document.php?id=' + d.id))}" target="_blank" class="pp-side-item__name"><i data-lucide="paperclip"></i> ${esc(d.original_name || 'File')}</a>
                <button class="btn btn--xs btn--danger" data-del-doc="${d.id}" title="Elimina"><i data-lucide="trash-2"></i></button>
            </div>`).join('');
    }

    function bindDocDeletes(container, reload) {
        container.querySelectorAll('[data-del-doc]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!confirm('Eliminare questo file?')) return;
                fetch('api/documents.php?id=' + btn.dataset.delDoc, { method: 'DELETE' })
                    .then(r => r.json())
                    .then(j => { if (!j.success) throw new Error(); reload(); })
                    .catch(() => showAlert('Impossibile eliminare il file.', 'error'));
            });
        });
    }

    function loadContracts() {
        const list = document.getElementById('pp-contracts-list');
        if (!list) return;
        const TYPE = { locazione: 'Locazione', compravendita: 'Compravendita', preliminare: 'Preliminare', mandato: 'Mandato', altro: 'Altro' };
        Promise.all([
            fetch('api/contracts.php?property_id=' + propertyId + '&limit=100').then(r => r.json()).catch(() => ({})),
            fetch('api/documents.php?property_id=' + propertyId + '&doc_type=contract&limit=100').then(r => r.json()).catch(() => ({})),
        ]).then(([cRes, dRes]) => {
            const contracts = cRes.data?.items || cRes.data || [];
            const docs = dRes.data?.items || dRes.data || [];
            const today = new Date().toISOString().slice(0, 10);
            // Files attached to a contract record (contract_id set) are shown on that
            // record, not as standalone file cards — avoids duplicate entries.
            const linked = {};
            docs.forEach(d => { if (d.contract_id) linked[d.contract_id] = d; });
            const dotFor = (c) => {
                if (c.status === 'cancelled') return { cls: 'expired', label: 'Annullato' };
                if (c.status === 'expired' || (c.end_date && c.end_date < today)) return { cls: 'expired', label: 'Scaduto' };
                if (c.status === 'signed' || !c.status) return { cls: 'active', label: 'Attivo' }; // signed or Automatico
                return { cls: 'pending', label: 'In corso' };
            };
            let html = contracts.map(c => {
                const d = dotFor(c);
                const att = linked[c.id];
                return `
                <div class="pp-side-item">
                    <span class="status-dot status-dot--${d.cls}" title="${esc(d.label)}"></span>
                    <div class="pp-side-item__main">
                        <strong>${esc(c.title || TYPE[c.contract_type] || 'Contratto')}</strong>
                        <span class="text-muted">${esc(TYPE[c.contract_type] || c.contract_type || '')}${c.monthly_rent ? ' · ' + ppMoney(c.monthly_rent) + (c.contract_type === 'locazione' ? '/mese' : '') : ''}</span>
                        <span class="text-muted">${ppFmtDate(c.start_date)}${c.end_date ? ' → ' + ppFmtDate(c.end_date) : ''}</span>
                        ${att ? `<a href="${esc(att.download_url || ('api/download_document.php?id=' + att.id))}" target="_blank" class="pp-side-attach"><i data-lucide="paperclip"></i> File allegato</a>` : ''}
                    </div>
                    <span class="pp-side-status pp-side-status--${d.cls}">${esc(d.label)}</span>
                    <button class="pp-side-del" data-del-contract="${c.id}" data-del-file="${att ? att.id : ''}" title="Elimina contratto" aria-label="Elimina contratto"><i data-lucide="trash-2"></i></button>
                </div>`;
            }).join('');
            const looseDocs = docs.filter(d => !d.contract_id);
            html += docFilesHtml(looseDocs, loadContracts);
            if (!html) html = '<p class="text-muted" style="font-size:13px;margin:0;">Nessun contratto. Usa il pulsante di caricamento per aggiungerne uno.</p>';
            list.innerHTML = html;
            bindDocDeletes(list, loadContracts);
            list.querySelectorAll('[data-del-contract]').forEach(btn => {
                btn.addEventListener('click', () => deleteContractRecord(btn.dataset.delContract, btn.dataset.delFile || null));
            });
            window.lucide?.createIcons();
        }).catch(() => { list.innerHTML = '<p class="text-muted" style="font-size:13px;margin:0;">Errore di caricamento.</p>'; });
    }

    // Delete a contract record (and its attached file, if any), then refresh the list.
    async function deleteContractRecord(id, fileId) {
        if (!confirm('Eliminare definitivamente questo contratto?')) return;
        try {
            // Remove the attached file first so it doesn't linger as a loose document
            // (and so the contract delete isn't blocked by a linked record).
            if (fileId) {
                await fetch('api/documents.php?id=' + fileId, { method: 'DELETE' }).catch(() => {});
            }
            const res  = await fetch('api/contracts.php?id=' + id, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Errore durante l\'eliminazione.');
            showAlert('Contratto eliminato.', 'success');
            loadContracts();
        } catch (err) {
            showAlert('Eliminazione non riuscita: ' + (err.message || ''), 'error');
        }
    }

    function loadInvoices() {
        const list = document.getElementById('pp-invoices-list');
        if (!list) return;
        Promise.all([
            fetch('api/invoices.php?property_id=' + propertyId + '&limit=100').then(r => r.json()).catch(() => ({})),
            fetch('api/documents.php?property_id=' + propertyId + '&doc_type=invoice&limit=100').then(r => r.json()).catch(() => ({})),
        ]).then(([iRes, dRes]) => {
            const invoices = iRes.data?.items || iRes.data || [];
            const docs = dRes.data?.items || dRes.data || [];
            let html = invoices.map(i => `
                <div class="pp-side-item">
                    <div class="pp-side-item__main">
                        <strong>${esc(i.invoice_number || 'Fattura')}</strong>
                        <span class="text-muted">${esc(i.description || '')}</span>
                        <span class="text-muted">${ppFmtDate(i.issue_date)}${i.total ? ' · ' + ppMoney(i.total) : (i.amount ? ' · ' + ppMoney(i.amount) : '')}</span>
                    </div>
                    <span class="badge badge--${esc(i.status || 'draft')}">${esc(i.status || '')}</span>
                </div>`).join('');
            html += docFilesHtml(docs, loadInvoices);
            if (!html) html = '<p class="text-muted" style="font-size:13px;margin:0;">Nessuna fattura. Usa il pulsante di caricamento per aggiungerne una.</p>';
            list.innerHTML = html;
            bindDocDeletes(list, loadInvoices);
        }).catch(() => { list.innerHTML = '<p class="text-muted" style="font-size:13px;margin:0;">Errore di caricamento.</p>'; });
    }

    function uploadSideDoc(file, docType, reload) {
        if (!file) return;
        const fd = new FormData();
        fd.append('property_id', propertyId);
        fd.append('doc_type', docType);
        fd.append('file', file);
        fd.append('title', docType === 'contract' ? 'Contratto' : 'Fattura');
        fetch('api/documents.php', { method: 'POST', body: fd })
            .then(r => r.json())
            .then(j => { if (!j.success) throw new Error(j.error || 'Errore'); showAlert('File caricato.', 'success'); reload(); })
            .catch(err => showAlert('Caricamento non riuscito: ' + (err.message || ''), 'error'));
    }

    // ── Importa contratto (Carica → registra come record contratto) ───────────
    let _pciFile = null;

    function openContractImport(file) {
        _pciFile = file;
        const modal = document.getElementById('pp-contract-import-modal');
        if (!modal) { uploadSideDoc(file, 'contract', loadContracts); return; }
        // Reset form
        document.getElementById('pci-error').style.display = 'none';
        document.getElementById('pci-fileinfo').innerHTML =
            `<i data-lucide="paperclip"></i> <strong>${esc(file.name)}</strong> <span class="text-muted">(${(file.size / 1024).toFixed(0)} KB)</span>`;
        const baseName = file.name.replace(/\.[^.]+$/, '');
        document.getElementById('pci-title-input').value = baseName || 'Contratto';
        document.getElementById('pci-type').value = 'locazione';
        document.getElementById('pci-start').value = '';
        document.getElementById('pci-end').value = '';
        document.getElementById('pci-rent').value = '';
        document.getElementById('pci-deposit').value = '';
        document.getElementById('pci-status').value = ''; // Automatico: state derived from the dates
        document.getElementById('pci-notes').value = '';
        ['pci-type', 'pci-start', 'pci-end', 'pci-rent', 'pci-deposit'].forEach(id =>
            document.getElementById(id).classList.remove('pci-autofilled'));

        loadPciDropdowns();
        modal.hidden = false;
        window.lucide?.createIcons();

        // Best-effort auto-fill from the PDF text (PDFs only).
        const scan = document.getElementById('pci-scan');
        if (/\.pdf$/i.test(file.name)) {
            scan.style.display = '';
            scan.innerHTML = '<i data-lucide="loader"></i> Analisi del PDF in corso…';
            window.lucide?.createIcons();
            extractPdfText(file)
                .then(text => { applyPdfHeuristics(text); scan.style.display = 'none'; })
                .catch(() => {
                    scan.className = 'alert alert--warning';
                    scan.innerHTML = 'Impossibile leggere il PDF automaticamente. Inserisci i dati manualmente.';
                });
        } else {
            scan.className = 'alert alert--info';
            scan.innerHTML = 'File non PDF: inserisci i dati manualmente.';
        }
    }

    function closeContractImport() {
        const m = document.getElementById('pp-contract-import-modal');
        if (m) m.hidden = true;
        _pciFile = null;
    }

    function loadPciDropdowns() {
        const cSel = document.getElementById('pci-client');
        const tSel = document.getElementById('pci-tenant');
        fetch('api/clients.php?limit=500').then(r => r.json()).then(j => {
            const items = j.data?.items || j.data || [];
            cSel.innerHTML = '<option value="">— Seleziona —</option>' +
                items.map(c => `<option value="${c.id}">${esc((c.name || '') + ' ' + (c.surname || ''))}</option>`).join('');
            // Prefill with the property's owner when known.
            if (currentProperty?.client_id) cSel.value = String(currentProperty.client_id);
        }).catch(() => {});
        fetch('api/tenants.php?limit=500').then(r => r.json()).then(j => {
            const items = j.data?.items || j.data || [];
            tSel.innerHTML = '<option value="">— Seleziona —</option>' +
                items.map(t => `<option value="${t.id}">${esc((t.name || '') + ' ' + (t.surname || ''))}</option>`).join('');
        }).catch(() => {});
    }

    // Load pdf.js on demand and extract concatenated text from all pages.
    function extractPdfText(file) {
        return loadPdfJs()
            .then(pdfjsLib => file.arrayBuffer().then(buf => pdfjsLib.getDocument({ data: buf }).promise))
            .then(async pdf => {
                let text = '';
                const max = Math.min(pdf.numPages, 8); // first 8 pages are enough for the key terms
                for (let i = 1; i <= max; i++) {
                    const page = await pdf.getPage(i);
                    const content = await page.getTextContent();
                    text += ' ' + content.items.map(it => it.str).join(' ');
                }
                return text;
            });
    }

    let _pdfjsPromise = null;
    function loadPdfJs() {
        if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
        if (_pdfjsPromise) return _pdfjsPromise;
        const VER = '3.11.174';
        _pdfjsPromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${VER}/pdf.min.js`;
            s.onload = () => {
                if (!window.pdfjsLib) return reject(new Error('pdfjs non disponibile'));
                window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${VER}/pdf.worker.min.js`;
                resolve(window.pdfjsLib);
            };
            s.onerror = () => reject(new Error('Caricamento pdf.js non riuscito'));
            document.head.appendChild(s);
        });
        return _pdfjsPromise;
    }

    function pciItNumber(raw) {
        if (!raw) return null;
        // Italian formatting: 1.200,50 → 1200.50
        let s = String(raw).trim().replace(/\./g, '').replace(',', '.');
        const n = parseFloat(s);
        return isNaN(n) ? null : n;
    }
    function pciItDate(raw) {
        if (!raw) return null;
        const m = String(raw).match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
        if (!m) return null;
        let [, d, mo, y] = m;
        if (y.length === 2) y = (parseInt(y, 10) > 50 ? '19' : '20') + y;
        d = d.padStart(2, '0'); mo = mo.padStart(2, '0');
        if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
        return `${y}-${mo}-${d}`;
    }
    function pciMark(id) { document.getElementById(id)?.classList.add('pci-autofilled'); }

    function applyPdfHeuristics(text) {
        const t = (text || '').replace(/\s+/g, ' ');
        const low = t.toLowerCase();

        // Contract type
        let type = null;
        if (/comprav|atto di vendita/.test(low)) type = 'compravendita';
        else if (/prelimina/.test(low)) type = 'preliminare';
        else if (/mandato/.test(low)) type = 'mandato';
        else if (/locazion|affitt/.test(low)) type = 'locazione';
        if (type) { document.getElementById('pci-type').value = type; pciMark('pci-type'); }

        // Monthly rent (canone)
        let rent = null;
        let m = low.match(/canone[^0-9€]{0,40}(?:€|euro)?\s*([\d.]+,\d{2}|[\d.]+)/);
        if (!m) m = low.match(/(?:€|euro)\s*([\d.]+,\d{2}|[\d.]+)\s*(?:mensil|al mese|\/\s*mese)/);
        if (m) { rent = pciItNumber(m[1]); if (rent) { document.getElementById('pci-rent').value = rent; pciMark('pci-rent'); } }

        // Deposit / cauzione
        m = low.match(/(?:deposito cauzionale|cauzion|deposito)[^0-9€]{0,40}(?:€|euro)?\s*([\d.]+,\d{2}|[\d.]+)/);
        if (m) { const dep = pciItNumber(m[1]); if (dep) { document.getElementById('pci-deposit').value = dep; pciMark('pci-deposit'); } }

        // Dates
        m = low.match(/(?:con decorrenza|decorrenza|a far data dal|dalla data del|dal)\s*(?:il\s*)?(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/);
        const start = m ? pciItDate(m[1]) : null;
        if (start) { document.getElementById('pci-start').value = start; pciMark('pci-start'); }

        m = low.match(/(?:fino al|scadenza il|scadenza|scade il|termine del|al)\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/);
        let end = m ? pciItDate(m[1]) : null;
        // Avoid picking the same date as start for the "al" fallback
        if (end && end === start) end = null;
        if (end) { document.getElementById('pci-end').value = end; pciMark('pci-end'); }

        suggestStatusFromDates();
    }

    function suggestStatusFromDates() {
        // No-op: with "Automatico" status the Scaduto/Attivo state is derived from
        // the dates automatically, so we don't override the chosen status here.
    }

    function saveContractImport(e) {
        e.preventDefault();
        const errEl = document.getElementById('pci-error');
        errEl.style.display = 'none';
        if (!_pciFile) { closeContractImport(); return; }

        const startDate = document.getElementById('pci-start').value || null;
        const endDate   = document.getElementById('pci-end').value || null;
        // Only the two dates are required; title falls back to the file name so the
        // record always has a label even when the field is left blank.
        const title = document.getElementById('pci-title-input').value.trim()
            || (_pciFile && _pciFile.name ? _pciFile.name.replace(/\.[^.]+$/, '') : '')
            || 'Contratto importato';
        const payload = {
            property_id:   propertyId,
            client_id:     document.getElementById('pci-client').value || null,
            tenant_id:     document.getElementById('pci-tenant').value || null,
            title:         title,
            contract_type: document.getElementById('pci-type').value,
            status:        document.getElementById('pci-status').value,
            start_date:    startDate,
            end_date:      endDate,
            monthly_rent:  document.getElementById('pci-rent').value || null,
            deposit:       document.getElementById('pci-deposit').value || null,
            notes:         document.getElementById('pci-notes').value.trim() || null,
        };
        if (!startDate || !endDate) { errEl.textContent = 'Data inizio e data fine sono obbligatorie.'; errEl.style.display = ''; return; }

        const btn = document.getElementById('pci-save');
        btn.disabled = true; btn.textContent = 'Salvataggio…';
        const file = _pciFile;

        fetch('api/contracts.php', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        })
            .then(r => r.json())
            .then(json => {
                if (!json.success) throw new Error(json.error || 'Errore creazione contratto.');
                const contractId = json.data?.id;
                // Attach the original file to the new contract record.
                const fd = new FormData();
                fd.append('property_id', propertyId);
                fd.append('doc_type', 'contract');
                fd.append('file', file);
                fd.append('title', payload.title);
                if (contractId) fd.append('contract_id', contractId);
                return fetch('api/documents.php', { method: 'POST', body: fd }).then(r => r.json());
            })
            .then(j => {
                if (!j.success) throw new Error(j.error || 'Contratto creato, ma il file non è stato allegato.');
                showAlert('Contratto importato e registrato.', 'success');
                closeContractImport();
                loadContracts();
            })
            .catch(err => { errEl.textContent = err.message; errEl.style.display = ''; })
            .finally(() => { btn.disabled = false; btn.innerHTML = '<i data-lucide="save"></i> Salva contratto'; window.lucide?.createIcons(); });
    }

    // ── Gallery grid (management tab) ─────────────────────────────────────────

    function renderGalleryGrid(media) {
        const grid = document.getElementById('pp-gallery-grid');
        if (!media.length) {
            grid.innerHTML = '<p class="text-muted" style="padding:16px;">Nessun file caricato.</p>';
            return;
        }
        grid.innerHTML = media.map((m, i) => {
            const isPhoto = !m.media_type || m.media_type === 'photo' || m.media_type === 'image';
            const thumb = isPhoto ? `<img src="${esc(m.file_path)}" alt="">` : `<div class="gallery-item-icon"><i data-lucide="file-text"></i></div>`;
            const coverBadge = m.is_cover ? '<span class="gallery-cover-badge">Copertina</span>' : '';
            return `<div class="gallery-item" data-id="${m.id}">
                <div class="gallery-item-thumb" data-lightbox="${i}">${thumb}${coverBadge}</div>
                <div class="gallery-item-info">
                    <span class="gallery-item-name">${esc(m.original_name || m.file_name || '')}</span>
                    <div class="gallery-item-actions">
                        ${isPhoto && !m.is_cover ? `<button class="btn btn--xs btn--ghost" data-action="cover" data-id="${m.id}">Copertina</button>` : ''}
                        <button class="btn btn--xs btn--danger" data-action="delete" data-id="${m.id}"><i data-lucide="trash-2"></i></button>
                    </div>
                </div>
            </div>`;
        }).join('');

        grid.querySelectorAll('[data-lightbox]').forEach(el => {
            el.addEventListener('click', e => {
                if (e.target.closest('button')) return;
                openLightbox(parseInt(el.dataset.lightbox, 10));
            });
        });
        grid.querySelectorAll('[data-action="cover"]').forEach(btn => btn.addEventListener('click', () => setCover(btn.dataset.id)));
        grid.querySelectorAll('[data-action="delete"]').forEach(btn => btn.addEventListener('click', () => deleteMedia(btn.dataset.id)));
    }

    // ── Lightbox ──────────────────────────────────────────────────────────────

    function openLightbox(index) {
        const photos = allMedia.filter(m => !m.media_type || m.media_type === 'photo' || m.media_type === 'image');
        if (!photos.length) return;
        lightboxIndex = ((index % photos.length) + photos.length) % photos.length;

        let lb = document.getElementById('pp-lightbox');
        if (!lb) {
            lb = document.createElement('div');
            lb.id = 'pp-lightbox';
            lb.className = 'pp-lightbox';
            lb.innerHTML = `
                <div class="pp-lightbox-backdrop"></div>
                <button class="pp-lightbox-close" aria-label="Chiudi">✕</button>
                <button class="pp-lightbox-nav pp-lightbox-prev" aria-label="Precedente">‹</button>
                <div class="pp-lightbox-img-wrap">
                    <img class="pp-lightbox-img" src="" alt="">
                    <div class="pp-lightbox-counter"></div>
                </div>
                <button class="pp-lightbox-nav pp-lightbox-next" aria-label="Successiva">›</button>`;
            document.body.appendChild(lb);
            lb.querySelector('.pp-lightbox-backdrop').addEventListener('click', closeLightbox);
            lb.querySelector('.pp-lightbox-close').addEventListener('click', closeLightbox);
            lb.querySelector('.pp-lightbox-prev').addEventListener('click', () => setLightboxIndex(lightboxIndex - 1));
            lb.querySelector('.pp-lightbox-next').addEventListener('click', () => setLightboxIndex(lightboxIndex + 1));
            document.addEventListener('keydown', onLightboxKey);
        }

        setLightboxIndex(lightboxIndex, photos);
        lb.style.display = 'flex';
    }

    function setLightboxIndex(idx, photos) {
        const ph = photos || allMedia.filter(m => !m.media_type || m.media_type === 'photo' || m.media_type === 'image');
        lightboxIndex = ((idx % ph.length) + ph.length) % ph.length;
        const lb = document.getElementById('pp-lightbox');
        if (!lb) return;
        lb.querySelector('.pp-lightbox-img').src = ph[lightboxIndex].file_path;
        lb.querySelector('.pp-lightbox-counter').textContent = (lightboxIndex + 1) + ' / ' + ph.length;
        const multi = ph.length > 1;
        lb.querySelector('.pp-lightbox-prev').style.display = multi ? '' : 'none';
        lb.querySelector('.pp-lightbox-next').style.display = multi ? '' : 'none';
    }

    function closeLightbox() {
        const lb = document.getElementById('pp-lightbox');
        if (lb) lb.style.display = 'none';
    }

    function onLightboxKey(e) {
        const lb = document.getElementById('pp-lightbox');
        if (!lb || lb.style.display === 'none') return;
        if (e.key === 'Escape') closeLightbox();
        else if (e.key === 'ArrowLeft') setLightboxIndex(lightboxIndex - 1);
        else if (e.key === 'ArrowRight') setLightboxIndex(lightboxIndex + 1);
    }

    // ── Media management ──────────────────────────────────────────────────────

    function uploadMedia(files) {
        const type = document.getElementById('pp-media-type').value;
        const uploads = Array.from(files).map(file => {
            const fd = new FormData();
            fd.append('property_id', propertyId);
            fd.append('media_type', type);
            fd.append('file', file);
            return fetch('api/property_media.php', { method: 'POST', body: fd }).then(r => r.json());
        });
        Promise.all(uploads).then(() => loadMedia()).catch(() => showAlert('Errore durante il caricamento.', 'error'));
    }

    let _pendingDeleteId = null;

    function deleteMedia(id) {
        const media = allMedia.find(m => String(m.id) === String(id));
        const overlay = document.getElementById('pp-delete-media-modal');
        const preview = document.getElementById('pp-delete-media-preview');
        const nameEl  = document.getElementById('pp-delete-media-name');

        const isPhoto = media && (!media.media_type || media.media_type === 'photo' || media.media_type === 'image');
        if (isPhoto && media?.file_path) {
            preview.innerHTML = `<img src="${esc(media.file_path)}" style="width:100%;height:100%;object-fit:cover;" alt="">`;
        } else {
            preview.innerHTML = '<i data-lucide="file-text"></i>';
        }
        nameEl.textContent = media?.original_name || media?.file_name || '';

        _pendingDeleteId = id;
        overlay.hidden = false;
    }

    function _execDeleteMedia(id) {
        fetch('api/property_media.php?id=' + id, { method: 'DELETE' })
            .then(r => r.json())
            .then(json => { if (!json.success) throw new Error(); loadMedia(); })
            .catch(() => showAlert('Impossibile eliminare il file.', 'error'));
    }

    function setCover(id) {
        fetch('api/property_media.php?action=set_cover', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ media_id: parseInt(id, 10), property_id: parseInt(propertyId, 10) })
        })
            .then(r => r.json())
            .then(() => loadMedia())
            .catch(() => showAlert('Impossibile impostare la copertina.', 'error'));
    }

    // ── Documents ─────────────────────────────────────────────────────────────

    function loadDocuments() {
        const list = document.getElementById('pp-docs-list');
        list.innerHTML = '<div class="entity-loading">Caricamento…</div>';
        fetch('api/documents.php?property_id=' + propertyId + '&limit=100')
            .then(r => r.json())
            .then(json => {
                if (!json.success) throw new Error();
                // The documents API also returns contract records as virtual entries
                // (doc_type 'contratto', no downloadable file). Those belong in the
                // Contratti panel, not here — keep only real uploaded files.
                const docs = (json.data?.items || json.data || []).filter(d => d.doc_type !== 'contratto' && (d.download_url || d.id));
                document.getElementById('pp-docs-count').textContent = docs.length + ' documenti';
                if (!docs.length) { list.innerHTML = '<p class="text-muted" style="padding:16px;">Nessun documento caricato.</p>'; return; }
                list.innerHTML = docs.map(d => `
                    <div class="doc-row">
                        <a href="${esc(d.download_url || ('api/download_document.php?id=' + d.id))}" target="_blank" class="doc-row__name"><i data-lucide="file-text"></i> ${esc(d.original_name || d.file_name || 'Documento')}</a>
                        <span class="doc-row__date text-muted">${d.created_at ? new Date(d.created_at).toLocaleDateString('it-IT') : ''}</span>
                        <button class="btn btn--xs btn--danger" data-doc-id="${d.id}"><i data-lucide="trash-2"></i></button>
                    </div>`).join('');
                list.querySelectorAll('[data-doc-id]').forEach(btn => btn.addEventListener('click', () => deleteDocument(btn.dataset.docId)));
            })
            .catch(() => { list.innerHTML = '<p class="text-muted" style="padding:16px;">Errore caricamento documenti.</p>'; });
    }

    function uploadDocuments(files) {
        const uploads = Array.from(files).map(file => {
            const fd = new FormData();
            fd.append('property_id', propertyId);
            fd.append('doc_type', 'other');
            fd.append('file', file);
            return fetch('api/documents.php', { method: 'POST', body: fd }).then(r => r.json());
        });
        Promise.all(uploads).then(() => loadDocuments()).catch(() => showAlert('Errore durante il caricamento.', 'error'));
    }

    function deleteDocument(id) {
        if (!confirm('Eliminare questo documento?')) return;
        fetch('api/documents.php?id=' + id, { method: 'DELETE' })
            .then(r => r.json())
            .then(json => { if (!json.success) throw new Error(); loadDocuments(); })
            .catch(() => showAlert('Impossibile eliminare il documento.', 'error'));
    }

    // ── Reminders ─────────────────────────────────────────────────────────────

    function loadReminders() {
        const list = document.getElementById('pp-reminders-list');
        list.innerHTML = '<div class="entity-loading">Caricamento…</div>';
        fetch('api/reminders.php?property_id=' + propertyId + '&limit=100')
            .then(r => r.json())
            .then(json => {
                // DELETE soft-cancels (status='cancelled'); hide those so deleting
                // actually removes the reminder from view.
                const items = (json.data?.items || json.data || []).filter(r => r.status !== 'cancelled');
                document.getElementById('pp-reminders-count').textContent = items.length + ' promemoria';
                if (!items.length) { list.innerHTML = '<p class="text-muted" style="padding:16px;">Nessun promemoria.</p>'; return; }
                list.innerHTML = items.map(r => {
                    const done = r.status === 'completed';
                    return `
                    <div class="reminder-row ${done ? 'reminder-row--done' : ''}">
                        <div class="reminder-row__info">
                            <strong>${esc(r.title)}</strong>
                            ${r.reminder_date ? `<span class="text-muted">${new Date(r.reminder_date).toLocaleDateString('it-IT')}</span>` : ''}
                            ${r.description ? `<span class="text-muted">${esc(r.description)}</span>` : ''}
                        </div>
                        <div class="reminder-row__actions">
                            ${!done ? `<button class="btn btn--xs btn--ghost" data-rem-complete="${r.id}"><i data-lucide="check"></i></button>` : '<span class="badge badge--success">Fatto</span>'}
                            <button class="btn btn--xs btn--danger" data-rem-delete="${r.id}"><i data-lucide="trash-2"></i></button>
                        </div>
                    </div>`;
                }).join('');
                list.querySelectorAll('[data-rem-complete]').forEach(btn => btn.addEventListener('click', () => completeReminder(btn.dataset.remComplete)));
                list.querySelectorAll('[data-rem-delete]').forEach(btn => btn.addEventListener('click', () => deleteReminder(btn.dataset.remDelete)));
            })
            .catch(() => { list.innerHTML = '<p class="text-muted" style="padding:16px;">Errore caricamento.</p>'; });
        loadSideReminders();
    }

    // Compact upcoming-reminders card in the right column (balances the layout height).
    function loadSideReminders() {
        const list = document.getElementById('pp-side-reminders');
        if (!list) return;
        fetch('api/reminders.php?property_id=' + propertyId + '&limit=100')
            .then(r => r.json())
            .then(json => {
                let items = json.data?.items || json.data || [];
                // API contract: open reminders have status 'pending'; date field is reminder_date.
                items = items.filter(r => r.status !== 'completed' && r.status !== 'cancelled')
                    .sort((a, b) => (a.reminder_date || '9999').localeCompare(b.reminder_date || '9999'))
                    .slice(0, 6);
                if (!items.length) {
                    list.innerHTML = '<p class="text-muted" style="font-size:13px;margin:0;">Nessun promemoria in programma.</p>';
                    return;
                }
                const today = new Date().toISOString().slice(0, 10);
                list.innerHTML = items.map(r => {
                    const datePart = (r.reminder_date || '').split(/[ T]/)[0];
                    const overdue = datePart && datePart < today;
                    return `
                    <div class="pp-side-item">
                        <span class="status-dot status-dot--${overdue ? 'expired' : 'pending'}" title="${overdue ? 'Scaduto' : 'In programma'}"></span>
                        <div class="pp-side-item__main">
                            <strong>${esc(r.title || 'Promemoria')}</strong>
                            ${r.reminder_date ? `<span class="text-muted">${ppFmtDate(r.reminder_date)}</span>` : ''}
                        </div>
                    </div>`;
                }).join('');
                window.lucide?.createIcons();
            })
            .catch(() => { list.innerHTML = '<p class="text-muted" style="font-size:13px;margin:0;">Errore di caricamento.</p>'; });
    }

    function openReminderModal(reminder) {
        document.getElementById('pp-rem-id').value = reminder?.id || '';
        document.getElementById('pp-rem-title').textContent = reminder ? 'Modifica promemoria' : 'Nuovo promemoria';
        document.getElementById('pp-rem-title-input').value = reminder?.title || '';
        // reminder_date comes back as 'YYYY-MM-DD HH:MM:SS' (or with a T) — take the date part.
        document.getElementById('pp-rem-date').value = (reminder?.reminder_date || '').split(/[ T]/)[0] || '';
        document.getElementById('pp-rem-freq').value = reminder?.frequency || 'once';
        document.getElementById('pp-rem-notes').value = reminder?.description || '';
        document.getElementById('pp-reminder-modal').hidden = false;
    }

    function closeReminderModal() {
        document.getElementById('pp-reminder-modal').hidden = true;
    }

    function handleReminderSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('pp-rem-id').value;
        const dateVal = document.getElementById('pp-rem-date').value;
        if (!dateVal) { showAlert('Inserisci la data del promemoria.', 'error'); return; }
        const body = {
            property_id: propertyId,
            title: document.getElementById('pp-rem-title-input').value.trim(),
            // API contract: reminders use reminder_date (datetime) + description, not due_date/notes.
            reminder_date: dateVal,
            frequency: document.getElementById('pp-rem-freq').value,
            description: document.getElementById('pp-rem-notes').value.trim(),
        };
        const method = id ? 'PUT' : 'POST';
        const url = id ? 'api/reminders.php?id=' + id : 'api/reminders.php';
        fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .then(r => r.json())
            .then(json => { if (!json.success) throw new Error(json.error || 'Errore'); closeReminderModal(); loadReminders(); loadSideReminders(); })
            .catch(err => showAlert('Errore: ' + err.message, 'error'));
    }

    function completeReminder(id) {
        // API contract: status changes go through PATCH ?action=complete.
        fetch('api/reminders.php?id=' + id + '&action=complete', { method: 'PATCH' })
            .then(r => r.json())
            .then(json => { if (!json.success) throw new Error(json.error || 'Errore'); loadReminders(); loadSideReminders(); })
            .catch(() => showAlert('Errore.', 'error'));
    }

    function deleteReminder(id) {
        if (!confirm('Eliminare questo promemoria?')) return;
        fetch('api/reminders.php?id=' + id, { method: 'DELETE' })
            .then(r => r.json())
            .then(() => { loadReminders(); loadSideReminders(); })
            .catch(() => showAlert('Errore.', 'error'));
    }

    // ── Price history ─────────────────────────────────────────────────────────

    function renderPriceHistory(history) {
        const el = document.getElementById('pp-price-history');
        if (!history.length) { el.innerHTML = '<p class="text-muted" style="padding:16px;">Nessuna variazione di prezzo registrata.</p>'; return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr><th>Data</th><th>Prezzo</th><th>Tipo</th><th>Note</th></tr></thead>
            <tbody>${history.map(h => `<tr>
                <td>${h.changed_at ? new Date(h.changed_at).toLocaleDateString('it-IT') : '—'}</td>
                <td>€ ${parseFloat(h.price).toLocaleString('it-IT')}</td>
                <td>${h.price_type || '—'}</td>
                <td>${esc(h.notes || '')}</td>
            </tr>`).join('')}</tbody>
        </table>`;
    }

    // ── Edit modal ────────────────────────────────────────────────────────────

    function loadClients() {
        return fetch('api/clients.php?limit=500')
            .then(r => r.json())
            .then(json => {
                const clients = json.data?.items || json.data || [];
                const sel = document.getElementById('pp-client');
                sel.innerHTML = '<option value="">— Seleziona proprietario —</option>' +
                    clients.map(c => `<option value="${c.id}">${esc(c.name || c.full_name || '')}</option>`).join('');
                return clients;
            });
    }

    function openEditModal() {
        const p = currentProperty;
        if (!p) return;
        loadClients().then(() => {
            document.getElementById('pp-prop-id').value = p.id;
            document.getElementById('pp-client').value = p.client_id || p.owner_id || '';
            document.getElementById('pp-status').value = p.status || 'available';
            document.getElementById('pp-address').value = p.address || '';
            document.getElementById('pp-floor').value = p.floor || '';
            document.getElementById('pp-city').value = p.city || '';
            document.getElementById('pp-cap').value = p.cap || '';
            document.getElementById('pp-province').value = p.province || '';
            document.getElementById('pp-sqm').value = p.sqm || '';
            document.getElementById('pp-rooms').value = p.rooms || '';
            document.getElementById('pp-bathrooms').value = p.bathrooms || '';
            document.getElementById('pp-property-type').value = p.property_type || 'appartamento';
            document.getElementById('pp-price').value = p.price || '';
            document.getElementById('pp-price-type').value = p.price_type || 'affitto';
            document.getElementById('pp-description').value = p.description || '';
            document.getElementById('pp-features').value = p.additional_features || '';
            document.getElementById('pp-edit-notes').value = p.internal_notes || '';
            document.getElementById('pp-edit-modal').hidden = false;
        });
    }

    function closeEditModal() {
        document.getElementById('pp-edit-modal').hidden = true;
    }

    function handleEditSubmit(e) {
        e.preventDefault();
        const body = {
            id: propertyId,
            client_id: document.getElementById('pp-client').value || null,
            status: document.getElementById('pp-status').value,
            address: document.getElementById('pp-address').value.trim(),
            floor: document.getElementById('pp-floor').value.trim() || null,
            city: document.getElementById('pp-city').value.trim(),
            cap: document.getElementById('pp-cap').value.trim() || null,
            province: document.getElementById('pp-province').value.trim().toUpperCase() || null,
            sqm: parseFloat(document.getElementById('pp-sqm').value) || null,
            rooms: parseInt(document.getElementById('pp-rooms').value, 10) || null,
            bathrooms: parseInt(document.getElementById('pp-bathrooms').value, 10) || null,
            property_type: document.getElementById('pp-property-type').value,
            price: parseFloat(document.getElementById('pp-price').value) || null,
            price_type: document.getElementById('pp-price-type').value,
            description: document.getElementById('pp-description').value.trim() || null,
            additional_features: document.getElementById('pp-features').value.trim() || null,
            internal_notes: document.getElementById('pp-edit-notes').value.trim() || null,
        };
        const btn = document.getElementById('pp-edit-save');
        btn.disabled = true;
        fetch('api/properties.php?id=' + propertyId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .then(r => r.json())
            .then(json => { if (!json.success) throw new Error(json.error || 'Errore'); closeEditModal(); loadProperty(); })
            .catch(err => showAlert('Errore salvataggio: ' + err.message, 'error'))
            .finally(() => { btn.disabled = false; });
    }

    // ── Archive ───────────────────────────────────────────────────────────────

    function confirmArchive() {
        fetch('api/properties.php?id=' + propertyId, { method: 'DELETE' })
            .then(r => r.json())
            .then(json => {
                if (!json.success) throw new Error(json.error || 'Errore');
                document.getElementById('pp-archive-modal').hidden = true;
                if (window.App) window.App.navigateTo('properties');
            })
            .catch(err => showAlert('Errore: ' + err.message, 'error'));
    }

    // ── PDF & QR ──────────────────────────────────────────────────────────────

    async function generatePdf() {
        const btn = document.getElementById('btn-pp-pdf');
        if (btn) { btn.disabled = true; btn.textContent = 'Generazione…'; }
        try {
            const res  = await fetch('api/generate_pdf.php', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ type: 'report', property_id: propertyId }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const a = document.createElement('a');
            a.href     = json.data.download;
            a.target   = '_blank';
            a.rel      = 'noopener';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (err) {
            showAlert('Errore generazione PDF: ' + err.message, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="file-text"></i> Scheda PDF'; window.lucide?.createIcons(); }
        }
    }

    function openQrModal() {
        const publicUrl = window.location.origin + '/property/' + propertyId;
        const qrSrc = 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent(publicUrl);
        document.getElementById('pp-qr-img').src = qrSrc;
        document.getElementById('pp-qr-url').value = publicUrl;
        document.getElementById('pp-qr-download').href = qrSrc;
        document.getElementById('pp-qr-modal').hidden = false;
    }

    function closeQrModal() {
        document.getElementById('pp-qr-modal').hidden = true;
    }

    // ── Tabs ──────────────────────────────────────────────────────────────────

    function switchTab(tabName) {
        document.querySelectorAll('.profile-tab').forEach(t => t.classList.toggle('profile-tab--active', t.dataset.tab === tabName));
        ['media', 'documents', 'reminders', 'history'].forEach(name => {
            document.getElementById('panel-' + name).hidden = name !== tabName;
        });
        if (tabName === 'documents') loadDocuments();
        if (tabName === 'reminders') loadReminders();
    }

    // ── Event binding ──────────────────────────────────────────────────────────

    function bindStaticEvents() {
        document.getElementById('btn-back-to-properties').addEventListener('click', () => {
            if (window.App) window.App.navigateTo('properties');
        });

        document.getElementById('property-profile-tabs').addEventListener('click', e => {
            const tab = e.target.closest('[data-tab]');
            if (tab) switchTab(tab.dataset.tab);
        });

        document.getElementById('pp-media-upload').addEventListener('change', e => {
            if (e.target.files.length) uploadMedia(e.target.files);
            e.target.value = '';
        });

        document.getElementById('pp-doc-upload').addEventListener('change', e => {
            if (e.target.files.length) uploadDocuments(e.target.files);
            e.target.value = '';
        });

        document.getElementById('pp-contract-upload')?.addEventListener('change', e => {
            if (e.target.files[0]) openContractImport(e.target.files[0]);
            e.target.value = '';
        });
        document.getElementById('pci-close')?.addEventListener('click', closeContractImport);
        document.getElementById('pci-cancel')?.addEventListener('click', closeContractImport);
        document.getElementById('pci-form')?.addEventListener('submit', saveContractImport);
        document.getElementById('pci-end')?.addEventListener('change', suggestStatusFromDates);
        document.getElementById('pp-invoice-upload')?.addEventListener('change', e => {
            if (e.target.files[0]) uploadSideDoc(e.target.files[0], 'invoice', loadInvoices);
            e.target.value = '';
        });

        document.getElementById('btn-pp-new-reminder').addEventListener('click', () => openReminderModal());
        document.getElementById('btn-pp-side-reminder')?.addEventListener('click', () => openReminderModal());
        document.getElementById('pp-rem-close').addEventListener('click', closeReminderModal);
        document.getElementById('pp-rem-cancel').addEventListener('click', closeReminderModal);
        document.getElementById('pp-reminder-form').addEventListener('submit', handleReminderSubmit);

        document.getElementById('pp-edit-close').addEventListener('click', closeEditModal);
        document.getElementById('pp-edit-cancel').addEventListener('click', closeEditModal);
        document.getElementById('pp-edit-form').addEventListener('submit', handleEditSubmit);

        document.getElementById('pp-archive-close').addEventListener('click', () => { document.getElementById('pp-archive-modal').hidden = true; });
        document.getElementById('pp-archive-cancel').addEventListener('click', () => { document.getElementById('pp-archive-modal').hidden = true; });
        document.getElementById('pp-archive-confirm').addEventListener('click', confirmArchive);

        // Social publish modal
        document.getElementById('pp-social-close')?.addEventListener('click', closeSocialPublish);
        document.getElementById('pp-social-cancel')?.addEventListener('click', closeSocialPublish);
        document.getElementById('pp-social-publish')?.addEventListener('click', confirmSocialPublish);
        document.getElementById('pp-social-modal')?.addEventListener('click', (e) => {
            if (e.target === document.getElementById('pp-social-modal')) closeSocialPublish();
        });

        document.getElementById('pp-qr-close').addEventListener('click', closeQrModal);
        document.getElementById('pp-qr-cancel').addEventListener('click', closeQrModal);
        document.getElementById('pp-qr-copy').addEventListener('click', () => {
            navigator.clipboard.writeText(document.getElementById('pp-qr-url').value).catch(() => {});
        });

        const closeDeleteModal = () => {
            document.getElementById('pp-delete-media-modal').hidden = true;
            _pendingDeleteId = null;
        };
        document.getElementById('pp-delete-media-close').addEventListener('click', closeDeleteModal);
        document.getElementById('pp-delete-media-cancel').addEventListener('click', closeDeleteModal);
        document.getElementById('pp-delete-media-modal').addEventListener('click', e => {
            if (e.target === e.currentTarget) closeDeleteModal();
        });
        document.getElementById('pp-delete-media-confirm').addEventListener('click', () => {
            const id = _pendingDeleteId;
            closeDeleteModal();
            if (id != null) _execDeleteMedia(id);
        });
    }

    // ── Utility ───────────────────────────────────────────────────────────────

    function showAlert(msg, type) {
        const el = document.getElementById('property-profile-alert');
        el.textContent = msg;
        el.className = 'alert alert--' + (type || 'info');
        el.style.display = '';
        setTimeout(() => { el.style.display = 'none'; }, 5000);
    }

    function esc(str) {
        if (str == null) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    init();
})();
