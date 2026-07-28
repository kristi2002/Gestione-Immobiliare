-- phase77_edificio_condominio.sql
-- L'edificio finora era poco piu' di un raggruppamento con un'etichetta: nome,
-- indirizzo, un contatto amministratore scritto a mano e un contatore di unita'
-- digitato dall'agente. Questa fase gli da' le quattro cose che servono perche'
-- sia davvero il record padre di un condominio.
--
--   1. AMMINISTRATORE NORMALIZZATO
--      `administrator_name/phone/email` erano tre VARCHAR liberi. Lo stesso
--      studio che amministra sei stabili era scritto sei volte, e un cambio di
--      numero andava inseguito riga per riga. Ora c'e' `administrator_supplier_id`
--      verso `suppliers` (rubrica gia' esistente, con categoria/rating/note), e
--      alla categoria si aggiunge 'amministratore'. Le tre colonne testo NON
--      vengono rimosse: restano come fallback per gli edifici gia' inseriti e
--      per i casi in cui l'agenzia ha solo un nome su un post-it. La API
--      preferisce sempre il fornitore collegato quando c'e'.
--
--   2. GEOGRAFIA EREDITABILE
--      `cap`, `province`, `latitude`, `longitude`: l'edificio non aveva ne' CAP
--      ne' coordinate, quindi non poteva passare nulla di geografico ai figli.
--      Con queste colonne una sola geocodifica serve tutte le unita' generate.
--
--   3. TABELLE MILLESIMALI (`building_millesimi`)
--      Senza millesimi una spesa condominiale non e' ripartibile: l'unica
--      alternativa e' che l'agente divida a mano e inserisca N spese. La tabella
--      e' per (edificio, immobile, tipo tabella) perche' un condominio ne ha
--      piu' d'una — proprieta', riscaldamento, ascensore, scale — e le quote
--      differiscono (il piano terra non paga l'ascensore).
--      quota DECIMAL(9,4): i millesimi frazionari esistono (es. 43,7826).
--
--   4. SPESE CONDOMINIALI RIPARTIBILI
--      `expenses.building_id` per la spesa dell'edificio, `parent_expense_id`
--      per le quote-figlie generate dalla ripartizione, `millesimi_quota` per
--      tenere traccia della quota applicata. La riga padre e' la spesa vera
--      (la fattura pagata); le figlie sono l'imputazione per unita'. Le figlie
--      vanno ESCLUSE dai totali generali, o gli stessi soldi si contano due
--      volte — vedi api/expenses.php.
--
--   5. DOCUMENTI CONDIVISI (`documents.building_id`)
--      Regolamento di condominio, planimetrie strutturali, verbali d'assemblea:
--      documenti dell'edificio, non della singola unita'. Prima l'unico modo di
--      allegarli a 56 appartamenti era caricare 56 volte lo stesso PDF. Con
--      building_id il file sta una volta sola e le unita' figlie lo vedono in
--      sola lettura (ereditato, non copiato).
--      La FK e' RESTRICT, non SET NULL: coerente con phase71 — un documento non
--      resta mai orfano di cio' che lo motivava.
--
-- Idempotente: ogni colonna, indice e vincolo viene creato solo se assente.

USE gestione_immobiliare;

-- ---------------------------------------------------------------------------
-- 1. suppliers.category — aggiunge 'amministratore'
-- ---------------------------------------------------------------------------
-- L'enum si allarga APPENDENDO al valore corrente letto da information_schema,
-- non riscrivendo la lista per esteso: piu' migrazioni della stessa tornata
-- toccano gli stessi enum, e chi riscrive la lista che conosceva al momento
-- della stesura cancella i valori aggiunti dalle altre — invalidando le righe
-- gia' salvate con quei tipi. Cosi' l'ordine di applicazione non conta.
-- 'altro' resta l'ultimo elemento: si inserisce PRIMA di lui, non in coda.
SET @cur := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'suppliers' AND COLUMN_NAME = 'category');
SET @sql := IF(@cur IS NULL OR LOCATE("'amministratore'", @cur) > 0,
    'SELECT 1',
    CONCAT("ALTER TABLE suppliers MODIFY COLUMN category ",
           LEFT(@cur, CHAR_LENGTH(@cur) - 1),
           ",'amministratore') NOT NULL DEFAULT 'altro'"));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 2. buildings — amministratore normalizzato + geografia
-- ---------------------------------------------------------------------------
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'buildings' AND COLUMN_NAME = 'administrator_supplier_id');
SET @sql := IF(@col = 0,
    'ALTER TABLE buildings ADD COLUMN administrator_supplier_id INT UNSIGNED NULL AFTER notes',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'buildings' AND INDEX_NAME = 'idx_buildings_administrator');
SET @sql := IF(@idx = 0,
    'ALTER TABLE buildings ADD INDEX idx_buildings_administrator (administrator_supplier_id)',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ON DELETE SET NULL: cancellare un fornitore dalla rubrica non deve impedire
-- di cancellarlo ne' cancellare l'edificio — l'edificio resta, senza amministratore.
SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
            WHERE CONSTRAINT_SCHEMA = DATABASE()
              AND TABLE_NAME = 'buildings' AND CONSTRAINT_NAME = 'fk_buildings_administrator');
SET @sql := IF(@fk = 0,
    'ALTER TABLE buildings ADD CONSTRAINT fk_buildings_administrator
       FOREIGN KEY (administrator_supplier_id) REFERENCES suppliers(id)
       ON DELETE SET NULL ON UPDATE CASCADE',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'buildings' AND COLUMN_NAME = 'cap');
SET @sql := IF(@col = 0,
    'ALTER TABLE buildings ADD COLUMN cap VARCHAR(10) NULL AFTER city',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'buildings' AND COLUMN_NAME = 'province');
SET @sql := IF(@col = 0,
    'ALTER TABLE buildings ADD COLUMN province VARCHAR(10) NULL AFTER cap',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'buildings' AND COLUMN_NAME = 'latitude');
SET @sql := IF(@col = 0,
    'ALTER TABLE buildings ADD COLUMN latitude DECIMAL(10,8) NULL AFTER province',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'buildings' AND COLUMN_NAME = 'longitude');
SET @sql := IF(@col = 0,
    'ALTER TABLE buildings ADD COLUMN longitude DECIMAL(11,8) NULL AFTER latitude',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 3. building_millesimi — tabelle millesimali
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS building_millesimi (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    building_id INT UNSIGNED NOT NULL,
    property_id INT UNSIGNED NOT NULL,
    table_type  ENUM('proprieta','riscaldamento','ascensore','scale','acqua','altro')
                NOT NULL DEFAULT 'proprieta',
    quota       DECIMAL(9,4) NOT NULL DEFAULT 0 COMMENT 'Millesimi (0-1000), frazioni ammesse',
    notes       VARCHAR(255) NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_millesimi_unit_table (building_id, property_id, table_type),
    KEY idx_millesimi_property (property_id),
    CONSTRAINT fk_millesimi_building FOREIGN KEY (building_id)
        REFERENCES buildings(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_millesimi_property FOREIGN KEY (property_id)
        REFERENCES properties(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4. expenses — spesa condominiale + ripartizione
-- ---------------------------------------------------------------------------
-- Append-in-place, per la stessa ragione di suppliers.category sopra.
SET @cur := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'expenses' AND COLUMN_NAME = 'category');
SET @sql := IF(@cur IS NULL OR LOCATE("'condominio'", @cur) > 0,
    'SELECT 1',
    CONCAT("ALTER TABLE expenses MODIFY COLUMN category ",
           LEFT(@cur, CHAR_LENGTH(@cur) - 1),
           ",'condominio') NOT NULL DEFAULT 'altro'"));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'expenses' AND COLUMN_NAME = 'building_id');
SET @sql := IF(@col = 0,
    'ALTER TABLE expenses ADD COLUMN building_id INT UNSIGNED NULL AFTER property_id',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'expenses' AND COLUMN_NAME = 'parent_expense_id');
SET @sql := IF(@col = 0,
    'ALTER TABLE expenses ADD COLUMN parent_expense_id INT UNSIGNED NULL AFTER building_id',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'expenses' AND COLUMN_NAME = 'millesimi_quota');
SET @sql := IF(@col = 0,
    'ALTER TABLE expenses ADD COLUMN millesimi_quota DECIMAL(9,4) NULL AFTER parent_expense_id',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'expenses' AND INDEX_NAME = 'idx_expenses_building');
SET @sql := IF(@idx = 0,
    'ALTER TABLE expenses ADD INDEX idx_expenses_building (building_id)',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'expenses' AND INDEX_NAME = 'idx_expenses_parent');
SET @sql := IF(@idx = 0,
    'ALTER TABLE expenses ADD INDEX idx_expenses_parent (parent_expense_id)',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- RESTRICT: un edificio con spese registrate non si cancella di soppiatto.
SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
            WHERE CONSTRAINT_SCHEMA = DATABASE()
              AND TABLE_NAME = 'expenses' AND CONSTRAINT_NAME = 'fk_expenses_building');
SET @sql := IF(@fk = 0,
    'ALTER TABLE expenses ADD CONSTRAINT fk_expenses_building
       FOREIGN KEY (building_id) REFERENCES buildings(id)
       ON DELETE RESTRICT ON UPDATE CASCADE',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- CASCADE: le quote-figlie non hanno vita propria. Se si annulla la spesa
-- condominiale, la sua ripartizione sparisce con lei — altrimenti restano
-- addebiti per unita' che non corrispondono piu' ad alcuna fattura.
SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
            WHERE CONSTRAINT_SCHEMA = DATABASE()
              AND TABLE_NAME = 'expenses' AND CONSTRAINT_NAME = 'fk_expenses_parent');
SET @sql := IF(@fk = 0,
    'ALTER TABLE expenses ADD CONSTRAINT fk_expenses_parent
       FOREIGN KEY (parent_expense_id) REFERENCES expenses(id)
       ON DELETE CASCADE ON UPDATE CASCADE',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 5. documents — documenti condominiali condivisi
-- ---------------------------------------------------------------------------
-- Nuovi doc_type: i documenti dell'edificio non sono ne' fatture ne' contratti.
-- Tre valori, aggiunti uno alla volta e sempre in append: un'altra migrazione
-- della stessa tornata sta allargando questo stesso enum.
SET @cur := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'documents' AND COLUMN_NAME = 'doc_type');
SET @sql := IF(@cur IS NULL OR LOCATE("'regolamento'", @cur) > 0,
    'SELECT 1',
    CONCAT("ALTER TABLE documents MODIFY COLUMN doc_type ",
           LEFT(@cur, CHAR_LENGTH(@cur) - 1),
           ",'regolamento') NOT NULL DEFAULT 'other'"));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @cur := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'documents' AND COLUMN_NAME = 'doc_type');
SET @sql := IF(@cur IS NULL OR LOCATE("'planimetria'", @cur) > 0,
    'SELECT 1',
    CONCAT("ALTER TABLE documents MODIFY COLUMN doc_type ",
           LEFT(@cur, CHAR_LENGTH(@cur) - 1),
           ",'planimetria') NOT NULL DEFAULT 'other'"));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @cur := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'documents' AND COLUMN_NAME = 'doc_type');
SET @sql := IF(@cur IS NULL OR LOCATE("'verbale'", @cur) > 0,
    'SELECT 1',
    CONCAT("ALTER TABLE documents MODIFY COLUMN doc_type ",
           LEFT(@cur, CHAR_LENGTH(@cur) - 1),
           ",'verbale') NOT NULL DEFAULT 'other'"));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'documents' AND COLUMN_NAME = 'building_id');
SET @sql := IF(@col = 0,
    'ALTER TABLE documents ADD COLUMN building_id INT UNSIGNED NULL AFTER property_id',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'documents' AND INDEX_NAME = 'idx_documents_building');
SET @sql := IF(@idx = 0,
    'ALTER TABLE documents ADD INDEX idx_documents_building (building_id)',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
            WHERE CONSTRAINT_SCHEMA = DATABASE()
              AND TABLE_NAME = 'documents' AND CONSTRAINT_NAME = 'fk_documents_building');
SET @sql := IF(@fk = 0,
    'ALTER TABLE documents ADD CONSTRAINT fk_documents_building
       FOREIGN KEY (building_id) REFERENCES buildings(id)
       ON DELETE RESTRICT ON UPDATE CASCADE',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
