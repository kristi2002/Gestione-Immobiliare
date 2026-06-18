-- Phase 21: Fix missing foreign keys and add invoice→property link
-- Idempotent — safe to re-run.

USE gestione_immobiliare;

DROP PROCEDURE IF EXISTS _migration_phase21;
DELIMITER //
CREATE PROCEDURE _migration_phase21()
BEGIN
    -- 1. Add property_id to invoices so fatture can be linked to a specific property
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices' AND COLUMN_NAME = 'property_id'
    ) THEN
        ALTER TABLE invoices
            ADD COLUMN property_id INT UNSIGNED NULL AFTER lead_id,
            ADD CONSTRAINT fk_invoices_property
                FOREIGN KEY (property_id) REFERENCES properties(id)
                ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    -- 2. Add foreign key on property_applications.property_id if missing
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'property_applications'
          AND CONSTRAINT_NAME = 'fk_pa_property'
    ) THEN
        -- Only add FK if column exists
        IF EXISTS (
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'property_applications' AND COLUMN_NAME = 'property_id'
        ) THEN
            ALTER TABLE property_applications
                ADD CONSTRAINT fk_pa_property
                    FOREIGN KEY (property_id) REFERENCES properties(id)
                    ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
    END IF;
END //
DELIMITER ;
CALL _migration_phase21();
DROP PROCEDURE IF EXISTS _migration_phase21;
