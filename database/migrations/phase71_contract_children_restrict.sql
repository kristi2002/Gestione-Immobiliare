-- phase71_contract_children_restrict.sql
-- Chiude la stessa falla di phase70 sulle tre relazioni rimaste verso contracts.
--
-- Erano tutte ON DELETE SET NULL: eliminando un contratto, provvigioni, richieste
-- di firma e documenti restavano in giro scollegati, senza errore e senza traccia
-- di quale contratto li avesse originati. Per le provvigioni è denaro; per le
-- richieste di firma è la prova di una firma elettronica (con firmatario, data e
-- IP); per i documenti è un file su disco, spesso un contratto firmato o un
-- documento d'identità.
--
--   agent_commissions.contract_id : SET NULL -> RESTRICT
--   esign_requests.contract_id    : SET NULL -> RESTRICT
--   documents.contract_id         : SET NULL -> RESTRICT
--
-- La cancellazione dei contratti resta possibile: deleteContract() rimuove ciò
-- che è previsione (rate non incassate, provvigioni non liquidate, richieste di
-- firma non completate) e si ferma su ciò che è storia. I DOCUMENTI non vengono
-- mai rimossi in automatico: la riga possiede un file su disco, e cancellarlo
-- come effetto collaterale dell'eliminazione di un contratto sarebbe distruttivo
-- e potenzialmente illegittimo (conservazione). Un contratto con documenti
-- allegati non si elimina finché l'agente non decide file per file.
--
-- Idempotente: ogni FK viene ricostruita solo se la regola è ancora SET NULL.

USE gestione_immobiliare;

-- ── agent_commissions.fk_ac_contract ─────────────────────────────────────────
SET @r := (SELECT delete_rule FROM information_schema.referential_constraints
           WHERE constraint_schema = DATABASE()
             AND table_name = 'agent_commissions' AND constraint_name = 'fk_ac_contract');
SET @sql := IF(@r = 'SET NULL', 'ALTER TABLE agent_commissions DROP FOREIGN KEY fk_ac_contract', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql := IF(@r = 'SET NULL',
    'ALTER TABLE agent_commissions ADD CONSTRAINT fk_ac_contract FOREIGN KEY (contract_id)
       REFERENCES contracts(id) ON DELETE RESTRICT ON UPDATE CASCADE',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── esign_requests.fk_er_contract ────────────────────────────────────────────
SET @r := (SELECT delete_rule FROM information_schema.referential_constraints
           WHERE constraint_schema = DATABASE()
             AND table_name = 'esign_requests' AND constraint_name = 'fk_er_contract');
SET @sql := IF(@r = 'SET NULL', 'ALTER TABLE esign_requests DROP FOREIGN KEY fk_er_contract', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql := IF(@r = 'SET NULL',
    'ALTER TABLE esign_requests ADD CONSTRAINT fk_er_contract FOREIGN KEY (contract_id)
       REFERENCES contracts(id) ON DELETE RESTRICT ON UPDATE CASCADE',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── documents.fk_documents_contract ──────────────────────────────────────────
SET @r := (SELECT delete_rule FROM information_schema.referential_constraints
           WHERE constraint_schema = DATABASE()
             AND table_name = 'documents' AND constraint_name = 'fk_documents_contract');
SET @sql := IF(@r = 'SET NULL', 'ALTER TABLE documents DROP FOREIGN KEY fk_documents_contract', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql := IF(@r = 'SET NULL',
    'ALTER TABLE documents ADD CONSTRAINT fk_documents_contract FOREIGN KEY (contract_id)
       REFERENCES contracts(id) ON DELETE RESTRICT ON UPDATE CASCADE',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
