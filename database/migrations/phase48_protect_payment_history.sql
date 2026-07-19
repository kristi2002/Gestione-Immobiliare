-- phase48_protect_payment_history.sql
-- Stop a tenant delete from CASCADE-wiping financial history.
--
-- payments.tenant_id and stripe_payments.tenant_id were ON DELETE CASCADE, so a
-- raw `DELETE FROM tenants WHERE id = ?` silently erased every rent payment and
-- Stripe record for that tenant. The app itself only soft-archives tenants
-- (api/tenants.php archiveTenant sets status='archived'), so this never fires in
-- normal use — but it is a live footgun for any manual delete / future code path.
-- This is inconsistent with the property side, which was deliberately set to
-- RESTRICT in phase25 for exactly this reason.
--
-- Switch both FKs to ON DELETE RESTRICT (tenant_id is NOT NULL, so SET NULL is not
-- an option). A tenant with payments can then only be archived, never hard-deleted
-- out from under its financial history.
--
-- Idempotent: each FK is only rebuilt when its current delete rule is still
-- CASCADE, so re-running is a no-op.

USE gestione_immobiliare;

-- ── payments.fk_payments_tenant : CASCADE -> RESTRICT ────────────────────────
SET @rule := (
    SELECT delete_rule FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'payments' AND constraint_name = 'fk_payments_tenant'
);
SET @sql := IF(@rule = 'CASCADE',
    'ALTER TABLE payments DROP FOREIGN KEY fk_payments_tenant',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql := IF(@rule = 'CASCADE',
    'ALTER TABLE payments ADD CONSTRAINT fk_payments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── stripe_payments.fk_sp_tenant : CASCADE -> RESTRICT ───────────────────────
SET @rule2 := (
    SELECT delete_rule FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'stripe_payments' AND constraint_name = 'fk_sp_tenant'
);
SET @sql := IF(@rule2 = 'CASCADE',
    'ALTER TABLE stripe_payments DROP FOREIGN KEY fk_sp_tenant',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql := IF(@rule2 = 'CASCADE',
    'ALTER TABLE stripe_payments ADD CONSTRAINT fk_sp_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
