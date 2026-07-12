-- Phase 35 — Fiscal & legal property data, SEPA mandates, portal sync
-- Run once against the production DB:
--   mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" < database/migrations/phase35_fiscal_property.sql
-- (MySQL 8 has no "ADD COLUMN IF NOT EXISTS"; run this only once.)

-- --- Dati catastali (structured) + APE tracking on properties -----------------
ALTER TABLE `properties`
  ADD COLUMN `cadastral_comune`     VARCHAR(100) DEFAULT NULL COMMENT 'Comune catastale' AFTER `reference_code`,
  ADD COLUMN `cadastral_foglio`     VARCHAR(20)  DEFAULT NULL COMMENT 'Foglio',
  ADD COLUMN `cadastral_particella` VARCHAR(20)  DEFAULT NULL COMMENT 'Particella / mappale',
  ADD COLUMN `cadastral_subalterno` VARCHAR(20)  DEFAULT NULL COMMENT 'Subalterno',
  ADD COLUMN `cadastral_category`   VARCHAR(10)  DEFAULT NULL COMMENT 'Categoria catastale (A/2, C/6 ...)',
  ADD COLUMN `cadastral_class`      VARCHAR(10)  DEFAULT NULL COMMENT 'Classe catastale',
  ADD COLUMN `cadastral_rendita`    DECIMAL(12,2) DEFAULT NULL COMMENT 'Rendita catastale (EUR)',
  ADD COLUMN `cadastral_zone`       VARCHAR(20)  DEFAULT NULL COMMENT 'Zona OMI',
  ADD COLUMN `ape_number`           VARCHAR(50)  DEFAULT NULL COMMENT 'Numero attestato APE',
  ADD COLUMN `ape_issue_date`       DATE         DEFAULT NULL COMMENT 'Data rilascio APE',
  ADD COLUMN `ape_expiry_date`      DATE         DEFAULT NULL COMMENT 'Scadenza APE (10 anni)',
  ADD COLUMN `ipe_value`            DECIMAL(8,2) DEFAULT NULL COMMENT 'Indice prestazione energetica kWh/m2a';

ALTER TABLE `properties`
  ADD KEY `idx_properties_ape_expiry` (`ape_expiry_date`);

-- --- SEPA / SDD (addebito diretto) on tenants ---------------------------------
ALTER TABLE `tenants`
  ADD COLUMN `iban`             VARCHAR(34) DEFAULT NULL COMMENT 'IBAN per addebito diretto SEPA',
  ADD COLUMN `sdd_mandate_ref`  VARCHAR(35) DEFAULT NULL COMMENT 'Riferimento mandato SDD (UMR)',
  ADD COLUMN `sdd_mandate_date` DATE        DEFAULT NULL COMMENT 'Data firma mandato SDD';

-- --- Payment method on rent payments -----------------------------------------
ALTER TABLE `payments`
  ADD COLUMN `method` ENUM('bonifico','sdd','mav','contanti','assegno','pos','stripe','altro')
      NOT NULL DEFAULT 'bonifico' COMMENT 'Metodo di pagamento' AFTER `status`;

-- --- Portal listing sync state (immobiliare.it, idealista, ...) ---------------
CREATE TABLE IF NOT EXISTS `portal_listings` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `property_id`    INT UNSIGNED NOT NULL,
  `portal`         ENUM('immobiliare','idealista','casa','subito','sito_agenzia','altro')
                     NOT NULL DEFAULT 'immobiliare',
  `status`         ENUM('draft','publishing','published','error','removed')
                     NOT NULL DEFAULT 'draft',
  `external_id`    VARCHAR(100) DEFAULT NULL COMMENT 'ID annuncio sul portale',
  `external_url`   VARCHAR(500) DEFAULT NULL,
  `last_synced_at` DATETIME     DEFAULT NULL,
  `error_message`  VARCHAR(500) DEFAULT NULL,
  `notes`          TEXT         DEFAULT NULL,
  `created_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_portal_property` (`property_id`, `portal`),
  KEY `idx_portal_status` (`status`),
  CONSTRAINT `fk_portal_property` FOREIGN KEY (`property_id`)
      REFERENCES `properties` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
