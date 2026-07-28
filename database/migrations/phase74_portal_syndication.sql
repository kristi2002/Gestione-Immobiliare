-- phase74_portal_syndication.sql
-- Sindacazione portali: dizionario di mappatura tassonomie + provenienza riga.
--
-- Perche' una tabella e non costanti PHP: i portali rivedono le proprie liste
-- di codici per conto loro, e un cambio di codice deve essere una UPDATE, non
-- un rilascio. La STRUTTURA del feed (forma XML, annidamenti) resta invece
-- codice, in config/portal_specs.php: una tabella non sa esprimere "Idealista
-- annida gli optional sotto <features>, Immobiliare li mette piatti".
--
-- portal_listings.source separa le righe scritte a mano dall'agente da quelle
-- che un domani scrivera' il feed: la UI rende sola-lettura solo le seconde,
-- cosi' i due mondi convivono durante il rollout invece di scambiarsi errori.
--
-- Idempotente: colonne/tabelle create solo se mancanti, seed con INSERT IGNORE.

USE gestione_immobiliare;

-- --- Dizionario di mappatura -------------------------------------------------
CREATE TABLE IF NOT EXISTS `portal_field_map` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `portal`         ENUM('immobiliare','idealista','casa','subito','sito_agenzia','altro')
                   COLLATE utf8mb4_unicode_ci NOT NULL,
  `domain`         VARCHAR(40)  COLLATE utf8mb4_unicode_ci NOT NULL
                   COMMENT 'Colonna interna mappata: property_type, price_type, energy_class, ...',
  `internal_value` VARCHAR(60)  COLLATE utf8mb4_unicode_ci NOT NULL
                   COMMENT 'Valore come lo salva il gestionale',
  `external_value` VARCHAR(60)  COLLATE utf8mb4_unicode_ci NOT NULL
                   COMMENT 'Codice atteso dal portale',
  `notes`          VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_portal_domain_value` (`portal`, `domain`, `internal_value`),
  KEY `idx_portal_domain` (`portal`, `domain`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- Provenienza della riga di pubblicazione --------------------------------
SET @has_source := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'portal_listings' AND COLUMN_NAME = 'source'
);
SET @sql := IF(@has_source = 0,
    'ALTER TABLE portal_listings
       ADD COLUMN `source` ENUM(''manual'',''feed'') COLLATE utf8mb4_unicode_ci
       NOT NULL DEFAULT ''manual''
       COMMENT ''manual = compilata dall''''agente; feed = scritta dalla sindacazione''
       AFTER `status`',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- --- Seed tassonomie --------------------------------------------------------
-- ATTENZIONE: codici di partenza, NON verificati contro le specifiche
-- contrattuali dei portali (che si ottengono solo con l'account a pagamento).
-- Vanno riconciliati con il tracciato fornito in fase di onboarding: sono in
-- tabella proprio perche' li si corregge senza toccare il codice.
INSERT IGNORE INTO portal_field_map (portal, domain, internal_value, external_value, notes) VALUES
-- Immobiliare.it — tipologia
('immobiliare','property_type','appartamento','appartamento','Da riconciliare con il tracciato contrattuale'),
('immobiliare','property_type','villa','villa','Da riconciliare con il tracciato contrattuale'),
('immobiliare','property_type','ufficio','ufficio','Da riconciliare con il tracciato contrattuale'),
('immobiliare','property_type','negozio','negozio','Da riconciliare con il tracciato contrattuale'),
('immobiliare','property_type','box','box','Da riconciliare con il tracciato contrattuale'),
('immobiliare','property_type','terreno','terreno','Da riconciliare con il tracciato contrattuale'),
('immobiliare','property_type','altro','altro','Da riconciliare con il tracciato contrattuale'),
('immobiliare','price_type','vendita','vendita',NULL),
('immobiliare','price_type','affitto','affitto',NULL),
-- Idealista — tipologia (tassonomia inglese)
('idealista','property_type','appartamento','flat','Da riconciliare con il tracciato contrattuale'),
('idealista','property_type','villa','house','Da riconciliare con il tracciato contrattuale'),
('idealista','property_type','ufficio','office','Da riconciliare con il tracciato contrattuale'),
('idealista','property_type','negozio','premise','Da riconciliare con il tracciato contrattuale'),
('idealista','property_type','box','garage','Da riconciliare con il tracciato contrattuale'),
('idealista','property_type','terreno','land','Da riconciliare con il tracciato contrattuale'),
('idealista','property_type','altro','other','Da riconciliare con il tracciato contrattuale'),
('idealista','price_type','vendita','sale',NULL),
('idealista','price_type','affitto','rent',NULL);
