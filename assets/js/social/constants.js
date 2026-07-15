/**
 * Social Media controller — static config (stateless).
 */

export const POSTS_API      = 'api/social_posts.php';
export const SETTINGS_API   = 'api/social_settings.php';
export const PUBLISH_API    = 'api/publish_social_posts.php';
export const PROPERTIES_API = 'api/properties.php';
export const MEDIA_API      = 'api/property_media.php';

export const PLATFORM_LABELS = {
    facebook:  'Facebook',
    instagram: 'Instagram',
    both:      'FB + IG',
};

export const STATUS_LABELS = {
    draft:     'Bozza',
    scheduled: 'Programmato',
    published: 'Pubblicato',
    failed:    'Fallito',
};

export const PAGE_LIMIT = 25;
