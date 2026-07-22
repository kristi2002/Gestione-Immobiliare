-- phase53_communications_nullable_client.sql
-- api/email_inbound.php salva la comunicazione con client_id NULL quando il
-- mittente non corrisponde a nessun cliente (in primis: notifiche dei portali
-- immobiliari, ora importate come lead da lib/portal_leads.php). La colonna
-- però era NOT NULL: l'INSERT falliva, l'errore veniva inghiottito dal catch
-- e l'email in entrata andava persa in silenzio (Mailgun riceveva comunque 200).
-- Rende client_id NULLable. La FK resta invariata: ON DELETE CASCADE continua
-- ad applicarsi alle righe collegate a un cliente (erasure GDPR intatta),
-- le righe senza cliente semplicemente non partecipano.
-- Idempotente: modifica solo se la colonna è ancora NOT NULL.

USE gestione_immobiliare;

SET @nullable := (
    SELECT IS_NULLABLE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'communications' AND COLUMN_NAME = 'client_id'
);
SET @sql := IF(@nullable = 'NO',
    'ALTER TABLE communications MODIFY client_id INT UNSIGNED NULL',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
