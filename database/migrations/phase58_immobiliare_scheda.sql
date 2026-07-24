-- phase58_immobiliare_scheda.sql
-- Allineamento 1:1 alla scheda "Descrizione immobile" di immobiliare.it.
-- Il cliente (Orlandi) lavora con immobiliare.it: il form immobili deve
-- replicare la loro scheda di inserimento, e il feed (api/property_export.php)
-- deve poter esportare gli stessi campi senza mapping con perdita.
--
-- Tutte le colonne sono NULLABLE (tranne price_on_request, default 0): la
-- scheda immobiliare.it non obbliga nessuno di questi campi e gli immobili
-- esistenti non devono diventare invalidi.
--
-- property_type resta l'enum "gruppo" (appartamento/villa/...) perche' il
-- matching lead (leads.preferred_type) confronta quei valori; la tipologia
-- fine di immobiliare.it vive nella nuova colonna `typology`.
--
-- Idempotente: usa migration_add_column/migration_add_index (000_helpers.sql).

USE gestione_immobiliare;

-- ── Tipologia ────────────────────────────────────────────────────────────────
CALL migration_add_column('properties', 'category',              'VARCHAR(30) NULL AFTER property_type');
CALL migration_add_column('properties', 'typology',              'VARCHAR(60) NULL AFTER category');

-- ── Contratto, prezzo e costi di gestione ────────────────────────────────────
CALL migration_add_column('properties', 'ownership_type',        'VARCHAR(30) NULL');
CALL migration_add_column('properties', 'price_on_request',      'TINYINT(1) NOT NULL DEFAULT 0');
CALL migration_add_column('properties', 'heating_costs',         'DECIMAL(10,2) NULL');
CALL migration_add_column('properties', 'is_vacant',             'TINYINT(1) NULL');
CALL migration_add_column('properties', 'rent_to_own',           'TINYINT(1) NULL');
CALL migration_add_column('properties', 'investment_property',   'TINYINT(1) NULL');

-- ── Composizione ─────────────────────────────────────────────────────────────
CALL migration_add_column('properties', 'other_rooms',           'SMALLINT UNSIGNED NULL');
CALL migration_add_column('properties', 'kitchen_type',          'VARCHAR(30) NULL');
CALL migration_add_column('properties', 'garage_type',           'VARCHAR(30) NULL');
CALL migration_add_column('properties', 'wardrobes',             'TINYINT(1) NULL');
CALL migration_add_column('properties', 'cellar',                'TINYINT(1) NULL');
CALL migration_add_column('properties', 'attic_room',            'TINYINT(1) NULL');
CALL migration_add_column('properties', 'tavern',                'TINYINT(1) NULL');
CALL migration_add_column('properties', 'armored_door',          'TINYINT(1) NULL');
CALL migration_add_column('properties', 'alarm_system',          'TINYINT(1) NULL');
CALL migration_add_column('properties', 'electric_gate',         'TINYINT(1) NULL');
CALL migration_add_column('properties', 'video_intercom',        'TINYINT(1) NULL');
CALL migration_add_column('properties', 'optical_fiber',         'TINYINT(1) NULL');
CALL migration_add_column('properties', 'fireplace',             'TINYINT(1) NULL');
CALL migration_add_column('properties', 'jacuzzi',               'TINYINT(1) NULL');
CALL migration_add_column('properties', 'pool',                  'TINYINT(1) NULL');
CALL migration_add_column('properties', 'tennis_court',          'TINYINT(1) NULL');
CALL migration_add_column('properties', 'window_frames',         'VARCHAR(40) NULL');
CALL migration_add_column('properties', 'tv_system',             'VARCHAR(30) NULL');
CALL migration_add_column('properties', 'concierge',             'VARCHAR(30) NULL');

-- ── Caratteristiche ──────────────────────────────────────────────────────────
CALL migration_add_column('properties', 'property_class',        'VARCHAR(20) NULL');
CALL migration_add_column('properties', 'multi_level',           'TINYINT(1) NULL');
CALL migration_add_column('properties', 'disabled_access',       'TINYINT(1) NULL');
CALL migration_add_column('properties', 'free_sides',            'TINYINT UNSIGNED NULL');
CALL migration_add_column('properties', 'overlooking',           'VARCHAR(40) NULL');
CALL migration_add_column('properties', 'heating_system',        'VARCHAR(30) NULL');
CALL migration_add_column('properties', 'heating_fuel',          'VARCHAR(30) NULL');
CALL migration_add_column('properties', 'air_conditioning',      'VARCHAR(30) NULL');
CALL migration_add_column('properties', 'air_conditioning_type', 'VARCHAR(30) NULL');

-- ── Dati catastali (integrazione) ────────────────────────────────────────────
CALL migration_add_column('properties', 'cadastral_sezione',     'VARCHAR(20) NULL');
CALL migration_add_column('properties', 'ownership_share',       'VARCHAR(50) NULL');
CALL migration_add_column('properties', 'cadastral_other',       'TEXT NULL');

-- ── Descrizione per i portali ────────────────────────────────────────────────
CALL migration_add_column('properties', 'listing_title',         'VARCHAR(255) NULL');

-- ── Dati intermediazione ─────────────────────────────────────────────────────
CALL migration_add_column('properties', 'agent_id',              'INT UNSIGNED NULL');
CALL migration_add_column('properties', 'collaboration',         'VARCHAR(30) NULL');
CALL migration_add_column('properties', 'mandate_type',          'VARCHAR(30) NULL');

CALL migration_add_index('properties', 'idx_properties_agent', '`agent_id`');

-- FK agente → admin_users (SET NULL alla rimozione dell'utente).
SET @fk := (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'properties'
      AND CONSTRAINT_NAME = 'fk_properties_agent'
);
SET @sql := IF(@fk = 0,
    'ALTER TABLE properties ADD CONSTRAINT fk_properties_agent FOREIGN KEY (agent_id) REFERENCES admin_users(id) ON DELETE SET NULL ON UPDATE CASCADE',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── Superficie: righe multiple con calcolo commerciale ───────────────────────
-- Replica la tabella "Superficie" della scheda: consistenza, piano, m²,
-- conteggio %, commerciale (m² * %), flag accessoria. properties.sqm viene
-- sincronizzato dall'API col totale commerciale quando esistono righe.
CREATE TABLE IF NOT EXISTS property_surfaces (
    id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_id    INT UNSIGNED NOT NULL,
    surface_type   VARCHAR(40)  NOT NULL DEFAULT 'abitazione',
    floor_label    VARCHAR(40)  DEFAULT NULL,
    sqm            DECIMAL(8,2) NOT NULL DEFAULT 0,
    weight_percent DECIMAL(5,1) NOT NULL DEFAULT 100.0,
    commercial_sqm DECIMAL(8,2) NOT NULL DEFAULT 0,
    is_accessory   TINYINT(1)   NOT NULL DEFAULT 0,
    sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_surfaces_property FOREIGN KEY (property_id)
        REFERENCES properties(id) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_surfaces_property (property_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Descrizioni multilingua per i portali ────────────────────────────────────
-- L'italiano resta il master su properties.listing_title/description; qui le
-- altre lingue della scheda (EN/DE/FR/ES/PT/RU/EL).
CREATE TABLE IF NOT EXISTS property_descriptions (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_id INT UNSIGNED NOT NULL,
    lang        CHAR(2)      NOT NULL,
    title       VARCHAR(255) DEFAULT NULL,
    description TEXT         DEFAULT NULL,
    updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_propdesc_lang (property_id, lang),
    CONSTRAINT fk_propdesc_property FOREIGN KEY (property_id)
        REFERENCES properties(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
