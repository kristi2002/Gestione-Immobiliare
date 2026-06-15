-- Phase 3 migration: Property Media gallery table
-- Run this if you already imported the Phase 1 schema.
-- Idempotent: safe to re-run.

USE gestione_immobiliare;

DROP PROCEDURE IF EXISTS _migration_phase3_property_media;

DELIMITER //

CREATE PROCEDURE _migration_phase3_property_media()
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name = 'property_media'
    ) THEN
        CREATE TABLE property_media (
            id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            property_id     INT UNSIGNED NOT NULL,
            media_type      ENUM('photo', 'video', 'floor_plan') NOT NULL DEFAULT 'photo',
            file_path       VARCHAR(500) NOT NULL,
            original_name   VARCHAR(255) NOT NULL,
            mime_type       VARCHAR(100) DEFAULT NULL,
            file_size       INT UNSIGNED DEFAULT NULL,
            sort_order      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
            created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

            CONSTRAINT fk_media_property
                FOREIGN KEY (property_id) REFERENCES properties(id)
                ON DELETE CASCADE
                ON UPDATE CASCADE,

            INDEX idx_media_property (property_id),
            INDEX idx_media_type (media_type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    END IF;
END //

DELIMITER ;

CALL _migration_phase3_property_media();
DROP PROCEDURE IF EXISTS _migration_phase3_property_media;
