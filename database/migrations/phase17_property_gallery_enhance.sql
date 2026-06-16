-- Phase 17: Property gallery enhancements (cover photo, new media types)
-- Idempotent: safe to re-run.

USE gestione_immobiliare;

DROP PROCEDURE IF EXISTS _migration_phase17_property_gallery;

DELIMITER //

CREATE PROCEDURE _migration_phase17_property_gallery()
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'properties'
          AND column_name = 'cover_media_id'
    ) THEN
        ALTER TABLE properties
            ADD COLUMN cover_media_id INT UNSIGNED DEFAULT NULL AFTER status,
            ADD INDEX idx_properties_cover_media (cover_media_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = DATABASE()
          AND table_name = 'properties'
          AND constraint_name = 'fk_properties_cover_media'
    ) THEN
        ALTER TABLE properties
            ADD CONSTRAINT fk_properties_cover_media
                FOREIGN KEY (cover_media_id) REFERENCES property_media(id)
                ON DELETE SET NULL
                ON UPDATE CASCADE;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'property_media'
          AND column_name = 'media_type'
          AND column_type NOT LIKE '%house_map%'
    ) THEN
        ALTER TABLE property_media
            MODIFY media_type ENUM(
                'photo', 'video', 'floor_plan', 'house_map', 'attachment'
            ) NOT NULL DEFAULT 'photo';
    END IF;
END //

DELIMITER ;

CALL _migration_phase17_property_gallery();
DROP PROCEDURE IF EXISTS _migration_phase17_property_gallery;
