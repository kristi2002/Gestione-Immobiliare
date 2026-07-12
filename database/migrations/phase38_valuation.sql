-- Phase 38 — OMI quotazioni (per-zone market values for the valuation engine)
-- Run once against the production DB:
--   mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" < database/migrations/phase38_valuation.sql

CREATE TABLE IF NOT EXISTS `omi_quotazioni` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `comune`         VARCHAR(100) NOT NULL COMMENT 'Comune',
  `cadastral_zone` VARCHAR(20)  NOT NULL DEFAULT '' COMMENT 'Zona OMI (es. B1)',
  `property_type`  ENUM('appartamento','villa','ufficio','negozio','box','terreno','altro')
                     NOT NULL DEFAULT 'appartamento',
  `price_min_sqm`  DECIMAL(10,2) DEFAULT NULL COMMENT 'Vendita €/m² min',
  `price_max_sqm`  DECIMAL(10,2) DEFAULT NULL COMMENT 'Vendita €/m² max',
  `rent_min_sqm`   DECIMAL(10,2) DEFAULT NULL COMMENT 'Affitto €/m²/mese min',
  `rent_max_sqm`   DECIMAL(10,2) DEFAULT NULL COMMENT 'Affitto €/m²/mese max',
  `period`         VARCHAR(10)  DEFAULT NULL COMMENT 'Semestre di riferimento (es. 2026-S1)',
  `notes`          VARCHAR(255) DEFAULT NULL,
  `created_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_omi_zone_type` (`comune`, `cadastral_zone`, `property_type`),
  KEY `idx_omi_comune` (`comune`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
