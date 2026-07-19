-- ============================================================================
-- Least-privilege application database user  (DEPLOY liability #2: no root)
-- ============================================================================
-- Run this ONCE as an administrative MySQL user (e.g. root) on the DB server,
-- then set DB_USER/DB_PASS in the app environment to this user. The app must
-- NOT run as root in production.
--
-- The app + migration runner (database/migrate.php runs on every container
-- start) need full DML *and* DDL — CREATE/ALTER/INDEX/FK/stored procedures —
-- but only on the app schema. Granting ALL on the app schema, with NO global
-- privileges (no SUPER/FILE/PROCESS/RELOAD/SHUTDOWN, no access to `mysql` or
-- any other database), is the least privilege that keeps migrations working.
--
-- IMPORTANT — database name differs by environment:
--   • Production (Coolify) DB is named  `default`
--   • Local docker-compose / dev DB is  `gestione_immobiliare`
-- This script grants on BOTH so the same file is correct everywhere. Granting
-- on a schema that doesn't exist on a given server is harmless — MySQL simply
-- records the privilege. Delete whichever line you don't need if you prefer.
-- ============================================================================

-- 1) Change the password before running. Generate a strong one, e.g.:
--       openssl rand -base64 24
CREATE USER IF NOT EXISTS 'gestionale_app'@'%' IDENTIFIED BY 'CHANGE_ME_TO_A_STRONG_PASSWORD';

-- 2) Scope ALL privileges to the app database ONLY (no global grants).
GRANT ALL PRIVILEGES ON `default`.*               TO 'gestionale_app'@'%';   -- production (Coolify)
GRANT ALL PRIVILEGES ON `gestione_immobiliare`.*  TO 'gestionale_app'@'%';   -- local / dev

-- 3) Apply.
FLUSH PRIVILEGES;

-- ----------------------------------------------------------------------------
-- Verify (run as admin): the app user must have schema-scoped grants and NO
-- global privileges. The first row should show only DB-scoped GRANTs; there
-- must be NO "GRANT ALL PRIVILEGES ON *.*" (that would mean it's still global).
-- ----------------------------------------------------------------------------
-- SHOW GRANTS FOR 'gestionale_app'@'%';
--
-- Expected shape:
--   GRANT USAGE ON *.* TO `gestionale_app`@`%`                 <- no global privs, just the account
--   GRANT ALL PRIVILEGES ON `default`.* TO `gestionale_app`@`%`
--   GRANT ALL PRIVILEGES ON `gestione_immobiliare`.* TO `gestionale_app`@`%`

-- Tip: restrict the host from '%' to the app container's network/subnet where
-- possible (e.g. 'gestionale_app'@'10.%'), and never reuse the root account.
