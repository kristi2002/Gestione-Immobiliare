-- Phase 23 — Extend documents.doc_type ENUM for identity card front/back
-- Allows uploading fronte/retro carta di identità via the proprietari edit modal.

DROP PROCEDURE IF EXISTS _migration_phase23;
DELIMITER $$
CREATE PROCEDURE _migration_phase23()
BEGIN
    ALTER TABLE documents
        MODIFY COLUMN doc_type
            ENUM('invoice','contract','id','id_front','id_back','other')
            NOT NULL DEFAULT 'other';
END$$
DELIMITER ;
CALL _migration_phase23();
DROP PROCEDURE IF EXISTS _migration_phase23;
