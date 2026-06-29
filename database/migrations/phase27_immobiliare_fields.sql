-- Phase 27 — immobiliare.it-compatible property fields
-- Run once against the production DB:
--   mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" < database/migrations/phase27_immobiliare_fields.sql
-- (MySQL 8 has no "ADD COLUMN IF NOT EXISTS"; run this only once.)

ALTER TABLE `properties`
  ADD COLUMN `locali`          SMALLINT UNSIGNED DEFAULT NULL COMMENT 'Numero locali (immobiliare.it)' AFTER `rooms`,
  ADD COLUMN `total_floors`    SMALLINT UNSIGNED DEFAULT NULL COMMENT 'Piani totali edificio' AFTER `floor`,
  ADD COLUMN `energy_class`    VARCHAR(10)  DEFAULT NULL COMMENT 'Classe energetica (A4..G, esente)' AFTER `year_built`,
  ADD COLUMN `heating`         VARCHAR(20)  DEFAULT NULL COMMENT 'Riscaldamento: autonomo/centralizzato/assente',
  ADD COLUMN `elevator`        TINYINT(1)   DEFAULT NULL COMMENT 'Ascensore 0/1',
  ADD COLUMN `furnished`       VARCHAR(20)  DEFAULT NULL COMMENT 'Arredato: no/si/parziale',
  ADD COLUMN `balconies`       SMALLINT UNSIGNED DEFAULT NULL COMMENT 'Numero balconi',
  ADD COLUMN `terraces`        SMALLINT UNSIGNED DEFAULT NULL COMMENT 'Numero terrazzi',
  ADD COLUMN `garden`          VARCHAR(20)  DEFAULT NULL COMMENT 'Giardino: no/privato/comune',
  ADD COLUMN `parking_spaces`  SMALLINT UNSIGNED DEFAULT NULL COMMENT 'Posti auto / box',
  ADD COLUMN `condition_state` VARCHAR(30)  DEFAULT NULL COMMENT 'Stato: nuovo/ottimo/buono/da_ristrutturare',
  ADD COLUMN `exposure`        VARCHAR(60)  DEFAULT NULL COMMENT 'Esposizione',
  ADD COLUMN `condo_fees`      DECIMAL(10,2) DEFAULT NULL COMMENT 'Spese condominiali mensili (EUR)',
  ADD COLUMN `reference_code`  VARCHAR(50)  DEFAULT NULL COMMENT 'Riferimento annuncio';
