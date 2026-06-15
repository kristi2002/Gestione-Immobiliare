-- Phase 9: Multi-user roles, app settings, tenants, extended social OAuth
-- Idempotent — run 000_helpers.sql first. Safe on re-run.

USE gestione_immobiliare;

-- Admin role columns (no-op if phase 8 already applied them)
CALL migration_add_column('admin_users', 'role',      "ENUM('super_admin','admin','agent','readonly') NOT NULL DEFAULT 'admin' AFTER password_hash");
CALL migration_add_column('admin_users', 'email',     'VARCHAR(255) DEFAULT NULL AFTER role');
CALL migration_add_column('admin_users', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER email');
CALL migration_add_index('admin_users', 'idx_admin_role', 'role');

UPDATE admin_users SET role = 'super_admin' WHERE id = 1 AND role IN ('admin', '') LIMIT 1;

CREATE TABLE IF NOT EXISTS app_settings (
    setting_key   VARCHAR(100) NOT NULL PRIMARY KEY,
    setting_value TEXT         DEFAULT NULL,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tenants (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_id     INT UNSIGNED NOT NULL,
    name            VARCHAR(100) NOT NULL,
    surname         VARCHAR(100) NOT NULL,
    email           VARCHAR(255) NOT NULL,
    phone           VARCHAR(30)  DEFAULT NULL,
    lease_start     DATE         DEFAULT NULL,
    lease_end       DATE         DEFAULT NULL,
    monthly_rent    DECIMAL(10,2) DEFAULT NULL,
    notes           TEXT         DEFAULT NULL,
    status          ENUM('active','inactive','archived') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_tenants_property
        FOREIGN KEY (property_id) REFERENCES properties(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    UNIQUE KEY uk_tenant_email (email),
    INDEX idx_tenants_property (property_id),
    INDEX idx_tenants_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tenant_users (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id       INT UNSIGNED NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    last_login_at   DATETIME     DEFAULT NULL,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_tenant_users_tenant
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    UNIQUE KEY uk_tenant_users_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL migration_add_column('social_settings', 'meta_user_token',    'VARCHAR(500) DEFAULT NULL AFTER meta_app_id');
CALL migration_add_column('social_settings', 'meta_refresh_token', 'VARCHAR(500) DEFAULT NULL AFTER meta_user_token');
CALL migration_add_column('social_settings', 'oauth_connected_at', 'DATETIME DEFAULT NULL AFTER token_expires_at');

CREATE TABLE IF NOT EXISTS pdf_documents (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    doc_type        ENUM('contract','report','invoice') NOT NULL DEFAULT 'contract',
    title           VARCHAR(255) NOT NULL,
    client_id       INT UNSIGNED DEFAULT NULL,
    property_id     INT UNSIGNED DEFAULT NULL,
    tenant_id       INT UNSIGNED DEFAULT NULL,
    file_path       VARCHAR(500) NOT NULL,
    created_by      INT UNSIGNED DEFAULT NULL,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_pdf_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
    CONSTRAINT fk_pdf_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL,
    CONSTRAINT fk_pdf_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL,
    INDEX idx_pdf_type (doc_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
