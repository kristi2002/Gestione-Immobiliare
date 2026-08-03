-- phase94_documents_aml_record.sql
--
-- La copia del documento d'identita' non aveva dove stare.
--
-- La scheda antiriciclaggio registra tipo, numero e scadenza del documento con
-- cui si e' identificato il soggetto, ma non il documento. L'art. 31 del D.lgs
-- 231/2007 chiede di conservare "copia dei documenti acquisiti in occasione
-- dell'adeguata verifica" per dieci anni: i tre campi di testo dicono che la
-- copia esiste, non sono la copia.
--
-- Finora l'unico posto dove metterla era la cartella documenti del
-- proprietario, cioe' staccata dalla pratica che la giustifica. In ispezione la
-- domanda non e' "avete la carta d'identita' di Rossi" ma "mostratemi il
-- fascicolo dell'operazione": un file che sta in un altro raccoglitore, senza
-- legame con la verifica, e' una copia che c'e' ma non risponde. E per le
-- pratiche aperte su un lead — un potenziale acquirente che non e' ancora un
-- proprietario in anagrafica — non c'era proprio nessun raccoglitore.
--
-- `documents` tiene un legame per entita' (client_id, property_id, contract_id,
-- building_id, meter_reading_id, inventory_item_id): questa e' la settima.
--
-- ON DELETE RESTRICT, come contracts e buildings e non come le letture dei
-- contatori. La regola di cancellazione qui e' una scelta di merito, non di
-- forma: la pratica E' il fascicolo, e il fascicolo e' il motivo per cui quella
-- copia e' stata raccolta. In CASCADE, cancellare una pratica creata per errore
-- porterebbe via anche la carta d'identita' allegata — in silenzio, e per
-- giunta lasciando il file su disco, perche' un CASCADE del database non passa
-- da deleteDocument() e non cancella niente in `uploads/`. Con RESTRICT
-- api/aml.php conta gli allegati prima e si ferma dicendo quanti sono: chi
-- vuole davvero eliminare la pratica stacca prima i documenti, e lo fa
-- guardandoli.

CALL migration_add_column('documents', 'aml_record_id', 'INT UNSIGNED NULL DEFAULT NULL AFTER inventory_item_id');
CALL migration_add_index('documents', 'idx_documents_aml', '`aml_record_id`');
-- migration_add_fk aggiunge sempre ON UPDATE CASCADE, che e' quel che serve qui.
CALL migration_add_fk('documents', 'fk_documents_aml', 'aml_record_id', 'aml_records', 'id', 'RESTRICT');
