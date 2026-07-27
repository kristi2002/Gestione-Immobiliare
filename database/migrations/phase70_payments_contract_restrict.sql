-- phase70_payments_contract_restrict.sql
-- `payments.contract_id` era l'ultima FK della famiglia rimasta su SET NULL.
--
-- Le sorelle sono entrambe RESTRICT, e per una scelta esplicita:
--   payments.property_id -> RESTRICT (phase25)
--   payments.tenant_id   -> RESTRICT (phase48, "A tenant with payments can then
--                                     only be archived, never hard-deleted out
--                                     from under its financial history")
--
-- contract_id no. Cancellare un contratto quindi non falliva: staccava le rate
-- mettendo contract_id a NULL e le lasciava nel scadenzario, scollegate dal
-- contratto che le aveva generate e ormai indistinguibili da un pagamento
-- una tantum (caparra, conguaglio), che legittimamente non ha contratto.
-- Nessun errore, nessuna traccia: solo righe di denaro senza più un'origine.
--
-- Da qui RESTRICT, coerente con le sorelle: il database non può più produrre
-- quella classe di orfani, da nessun percorso di codice, nemmeno da una DELETE
-- manuale.
--
-- La cancellazione dei contratti resta possibile: api/contracts.php
-- deleteContract() rimuove prima le rate NON incassate (uno scadenzario non
-- ancora onorato è una previsione, non storia contabile) e si ferma invece se
-- esiste anche solo un pagamento incassato. Quello è storia, e va conservato.
--
-- NB: le righe con contract_id NULL già presenti NON vengono toccate. Un
-- pagamento senza contratto è uno stato legittimo — nei dati attuali è anzi
-- la norma — quindi un orfano storico non è distinguibile da una caparra
-- inserita a mano. Non c'è modo corretto di ripulirli a posteriori.
--
-- Idempotente: la FK viene ricostruita solo se la regola è ancora SET NULL.

USE gestione_immobiliare;

SET @rule := (
    SELECT delete_rule FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'payments'
      AND constraint_name = 'fk_payments_contract'
);

SET @sql := IF(@rule = 'SET NULL',
    'ALTER TABLE payments DROP FOREIGN KEY fk_payments_contract',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(@rule = 'SET NULL',
    'ALTER TABLE payments
       ADD CONSTRAINT fk_payments_contract FOREIGN KEY (contract_id)
       REFERENCES contracts(id) ON DELETE RESTRICT ON UPDATE CASCADE',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
