-- Phase 19: Add maintenance workflow columns to reminders table

ALTER TABLE reminders
    ADD COLUMN supplier_id        INT            NULL        AFTER client_id,
    ADD COLUMN supplier_name      VARCHAR(255)   NULL        AFTER supplier_id,
    ADD COLUMN maintenance_status ENUM('aperta','in_lavorazione','completata','chiusa') NULL DEFAULT 'aperta' AFTER supplier_name,
    ADD COLUMN priority           VARCHAR(50)    NULL        AFTER maintenance_status,
    ADD COLUMN request_type       VARCHAR(100)   NULL        AFTER priority,
    ADD COLUMN category           VARCHAR(100)   NULL        AFTER request_type,
    ADD COLUMN tenant_name        VARCHAR(255)   NULL        AFTER category;
