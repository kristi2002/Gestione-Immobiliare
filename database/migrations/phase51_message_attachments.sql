-- phase51_message_attachments.sql
-- "Allega documenti" nella modal Invia messaggio (pagina Proprietari):
--   1. nuovo doc_type 'preventivo' sui documenti (categoria P dei filtri D/F/C/P);
--   2. colonna communications.attachments — JSON [{id,name,size}] dei documenti
--      allegati all'email inviata (storico del thread).
-- Idempotente: l'enum viene modificato solo se 'preventivo' manca, la colonna
-- viene aggiunta con l'helper migration_add_column.

USE gestione_immobiliare;

-- ── documents.doc_type: aggiunge 'preventivo' ────────────────────────────────
SET @tipo := (
    SELECT COLUMN_TYPE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'documents' AND COLUMN_NAME = 'doc_type'
);
SET @sql := IF(@tipo NOT LIKE '%preventivo%',
    'ALTER TABLE documents MODIFY doc_type enum(''invoice'',''contract'',''id'',''id_front'',''id_back'',''preventivo'',''other'') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''other''',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── communications.attachments ───────────────────────────────────────────────
CALL migration_add_column('communications', 'attachments', 'TEXT NULL AFTER body');
