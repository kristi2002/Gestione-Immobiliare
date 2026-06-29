-- phase28_contract_auto_status.sql
-- Make contracts.status optional so a contract can be left "Automatico":
-- when status IS NULL, the state is derived from the dates
-- (Attivo while inside start_date..end_date, Scaduto once end_date has passed).
-- Manual statuses (draft/sent/signed/cancelled) remain available but optional.
--
-- Safe to run once. Making the column nullable does not alter existing rows.

ALTER TABLE `contracts`
    MODIFY COLUMN `status`
    ENUM('draft','sent','signed','expired','cancelled')
    COLLATE utf8mb4_unicode_ci
    NULL DEFAULT NULL;
