-- phase76_meters_registry.sql
-- Finora il "contatore" non esisteva come cosa: c'era solo `meter_readings`
-- appeso all'immobile con un ENUM a quattro voci. Le conseguenze pratiche:
--
--   * Due contatori gas nello stesso immobile (la caldaia condominiale e quella
--     autonoma, o un negozio con due utenze) erano indistinguibili. Le loro
--     letture finivano nella stessa serie e il consumo calcolato era la
--     differenza fra numeri di quadranti diversi: un dato senza senso.
--   * Non c'era posto per il POD, il PDR, la matricola, il fornitore o il punto
--     fisico in cui si trova il contatore. Sono esattamente le informazioni che
--     servono per una voltura, per un reclamo al fornitore o per spiegare a un
--     agente nuovo dove andare a leggere.
--   * La KPI "Contatori Censiti" contava
--     COUNT(DISTINCT CONCAT(property_id,'-',meter_type)), cioe' le combinazioni
--     che avevano gia' una lettura. Un contatore mai letto non esisteva, e il
--     numero non era un censimento ma un effetto collaterale.
--
-- Il codice identificativo sta in UNA colonna, `code`, e non in tre (pod/pdr/
-- matricola): per ogni contatore ne esiste sempre e solo uno, e quale sia lo
-- dice gia' il tipo — luce = POD, gas = PDR, acqua e riscaldamento = matricola.
-- Tre colonne di cui due sempre vuote avrebbero solo spostato il problema.
-- E' UNIQUE perche' POD e PDR sono identificativi nazionali: lo stesso codice
-- su due immobili e' un errore di inserimento, non un caso reale. I NULL non
-- sono vincolati (MySQL li ammette ripetuti), quindi un contatore ancora senza
-- codice non blocca niente.
--
-- `supplier_id` + `supplier_name` ripetono la scelta gia' fatta in phase74 per
-- l'amministratore di condominio: il collegamento alla rubrica quando c'e', il
-- testo libero come ripiego per chi ha solo un nome. Nessuna delle due e'
-- obbligatoria.
--
-- `meter_readings.meter_id` resta NULLABLE e `property_id`/`meter_type`
-- restano al loro posto. Non e' pigrizia: renderlo NOT NULL avrebbe rotto ogni
-- inserimento esistente (i seed, gli script, le vecchie chiamate API), e
-- togliere le due colonne avrebbe richiesto di riscrivere ogni filtro. La API
-- risolve o crea il contatore a ogni scrittura e RIDERIVA property_id e
-- meter_type dal contatore scelto, quindi le due colonne non possono divergere:
-- restano una copia sempre allineata, comoda per i filtri, non una seconda
-- verita'.

-- ─── meters ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meters (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_id   INT UNSIGNED NOT NULL,
    meter_type    ENUM('gas','electricity','water','heating') NOT NULL,
    code          VARCHAR(50) NULL COMMENT 'POD (luce), PDR (gas), matricola (acqua/riscaldamento)',
    serial_number VARCHAR(50) NULL,
    supplier_id   INT UNSIGNED NULL,
    supplier_name VARCHAR(150) NULL,
    location      VARCHAR(150) NULL COMMENT 'Dove si trova fisicamente: vano scala, piano -2, cortile',
    installed_on  DATE NULL,
    removed_on    DATE NULL,
    is_active     TINYINT(1) NOT NULL DEFAULT 1,
    notes         VARCHAR(255) NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_meters_code (code),
    INDEX idx_meters_property (property_id),
    INDEX idx_meters_type (meter_type),
    INDEX idx_meters_supplier (supplier_id),
    CONSTRAINT fk_meters_property FOREIGN KEY (property_id) REFERENCES properties (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_meters_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── meter_readings.meter_id ───────────────────────────────────────────────────
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'meter_readings'
                AND COLUMN_NAME  = 'meter_id');
SET @sql := IF(@col > 0,
    'SELECT 1',
    'ALTER TABLE meter_readings ADD COLUMN meter_id INT UNSIGNED NULL AFTER property_id');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'meter_readings'
                AND INDEX_NAME   = 'idx_mr_meter');
SET @sql := IF(@idx > 0,
    'SELECT 1',
    'ALTER TABLE meter_readings ADD INDEX idx_mr_meter (meter_id, reading_date)');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ON DELETE CASCADE: le letture di un contatore rimosso non hanno piu' un
-- quadrante a cui riferirsi. La API elimina comunque prima le foto allegate
-- (phase75), altrimenti resterebbero file orfani sotto uploads/.
SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
             WHERE TABLE_SCHEMA    = DATABASE()
               AND TABLE_NAME      = 'meter_readings'
               AND CONSTRAINT_NAME = 'fk_mr_meter');
SET @sql := IF(@fk > 0,
    'SELECT 1',
    'ALTER TABLE meter_readings ADD CONSTRAINT fk_mr_meter
       FOREIGN KEY (meter_id) REFERENCES meters (id)
       ON DELETE CASCADE ON UPDATE CASCADE');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ─── Backfill: un contatore per ogni serie di letture gia' esistente ───────────
-- Ogni coppia (immobile, tipo) che ha gia' delle letture diventa un contatore
-- censito, cosi' lo storico non resta orfano e la KPI parte da un numero vero.
-- Il codice resta vuoto: nessuno puo' inventarsi il POD a posteriori, lo
-- compilera' l'agente.
INSERT INTO meters (property_id, meter_type, notes)
SELECT mr.property_id, mr.meter_type,
       'Creato automaticamente dallo storico letture (phase76).'
  FROM meter_readings mr
  LEFT JOIN meters m
         ON m.property_id = mr.property_id
        AND m.meter_type  = mr.meter_type
 WHERE mr.meter_id IS NULL
   AND m.id IS NULL
 GROUP BY mr.property_id, mr.meter_type;

-- Aggancio delle letture. Se per una coppia esistessero gia' piu' contatori si
-- prende il piu' vecchio (MIN(id)): e' quello nato dallo storico, cioe' proprio
-- la serie a cui quelle letture appartengono.
UPDATE meter_readings mr
  JOIN (SELECT property_id, meter_type, MIN(id) AS meter_id
          FROM meters
         GROUP BY property_id, meter_type) m
    ON m.property_id = mr.property_id
   AND m.meter_type  = mr.meter_type
   SET mr.meter_id = m.meter_id
 WHERE mr.meter_id IS NULL;

-- ─── suppliers.category += 'fornitore_utenze' ──────────────────────────────────
-- Append dinamico invece di riscrivere la lista: phase74 tocca lo stesso enum e
-- due riscritture complete si cancellerebbero a vicenda secondo l'ordine di
-- applicazione.
SET @cur := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'suppliers'
                AND COLUMN_NAME  = 'category');
SET @sql := IF(@cur IS NULL OR LOCATE("'fornitore_utenze'", @cur) > 0,
    'SELECT 1',
    CONCAT("ALTER TABLE suppliers MODIFY COLUMN category ",
           LEFT(@cur, CHAR_LENGTH(@cur) - 1),
           ",'fornitore_utenze') NOT NULL DEFAULT 'altro'"));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
