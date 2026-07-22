/**
 * Leads — pure top-level config constants. Stateless.
 */

export const API = 'api/leads.php';

export const STATUS_LABELS = {
    new: 'Nuovo', contacted: 'Contattato', interested: 'Interessato',
    negotiating: 'In trattativa', converted: 'Convertito', lost: 'Perso',
};

// Pipeline column order for the kanban board ('lost' is intentionally
// excluded — persi leads are reachable via the grid view / status filter).
export const KANBAN_ORDER = ['new', 'contacted', 'interested', 'negotiating', 'converted'];

export const INTEREST_LABELS = { affitto: 'Affitto', acquisto: 'Acquisto', entrambi: 'Entrambi' };

export const SOURCE_LABELS = {
    telefono: 'Telefono', email: 'Email', web: 'Web',
    passaparola: 'Passaparola', social: 'Social', altro: 'Altro',
    immobiliare: 'Immobiliare.it', idealista: 'Idealista', casa: 'Casa.it', subito: 'Subito',
};

export const PAGE_LIMIT = 25;
