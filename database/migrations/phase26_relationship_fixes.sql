-- ============================================================
-- Phase 26 — Relationship model fixes (June 2026 review)
--
-- 1. expenses.supplier_id      — track which vendor an expense was paid to
-- 2. properties.building_id    — a unit belongs to exactly one building
--                                (was an unenforced M:N junction table)
-- 3. documents.contract_id     — a contract can have many documents
--                                (was a one-document-per-contract column)
-- 4. tenants decoupled from properties — a tenant is a person; WHERE they
--                                live and on what lease terms is recorded in
--                                CONTRACTS (tenant_id + property_id), so the
--                                same person can be re-rented to a different
--                                property later without losing history or
--                                colliding with the tenants.email UNIQUE key.
--
-- Each section is data-safe: existing relationships are migrated forward
-- BEFORE the old column/table is dropped. Safe to run multiple times.
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ------------------------------------------------------------
-- 1. expenses.supplier_id
-- ------------------------------------------------------------
SET @exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'expenses' AND COLUMN_NAME = 'supplier_id'
);
SET @sql := IF(@exists = 0,
    'ALTER TABLE expenses ADD COLUMN supplier_id INT UNSIGNED NULL AFTER client_id',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'expenses' AND INDEX_NAME = 'idx_expenses_supplier'
);
SET @sql := IF(@exists = 0,
    'ALTER TABLE expenses ADD INDEX idx_expenses_supplier (supplier_id)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'expenses' AND CONSTRAINT_NAME = 'fk_expenses_supplier'
);
SET @sql := IF(@exists = 0,
    'ALTER TABLE expenses ADD CONSTRAINT fk_expenses_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL ON UPDATE CASCADE',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- 2. properties.building_id (replaces building_properties M:N)
-- ------------------------------------------------------------
SET @exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'properties' AND COLUMN_NAME = 'building_id'
);
SET @sql := IF(@exists = 0,
    'ALTER TABLE properties ADD COLUMN building_id INT UNSIGNED NULL AFTER client_id',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'properties' AND INDEX_NAME = 'idx_properties_building'
);
SET @sql := IF(@exists = 0,
    'ALTER TABLE properties ADD INDEX idx_properties_building (building_id)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Migrate existing M:N links forward (a property linked to more than one
-- building — which the app never actually allowed via the UI — keeps the
-- lowest building_id deterministically).
SET @bp_exists := (
    SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'building_properties'
);
SET @sql := IF(@bp_exists > 0,
    'UPDATE properties p
     INNER JOIN (
         SELECT property_id, MIN(building_id) AS building_id
         FROM building_properties
         GROUP BY property_id
     ) bp ON bp.property_id = p.id
     SET p.building_id = bp.building_id
     WHERE p.building_id IS NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'properties' AND CONSTRAINT_NAME = 'fk_properties_building'
);
SET @sql := IF(@exists = 0,
    'ALTER TABLE properties ADD CONSTRAINT fk_properties_building FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE RESTRICT ON UPDATE CASCADE',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

DROP TABLE IF EXISTS building_properties;

-- ------------------------------------------------------------
-- 3. documents.contract_id (replaces contracts.document_id)
-- ------------------------------------------------------------
SET @exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documents' AND COLUMN_NAME = 'contract_id'
);
SET @sql := IF(@exists = 0,
    'ALTER TABLE documents ADD COLUMN contract_id INT UNSIGNED NULL AFTER property_id',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documents' AND INDEX_NAME = 'idx_documents_contract'
);
SET @sql := IF(@exists = 0,
    'ALTER TABLE documents ADD INDEX idx_documents_contract (contract_id)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Carry forward any pre-existing one-document-per-contract links.
SET @docid_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contracts' AND COLUMN_NAME = 'document_id'
);
SET @sql := IF(@docid_exists > 0,
    'UPDATE documents d
     INNER JOIN contracts c ON c.document_id = d.id
     SET d.contract_id = c.id
     WHERE d.contract_id IS NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'documents' AND CONSTRAINT_NAME = 'fk_documents_contract'
);
SET @sql := IF(@exists = 0,
    'ALTER TABLE documents ADD CONSTRAINT fk_documents_contract FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE SET NULL ON UPDATE CASCADE',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Drop the old single-document column (FK first, then the column).
SET @sql := IF(@docid_exists > 0,
    'ALTER TABLE contracts DROP FOREIGN KEY fk_contracts_document',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(@docid_exists > 0,
    'ALTER TABLE contracts DROP COLUMN document_id',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- 4. Decouple tenants from properties
-- ------------------------------------------------------------
SET @pid_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants' AND COLUMN_NAME = 'property_id'
);

-- Backfill: every tenant who has a property_id but no matching contract yet
-- gets one created from their existing lease_start/lease_end/monthly_rent,
-- so no lease history is lost when the columns are dropped below.
SET @sql := IF(@pid_exists > 0,
    "INSERT INTO contracts (property_id, tenant_id, client_id, title, contract_type, status, start_date, end_date, monthly_rent, created_at)
     SELECT t.property_id, t.id, p.client_id,
            CONCAT('Locazione ', p.address, ', ', p.city),
            'locazione',
            IF(t.status = 'archived', 'expired', 'signed'),
            t.lease_start, t.lease_end, t.monthly_rent, NOW()
     FROM tenants t
     INNER JOIN properties p ON p.id = t.property_id
     WHERE t.property_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM contracts c WHERE c.tenant_id = t.id AND c.property_id = t.property_id
       )",
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Drop the FK, then the now-redundant columns.
SET @sql := IF(@pid_exists > 0,
    'ALTER TABLE tenants DROP FOREIGN KEY fk_tenants_property',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(@pid_exists > 0,
    'ALTER TABLE tenants DROP COLUMN property_id, DROP COLUMN lease_start, DROP COLUMN lease_end, DROP COLUMN monthly_rent',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- Verification — run after applying:
--
--   SELECT COUNT(*) FROM tenants WHERE id NOT IN (SELECT tenant_id FROM contracts WHERE tenant_id IS NOT NULL);
--   -- should equal the number of tenants who never had a property assigned
--   -- (e.g. freshly created with no lease yet) — NOT a backfill failure.
--
--   SHOW CREATE TABLE tenants\G       -- property_id/lease_*/monthly_rent gone
--   SHOW CREATE TABLE properties\G    -- building_id present
--   SHOW CREATE TABLE documents\G     -- contract_id present
--   SHOW CREATE TABLE contracts\G     -- document_id gone
--   SHOW TABLES LIKE 'building_properties';  -- empty result
-- ============================================================
