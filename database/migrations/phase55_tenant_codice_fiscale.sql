-- phase55_tenant_codice_fiscale.sql
-- Il Codice Fiscale del conduttore e' obbligatorio per la Registrazione
-- telematica del contratto di locazione all'Agenzia delle Entrate (modello RLI):
-- senza CF il contratto non e' registrabile. La tabella `tenants` non lo aveva,
-- mentre `clients` (proprietari) lo ha da sempre. Qui lo aggiungiamo al conduttore.
--
-- Colonna NULLABLE: gli inquilini gia' in anagrafica non ce l'hanno e non vanno
-- bloccati; l'obbligatorieta' per i NUOVI inserimenti e' applicata a livello
-- applicativo (api/tenants.php + form). Coerente con clients.codice_fiscale, che
-- e' anch'esso VARCHAR(16) nullable.
--
-- Idempotente: la colonna e l'indice vengono aggiunti solo se mancanti.

USE gestione_immobiliare;

-- Colonna ------------------------------------------------------------------
SET @col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tenants' AND COLUMN_NAME = 'codice_fiscale'
);
SET @sql := IF(@col = 0,
    'ALTER TABLE tenants ADD COLUMN codice_fiscale VARCHAR(16) NULL AFTER email',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Indice (ricerca per CF, come su clients) ---------------------------------
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tenants' AND INDEX_NAME = 'idx_tenants_cf'
);
SET @sql := IF(@idx = 0,
    'ALTER TABLE tenants ADD INDEX idx_tenants_cf (codice_fiscale)',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
