/**
 * entity_edit — controller for the generic form page.
 *
 * Reads { entity, id } off App.viewParams, looks the schema up in the registry
 * and hands it to EntityForm. Every schema-driven form in the app runs through
 * this file; there is no per-entity controller.
 */
import { EntityForm } from '../lib/entity_form.js';
import { getSchema, listEntities } from './schemas/index.js';

const root = document.getElementById('entity-edit-root');
if (root) {
    const vp     = window.App?.viewParams || {};
    const entity = String(vp.entity || '');
    const id     = vp.id ?? vp.recordId ?? null;

    const schema = getSchema(entity);

    if (!schema) {
        root.innerHTML = `
            <div class="view-header"><div class="view-header__text">
                <h2>Modulo non disponibile</h2>
                <p>La scheda richiesta non esiste.</p>
            </div></div>
            <div class="alert alert--error">
                Nessun modulo registrato per <strong>${entity ? entity.replace(/[<>&]/g, '') : '(nessuna entità)'}</strong>.
                Moduli disponibili: ${listEntities().join(', ')}.
            </div>`;
    } else {
        const form = new EntityForm(schema, {
            mount: root,
            id,
            // Everything not called `entity`/`id` is a prefill: opening the
            // polizza form from an immobile's scheda arrives as
            // { entity:'insurance', property_id: 12 } and lands in the field.
            prefill: Object.fromEntries(
                Object.entries(vp).filter(([k]) => k !== 'entity' && k !== 'id' && k !== 'recordId')
            ),
        });

        // Leaving the page by any route other than the form's own buttons
        // (sidebar click, browser Back) must still detach the unload guard.
        const teardown = () => {
            if (!root.isConnected) { form.destroy(); obs.disconnect(); }
        };
        const obs = new MutationObserver(teardown);
        obs.observe(document.getElementById('app-content') || document.body, { childList: true });

        form.mount().catch(err => {
            root.innerHTML = `<div class="alert alert--error">Errore nel modulo: ${String(err.message).replace(/[<>&]/g, '')}</div>`;
        });
    }
}
