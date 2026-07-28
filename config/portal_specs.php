<?php
/**
 * Requisiti di pubblicazione per portale.
 *
 * Divisione voluta, da tenere:
 *   - QUI la STRUTTURA (quali campi servono, quante foto, quali soglie). E'
 *     codice: sta in git, si rilegge in diff, si testa.
 *   - in `portal_field_map` (DB) la TASSONOMIA (appartamento -> flat). E' dato:
 *     i portali rivedono le liste di codici quando vogliono e la correzione
 *     dev'essere una UPDATE, non un rilascio.
 *
 * A cosa serve: bloccare la pubblicazione PRIMA che parta, non dopo. Un
 * immobile senza classe energetica o con una foto sola viene scartato dal
 * portale ore dopo, dentro un feed di ritorno che nessuno legge; qui l'agente
 * lo sa subito e sa cosa manca.
 *
 * ⚠️ Le soglie sono una BASE RAGIONEVOLE, non le specifiche contrattuali dei
 * portali: quelle si ottengono solo con l'account a pagamento, in fase di
 * onboarding. Vanno riconciliate con il tracciato reale prima di annunciare
 * al cliente che la sindacazione e' attiva.
 */

/** Etichette italiane + dove si correggono, per messaggi utili all'agente. */
const PORTAL_FIELD_LABELS = [
    'listing_title'  => 'Titolo annuncio',
    'description'    => 'Descrizione',
    'address'        => 'Indirizzo',
    'city'           => 'Comune',
    'cap'            => 'CAP',
    'province'       => 'Provincia',
    'property_type'  => 'Tipologia',
    'price_type'     => 'Tipo contratto (vendita/affitto)',
    'price'          => 'Prezzo',
    'sqm'            => 'Superficie',
    'rooms'          => 'Locali',
    'bathrooms'      => 'Bagni',
    'floor'          => 'Piano',
    'energy_class'   => 'Classe energetica',
    'latitude'       => 'Posizione sulla mappa',
];

/**
 * `required`      — campi che devono essere valorizzati.
 * `min_photos`    — foto (media_type = 'photo') minime.
 * `require_floor_plan` — planimetria obbligatoria (media_type = 'floor_plan').
 * `map_domains`   — domini che DEVONO avere una riga in portal_field_map:
 *                   se manca la mappatura il feed spedirebbe un codice che il
 *                   portale non conosce, quindi e' un errore bloccante.
 */
const PORTAL_SPECS = [
    'immobiliare' => [
        'label'              => 'Immobiliare.it',
        'min_photos'         => 3,
        'require_floor_plan' => false,
        'required'           => [
            'listing_title', 'description', 'address', 'city', 'cap', 'province',
            'property_type', 'price_type', 'sqm', 'energy_class',
        ],
        'map_domains'        => ['property_type', 'price_type'],
    ],
    'idealista' => [
        'label'              => 'Idealista',
        'min_photos'         => 1,
        'require_floor_plan' => false,
        'required'           => [
            'listing_title', 'description', 'address', 'city', 'cap', 'province',
            'property_type', 'price_type', 'sqm', 'energy_class',
        ],
        'map_domains'        => ['property_type', 'price_type'],
    ],
    'casa' => [
        'label'              => 'Casa.it',
        'min_photos'         => 1,
        'require_floor_plan' => false,
        'required'           => [
            'description', 'address', 'city', 'cap', 'province',
            'property_type', 'price_type', 'sqm', 'energy_class',
        ],
        'map_domains'        => [],
    ],
    'subito' => [
        'label'              => 'Subito',
        'min_photos'         => 1,
        'require_floor_plan' => false,
        'required'           => ['description', 'city', 'property_type', 'price_type'],
        'map_domains'        => [],
    ],
    // Sito dell'agenzia: lo pubblichiamo noi, quindi nessun tracciato esterno
    // da rispettare. Resta un minimo di decenza editoriale.
    'sito_agenzia' => [
        'label'              => 'Sito agenzia',
        'min_photos'         => 1,
        'require_floor_plan' => false,
        'required'           => ['description', 'city', 'property_type', 'price_type'],
        'map_domains'        => [],
    ],
    // Destinazione generica: non sappiamo cosa pretenda, non inventiamo regole.
    'altro' => [
        'label'              => 'Altro',
        'min_photos'         => 0,
        'require_floor_plan' => false,
        'required'           => [],
        'map_domains'        => [],
    ],
];

/**
 * Classi energetiche ammesse. L'esenzione va dichiarata esplicitamente:
 * "campo vuoto" non e' un'esenzione, e' un dato mancante — ed e' esattamente
 * l'ambiguita' che fa scartare l'annuncio dal portale.
 */
const PORTAL_ENERGY_CLASSES = [
    'A4', 'A3', 'A2', 'A1', 'A', 'B', 'C', 'D', 'E', 'F', 'G',
    'ESENTE', 'IN_ATTESA',
];

/** Stati immobile che non possono stare su un portale come annuncio attivo. */
const PORTAL_UNPUBLISHABLE_PROPERTY_STATUS = ['sold', 'rented', 'archived'];

function portalSpec(string $portal): ?array
{
    return PORTAL_SPECS[$portal] ?? null;
}
