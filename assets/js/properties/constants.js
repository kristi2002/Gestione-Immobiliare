/**
 * Properties — pure configuration constants.
 * Stateless singleton module: only `const`/`export`, no mutable state.
 */

export const API           = 'api/properties.php';
export const CLIENTS_API   = 'api/clients.php';
export const MEDIA_API     = 'api/property_media.php';
export const APPRAISAL_API = 'api/property_appraisals.php';
export const COMPARE_API   = 'api/property_comparison.php';
export const EXPORT_API    = 'api/property_export.php';

export const RATING_LABELS = {
    ottimo: 'Ottimo', buono: 'Buono', discreto: 'Discreto', da_ristrutturare: 'Da ristrutturare',
};

export const STATUS_LABELS = {
    available: 'Disponibile',
    rented:    'Affittato',
    sold:      'Venduto',
    archived:  'Archiviato',
};

export const MEDIA_LABELS = {
    photo:      'Foto',
    video:      'Video',
    floor_plan: 'Planimetria',
    house_map:  'Cartina casa',
    attachment: 'Allegato',
};

export const MEDIA_ACCEPT = {
    photo:      'image/jpeg,image/png,image/webp,image/gif',
    video:      'video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov',
    floor_plan: 'image/jpeg,image/png,image/webp',
    house_map:  'image/jpeg,image/png,image/webp',
};

export const COVER_MEDIA_TYPES = new Set(['photo', 'floor_plan', 'house_map']);

export const PAGE_LIMIT = 16;
