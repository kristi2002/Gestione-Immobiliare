-- phase30_property_insurance_fk.sql
-- Add the missing foreign key property_insurance.property_id -> properties.id.
-- Without it, deleting a property left dangling insurance rows (the ERD even
-- annotated this as "no FK constraint"). property_id is NOT NULL, so orphaned
-- rows (pointing at a property that no longer exists) are removed first.
--
-- Idempotent.

USE gestione_immobiliare;

-- 1) Remove orphaned insurance rows (their property no longer exists).
DELETE pi FROM property_insurance pi
LEFT JOIN properties p ON p.id = pi.property_id
WHERE p.id IS NULL;

-- 2) Add the FK only if it does not already exist. RESTRICT so an accidental raw
--    property delete is blocked (consistent with contracts/payments hardening).
SET @has_fk := (
    SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE() AND table_name = 'property_insurance'
      AND constraint_name = 'fk_pi_property' AND constraint_type = 'FOREIGN KEY'
);
SET @sql := IF(@has_fk = 0,
    'ALTER TABLE property_insurance
        ADD CONSTRAINT fk_pi_property FOREIGN KEY (property_id)
        REFERENCES properties(id) ON DELETE RESTRICT ON UPDATE CASCADE',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
