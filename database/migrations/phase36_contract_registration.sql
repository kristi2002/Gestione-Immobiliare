-- Phase 36 — Lease registration (RLI), cedolare secca, imposta di registro, ISTAT
-- Run once against the production DB:
--   mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" < database/migrations/phase36_contract_registration.sql

ALTER TABLE `contracts`
  ADD COLUMN `contract_subtype` VARCHAR(30) DEFAULT NULL
      COMMENT 'Sottotipo locazione: 4+4, 3+2, transitorio, studenti, comodato, commerciale' AFTER `contract_type`,
  ADD COLUMN `registration_number`   VARCHAR(50)  DEFAULT NULL COMMENT 'Numero registrazione Agenzia Entrate',
  ADD COLUMN `registration_date`     DATE         DEFAULT NULL COMMENT 'Data registrazione',
  ADD COLUMN `registration_office`   VARCHAR(120) DEFAULT NULL COMMENT 'Ufficio Agenzia delle Entrate',
  ADD COLUMN `cedolare_secca`        TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'Regime cedolare secca 0/1',
  ADD COLUMN `registration_tax_annual` DECIMAL(10,2) DEFAULT NULL COMMENT 'Imposta di registro annua (EUR)',
  ADD COLUMN `stamp_duty`            DECIMAL(10,2) DEFAULT NULL COMMENT 'Imposta di bollo (EUR)',
  ADD COLUMN `imposta_registro_due_date` DATE     DEFAULT NULL COMMENT 'Prossima scadenza imposta di registro',
  ADD COLUMN `istat_update_enabled`  TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'Aggiornamento ISTAT canone 0/1',
  ADD COLUMN `istat_baseline_index`  DECIMAL(8,3) DEFAULT NULL COMMENT 'Indice FOI di riferimento alla firma',
  ADD COLUMN `istat_baseline_month`  VARCHAR(7)   DEFAULT NULL COMMENT 'Mese indice base (YYYY-MM)',
  ADD COLUMN `last_istat_update`     DATE         DEFAULT NULL COMMENT 'Ultimo adeguamento ISTAT applicato';

ALTER TABLE `contracts`
  ADD KEY `idx_contracts_registro_due` (`imposta_registro_due_date`);
