-- ============================================================
-- Phase 25 — Property deletion integrity + missing date indexes
-- Audit finding (June 2026): contracts.property_id and
-- payments.property_id were ON DELETE CASCADE, meaning a raw
-- DELETE of a property would silently wipe its entire contract
-- and rent-payment history. The app itself never hard-deletes a
-- property (api/properties.php only does UPDATE status='archived'),
-- so this tightens the schema to match that intent and match the
-- existing RESTRICT pattern already used on properties.client_id
-- and tenants.property_id.
--
-- Also adds indexes for date-range queries that were doing full
-- table scans: contracts(start_date, end_date) — used by
-- api/forecast.php and api/property_comparison.php — and
-- invoices(issue_date / due_date) — used by api/invoices.php.
--
-- Safe to run multiple times: DROP FOREIGN KEY / DROP INDEX are
-- wrapped in existence checks via information_schema.
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ------------------------------------------------------------
-- 1. contracts.property_id — CASCADE -> RESTRICT
-- ------------------------------------------------------------
SET @exists := (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'contracts'
      AND CONSTRAINT_NAME = 'fk_contracts_property'
);
SET @sql := IF(@exists > 0,
    'ALTER TABLE contracts DROP FOREIGN KEY fk_contracts_property',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE contracts
    ADD CONSTRAINT fk_contracts_property
        FOREIGN KEY (property_id) REFERENCES properties(id)
        ON DELETE RESTRICT;

-- ------------------------------------------------------------
-- 2. payments.property_id — CASCADE -> RESTRICT
-- ------------------------------------------------------------
SET @exists := (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'payments'
      AND CONSTRAINT_NAME = 'fk_payments_property'
);
SET @sql := IF(@exists > 0,
    'ALTER TABLE payments DROP FOREIGN KEY fk_payments_property',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE payments
    ADD CONSTRAINT fk_payments_property
        FOREIGN KEY (property_id) REFERENCES properties(id)
        ON DELETE RESTRICT;

-- ------------------------------------------------------------
-- 3. Missing date-range indexes
-- ------------------------------------------------------------
SET @exists := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contracts'
      AND INDEX_NAME = 'idx_contracts_dates'
);
SET @sql := IF(@exists = 0,
    'ALTER TABLE contracts ADD INDEX idx_contracts_dates (start_date, end_date)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices'
      AND INDEX_NAME = 'idx_invoices_issue_date'
);
SET @sql := IF(@exists = 0,
    'ALTER TABLE invoices ADD INDEX idx_invoices_issue_date (issue_date)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices'
      AND INDEX_NAME = 'idx_invoices_due_date'
);
SET @sql := IF(@exists = 0,
    'ALTER TABLE invoices ADD INDEX idx_invoices_due_date (due_date)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- Note: this migration only changes the constraint definition —
-- it does not delete any data, so it applies cleanly regardless
-- of current row counts. After this runs, any future attempt to
-- run `DELETE FROM properties WHERE id = ...` for a property that
-- still has contracts or payments will be rejected by MySQL
-- (FK constraint fails) instead of silently cascading. The app's
-- own delete endpoint already only archives (UPDATE status =
-- 'archived'), so normal usage is unaffected.
-- ============================================================
