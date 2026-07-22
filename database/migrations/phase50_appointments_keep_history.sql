-- phase50_appointments_keep_history.sql
-- Stop a property delete from CASCADE-wiping visit history.
--
-- appointments.property_id was ON DELETE CASCADE, so removing a property also
-- silently deleted every appointment ever held there — including completed
-- visits linked to leads/clients that the agency may need as history. Every
-- comparable child table (agent_commissions, tenant_surveys, expenses, ...)
-- uses SET NULL for exactly this reason.
--
-- The column was NOT NULL, so it is made nullable first, then the FK is
-- recreated as ON DELETE SET NULL. New appointments still require a property
-- at the API layer (api/appointments.php validation) — only deletion of the
-- property detaches, rather than destroys, its past appointments. The API list
-- queries were switched from INNER to LEFT JOIN in the same commit so detached
-- rows stay visible.
--
-- Same guarded + idempotent pattern as phase48/phase49. The USE line is
-- stripped by the migration runner; DATABASE() resolves to the connected
-- schema, prod or dev, whatever it is named.

USE gestione_immobiliare;

-- 1) Make property_id nullable (no-op if already nullable).
SET @is_nullable := (
    SELECT IS_NULLABLE FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'appointments' AND column_name = 'property_id'
);
SET @sql := IF(@is_nullable = 'NO',
    'ALTER TABLE appointments MODIFY property_id INT UNSIGNED NULL',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 2) Swap the FK CASCADE -> SET NULL, only if the current rule is CASCADE.
SET @rule := (
    SELECT DELETE_RULE FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'appointments' AND constraint_name = 'fk_appt_property'
);
SET @sql := IF(@rule = 'CASCADE',
    'ALTER TABLE appointments DROP FOREIGN KEY fk_appt_property',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(@rule = 'CASCADE',
    'ALTER TABLE appointments ADD CONSTRAINT fk_appt_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL ON UPDATE CASCADE',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
