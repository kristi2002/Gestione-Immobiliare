-- phase47_login_throttle_username.sql
-- Add per-username brute-force throttling alongside the existing per-IP throttle.
--
-- login_attempts previously tracked only ip_address, so an attacker rotating IPs
-- faced no account-level limit, and one NAT'd office IP could lock out all staff.
-- This adds a `username` column + index so isLoginLocked()/recordLoginAttempt()
-- can throttle a targeted account regardless of source IP.
--
-- Guarded + idempotent: if the column/index already exist (e.g. a fresh load of
-- schema_production.sql, which now includes them), each step is a no-op.

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
