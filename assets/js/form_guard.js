/**
 * form_guard.js — the three things every long edit form got wrong.
 *
 * Loaded globally (classic script, like format.js / confirm.js) because the
 * hand-written *_edit pages are classic scripts and cannot `import`. The
 * schema-driven pages get the same behaviour built into
 * assets/js/lib/entity_form.js.
 *
 * 1. reportError() — the immobile form is ~4000px tall and its save button is
 *    pinned to the bottom of the viewport. The error box lived at the END of the
 *    form markup, so submitting from anywhere above the last section painted the
 *    message off-screen: the user clicked Salva, nothing appeared to happen, and
 *    the record was not saved. The message now scrolls itself into view.
 *
 * 2. guardUnsaved() — none of the forms warned before discarding a half-filled
 *    record. One stray click on the sidebar and forty fields were gone.
 *
 * 3. keepSelected() — the owner/agent dropdowns are loaded with status=active
 *    only, and the controllers then did `select.value = savedId`. When the saved
 *    owner had since been deactivated that option did not exist, the assignment
 *    silently left the select on "", and the next save wrote client_id: "" —
 *    quietly unassigning the owner of an immobile just because someone opened
 *    its form. The record's own value is now always present as an option.
 */
(function () {
    'use strict';

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    }

    window.FormGuard = {
        /**
         * Show a blocking error and make sure the user actually sees it.
         * Returns the element so callers can keep chaining.
         */
        reportError(el, message) {
            if (!el) return null;
            el.textContent = message;
            el.style.display = 'block';
            el.setAttribute('role', 'alert');
            // 'center' rather than 'nearest': the sticky action bar overlays the
            // bottom of the scroller, and 'nearest' happily parks the message
            // underneath it.
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return el;
        },

        clearError(el) {
            if (!el) return;
            el.style.display = 'none';
            el.textContent = '';
        },

        /**
         * Warn before losing unsaved edits.
         *   form    — the <form> to watch
         *   opts.isSaving — () => bool, so a save in flight doesn't prompt
         * Returns { isDirty(), markClean(), confirmLeave(), detach() }.
         * confirmLeave() is what "Indietro"/"Annulla"/Esc should call.
         */
        guardUnsaved(form, opts) {
            const o = opts || {};
            let dirty = false;

            const touch = () => { dirty = true; };
            form.addEventListener('input', touch);
            form.addEventListener('change', touch);

            const onUnload = (e) => {
                if (!dirty || (o.isSaving && o.isSaving())) return;
                e.preventDefault();
                e.returnValue = '';
            };
            window.addEventListener('beforeunload', onUnload);

            // The SPA swaps #app-content instead of unloading the document, so
            // beforeunload never fires on an in-app navigation. Detach when the
            // form leaves the DOM so the guard can't outlive its page and start
            // blocking unrelated reloads.
            const host = document.getElementById('app-content');
            let obs = null;
            if (host) {
                obs = new MutationObserver(() => {
                    if (!form.isConnected) { window.removeEventListener('beforeunload', onUnload); obs.disconnect(); }
                });
                obs.observe(host, { childList: true });
            }

            return {
                isDirty: () => dirty,
                markClean() { dirty = false; },
                confirmLeave() {
                    if (!dirty) return true;
                    return window.confirm('Ci sono modifiche non salvate. Vuoi uscire e perderle?');
                },
                detach() {
                    window.removeEventListener('beforeunload', onUnload);
                    if (obs) obs.disconnect();
                },
            };
        },

        /**
         * Select `value` in `select`, adding the option first when the loaded
         * list does not contain it (a deactivated/archived record). `label` is
         * used for the synthesised option; when omitted the caller can pass a
         * fetcher that resolves one.
         *
         * Without this the assignment is a silent no-op and the field reads as
         * "nothing selected", which the next save then persists.
         */
        keepSelected(select, value, label) {
            if (!select || value === null || value === undefined || value === '') return false;
            const v = String(value);
            const has = [...select.options].some(o => o.value === v);
            if (!has) {
                const opt = document.createElement('option');
                opt.value = v;
                opt.textContent = (label ? label : `#${v}`) + ' — non più attivo';
                opt.dataset.inactive = '1';
                // First position after the placeholder so it is visible, not
                // buried at the end of a 400-row list.
                select.insertBefore(opt, select.options[1] || null);
            }
            select.value = v;
            return !has;
        },

        /**
         * Fetch a single record by id from a CRUD endpoint and hand back a label.
         * Used to give keepSelected() a real name instead of "#42".
         */
        async labelFor(api, id, toLabel) {
            try {
                const res  = await fetch(`${api}${api.includes('?') ? '&' : '?'}id=${encodeURIComponent(id)}`);
                const json = await res.json();
                if (!json.success) return null;
                let d = json.data ?? json;
                if (Array.isArray(d)) d = d[0];
                if (d && d.items) d = d.items[0];
                return d ? toLabel(d) : null;
            } catch (_) {
                return null;
            }
        },

        /**
         * Enforce `required` on the controls the browser refuses to check.
         *
         * datepicker.js sets readOnly on every input[type=date] to suppress the
         * native picker and the mobile keyboard — which also bars the control
         * from HTML constraint validation. `required` on a date is therefore
         * decorative everywhere in this app, and no `invalid` event ever fires
         * for one. (min/max still hold: the calendar greys out-of-range days,
         * and setValue() clamps.)
         *
         * Returns the first offending element, or null.
         */
        checkReadonlyRequired(form) {
            const bad = [...form.querySelectorAll('input[required][readonly]')]
                .find(el => String(el.value || '').trim() === '');
            if (!bad) return null;
            this.revealField(bad);
            bad.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return bad;
        },

        /** The visible label text for a control, for use in an error message. */
        labelOf(el) {
            const lab = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
            return (lab ? lab.textContent : '').replace('*', '').trim() || 'Il campo';
        },

        /**
         * Make a control reachable before focusing or complaining about it:
         * a field inside a closed <details> can't be focused and its error
         * message renders inside a collapsed box.
         */
        revealField(el) {
            if (!el) return;
            let d = el.closest('details');
            while (d) { d.open = true; d = d.parentElement && d.parentElement.closest('details'); }
        },

        /**
         * Open every collapsed section that already holds data.
         *
         * Progressive disclosure is only honest if it hides *empty* things. An
         * immobile that has catasto data filed against it must not open with the
         * Dati catastali section shut — the user would read the closed section as
         * "nothing here" and, worse, never notice a stale value.
         *
         * Call AFTER populating the form from the record.
         */
        autoOpenFilled(root) {
            (root || document).querySelectorAll('details.form-section--fold').forEach(d => {
                if (d.open) return;
                const filled = [...d.querySelectorAll('input, select, textarea')].some(c => {
                    if (c.type === 'hidden' || c.disabled) return false;
                    if (c.type === 'checkbox' || c.type === 'radio') return c.checked;
                    if (c.tagName === 'SELECT') return c.value !== '' && c.selectedIndex > 0;
                    return String(c.value || '').trim() !== '';
                });
                if (filled) {
                    d.open = true;
                    d.classList.add('is-auto-opened');
                }
            });
        },

        /**
         * Count the fields in each collapsed section and print it in the summary,
         * so a shut section still says how much is inside it.
         */
        labelFolds(root) {
            (root || document).querySelectorAll('details.form-section--fold > summary .ef-fold-meta').forEach(meta => {
                if (meta.dataset.counted) return;
                const d = meta.closest('details');
                const n = d.querySelectorAll('input:not([type=hidden]), select, textarea').length;
                const base = meta.textContent.trim();
                meta.textContent = (base ? base + ' · ' : '') + `${n} camp${n === 1 ? 'o' : 'i'}`;
                meta.dataset.counted = '1';
            });
        },

        esc,
    };
})();
