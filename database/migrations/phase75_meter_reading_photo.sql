-- phase75_meter_reading_photo.sql
-- La lettura di un contatore era un numero digitato a mano e nient'altro. E'
-- esattamente il dato su cui proprietario e inquilino uscente litigano a fine
-- locazione, e finora l'agenzia non aveva modo di difenderlo: nessuna prova che
-- il 1.310 fosse davvero sul quadrante quel giorno.
--
-- La foto del contatore NON diventa una colonna di `meter_readings`. Va nella
-- tabella `documents`, per un motivo di sicurezza preciso: `uploads/documents/`
-- e' l'unico ramo con il deny totale di Apache (uploads/documents/.htaccess +
-- la rewrite di root), l'unico servito da uno streamer che verifica di chi e'
-- il file (api/download_document.php) e l'unico che scrive l'accesso nel log
-- GDPR. `uploads/properties/` e `uploads/social/` sono pubblici per scelta —
-- sono foto d'annuncio. Una nuova cartella `uploads/meters/` sarebbe nata fuori
-- da tutte e tre le protezioni: la stessa esposizione che CLAUDE.md indica come
-- il buco piu' grave dell'app.
--
-- Riusare `documents` regala anche lo scoping dei portali: l'inquilino vede la
-- foto del contatore dell'immobile che affitta (gli serve proprio in caso di
-- contestazione), non quelli altrui. Nessuna riga di codice in piu'.
--
-- La FK e' CASCADE perche' una foto di lettura senza la sua lettura non
-- significa niente. Il file su disco lo cancella comunque la API prima di
-- eliminare la lettura (vedi deleteMeterReading): il CASCADE e' la rete di
-- sicurezza per le cancellazioni fatte in SQL diretto, non la via normale.

-- ─── documents.meter_reading_id ────────────────────────────────────────────────
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'documents'
                AND COLUMN_NAME  = 'meter_reading_id');
SET @sql := IF(@col > 0,
    'SELECT 1',
    'ALTER TABLE documents ADD COLUMN meter_reading_id INT UNSIGNED NULL AFTER contract_id');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'documents'
                AND INDEX_NAME   = 'idx_documents_meter_reading');
SET @sql := IF(@idx > 0,
    'SELECT 1',
    'ALTER TABLE documents ADD INDEX idx_documents_meter_reading (meter_reading_id)');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
             WHERE TABLE_SCHEMA     = DATABASE()
               AND TABLE_NAME       = 'documents'
               AND CONSTRAINT_NAME  = 'fk_documents_meter_reading');
SET @sql := IF(@fk > 0,
    'SELECT 1',
    'ALTER TABLE documents ADD CONSTRAINT fk_documents_meter_reading
       FOREIGN KEY (meter_reading_id) REFERENCES meter_readings (id)
       ON DELETE CASCADE ON UPDATE CASCADE');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ─── doc_type += 'lettura_contatore' ───────────────────────────────────────────
-- L'enum si allarga leggendo il valore CORRENTE da information_schema e
-- appendendo, invece di riscrivere la lista per esteso. Un'altra migrazione in
-- lavorazione (phase74, documenti condominiali) tocca lo stesso enum: se ognuna
-- riscrivesse la lista completa che conosceva al momento della stesura, l'ultima
-- ad essere applicata cancellerebbe i valori dell'altra e le righe gia' salvate
-- con quei tipi diventerebbero invalide. Cosi' l'ordine non conta, e non conta
-- nemmeno quale delle due arrivi prima in produzione.
SET @cur := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'documents'
                AND COLUMN_NAME  = 'doc_type');
SET @sql := IF(@cur IS NULL OR LOCATE("'lettura_contatore'", @cur) > 0,
    'SELECT 1',
    CONCAT("ALTER TABLE documents MODIFY COLUMN doc_type ",
           LEFT(@cur, CHAR_LENGTH(@cur) - 1),
           ",'lettura_contatore') NOT NULL DEFAULT 'other'"));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
