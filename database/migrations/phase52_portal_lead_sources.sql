-- phase52_portal_lead_sources.sql
-- Import lead dai portali (Immobiliare.it, Idealista, Casa.it, Subito):
-- aggiunge i portali all'enum leads.source così i lead importati dalle
-- email di notifica dei portali restano filtrabili per fonte reale
-- (lib/portal_leads.php + api/leads.php?action=import_email).
-- Idempotente: l'enum viene modificato solo se 'immobiliare' manca.

USE gestione_immobiliare;

SET @tipo := (
    SELECT COLUMN_TYPE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'source'
);
SET @sql := IF(@tipo NOT LIKE '%immobiliare%',
    'ALTER TABLE leads MODIFY source enum(''telefono'',''email'',''web'',''passaparola'',''social'',''immobiliare'',''idealista'',''casa'',''subito'',''altro'') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''altro''',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
