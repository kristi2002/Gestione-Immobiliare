-- phase56_lead_next_action.sql
-- "Prossima azione" sul lead: rende la scheda agente un vero strumento di
-- workflow. Aggiunge una data di follow-up (next_action_at) e una nota breve
-- (next_action) così l'agente vede a colpo d'occhio cosa fare e quando su
-- ogni lead assegnato, e la tabella può ordinare per urgenza.
-- Idempotente: ogni colonna viene aggiunta solo se mancante.

USE gestione_immobiliare;

-- next_action_at (data di follow-up) --------------------------------------
SET @col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'next_action_at'
);
SET @sql := IF(@col = 0,
    'ALTER TABLE leads ADD COLUMN next_action_at DATE NULL AFTER status',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- next_action (nota breve dell'azione) ------------------------------------
SET @col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'next_action'
);
SET @sql := IF(@col = 0,
    'ALTER TABLE leads ADD COLUMN next_action VARCHAR(255) NULL AFTER next_action_at',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- indice per ordinare i lead per urgenza del follow-up --------------------
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'leads' AND INDEX_NAME = 'idx_leads_next_action'
);
SET @sql := IF(@idx = 0,
    'ALTER TABLE leads ADD INDEX idx_leads_next_action (next_action_at)',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
