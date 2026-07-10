-- Least-privilege application database user.
-- Run this once as an administrative MySQL user (e.g. root) on the DB server,
-- then set DB_USER/DB_PASS in the app environment to this user. The app must NOT
-- run as root in production (DEPLOY liability #2).
--
-- The app + migration runner need full DML *and* DDL, but only on the app schema
-- (CREATE/ALTER/INDEX/FK/stored procedures during migrations). Granting ALL on a
-- single schema — with no global privileges (no SUPER/FILE/PROCESS/other DBs) —
-- is the least privilege that keeps migrations working.

-- 1) Change the password below before running.
CREATE USER IF NOT EXISTS 'gestionale_app'@'%' IDENTIFIED BY 'CHANGE_ME_TO_A_STRONG_PASSWORD';

-- 2) Scope all privileges to the app database only.
GRANT ALL PRIVILEGES ON `gestione_immobiliare`.* TO 'gestionale_app'@'%';

-- 3) Apply.
FLUSH PRIVILEGES;

-- Tip: restrict the host from '%' to the app container's network/subnet where
-- possible (e.g. 'gestionale_app'@'10.%'), and never reuse the root account.
