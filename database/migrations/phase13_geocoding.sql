-- Phase 13 — Geocoding: province + confidence metadata
-- Idempotent — safe to re-run.

USE gestione_immobiliare;

DROP PROCEDURE IF EXISTS _migration_phase13_geocoding;

DELIMITER //

CREATE PROCEDURE _migration_phase13_geocoding()
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'properties' AND COLUMN_NAME = 'province'
    ) THEN
        ALTER TABLE properties ADD COLUMN province VARCHAR(10) NULL AFTER cap;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'properties' AND COLUMN_NAME = 'geo_confidence'
    ) THEN
        ALTER TABLE properties ADD COLUMN geo_confidence ENUM('exact','street','cap_area') NULL AFTER longitude;
    END IF;
END //

DELIMITER ;

CALL _migration_phase13_geocoding();
DROP PROCEDURE IF EXISTS _migration_phase13_geocoding;
