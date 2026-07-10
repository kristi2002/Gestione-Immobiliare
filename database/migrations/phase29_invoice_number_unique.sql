-- phase29_invoice_number_unique.sql
-- Enforce unique invoice numbers (Italian invoicing requires unique, non-reused,
-- sequential numbering). The app now derives the next number from MAX(sequence)
-- and retries on a unique-key collision (see api/invoices.php).
--
-- Idempotent. If legacy duplicate invoice_numbers exist (from the old COUNT(*)+1
-- numbering) the UNIQUE index is NOT added and the non-unique index is kept — the
-- duplicates must be resolved manually, then this migration re-run. New inserts
-- can no longer create duplicates regardless.

USE gestione_immobiliare;

-- 1) Add the UNIQUE index only when there are no existing duplicates.
SET @dupes := (
    SELECT COUNT(*) FROM (
        SELECT invoice_number FROM invoices
        GROUP BY invoice_number HAVING COUNT(*) > 1
    ) d
);
SET @has_uq := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'invoices'
      AND index_name = 'uq_invoices_number'
);
SET @sql := IF(@dupes = 0 AND @has_uq = 0,
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
