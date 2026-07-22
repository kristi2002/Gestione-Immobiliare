-- phase49_login_attempts_username_backfill.sql
-- Re-assert the login_attempts.username column + index (originally added in
-- phase47).
--
-- WHY a second migration: on at least one deployment the prod `login_attempts`
-- table was missing the `username` column while phase47 was already recorded in
-- schema_migrations (a DB seeded/restored from a dump predating the column, so
-- the runner skips phase47 as "already applied"). The result was a hard 500 on
-- EVERY login across all portals, because config/login_throttle.php queries the
-- column. phase49 is a brand-new version, so migrate.php always runs it — and it
-- is a strict no-op wherever the column/index already exist.
--
-- Same guarded + idempotent pattern as phase47. The USE line is stripped by the
-- migration runner (config -> database/migrate.php); DATABASE() resolves to the
-- connected schema, prod or dev, whatever it is named.

USE gestione_immobiliare;

SET @has_col := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'login_attempts'
      AND column_name = 'username'
);
SET @sql := IF(@has_col = 0,
    'ALTER TABLE login_attempts ADD COLUMN username VARCHAR(190) NULL AFTER ip_address',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has_idx := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'login_attempts'
      AND index_name = 'idx_login_user_time'
);
SET @sql := IF(@has_idx = 0,
    'ALTER TABLE login_attempts ADD INDEX idx_login_user_time (username, attempted_at)',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
