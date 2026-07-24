-- phase54_lead_preferred_property.sql
-- "Immobile richiesto": collega un lead all'immobile specifico per cui ha
-- chiamato (es. il RIF visto in vetrina / sul portale). E' un concetto diverso
-- dal match automatico salvato in lead_property_matches, che resta invariato.
-- Aggiunge leads.preferred_property_id con FK ON DELETE SET NULL: se l'immobile
-- viene eliminato il lead sopravvive, semplicemente senza collegamento.
-- Idempotente: colonna, indice e FK vengono aggiunti solo se mancanti.

USE gestione_immobiliare;

-- Colonna ------------------------------------------------------------------
SET @col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'preferred_property_id'
);
SET @sql := IF(@col = 0,
    'ALTER TABLE leads ADD COLUMN preferred_property_id INT UNSIGNED NULL AFTER preferred_type',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Indice (richiesto dalla FK) ----------------------------------------------
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'leads' AND INDEX_NAME = 'idx_leads_preferred_property'
);
SET @sql := IF(@idx = 0,
    'ALTER TABLE leads ADD INDEX idx_leads_preferred_property (preferred_property_id)',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Foreign key --------------------------------------------------------------
SET @fk := (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'leads' AND CONSTRAINT_NAME = 'fk_leads_preferred_property'
);
SET @sql := IF(@fk = 0,
    'ALTER TABLE leads ADD CONSTRAINT fk_leads_preferred_property FOREIGN KEY (preferred_property_id) REFERENCES properties(id) ON DELETE SET NULL',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
