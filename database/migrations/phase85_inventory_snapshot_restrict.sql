-- phase85_inventory_snapshot_restrict.sql
--
-- Il verbale di consegna non se ne va insieme al contratto.
--
-- `inventory_snapshots` e' l'unico figlio di `contracts` rimasto in CASCADE:
--
--   fk_ac_contract         agent_commissions    RESTRICT   (phase71)
--   fk_documents_contract  documents            RESTRICT   (phase71)
--   fk_er_contract         esign_requests       RESTRICT   (phase71)
--   fk_payments_contract   payments             RESTRICT   (phase70)
--   fk_inv_snap_contract   inventory_snapshots  CASCADE    <- questo
--
-- api/contracts.php:378 conta pagamenti, provvigioni, firme e documenti prima di
-- lasciar cancellare un contratto, e blocca su quelli che sono gia' *prova* di
-- qualcosa. I verbali non li conta nemmeno: sparivano in silenzio, e con loro
-- gli inventory_snapshot_items (a loro volta in CASCADE).
--
-- Un verbale `locked` e' congelato: ha content_hash, locked_at, locked_by e
-- spesso una firma via esign_request_id. E' il documento con cui si discute una
-- trattenuta sulla cauzione a fine locazione. Cancellare il contratto e'
-- esattamente il momento in cui quella prova serve di piu'.
--
-- Con RESTRICT il comportamento diventa quello gia' scelto per gli altri
-- quattro: i verbali `draft` (lavoro in corso, nessun valore probatorio) li
-- cancella deleteContract() dentro la sua transazione e li elenca in `removed`;
-- quelli `locked` fermano l'operazione con un 409 che li nomina.

USE gestione_immobiliare;

-- Il vincolo esiste sotto questo nome solo se phase78 e' passata; se un ambiente
-- lo ha con un nome diverso (o non lo ha), la migrazione non deve rompersi.
SET @fk := (
    SELECT CONSTRAINT_NAME
      FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'inventory_snapshots'
       AND REFERENCED_TABLE_NAME = 'contracts'
       AND DELETE_RULE = 'CASCADE'
     LIMIT 1
);

SET @sql := IF(@fk IS NULL,
    'SELECT 1',
    CONCAT('ALTER TABLE inventory_snapshots DROP FOREIGN KEY `', @fk, '`'));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := IF(@fk IS NULL,
    'SELECT 1',
    'ALTER TABLE inventory_snapshots
       ADD CONSTRAINT `fk_inv_snap_contract`
       FOREIGN KEY (`contract_id`) REFERENCES `contracts` (`id`)
       ON DELETE RESTRICT ON UPDATE CASCADE');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
