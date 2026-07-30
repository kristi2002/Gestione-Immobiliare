/**
 * Schema registry — the list of entities that have a schema-driven form page.
 *
 * Adding a form to the app:
 *   1. write ./<entity>.js exporting a schema (see suppliers.js for the shape)
 *   2. import it here and add it to REGISTRY
 *   3. add the entity to ENTITY_FORM_VIEWS in config/roles.php so the page is
 *      gated by the same role that gates its list view
 *   4. add its titles to App.entityFormTitles in assets/js/app.js so the topbar
 *      and the breadcrumb say the right thing
 *
 * No new view file, no new controller, no new route.
 */
import suppliers  from './suppliers.js';
import insurance  from './insurance.js';
import commissions from './commissions.js';
import keys       from './keys.js';
import buildings  from './buildings.js';
import aml        from './aml.js';
import valuation  from './valuation.js';
import applications from './applications.js';
import inventory  from './inventory.js';

// Keep this list, ENTITY_FORM_VIEWS in config/roles.php and
// App.entityFormTitles in assets/js/app.js in step: un'entita' presente qui ma
// non in roles.php e' 404 per tutti, che e' la direzione sicura.
const REGISTRY = {
    suppliers,
    insurance,
    commissions,
    keys,
    buildings,
    aml,
    valuation,
    applications,
    inventory,
};

export function getSchema(entity) {
    return Object.prototype.hasOwnProperty.call(REGISTRY, entity) ? REGISTRY[entity] : null;
}

export function listEntities() {
    return Object.keys(REGISTRY);
}

export default REGISTRY;
