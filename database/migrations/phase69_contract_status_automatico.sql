-- phase69_contract_status_automatico.sql
-- `contracts.status` NULL = "Automatico": lo stato del contratto è derivato
-- dalle date invece di essere fissato a mano.
--
-- Il codice tratta NULL come stato legittimo in cinque punti — il filtro
-- "Attivi" (`status IS NULL OR status = 'signed'`), il filtro "Scaduti",
-- il guard anti doppia-prenotazione in assertNoOverlappingLease(),
-- api/scadenzario.php e validateContractInput(), che converte esplicitamente
-- '' / 'auto' in NULL — e il form propone "Automatico (in base alle date)"
-- come DEFAULT di ogni nuovo contratto (assets/js/contract_edit.js,
-- assets/js/property_profile/index.js).
--
-- La colonna però era NOT NULL. Risultato: salvare un contratto lasciando lo
-- stato sul default faceva fallire l'INSERT con SQLSTATE 23000, che il
-- gestore di api/contracts.php riportava come "esistono record collegati a
-- questo contratto" — un messaggio che parla di foreign key e che quindi
-- mandava a cercare il problema dalla parte sbagliata. Nessun contratto in
-- database ha infatti mai avuto stato NULL: la funzione non ha mai funzionato.
--
-- Qui si allinea lo schema all'intenzione del codice. Non si tocca il default
-- delle righe esistenti: chi ha già uno stato esplicito lo mantiene.

USE gestione_immobiliare;

SET @is_nullable := (
    SELECT IS_NULLABLE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'contracts'
      AND COLUMN_NAME = 'status'
);

SET @sql := IF(@is_nullable = 'NO',
    "ALTER TABLE contracts
       MODIFY COLUMN status ENUM('draft','sent','signed','expired','cancelled')
       NULL DEFAULT NULL
       COMMENT 'NULL = Automatico: stato derivato dalle date (vedi phase69)'",
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
