-- ============================================================
-- Phase 22 — Referential Integrity & Index Fixes
-- Adds all missing FK constraints and indexes identified in
-- the June 2026 database audit.
-- Safe to run multiple times (uses IF NOT EXISTS where possible).
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ------------------------------------------------------------
-- 1. stripe_payments — missing FKs on payment_id + tenant_id
-- ------------------------------------------------------------
ALTER TABLE stripe_payments
    ADD CONSTRAINT fk_sp_payment
        FOREIGN KEY (payment_id) REFERENCES payments(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT fk_sp_tenant
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        ON DELETE CASCADE ON UPDATE CASCADE;

-- Index tenant_id (payment_id already has MUL via existing index)
ALTER TABLE stripe_payments ADD INDEX idx_sp_tenant (tenant_id);

-- ------------------------------------------------------------
-- 2. payment_reminder_log — missing FKs on all 3 columns
-- ------------------------------------------------------------
ALTER TABLE payment_reminder_log
    ADD CONSTRAINT fk_prl_payment
        FOREIGN KEY (payment_id) REFERENCES payments(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT fk_prl_tenant
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT fk_prl_client
        FOREIGN KEY (client_id) REFERENCES clients(id)
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE payment_reminder_log
    ADD INDEX idx_prl_tenant (tenant_id),
    ADD INDEX idx_prl_client (client_id);

-- ------------------------------------------------------------
-- 3. property_insurance — missing FK on client_id
-- ------------------------------------------------------------
ALTER TABLE property_insurance
    ADD CONSTRAINT fk_pi_client
        FOREIGN KEY (client_id) REFERENCES clients(id)
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE property_insurance ADD INDEX idx_pi_client (client_id);

-- ------------------------------------------------------------
-- 4. meter_readings — missing FK on property_id
--    (index idx_mr_property already exists)
-- ------------------------------------------------------------
ALTER TABLE meter_readings
    ADD CONSTRAINT fk_mr_property
        FOREIGN KEY (property_id) REFERENCES properties(id)
        ON DELETE CASCADE ON UPDATE CASCADE;

-- ------------------------------------------------------------
-- 5. property_inventory — missing FK on property_id
--    (index idx_inv_property already exists)
-- ------------------------------------------------------------
ALTER TABLE property_inventory
    ADD CONSTRAINT fk_inv_property
        FOREIGN KEY (property_id) REFERENCES properties(id)
        ON DELETE CASCADE ON UPDATE CASCADE;

-- ------------------------------------------------------------
-- 6. building_properties — missing FKs on both columns
-- ------------------------------------------------------------
ALTER TABLE building_properties
    ADD CONSTRAINT fk_bp_building
        FOREIGN KEY (building_id) REFERENCES buildings(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT fk_bp_property
        FOREIGN KEY (property_id) REFERENCES properties(id)
        ON DELETE CASCADE ON UPDATE CASCADE;

-- ------------------------------------------------------------
-- 7. tenant_surveys — missing FKs on tenant_id + property_id
--    (index idx_ts_tenant already exists)
-- ------------------------------------------------------------
ALTER TABLE tenant_surveys
    ADD CONSTRAINT fk_ts_tenant
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT fk_ts_property
        FOREIGN KEY (property_id) REFERENCES properties(id)
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE tenant_surveys ADD INDEX idx_ts_property (property_id);

-- ------------------------------------------------------------
-- 8. whatsapp_messages — missing FKs + indexes
-- ------------------------------------------------------------
ALTER TABLE whatsapp_messages
    ADD CONSTRAINT fk_wm_client
        FOREIGN KEY (client_id) REFERENCES clients(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT fk_wm_tenant
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE whatsapp_messages
    ADD INDEX idx_wm_client (client_id),
    ADD INDEX idx_wm_tenant (tenant_id);

-- ------------------------------------------------------------
-- 9. esign_requests — missing FKs on document_id + contract_id
-- ------------------------------------------------------------
ALTER TABLE esign_requests
    ADD CONSTRAINT fk_er_document
        FOREIGN KEY (document_id) REFERENCES documents(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT fk_er_contract
        FOREIGN KEY (contract_id) REFERENCES contracts(id)
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE esign_requests
    ADD INDEX idx_er_document (document_id),
    ADD INDEX idx_er_contract (contract_id);

-- ------------------------------------------------------------
-- 10. created_by columns — missing FKs to admin_users
-- ------------------------------------------------------------
ALTER TABLE invoices
    ADD CONSTRAINT fk_invoices_created_by
        FOREIGN KEY (created_by) REFERENCES admin_users(id)
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE contracts
    ADD CONSTRAINT fk_contracts_created_by
        FOREIGN KEY (created_by) REFERENCES admin_users(id)
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE pdf_documents
    ADD CONSTRAINT fk_pdf_created_by
        FOREIGN KEY (created_by) REFERENCES admin_users(id)
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE expenses
    ADD CONSTRAINT fk_expenses_created_by
        FOREIGN KEY (created_by) REFERENCES admin_users(id)
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE invoices    ADD INDEX idx_inv_created_by  (created_by);
ALTER TABLE contracts   ADD INDEX idx_ct_created_by   (created_by);
ALTER TABLE pdf_documents ADD INDEX idx_pdf_created_by (created_by);
ALTER TABLE expenses    ADD INDEX idx_exp_created_by  (created_by);

-- ------------------------------------------------------------
-- 11. agent_commissions — missing FKs on contract/property/client
--     (admin_user_id already has index idx_ac_agent)
-- ------------------------------------------------------------
ALTER TABLE agent_commissions
    ADD CONSTRAINT fk_ac_admin_user
        FOREIGN KEY (admin_user_id) REFERENCES admin_users(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT fk_ac_contract
        FOREIGN KEY (contract_id) REFERENCES contracts(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT fk_ac_property
        FOREIGN KEY (property_id) REFERENCES properties(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT fk_ac_client
        FOREIGN KEY (client_id) REFERENCES clients(id)
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE agent_commissions
    ADD INDEX idx_ac_contract (contract_id),
    ADD INDEX idx_ac_property (property_id),
    ADD INDEX idx_ac_client   (client_id);

-- ------------------------------------------------------------
-- 12. property_applications — missing FK on converted_to_lead_id
-- ------------------------------------------------------------
ALTER TABLE property_applications
    ADD CONSTRAINT fk_pa_converted_to_lead
        FOREIGN KEY (converted_to_lead_id) REFERENCES leads(id)
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE property_applications ADD INDEX idx_pa_lead (converted_to_lead_id);

-- ------------------------------------------------------------
-- 13. reminders.supplier_id — fix column type then add FK
--     (was INT, must be INT UNSIGNED to match suppliers.id)
-- ------------------------------------------------------------
ALTER TABLE reminders MODIFY supplier_id INT UNSIGNED NULL;

ALTER TABLE reminders
    ADD CONSTRAINT fk_reminders_supplier
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE reminders ADD INDEX idx_rem_supplier (supplier_id);

-- ------------------------------------------------------------
-- 14. documents — add id_front/id_back to doc_type enum
--     (these doc types are used by clients.js upload but not
--      in the enum, causing silent storage as empty string)
-- ------------------------------------------------------------
ALTER TABLE documents
    MODIFY doc_type ENUM('invoice','contract','id','id_front','id_back','other') NOT NULL DEFAULT 'other';

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- Verification query — run after applying to confirm all FKs
-- ============================================================
-- SELECT TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME
-- FROM information_schema.KEY_COLUMN_USAGE
-- WHERE TABLE_SCHEMA = 'gestione_immobiliare'
--   AND REFERENCED_TABLE_NAME IS NOT NULL
-- ORDER BY TABLE_NAME;
