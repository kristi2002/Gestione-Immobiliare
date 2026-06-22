-- ============================================================
-- Phase 24 — Platform Gap Fixes
-- 1. reminders.tenant_id   — FK so maintenance tickets know who submitted them
-- 2. payments.contract_id  — FK so payments can reference their lease contract
-- Run 000_helpers.sql first if procedures are missing.
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ------------------------------------------------------------
-- 1. reminders: add tenant_id
-- ------------------------------------------------------------
CALL migration_add_column('reminders', 'tenant_id',
    'INT UNSIGNED NULL AFTER client_id');

CALL migration_add_index('reminders', 'idx_rem_tenant', '`tenant_id`');

ALTER TABLE reminders
    ADD CONSTRAINT fk_reminders_tenant
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        ON DELETE SET NULL ON UPDATE CASCADE;

-- ------------------------------------------------------------
-- 2. payments: add contract_id
-- ------------------------------------------------------------
CALL migration_add_column('payments', 'contract_id',
    'INT UNSIGNED NULL AFTER property_id');

CALL migration_add_index('payments', 'idx_payments_contract', '`contract_id`');

ALTER TABLE payments
    ADD CONSTRAINT fk_payments_contract
        FOREIGN KEY (contract_id) REFERENCES contracts(id)
        ON DELETE SET NULL ON UPDATE CASCADE;

SET FOREIGN_KEY_CHECKS = 1;
