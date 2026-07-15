/**
 * Contracts — constants (stateless config)
 */

export const API            = 'api/contracts.php';
export const PROPERTIES_API = 'api/properties.php';
export const TENANTS_API    = 'api/tenants.php';
export const CLIENTS_API    = 'api/clients.php';
export const ESIGN_API      = 'api/esign.php';

export const TYPE_LABELS = {
    locazione:     'Locazione',
    compravendita: 'Compravendita',
    preliminare:   'Preliminare',
    mandato:       'Mandato',
    altro:         'Altro',
};

export const STATUS_LABELS = {
    draft:     'Bozza',
    sent:      'Inviato',
    signed:    'Firmato',
    active:    'Attivo',
    expired:   'Scaduto',
    cancelled: 'Annullato',
};

export const STATUS_FLOW = ['draft', 'sent', 'signed'];

export const PAGE_LIMIT = 25;
