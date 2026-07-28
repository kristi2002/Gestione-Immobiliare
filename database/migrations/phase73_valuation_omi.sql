-- phase73_valuation_omi.sql
-- Valutazioni OMI: da "tabella compilata a mano" a dato ufficiale importabile,
-- datato e tracciabile.
--
-- Stato precedente (phase38): `omi_quotazioni` esisteva già con i valori €/m² e
-- una colonna `period` VARCHAR(10) libera. Tre problemi concreti:
--
-- 1) POPOLAMENTO MANUALE
--    L'unico modo di riempire la tabella era il modale "Nuova quotazione OMI".
--    L'Agenzia delle Entrate pubblica ogni semestre i listini in CSV: ricopiarli
--    a mano zona per zona e tipologia per tipologia significa, per un solo
--    comune, decine di righe con quattro importi ciascuna. Un import ufficiale
--    rende il modale quello che deve essere — lo strumento per l'OVERRIDE e per
--    le microzone non coperte dal listino — non il metodo primario.
--    Da qui `source`: distingue la riga importata da quella corretta a mano, e
--    permette all'importer di NON sovrascrivere una correzione dell'agente.
--
-- 2) `period` NON VERIFICABILE
--    VARCHAR(10) libero accetta "2026-S1", "2026 S1", "1° sem 2026" e "asd".
--    Finché il formato non è garantito, nessuna query e nessun badge possono
--    dire se una quotazione è vecchia — e una stima immobiliare basata su un
--    listino di tre anni fa è sbagliata senza che nulla lo segnali.
--    La normalizzazione a `YYYY-S1|S2` avviene in PHP (config/omi.php); qui si
--    ripulisce lo storico e si aggiunge l'indice su cui poggia il confronto.
--
-- 3) LA STIMA NON LASCIAVA TRACCIA
--    `property_appraisals` (phase11) registra estimated_value + due comparabili,
--    ma non DA DOVE veniva il numero. Una valutazione salvata oggi e riletta fra
--    otto mesi è indistinguibile da una fatta a occhio: non si sa su quale
--    semestre OMI poggiasse, su quale zona, né con quali coefficienti di merito.
--    Le colonne di provenienza qui sotto rendono la valutazione rileggibile e
--    permettono alla scheda di avvisare "stima basata su dati OMI scaduti".

-- ── 1. omi_quotazioni: provenienza + periodo affidabile ──────────────────────

-- `source`: 'import' = riga dal listino ufficiale, 'manuale' = inserita o
-- corretta dall'agente. L'importer aggiorna solo le righe 'import', così una
-- microzona tarata a mano sopravvive al semestre successivo.
SET @sql := (SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'omi_quotazioni' AND COLUMN_NAME = 'source') = 0,
    "ALTER TABLE `omi_quotazioni`
       ADD COLUMN `source` ENUM('import','manuale') NOT NULL DEFAULT 'manuale'
         COMMENT 'Origine: import listino ufficiale o inserimento/override manuale' AFTER `period`",
    'SELECT 1'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- `omi_stato`: l'OMI pubblica ogni zona/tipologia in più stati conservativi
-- (NORMALE, OTTIMO, SCADENTE). L'import prende la riga NORMALE come base — lo
-- stato reale dell'immobile è poi applicato come coefficiente di merito, così
-- la chiave unica (comune, zona, tipologia) resta quella di phase38 e non si
-- moltiplicano le righe. Si conserva comunque quale stato è stato importato:
-- se per una tipologia il NORMALE non esiste, la base non è quella standard e
-- va detto.
SET @sql := (SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'omi_quotazioni' AND COLUMN_NAME = 'omi_stato') = 0,
    "ALTER TABLE `omi_quotazioni`
       ADD COLUMN `omi_stato` VARCHAR(20) DEFAULT NULL
         COMMENT 'Stato conservativo della riga OMI di origine (NORMALE/OTTIMO/SCADENTE)' AFTER `source`",
    'SELECT 1'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Ripulitura dello storico scritto a mano prima che il formato fosse imposto.
-- Si recuperano solo le forme inequivocabili (anno + semestre in qualsiasi
-- ordine/separatore); tutto il resto diventa NULL, che l'app tratta come
-- "periodo ignoto" e segnala — meglio di un periodo inventato.
UPDATE `omi_quotazioni`
   SET `period` = CONCAT(
         REGEXP_SUBSTR(`period`, '(19|20)[0-9]{2}'),
         '-S',
         IF(`period` REGEXP '(^|[^0-9])2(°|º)?[[:space:]]*(sem|SEM|s|S)|S2|-2$', '2', '1'))
 WHERE `period` IS NOT NULL
   AND `period` <> ''
   AND `period` NOT REGEXP '^(19|20)[0-9]{2}-S[12]$'
   AND `period` REGEXP '(19|20)[0-9]{2}';

UPDATE `omi_quotazioni`
   SET `period` = NULL
 WHERE `period` IS NOT NULL
   AND `period` NOT REGEXP '^(19|20)[0-9]{2}-S[12]$';

-- Il badge "quotazione scaduta" e il filtro per semestre leggono questa colonna
-- su tutta la tabella: senza indice diventano scansioni complete a ogni stima.
SET @sql := (SELECT IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'omi_quotazioni' AND INDEX_NAME = 'idx_omi_period') = 0,
    "ALTER TABLE `omi_quotazioni` ADD INDEX `idx_omi_period` (`period`)",
    'SELECT 1'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── 2. property_appraisals: provenienza della stima ──────────────────────────
--
-- Tutte nullable: le valutazioni già registrate sono state fatte a mano e non
-- hanno una base OMI da dichiarare. NULL qui significa "stima manuale", non
-- "dato mancante", e la scheda la mostra come tale invece di segnalarla scaduta.

SET @sql := (SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'property_appraisals' AND COLUMN_NAME = 'omi_period') = 0,
    "ALTER TABLE `property_appraisals`
       ADD COLUMN `omi_period`     VARCHAR(10)  DEFAULT NULL COMMENT 'Semestre OMI su cui poggia la stima (YYYY-S1|S2)',
       ADD COLUMN `omi_zone`       VARCHAR(20)  DEFAULT NULL COMMENT 'Zona OMI usata',
       ADD COLUMN `omi_price_min`  DECIMAL(10,2) DEFAULT NULL COMMENT 'Vendita €/m² min del listino applicato',
       ADD COLUMN `omi_price_max`  DECIMAL(10,2) DEFAULT NULL COMMENT 'Vendita €/m² max del listino applicato',
       ADD COLUMN `sqm_used`       DECIMAL(8,2) DEFAULT NULL COMMENT 'Superficie usata nel calcolo (commerciale se disponibile)',
       ADD COLUMN `coefficient`    DECIMAL(5,3) DEFAULT NULL COMMENT 'Coefficiente di merito complessivo applicato (1.000 = nessuna rettifica)',
       ADD COLUMN `estimate_basis` VARCHAR(255) DEFAULT NULL COMMENT 'Descrizione leggibile della base di calcolo'",
    'SELECT 1'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
