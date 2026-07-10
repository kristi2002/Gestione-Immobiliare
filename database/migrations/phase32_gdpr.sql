-- phase32_gdpr.sql
-- GDPR compliance schema: consent records, data-access audit log, data-subject
-- export requests, right-to-erasure requests, retention configuration, and
-- consent/legal-basis columns on the two data-subject tables (clients, tenants).
--
-- Idempotent.

USE gestione_immobiliare;

-- Consent / legal-basis ledger for data subjects (owners + tenants).
CREATE TABLE IF NOT EXISTS consent_records (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    agency_id     INT UNSIGNED    NOT NULL DEFAULT 1,
    subject_type  ENUM('client','tenant') NOT NULL,
    subject_id    INT UNSIGNED    NOT NULL,
    purpose       VARCHAR(100)    NOT NULL,          -- e.g. contract, marketing, whatsapp
    legal_basis   ENUM('consent','contract','legal_obligation','legitimate_interest','vital_interest','public_task') NOT NULL DEFAULT 'consent',
    granted       TINYINT(1)      NOT NULL DEFAULT 1,
    consent_text  TEXT                NULL,          -- exact wording shown at capture
    source        VARCHAR(60)         NULL,          -- admin_form, owner_portal, tenant_portal, public_form
    ip_address    VARCHAR(45)         NULL,
    created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    withdrawn_at  DATETIME            NULL,
    INDEX idx_consent_subject (subject_type, subject_id),
    INDEX idx_consent_purpose (purpose)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data-access / processing audit log (who did what to whose personal data).
CREATE TABLE IF NOT EXISTS data_processing_log (
    id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    agency_id      INT UNSIGNED    NOT NULL DEFAULT 1,
    actor_type     ENUM('admin','owner','tenant','system') NOT NULL DEFAULT 'admin',
    actor_id       INT UNSIGNED        NULL,          -- admin_users.id / client.id / tenant.id
    actor_label    VARCHAR(120)        NULL,
    action         ENUM('view','export','download','create','update','delete','anonymize') NOT NULL,
    subject_type   VARCHAR(40)         NULL,          -- client, tenant, document, ...
    subject_id     INT UNSIGNED        NULL,
    entity_type    VARCHAR(40)         NULL,          -- specific record touched
    entity_id      INT UNSIGNED        NULL,
    detail         VARCHAR(255)        NULL,
    ip_address     VARCHAR(45)         NULL,
    created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_dpl_subject (subject_type, subject_id),
    INDEX idx_dpl_actor (actor_type, actor_id),
    INDEX idx_dpl_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Right-to-access: data-subject export requests + generated package.
CREATE TABLE IF NOT EXISTS data_export_requests (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    agency_id     INT UNSIGNED    NOT NULL DEFAULT 1,
    subject_type  ENUM('client','tenant') NOT NULL,
    subject_id    INT UNSIGNED    NOT NULL,
    requested_by  INT UNSIGNED        NULL,          -- admin_users.id
    status        ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
    file_path     VARCHAR(255)        NULL,
    created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at  DATETIME            NULL,
    INDEX idx_der_subject (subject_type, subject_id),
    INDEX idx_der_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Right-to-erasure: deletion/anonymisation requests + workflow state.
CREATE TABLE IF NOT EXISTS erasure_requests (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    agency_id     INT UNSIGNED    NOT NULL DEFAULT 1,
    subject_type  ENUM('client','tenant') NOT NULL,
    subject_id    INT UNSIGNED    NOT NULL,
    requested_by  INT UNSIGNED        NULL,
    reason        VARCHAR(255)        NULL,
    status        ENUM('pending','approved','completed','rejected') NOT NULL DEFAULT 'pending',
    method        ENUM('anonymize','delete') NOT NULL DEFAULT 'anonymize',
    notes         TEXT                NULL,
    created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at  DATETIME            NULL,
    processed_by  INT UNSIGNED        NULL,
    INDEX idx_er_subject (subject_type, subject_id),
    INDEX idx_er_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Consent / legal-basis columns on the data-subject tables.
CALL migration_add_column('clients', 'privacy_consent_at',   'DATETIME NULL DEFAULT NULL');
CALL migration_add_column('clients', 'marketing_consent_at', 'DATETIME NULL DEFAULT NULL');
CALL migration_add_column('clients', 'anonymized_at',        'DATETIME NULL DEFAULT NULL');
CALL migration_add_column('tenants', 'privacy_consent_at',   'DATETIME NULL DEFAULT NULL');
CALL migration_add_column('tenants', 'marketing_consent_at', 'DATETIME NULL DEFAULT NULL');
CALL migration_add_column('tenants', 'anonymized_at',        'DATETIME NULL DEFAULT NULL');

-- Default retention configuration (months). 0 = keep indefinitely / until erasure.
INSERT INTO app_settings (setting_key, setting_value)
SELECT * FROM (
    SELECT 'retention_documents_months'      AS k, '120' AS v UNION ALL  -- 10y (fiscal)
    SELECT 'retention_communications_months',      '36'         UNION ALL
    SELECT 'retention_whatsapp_months',            '24'         UNION ALL
    SELECT 'retention_activity_log_months',        '24'         UNION ALL
    SELECT 'retention_data_processing_log_months', '24'         UNION ALL
    SELECT 'retention_login_attempts_days',        '90'
) defaults
WHERE NOT EXISTS (
    SELECT 1 FROM app_settings s WHERE s.setting_key = defaults.k
);
