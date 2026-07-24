-- phase57_building_administrator.sql
-- Amministratore di condominio sull'edificio. Per un edificio/complesso il
-- contatto operativo piu' importante e' l'amministratore: e' a lui che si
-- chiedono spese condominiali, lavori straordinari, regolamento, ecc. Prima
-- non c'era alcun campo (ne' su buildings, ne' nel form).
--
-- Tre colonne, tutte NULLABLE: non ogni edificio ha (o l'agenzia conosce) un
-- amministratore — piccoli stabili o ville non ne hanno. Nessun obbligo
-- applicativo: e' un contatto opzionale, non un dato di registrazione.
--
-- NOTA: la baseline database/schema_production.sql NON e' aggiornata in questo
-- commit di proposito (una sessione parallela la sta modificando in working
-- tree); va rigenerata piu' avanti. Questa migration e' la fonte di verita':
-- il runner applica le fasi > 28 anche sui fresh install, quindi le colonne
-- vengono create sia in deploy che su DB nuovo.
--
-- Idempotente: ogni colonna viene aggiunta solo se mancante.

USE gestione_immobiliare;

-- administrator_name --------------------------------------------------------
SET @col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'buildings' AND COLUMN_NAME = 'administrator_name'
);
SET @sql := IF(@col = 0,
    'ALTER TABLE buildings ADD COLUMN administrator_name VARCHAR(150) NULL AFTER notes',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- administrator_phone -------------------------------------------------------
SET @col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'buildings' AND COLUMN_NAME = 'administrator_phone'
);
SET @sql := IF(@col = 0,
    'ALTER TABLE buildings ADD COLUMN administrator_phone VARCHAR(30) NULL AFTER administrator_name',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- administrator_email -------------------------------------------------------
SET @col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'buildings' AND COLUMN_NAME = 'administrator_email'
);
SET @sql := IF(@col = 0,
    'ALTER TABLE buildings ADD COLUMN administrator_email VARCHAR(255) NULL AFTER administrator_phone',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
