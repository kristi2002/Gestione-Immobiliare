-- Migration helpers — run once before other migrations (safe to re-run).
-- Provides idempotent column/index operations for MySQL 8.

USE gestione_immobiliare;

DROP PROCEDURE IF EXISTS migration_add_column;
DROP PROCEDURE IF EXISTS migration_add_index;
DROP PROCEDURE IF EXISTS migration_add_unique_index;
DROP PROCEDURE IF EXISTS migration_rename_column;

DELIMITER //

CREATE PROCEDURE migration_add_column(
    IN p_table VARCHAR(64),
    IN p_column VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table
          AND COLUMN_NAME = p_column
    ) THEN
        SET @sql = CONCAT(
            'ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition
        );
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END //

CREATE PROCEDURE migration_add_index(
    IN p_table VARCHAR(64),
    IN p_index VARCHAR(64),
    IN p_columns TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table
          AND INDEX_NAME = p_index
    ) THEN
        SET @sql = CONCAT(
            'ALTER TABLE `', p_table, '` ADD INDEX `', p_index, '` (', p_columns, ')'
        );
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END //

-- Indice UNIVOCO. Separato da migration_add_index perche' puo' FALLIRE per un
-- motivo legittimo: i duplicati esistono gia'. In quel caso deve fallire — e'
-- il punto dell'indice. Chi lo chiama ripulisce prima i duplicati.
CREATE PROCEDURE migration_add_unique_index(
    IN p_table VARCHAR(64),
    IN p_index VARCHAR(64),
    IN p_columns TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table
          AND INDEX_NAME = p_index
    ) THEN
        SET @sql = CONCAT(
            'ALTER TABLE `', p_table, '` ADD UNIQUE INDEX `', p_index, '` (', p_columns, ')'
        );
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END //

-- Per le chiavi esterne c'e' gia' migration_add_fk, definita in
-- phase31_multi_tenant_scaffold.sql: non se ne aggiunge una seconda che fa lo
-- stesso lavoro con un'altra firma.

-- Rinomina una colonna solo se c'e' ancora il vecchio nome e non esiste gia' il
-- nuovo: rieseguire la migrazione dopo un rinomina riuscito non deve fallire.
CREATE PROCEDURE migration_rename_column(
    IN p_table VARCHAR(64),
    IN p_old VARCHAR(64),
    IN p_new VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_old
    ) AND NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_new
    ) THEN
        SET @sql = CONCAT(
            'ALTER TABLE `', p_table, '` CHANGE COLUMN `', p_old, '` `', p_new, '` ', p_definition
        );
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END //

DELIMITER ;
