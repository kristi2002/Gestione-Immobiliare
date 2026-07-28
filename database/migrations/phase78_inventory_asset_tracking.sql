-- phase78_inventory_asset_tracking.sql
--
-- L'inventario nasce come lista della spesa: nome, categoria, quantita', tre
-- stelline. Regge il colpo d'occhio in dashboard e non regge niente altro. La
-- cauzione trattenuta si contesta davanti a un giudice di pace con prove, e
-- "condizione 3/5" non e' una prova: non dice quale lavatrice, non dice com'era,
-- non dice quanto valeva.
--
-- Questa migrazione porta l'inventario da lista a registro dei beni:
--
--   1. le categorie diventano una tabella. Oggi aggiungere "Biancheria" per gli
--      affitti brevi vuol dire toccare l'ENUM, la costante PHP e due <select>:
--      quattro punti, e ne basta uno dimenticato per far rifiutare all'API
--      un'opzione che il form mostra (e' gia' successo, vedi phase62).
--   2. marca / modello / matricola / valore / garanzia: senza questi campi il
--      link col ticket di manutenzione non serve a nulla — l'idraulico riceve
--      "lavatrice rotta", non "Bosch WAN28. matricola 0937, in garanzia fino al
--      2027".
--   3. le foto NON diventano una colonna: vanno in `documents`, l'unico ramo di
--      uploads/ con deny Apache, streamer autenticato e log GDPR (stesso
--      ragionamento di phase75 per le letture contatore).
--   4. i verbali (`inventory_snapshots`): l'inventario e' dell'immobile, la
--      contestazione e' del CONTRATTO. Finora scrivere la condizione d'uscita
--      avrebbe sovrascritto quella d'ingresso, cioe' distrutto la linea di
--      partenza nel momento esatto in cui serve. Il verbale congela le righe per
--      quella locazione: check-in e check-out coesistono e si confrontano.

-- ─── 1. Categorie come tabella ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `inventory_categories` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug`       VARCHAR(50)  NOT NULL COMMENT 'Valore salvato su property_inventory.category',
  `label`      VARCHAR(100) NOT NULL COMMENT 'Etichetta mostrata nei form',
  `sort_order` SMALLINT     NOT NULL DEFAULT 0,
  `is_active`  TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_inv_cat_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- I cinque valori dell'ENUM storico, piu' "biancheria" (affitti brevi): da qui
-- in avanti aggiungerne una e' una INSERT, non una migrazione.
INSERT IGNORE INTO `inventory_categories` (`slug`, `label`, `sort_order`) VALUES
  ('mobile',           'Mobile / Arredo',   10),
  ('arredamento',      'Arredamento',       20),
  ('elettrodomestico', 'Elettrodomestico',  30),
  ('impianto',         'Impianto',          40),
  ('biancheria',       'Biancheria',        50),
  ('altro',            'Altro',             99);

-- ENUM → VARCHAR + FK. La colonna resta `category` e resta il suo valore
-- testuale: tutte le query esistenti (WHERE pi.category = :category, ORDER BY
-- pi.category) continuano a funzionare senza JOIN.
SET @cur := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'property_inventory'
                AND COLUMN_NAME  = 'category');
SET @sql := IF(@cur IS NULL OR LOCATE('enum', LOWER(@cur)) = 0,
    'SELECT 1',
    "ALTER TABLE property_inventory
        MODIFY COLUMN category VARCHAR(50)
        CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        NOT NULL DEFAULT 'altro'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
             WHERE TABLE_SCHEMA    = DATABASE()
               AND TABLE_NAME      = 'property_inventory'
               AND CONSTRAINT_NAME = 'fk_inv_category');
SET @sql := IF(@fk > 0,
    'SELECT 1',
    'ALTER TABLE property_inventory ADD CONSTRAINT fk_inv_category
       FOREIGN KEY (category) REFERENCES inventory_categories (slug)
       ON DELETE RESTRICT ON UPDATE CASCADE');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ─── 2. Campi del bene ────────────────────────────────────────────────────────
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'property_inventory'
                AND COLUMN_NAME = 'brand');
SET @sql := IF(@col > 0, 'SELECT 1',
    'ALTER TABLE property_inventory
       ADD COLUMN brand           VARCHAR(100)  NULL AFTER category,
       ADD COLUMN model           VARCHAR(100)  NULL AFTER brand,
       ADD COLUMN serial_number   VARCHAR(100)  NULL AFTER model,
       ADD COLUMN estimated_value DECIMAL(10,2) NULL AFTER serial_number,
       ADD COLUMN warranty_until  DATE          NULL AFTER estimated_value');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ─── 3. Foto: documents.inventory_item_id ─────────────────────────────────────
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documents'
                AND COLUMN_NAME = 'inventory_item_id');
SET @sql := IF(@col > 0, 'SELECT 1',
    'ALTER TABLE documents ADD COLUMN inventory_item_id INT UNSIGNED NULL AFTER meter_reading_id');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documents'
                AND INDEX_NAME = 'idx_documents_inventory_item');
SET @sql := IF(@idx > 0, 'SELECT 1',
    'ALTER TABLE documents ADD INDEX idx_documents_inventory_item (inventory_item_id)');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- CASCADE: una foto senza il bene che ritrae non significa niente. Il file su
-- disco lo cancella comunque l'API prima di eliminare l'articolo — il CASCADE e'
-- la rete per le cancellazioni fatte in SQL diretto.
SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documents'
               AND CONSTRAINT_NAME = 'fk_documents_inventory_item');
SET @sql := IF(@fk > 0, 'SELECT 1',
    'ALTER TABLE documents ADD CONSTRAINT fk_documents_inventory_item
       FOREIGN KEY (inventory_item_id) REFERENCES property_inventory (id)
       ON DELETE CASCADE ON UPDATE CASCADE');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- doc_type += 'inventario'. Si legge il valore CORRENTE e si appende, invece di
-- riscrivere la lista: altre migrazioni toccano lo stesso ENUM e l'ultima
-- applicata cancellerebbe i valori dell'altra (vedi phase75).
SET @cur := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documents'
                AND COLUMN_NAME = 'doc_type');
SET @sql := IF(@cur IS NULL OR LOCATE("'inventario'", @cur) > 0, 'SELECT 1',
    CONCAT("ALTER TABLE documents MODIFY COLUMN doc_type ",
           LEFT(@cur, CHAR_LENGTH(@cur) - 1),
           ",'inventario') NOT NULL DEFAULT 'other'"));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ─── 4. Ticket manutenzione ↔ bene ────────────────────────────────────────────
-- Il ticket vero e' una riga `reminders` con request_type='maintenance': e' cio'
-- che scrive il portale inquilino ed e' cio' che legge la board Manutenzione.
-- (`maintenance_requests` di phase41 non ha piu' nessun lettore vivo.)
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reminders'
                AND COLUMN_NAME = 'inventory_item_id');
SET @sql := IF(@col > 0, 'SELECT 1',
    'ALTER TABLE reminders ADD COLUMN inventory_item_id INT UNSIGNED NULL AFTER property_id');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reminders'
                AND INDEX_NAME = 'idx_rem_inventory_item');
SET @sql := IF(@idx > 0, 'SELECT 1',
    'ALTER TABLE reminders ADD INDEX idx_rem_inventory_item (inventory_item_id)');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- SET NULL, non CASCADE: se il bene viene rimosso dall'inventario, lo storico
-- dell'intervento resta. E' successo, va tracciato, e il costo era reale.
SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reminders'
               AND CONSTRAINT_NAME = 'fk_reminders_inventory_item');
SET @sql := IF(@fk > 0, 'SELECT 1',
    'ALTER TABLE reminders ADD CONSTRAINT fk_reminders_inventory_item
       FOREIGN KEY (inventory_item_id) REFERENCES property_inventory (id)
       ON DELETE SET NULL ON UPDATE CASCADE');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ─── 5. Verbali di consegna (snapshot per contratto) ──────────────────────────
CREATE TABLE IF NOT EXISTS `inventory_snapshots` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `contract_id`      INT UNSIGNED NOT NULL,
  `property_id`      INT UNSIGNED NOT NULL,
  `phase`            ENUM('check_in','check_out') NOT NULL,
  `status`           ENUM('draft','locked')       NOT NULL DEFAULT 'draft',
  `snapshot_date`    DATE         NOT NULL,
  `notes`            TEXT         NULL,
  `document_id`      INT UNSIGNED NULL COMMENT 'PDF generato alla chiusura',
  `esign_request_id` INT UNSIGNED NULL COMMENT 'Richiesta di firma inviata all inquilino',
  `content_hash`     CHAR(64)     NULL COMMENT 'SHA-256 del PDF congelato',
  `locked_at`        DATETIME     NULL,
  `locked_by`        INT UNSIGNED NULL,
  `created_by`       INT UNSIGNED NULL,
  `created_at`       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- Un solo verbale d'ingresso e uno d'uscita per locazione: il secondo
  -- check-in di un contratto sarebbe una riscrittura della linea di partenza.
  UNIQUE KEY `uq_inv_snap_contract_phase` (`contract_id`, `phase`),
  KEY `idx_inv_snap_property` (`property_id`),
  KEY `idx_inv_snap_status` (`status`),
  CONSTRAINT `fk_inv_snap_contract`  FOREIGN KEY (`contract_id`)      REFERENCES `contracts` (`id`)      ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT `fk_inv_snap_property`  FOREIGN KEY (`property_id`)      REFERENCES `properties` (`id`)     ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT `fk_inv_snap_document`  FOREIGN KEY (`document_id`)      REFERENCES `documents` (`id`)      ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_inv_snap_esign`     FOREIGN KEY (`esign_request_id`) REFERENCES `esign_requests` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_inv_snap_locked_by` FOREIGN KEY (`locked_by`)        REFERENCES `admin_users` (`id`)    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_inv_snap_created_by` FOREIGN KEY (`created_by`)      REFERENCES `admin_users` (`id`)    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Le righe sono COPIE, non riferimenti: se domani l'articolo viene modificato o
-- cancellato, il verbale firmato deve continuare a dire cosa fu consegnato.
CREATE TABLE IF NOT EXISTS `inventory_snapshot_items` (
  `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `snapshot_id`       INT UNSIGNED NOT NULL,
  `inventory_item_id` INT UNSIGNED NULL COMMENT 'Riferimento vivo, puo sparire: i dati sotto restano',
  `item_name`         VARCHAR(150) NOT NULL,
  `category`          VARCHAR(50)  NULL,
  `quantity`          INT          NOT NULL DEFAULT 1,
  `condition_rating`  TINYINT      NULL COMMENT '1-5, NULL finche l agente non compila il check-out',
  `notes`             VARCHAR(255) NULL,
  `brand`             VARCHAR(100) NULL,
  `model`             VARCHAR(100) NULL,
  `serial_number`     VARCHAR(100) NULL,
  `estimated_value`   DECIMAL(10,2) NULL,
  `photo_count`       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `created_at`        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_inv_snapitem_snapshot` (`snapshot_id`),
  KEY `idx_inv_snapitem_item` (`inventory_item_id`),
  CONSTRAINT `fk_inv_snapitem_snapshot` FOREIGN KEY (`snapshot_id`)       REFERENCES `inventory_snapshots` (`id`) ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT `fk_inv_snapitem_item`     FOREIGN KEY (`inventory_item_id`) REFERENCES `property_inventory` (`id`)  ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
