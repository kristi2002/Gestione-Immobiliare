-- phase45_invoice_number_unique_enforce.sql
-- Make invoice-number uniqueness UNCONDITIONAL.
--
-- phase29 only added `uq_invoices_number` when zero legacy duplicates existed —
-- so on any DB that had duplicate invoice_numbers at that time, the UNIQUE index
-- was silently skipped and the app's retry-on-collision logic (api/invoices.php)
-- has no constraint to rely on. Two concurrent createInvoice() calls can then mint
-- the SAME number, which is illegal for Italian sequential invoicing.
--
-- This migration removes the silent escape hatch: when the UNIQUE index is missing
-- it is added UNCONDITIONALLY. If legacy duplicates are present the ADD fails with
-- MySQL error 1062 (Duplicate entry), which makes migrate.php abort the deploy
-- (exit 1) with a visible error instead of continuing unprotected. The operator
-- must then de-duplicate the affected invoice_numbers and re-run migrations.
--
-- Idempotent: if `uq_invoices_number` already exists (clean phase29 run), this is
-- a no-op.

USE gestione_immobiliare;

-- 1) Ensure the UNIQUE index exists. Attempt the ADD whenever it is absent — do
--    NOT gate on the absence of duplicates (that was the phase29 bug). A DB with
--    duplicate numbers will fail here, loudly and correctly.
SET @has_uq := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'invoices'
      AND index_name = 'uq_invoices_number'
);
SET @sql := IF(@has_uq = 0,
    'ALTER TABLE invoices ADD UNIQUE INDEX uq_invoices_number (invoice_number)',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 2) Drop the now-redundant non-unique index, but only once the unique one exists.
SET @has_uq2 := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'invoices'
      AND index_name = 'uq_invoices_number'
);
SET @has_old := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'invoices'
      AND index_name = 'idx_invoices_number'
);
SET @sql := IF(@has_uq2 = 1 AND @has_old = 1,
    'ALTER TABLE invoices DROP INDEX idx_invoices_number',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
