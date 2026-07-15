/**
 * Scheda Cliente — pure config constants (stateless).
 */

export const API       = 'api/clients.php';
export const PROPS_API = 'api/properties.php';
export const DOCS_API  = 'api/documents.php';
export const COMM_API  = 'api/communications.php';
export const REM_API   = 'api/reminders.php';
export const RPT_API   = 'api/generate_owner_report.php';
export const INV_API   = 'api/invoices.php';
export const CONT_API  = 'api/contracts.php';

export const STATUS_LABELS = { active: 'Attivo', inactive: 'Inattivo', archived: 'Archiviato' };
export const FREQ_LABELS   = { once: 'Una volta', weekly: 'Settimanale', biweekly: 'Quindicinale', monthly: 'Mensile', quarterly: 'Trimestrale', yearly: 'Annuale' };
export const PROP_STATUS   = { available: 'Disponibile', rented: 'Affittato', sold: 'Venduto', maintenance: 'Manutenzione', archived: 'Archiviato' };
export const PROP_COLOR    = { available: '#16a34a', rented: '#2563eb', sold: '#7c3aed', maintenance: '#d97706', archived: '#94a3b8' };
export const DOC_ICONS     = { pdf: '<i data-lucide="file-text"></i>', doc: '<i data-lucide="file-pen"></i>', docx: '<i data-lucide="file-pen"></i>', jpg: '<i data-lucide="image"></i>', jpeg: '<i data-lucide="image"></i>', png: '<i data-lucide="image"></i>', webp: '<i data-lucide="image"></i>' };
export const REM_ICONS     = { pending: '<i data-lucide="clock"></i>', completed: '<i data-lucide="check-circle"></i>', cancelled: '<i data-lucide="x-circle"></i>' };
