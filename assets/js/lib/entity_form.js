/**
 * entity_form.js — the form engine behind every "Nuovo / Modifica" page.
 *
 * Why
 * ---
 * Nine hand-written *_edit pages and a dozen in-modal forms were each carrying
 * their own copy of the same 200 lines: build the markup, populate from JSON,
 * read back into JSON, show an alert, disable the save button, navigate back.
 * The copies had drifted — currency was type=number in one form and type=text
 * in the next, "Salva" vs "Salva modifiche", some forms validated on the client
 * and some let the API 500 do the talking.
 *
 * A form is now a data structure. Give this module a schema and it renders the
 * established .entity-edit-view markup (see 12-forms.css / 14-entity-form.css),
 * loads the record, validates per field, saves, and returns the user to where
 * they came from.
 *
 * Schema
 * ------
 *   {
 *     entity:   'suppliers',              // key used in the URL
 *     api:      'api/suppliers.php',      // GET ?id / POST / PUT ?id
 *     listView: 'suppliers',              // where "Indietro" falls back to
 *     icon:     'truck',
 *     titles:   { create: 'Nuovo Fornitore', edit: 'Modifica Fornitore' },
 *     subtitle: 'Anagrafica e recapiti del fornitore.',
 *     sections: [
 *       { legend: 'Anagrafica', hint: '…', fields: [ …fieldSpec ] },
 *       { legend: 'Note',  fold: true, fields: [ … ] },   // fold = collapsed
 *     ],
 *     // optional hooks
 *     afterLoad(data, form)       — massage the record before it populates
 *     beforeSave(payload, form)   — massage/deny the payload (return false to stop)
 *     validate(payload, form)     — return a string to block the save
 *   }
 *
 * Field spec
 * ----------
 *   name, label, type, span (1..12, default 6)
 *   type: text | textarea | number | money | integer | date | time | datetime |
 *         email | tel | url | select | checkbox | yesno | stars | picker |
 *         hidden | static
 *   required, placeholder, hint, maxlength, min, max, rows, prefix, suffix
 *   options: [{value,label}] | () => [...]      (select / yesno)
 *   source:  key into lookups.SOURCES           (select / picker)
 *   filter:  (option, data) => bool             (narrow a sourced list)
 *   when:    (data) => bool                     (conditional visibility)
 *   readonly, autofocus, uppercase
 *   validate: (value, data) => string | null
 */

import * as Lookups from './lookups.js';

/* ------------------------------------------------------------------ utils */

const esc = (s) => {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
};

const attr = (name, val) =>
    (val === undefined || val === null || val === false || val === '') ? '' : ` ${name}="${esc(val)}"`;

/** Fields that never carry a control (no value, no validation). */
const DECORATIVE = new Set(['static', 'custom']);

/** Fields whose serialised value is numeric. */
const NUMERIC = new Set(['number', 'money', 'integer', 'stars']);

/* ---------------------------------------------------------------- rendering */

function renderControl(f, uid) {
    const id   = `${uid}-${f.name}`;
    const base = attr('id', id) + attr('name', f.name);
    const cls  = f.type === 'textarea' ? 'form-textarea'
               : (f.type === 'select' || f.type === 'yesno') ? 'form-select'
               : 'form-input';

    const common = base
        + ` class="${cls}"`
        + attr('placeholder', f.placeholder)
        + (f.readonly ? ' readonly' : '')
        + (f.required ? ' aria-required="true"' : '')
        + attr('maxlength', f.maxlength)
        + attr('autocomplete', f.autocomplete || 'off')
        + (f.uppercase ? ' style="text-transform:uppercase"' : '');

    switch (f.type) {
        case 'textarea':
            return `<textarea${common} rows="${f.rows || 3}"></textarea>`;

        case 'select': {
            // Sourced selects are filled asynchronously; render the placeholder
            // option now so the control has a stable height before data lands.
            const opts = Array.isArray(f.options) ? f.options : [];
            const empty = f.emptyLabel === false ? '' :
                `<option value="">${esc(f.emptyLabel || '— Seleziona —')}</option>`;
            return `<select${common}${f.source ? ' data-ef-source="' + esc(f.source) + '"' : ''}>`
                + empty
                + opts.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')
                + `</select>`;
        }

        case 'yesno':
            return `<select${common}>`
                + `<option value="">— —</option>`
                + `<option value="1">Sì</option>`
                + `<option value="0">No</option>`
                + `</select>`;

        case 'checkbox':
            return `<label class="pe-check" for="${id}">`
                + `<input type="checkbox"${base}${f.readonly ? ' disabled' : ''}>`
                + `<span>${esc(f.checkboxLabel || f.label)}</span>`
                + `</label>`;

        case 'stars':
            return `<div class="ef-stars" data-ef-stars="${esc(f.name)}" role="radiogroup" aria-label="${esc(f.label)}">`
                + [1, 2, 3, 4, 5].map(v =>
                    `<button type="button" class="ef-star" data-value="${v}" aria-label="${v} su 5">☆</button>`).join('')
                + `<button type="button" class="ef-star-clear" data-value="0" title="Azzera">×</button>`
                + `<input type="hidden"${base} value="0">`
                + `</div>`;

        case 'picker':
            // Type-ahead over a lookup source. The visible input holds a label;
            // the hidden input holds the id that actually gets saved — a stale
            // label with no id is rejected at save time rather than dropped.
            return `<input type="text" class="form-input" id="${id}-text" data-ef-picker="${esc(f.name)}"`
                + ` list="${id}-list"` + attr('placeholder', f.placeholder || 'Digita per cercare…')
                + (f.required ? ' aria-required="true"' : '')
                + ` autocomplete="off">`
                + `<datalist id="${id}-list"></datalist>`
                + `<input type="hidden"${base}>`;

        case 'file':
            // Uploads force the whole save onto multipart/form-data — see save().
            return `<input type="file"${base} class="form-input"`
                + attr('accept', f.accept) + (f.multiple ? ' multiple' : '') + `>`
                + `<div class="ef-file-existing" data-ef-files="${esc(f.name)}"></div>`;

        case 'hidden':
            return `<input type="hidden"${base}>`;

        case 'static':
            return `<div class="ef-static" data-ef-static="${esc(f.name)}">—</div>`;

        case 'custom':
            // Uno sportello per i pezzi che non sono campi: una galleria di foto,
            // un riquadro di sola lettura, un widget con una logica sua. Lo
            // schema fornisce il markup con `html` e ci si aggancia con
            // `onMount(contenitore, form)` — vedi schemas/inventory.js.
            // Non entra nel payload e non viene validato.
            return `<div class="ef-custom" data-ef-custom="${esc(f.name)}">${f.html || ''}</div>`;

        case 'money':
        case 'number':
        case 'integer': {
            // No `step` attribute on money. HTML's step grid is anchored at
            // `min`, so min=1 step=0.01 rejects perfectly ordinary amounts and
            // the browser reports it as a generic "valore non valido". Range is
            // checked in validateField() instead, where the message can say why.
            const inner = `<input type="number"${common} inputmode="${f.type === 'integer' ? 'numeric' : 'decimal'}"`
                + attr('min', f.min) + attr('max', f.max)
                + (f.type === 'integer' ? ' step="1"' : ' step="any"') + `>`;
            return (f.prefix || f.suffix)
                ? `<div class="field-inline">${f.prefix ? `<span class="field-unit">${esc(f.prefix)}</span>` : ''}${inner}${f.suffix ? `<span class="field-unit">${esc(f.suffix)}</span>` : ''}</div>`
                : inner;
        }

        case 'date':     return `<input type="date"${common}>`;
        case 'time':     return `<input type="time"${common}>`;
        case 'datetime': return `<input type="datetime-local"${common}>`;
        case 'email':    return `<input type="email"${common} inputmode="email">`;
        case 'tel':      return `<input type="tel"${common} inputmode="tel">`;
        case 'url':      return `<input type="url"${common} inputmode="url">`;
        default:         return `<input type="text"${common}>`;
    }
}

function renderField(f, uid) {
    const id   = `${uid}-${f.name}`;
    const span = Math.min(12, Math.max(1, f.span || (f.type === 'textarea' ? 12 : 6)));
    const hintId = f.hint ? ` aria-describedby="${id}-hint"` : '';

    if (f.type === 'hidden') return renderControl(f, uid);

    // A picker's `name` belongs to the HIDDEN id-carrying input; the control the
    // user actually types into is `${id}-text`. Pointing the label at the hidden
    // one made clicking it a no-op and left the visible box unlabelled for a
    // screen reader.
    const labelFor = f.type === 'picker' ? `${id}-text` : id;

    // The checkbox carries its own <label>; a second one would double the text.
    const label = f.type === 'checkbox' ? '' :
        `<label for="${labelFor}">${esc(f.label)}${f.required ? ' <span class="required">*</span>' : ''}`
        + (f.labelHint ? ` <span class="form-hint-inline">— ${esc(f.labelHint)}</span>` : '')
        + `</label>`;

    return `<div class="form-group ef-span-${span}" data-ef-field="${esc(f.name)}"${hintId}>`
        + label
        + renderControl(f, uid)
        + (f.hint ? `<p class="field-hint" id="${id}-hint">${esc(f.hint)}</p>` : '')
        + `<p class="ef-field-error" id="${id}-err" hidden></p>`
        + `</div>`;
}

function renderSection(s, uid) {
    const body = `<div class="form-grid">${(s.fields || []).map(f => renderField(f, uid)).join('')}</div>`
        + (s.footer ? `<div class="ef-section-footer">${s.footer}</div>` : '');

    if (s.fold) {
        // Rarely-touched blocks (catasto, APE, dati fiscali) start closed so the
        // form opens at the length of the job, not the length of the schema.
        const n = (s.fields || []).length;
        return `<details class="form-section form-section--fold" data-ef-section="${esc(s.legend)}">`
            + `<summary><span class="ef-fold-title">${esc(s.legend)}</span>`
            + `<span class="ef-fold-meta">${n} camp${n === 1 ? 'o' : 'i'}${s.optionalNote ? ' · ' + esc(s.optionalNote) : ''}</span></summary>`
            + (s.hint ? `<p class="ef-section-hint">${esc(s.hint)}</p>` : '')
            + body + `</details>`;
    }

    return `<fieldset class="form-section" data-ef-section="${esc(s.legend)}">`
        + `<legend>${esc(s.legend)}</legend>`
        + (s.hint ? `<p class="ef-section-hint">${esc(s.hint)}</p>` : '')
        + body + `</fieldset>`;
}

/* ------------------------------------------------------------------- engine */

export class EntityForm {
    constructor(schema, opts = {}) {
        this.schema  = schema;
        this.mountEl = opts.mount;
        this.id      = opts.id ? String(opts.id) : null;
        this.uid     = `ef-${schema.entity}`;
        this.onSaved = opts.onSaved || null;
        this.prefill = opts.prefill || {};
        this.record  = {};
        this.dirty   = false;
        this.saving  = false;
        this._fields = schema.sections.flatMap(s => s.fields || []);
    }

    get isEdit() { return !!this.id; }

    field(name) { return this._fields.find(f => f.name === name); }

    /* --------------------------------------------------------------- mount */

    async mount() {
        this.mountEl.innerHTML = this.html();
        this.formEl  = this.mountEl.querySelector('[data-ef="form"]');
        this.alertEl = this.mountEl.querySelector('[data-ef="alert"]');
        this.saveBtn = this.mountEl.querySelector('[data-ef="save"]');

        this.bind();
        this.mountCustom();
        if (window.lucide) window.lucide.createIcons();

        // Options first: populating a <select> before its options exist silently
        // leaves it on the placeholder, which reads as "the record lost a field".
        await this.loadOptions();

        if (this.isEdit) {
            try {
                await this.loadRecord();
            } catch (err) {
                this.alert(`Impossibile caricare i dati: ${err.message}`, 'error');
            }
        } else {
            this.populate(this.prefill);
        }

        this.applyConditionals();
        this.dirty = false;

        const first = this._fields.find(f => f.autofocus)
            || this._fields.find(f => f.required && !DECORATIVE.has(f.type) && f.type !== 'hidden');
        if (first) this.el(first.name)?.focus();
    }

    html() {
        const t = this.schema.titles || {};
        const title = this.isEdit ? (t.edit || 'Modifica') : (t.create || 'Nuovo');

        return `
<div class="entity-edit-view ef-view" data-ef-entity="${esc(this.schema.entity)}">
    <div class="view-header">
        <div class="view-header__text">
            <h2 data-ef="title">${esc(title)}</h2>
            <p>${esc(this.schema.subtitle || '')}</p>
        </div>
    </div>

    <div class="alert" data-ef="alert" style="display:none;"></div>

    <div class="card ef-card">
        <form data-ef="form" novalidate>
            <input type="hidden" data-ef="id">
            ${this.schema.sections.map(s => renderSection(s, this.uid)).join('')}

            <div class="form-actions">
                <span class="ef-kbd-hint">Esc per uscire · <kbd>Ctrl</kbd>+<kbd>Invio</kbd> per salvare</span>
                <button type="button" class="btn btn--ghost" data-ef="cancel">Annulla</button>
                <button type="submit" class="btn btn--primary" data-ef="save">${this.isEdit ? 'Salva modifiche' : 'Crea'}</button>
            </div>
        </form>
    </div>
</div>`;
    }

    /* ---------------------------------------------------------------- bind */

    bind() {
        // Il modulo non ha più un suo "Indietro": si esce dalle briciole, dalla
        // freccia o dalla barra laterale, e il router chiede qui prima di farlo.
        if (window.App) window.App.setLeaveGuard(() => this.confirmLeave());
        this.mountEl.querySelector('[data-ef="cancel"]').addEventListener('click', () => this.leave());
        this.formEl.addEventListener('submit', (e) => { e.preventDefault(); this.save(); });

        this.formEl.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); this.leave(); }
            else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); this.save(); }
        });

        this.formEl.addEventListener('input', (e) => {
            this.dirty = true;
            const group = e.target.closest('[data-ef-field]');
            if (group) this.clearFieldError(group.dataset.efField);
            this.applyConditionals();
        });
        this.formEl.addEventListener('change', () => { this.dirty = true; this.applyConditionals(); });

        this._beforeUnload = (e) => {
            if (!this.dirty || this.saving) return;
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', this._beforeUnload);

        this.bindStars();
        this.bindPickers();
    }

    /** Da' la parola ai campi `custom`, una volta che il loro nodo esiste. */
    mountCustom() {
        this._fields.filter(f => f.type === 'custom' && typeof f.onMount === 'function').forEach(f => {
            const box = this.mountEl.querySelector(`[data-ef-custom="${CSS.escape(f.name)}"]`);
            if (box) f.onMount(box, this);
        });
    }

    bindStars() {
        this.mountEl.querySelectorAll('[data-ef-stars]').forEach(wrap => {
            const hidden = wrap.querySelector('input[type=hidden]');
            const paint = (v) => wrap.querySelectorAll('.ef-star').forEach(s => {
                const on = Number(s.dataset.value) <= v;
                s.textContent = on ? '★' : '☆';
                s.classList.toggle('is-on', on);
            });
            wrap.addEventListener('click', (e) => {
                const btn = e.target.closest('.ef-star, .ef-star-clear');
                if (!btn) return;
                hidden.value = btn.dataset.value;
                paint(Number(btn.dataset.value));
                this.dirty = true;
            });
            wrap._paint = paint;
            paint(0);
        });
    }

    bindPickers() {
        this.mountEl.querySelectorAll('[data-ef-picker]').forEach(input => {
            const name   = input.dataset.efPicker;
            const hidden = this.el(name);
            input.addEventListener('input', () => {
                const map = this._pickerIndex?.[name];
                const hit = map ? map.get(input.value.trim().toLowerCase()) : null;
                hidden.value = hit || '';
                this.dirty = true;
            });
        });
    }

    /* -------------------------------------------------------------- options */

    async loadOptions() {
        const sourced = this._fields.filter(f => f.source);
        if (!sourced.length) return;

        const keys = [...new Set(sourced.map(f => f.source))];
        const loaded = {};
        await Promise.all(keys.map(async k => {
            try { loaded[k] = await Lookups.load(k); }
            catch (err) { loaded[k] = null; this.alert(`Elenco "${k}" non caricato: ${err.message}`, 'warning'); }
        }));

        this._sourceData = loaded;
        this._pickerIndex = {};

        sourced.forEach(f => {
            const rows = loaded[f.source];
            if (!rows) return;
            const list = f.filter ? rows.filter(o => f.filter(o, this.record)) : rows;

            if (f.type === 'picker') {
                const dl = this.mountEl.querySelector(`#${this.uid}-${f.name}-list`);
                const index = new Map();
                if (dl) dl.innerHTML = list.map(o => `<option value="${esc(o.label)}"></option>`).join('');
                list.forEach(o => index.set(o.label.toLowerCase(), o.value));
                this._pickerIndex[f.name] = index;
                this._pickerLabels = this._pickerLabels || {};
                this._pickerLabels[f.name] = new Map(list.map(o => [o.value, o.label]));
            } else {
                const sel = this.el(f.name);
                if (!sel) return;
                const keep = sel.value;
                const empty = f.emptyLabel === false ? '' :
                    `<option value="">${esc(f.emptyLabel || '— Seleziona —')}</option>`;
                sel.innerHTML = empty + list.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
                if (keep) sel.value = keep;
            }
        });
    }

    /* --------------------------------------------------------------- record */

    async loadRecord() {
        const res  = await fetch(`${this.schema.api}${this.schema.api.includes('?') ? '&' : '?'}id=${encodeURIComponent(this.id)}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || `HTTP ${res.status}`);

        let data = json.data ?? json;
        if (Array.isArray(data)) data = data[0] || {};
        if (data && data.items) data = data.items[0] || {};

        this.record = this.schema.afterLoad ? (this.schema.afterLoad(data, this) || data) : data;
        this.populate(this.record);
    }

    el(name) { return this.formEl.querySelector(`[name="${CSS.escape(name)}"]`); }

    populate(data) {
        const idEl = this.mountEl.querySelector('[data-ef="id"]');
        if (idEl) idEl.value = data?.id ?? this.id ?? '';

        this._fields.forEach(f => {
            if (f.type === 'static') {
                const box = this.mountEl.querySelector(`[data-ef-static="${CSS.escape(f.name)}"]`);
                if (box) box.textContent = f.render ? f.render(data) : (data?.[f.name] ?? '—');
                return;
            }
            if (f.type === 'custom') {
                const box = this.mountEl.querySelector(`[data-ef-custom="${CSS.escape(f.name)}"]`);
                if (box && typeof f.onPopulate === 'function') f.onPopulate(box, data, this);
                return;
            }
            const el = this.el(f.name);
            if (!el) return;
            let v = data?.[f.name];

            if (f.type === 'file') {
                // A file input can't be given a value; list what is already
                // attached so the user knows re-picking is optional.
                const box = this.mountEl.querySelector(`[data-ef-files="${CSS.escape(f.name)}"]`);
                if (box) box.innerHTML = f.renderExisting ? f.renderExisting(data) : '';
                return;
            }
            if (f.type === 'checkbox') { el.checked = v === 1 || v === '1' || v === true; return; }
            if (f.type === 'yesno')    { el.value = (v === null || v === undefined || v === '') ? '' : String(Number(v) ? 1 : 0); return; }
            if (f.type === 'stars') {
                el.value = Number(v) || 0;
                const wrap = el.closest('[data-ef-stars]');
                if (wrap && wrap._paint) wrap._paint(Number(v) || 0);
                return;
            }
            if (f.type === 'datetime' && typeof v === 'string') v = v.replace(' ', 'T').slice(0, 16);
            if (f.type === 'date' && typeof v === 'string')     v = v.slice(0, 10);
            if (f.type === 'time' && typeof v === 'string')     v = v.slice(0, 5);

            el.value = (v === null || v === undefined) ? '' : String(v);

            if (f.type === 'picker') {
                const label = this._pickerLabels?.[f.name]?.get(String(v ?? ''));
                const txt = this.mountEl.querySelector(`#${this.uid}-${f.name}-text`);
                if (txt) txt.value = label || '';
            }
        });
    }

    serialize() {
        const out = {};
        this._fields.forEach(f => {
            // Files never travel in the JSON body; save() moves them into a
            // FormData alongside these scalars.
            if (DECORATIVE.has(f.type) || f.type === 'file') return;
            const el = this.el(f.name);
            if (!el) return;

            // A field hidden by `when` is not part of the record: sending its
            // stale value would resurrect data the user just made irrelevant.
            if (this.isHidden(f)) { out[f.name] = null; return; }

            if (f.type === 'checkbox') { out[f.name] = el.checked ? 1 : 0; return; }

            const raw = typeof el.value === 'string' ? el.value.trim() : el.value;

            if (raw === '') { out[f.name] = f.emptyAs !== undefined ? f.emptyAs : null; return; }
            if (NUMERIC.has(f.type) || f.type === 'yesno') {
                const n = Number(raw);
                out[f.name] = Number.isFinite(n) ? n : null;
                return;
            }
            out[f.name] = f.uppercase ? raw.toUpperCase() : raw;
        });
        return out;
    }

    /* ----------------------------------------------------------- conditional */

    isHidden(f) {
        const group = this.mountEl.querySelector(`[data-ef-field="${CSS.escape(f.name)}"]`);
        return !!(group && group.hidden);
    }

    applyConditionals() {
        const conditional = this._fields.filter(f => typeof f.when === 'function');
        if (!conditional.length) return;
        const snapshot = this.snapshotRaw();
        conditional.forEach(f => {
            const group = this.mountEl.querySelector(`[data-ef-field="${CSS.escape(f.name)}"]`);
            if (!group) return;
            const show = !!f.when(snapshot);
            if (group.hidden === !show) return;
            group.hidden = !show;
            if (!show) this.clearFieldError(f.name);
        });
    }

    /** Raw current values — used by `when` before any casting. */
    snapshotRaw() {
        const out = {};
        this._fields.forEach(f => {
            const el = this.el(f.name);
            if (!el) return;
            out[f.name] = f.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value;
        });
        return out;
    }

    /* ------------------------------------------------------------ validation */

    fieldError(name, msg) {
        const group = this.mountEl.querySelector(`[data-ef-field="${CSS.escape(name)}"]`);
        if (!group) return;
        group.classList.add('has-error');
        const p = group.querySelector('.ef-field-error');
        if (p) { p.textContent = msg; p.hidden = false; }
        // For a picker, this.el() is the hidden id input — marking that invalid
        // tells assistive tech nothing. Mark whatever the user can actually focus.
        const el = this.visibleEl(name);
        if (el) el.setAttribute('aria-invalid', 'true');
    }

    /** The control the user interacts with (a picker's text box, else the field). */
    visibleEl(name) {
        return this.mountEl.querySelector(`#${CSS.escape(this.uid + '-' + name)}-text`) || this.el(name);
    }

    clearFieldError(name) {
        const group = this.mountEl.querySelector(`[data-ef-field="${CSS.escape(name)}"]`);
        if (!group) return;
        group.classList.remove('has-error');
        const p = group.querySelector('.ef-field-error');
        if (p) { p.hidden = true; p.textContent = ''; }
        const el = this.visibleEl(name);
        if (el) el.removeAttribute('aria-invalid');
    }

    validateField(f, value, payload) {
        if (this.isHidden(f)) return null;

        const empty = value === null || value === undefined || value === '';
        if (f.required && empty) return `${f.label} è obbligatorio.`;
        if (empty) return null;

        if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value))) {
            return 'Indirizzo email non valido.';
        }
        if (f.type === 'url' && !/^https?:\/\/.+/i.test(String(value))) {
            return 'L\'indirizzo deve iniziare con http:// o https://.';
        }
        if (NUMERIC.has(f.type)) {
            const n = Number(value);
            if (!Number.isFinite(n)) return 'Inserisci un numero.';
            if (f.min !== undefined && n < f.min) return `Il valore minimo è ${f.min}.`;
            if (f.max !== undefined && n > f.max) return `Il valore massimo è ${f.max}.`;
            if (f.type === 'integer' && !Number.isInteger(n)) return 'Inserisci un numero intero.';
        }
        if (f.pattern && !new RegExp(f.pattern).test(String(value))) {
            return f.patternMessage || 'Formato non valido.';
        }
        if (f.maxlength && String(value).length > f.maxlength) {
            return `Massimo ${f.maxlength} caratteri.`;
        }
        if (typeof f.validate === 'function') return f.validate(value, payload) || null;
        return null;
    }

    validate(payload) {
        let firstBad = null;
        this._fields.forEach(f => {
            if (DECORATIVE.has(f.type) || f.type === 'hidden') return;
            this.clearFieldError(f.name);

            if (f.type === 'file') {
                // Required only on create: editing a record that already carries
                // an attachment must not force the user to re-upload it.
                const picked = this.el(f.name)?.files?.length;
                if (f.required && !picked && !this.isEdit && !this.isHidden(f)) {
                    this.fieldError(f.name, `${f.label} è obbligatorio.`);
                    if (!firstBad) firstBad = f.name;
                }
                return;
            }

            const msg = this.validateField(f, payload[f.name], payload);
            if (msg) { this.fieldError(f.name, msg); if (!firstBad) firstBad = f.name; }
        });

        // A picker whose text was typed but never matched an option would
        // otherwise save as "nothing selected" without telling anyone.
        this.mountEl.querySelectorAll('[data-ef-picker]').forEach(input => {
            const name = input.dataset.efPicker;
            if (input.value.trim() !== '' && !this.el(name).value) {
                this.fieldError(name, 'Seleziona una voce dall\'elenco oppure svuota il campo.');
                if (!firstBad) firstBad = name;
            }
        });

        return firstBad;
    }

    /* ----------------------------------------------------------------- save */

    async save() {
        if (this.saving) return;

        const payload = this.serialize();
        const firstBad = this.validate(payload);
        if (firstBad) {
            this.alert('Controlla i campi evidenziati.', 'error');
            this.focusField(firstBad);
            return;
        }

        if (this.schema.validate) {
            const msg = this.schema.validate(payload, this);
            if (msg) { this.alert(msg, 'error'); return; }
        }
        if (this.schema.beforeSave && this.schema.beforeSave(payload, this) === false) return;

        this.saving = true;
        const label = this.saveBtn.textContent;
        this.saveBtn.disabled = true;
        this.saveBtn.textContent = 'Salvataggio…';

        try {
            const url = this.isEdit
                ? `${this.schema.api}${this.schema.api.includes('?') ? '&' : '?'}id=${encodeURIComponent(this.id)}`
                : this.schema.api;

            // PHP only populates $_FILES for POST, so an upload on an existing
            // record posts with an explicit _method=PUT the endpoint reads back.
            const body = this.buildBody(payload);
            const isMultipart = body instanceof FormData;
            const res  = await fetch(url, {
                method:  (this.isEdit && !isMultipart) ? 'PUT' : 'POST',
                headers: isMultipart ? undefined : { 'Content-Type': 'application/json' },
                body,
            });
            const json = await res.json().catch(() => ({ success: false, error: `Risposta non valida (HTTP ${res.status})` }));
            if (!json.success) throw new Error(json.error || `HTTP ${res.status}`);

            // The new record must show up in the dropdowns of the next form.
            if (this.schema.invalidates) this.schema.invalidates.forEach(k => Lookups.invalidate(k));

            this.dirty = false;
            this.saving = false;
            if (this.onSaved) this.onSaved(json.data ?? json, this);
            else this.leave({ force: true });
        } catch (err) {
            this.saving = false;
            this.alert(err.message, 'error');
            this.saveBtn.disabled = false;
            this.saveBtn.textContent = label;
        }
    }

    /**
     * JSON by default; FormData as soon as the user actually picked a file.
     * An empty file input must NOT tip the request into multipart — endpoints
     * that only read php://input would silently receive an empty payload.
     */
    buildBody(payload) {
        const fileFields = this._fields.filter(f => f.type === 'file');
        const chosen = fileFields.filter(f => this.el(f.name)?.files?.length);
        if (!chosen.length) return JSON.stringify(payload);

        const fd = new FormData();
        Object.entries(payload).forEach(([k, v]) => fd.append(k, v === null || v === undefined ? '' : v));
        if (this.isEdit) { fd.append('id', this.id); fd.append('_method', 'PUT'); }
        chosen.forEach(f => {
            const input = this.el(f.name);
            const key = f.multiple ? `${f.name}[]` : f.name;
            [...input.files].forEach(file => fd.append(key, file));
        });
        return fd;
    }

    focusField(name) {
        const group = this.mountEl.querySelector(`[data-ef-field="${CSS.escape(name)}"]`);
        // Open the fold first, otherwise focus() on a display:none control is a no-op
        // and the user gets "controlla i campi evidenziati" pointing at nothing.
        const fold = group?.closest('details.form-section--fold');
        if (fold) fold.open = true;
        const el = this.visibleEl(name);
        if (el) { el.focus({ preventScroll: true }); }
        group?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    /* ---------------------------------------------------------------- exit */

    /** Ask before discarding edits. Shared by the exits below and the router. */
    confirmLeave() {
        if (!this.dirty) return true;
        return window.confirm('Ci sono modifiche non salvate. Vuoi uscire e perderle?');
    }

    leave(opts = {}) {
        if (!opts.force && !this.confirmLeave()) return;
        this.dirty = false;
        this.destroy();
        // Chiesto qui: il router non deve richiederlo una seconda volta.
        if (window.App) { window.App.setLeaveGuard(null); window.App.back(this.schema.listView); }
    }

    goToList() {
        this.dirty = false;
        this.destroy();
        if (window.App) window.App.navigateTo(this.schema.listView);
    }

    destroy() {
        if (this._beforeUnload) window.removeEventListener('beforeunload', this._beforeUnload);
    }

    /* --------------------------------------------------------------- alert */

    alert(msg, type = 'info') {
        if (!this.alertEl) return;
        this.alertEl.textContent = msg;
        this.alertEl.className = `alert alert--${type}`;
        this.alertEl.style.display = 'block';
        clearTimeout(this._alertT);
        if (type !== 'error') this._alertT = setTimeout(() => { this.alertEl.style.display = 'none'; }, 5000);
        this.alertEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

export default EntityForm;
