-- Gestionale Agenzia Immobiliare — Production schema (no seed data)
-- Fresh install: import this file, then run setup.php once to create the admin user.
-- Existing installs: use database/migrations/phase3 through phase9 instead.

CREATE DATABASE IF NOT EXISTS gestione_immobiliare
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE gestione_immobiliare;

-- ---------------------------------------------------------------------------
-- Admin users (phase 8 + 9)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_users (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username        VARCHAR(50)  NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    role            ENUM('super_admin','admin','agent','readonly') NOT NULL DEFAULT 'admin',
    email           VARCHAR(255) DEFAULT NULL,
    is_active       TINYINT(1)   NOT NULL DEFAULT 1,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_admin_username (username),
    INDEX idx_admin_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- App settings (phase 9) — branding, SMTP, WhatsApp, backup, Meta UI config
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
    setting_key   VARCHAR(100) NOT NULL PRIMARY KEY,
    setting_value TEXT         DEFAULT NULL,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Clients (Proprietari)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(100)  NOT NULL,
    surname         VARCHAR(100)  NOT NULL,
    phone           VARCHAR(30)   DEFAULT NULL,
    email           VARCHAR(255)  DEFAULT NULL,
    internal_notes  TEXT          DEFAULT NULL,
    creation_date   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status          ENUM('active', 'inactive', 'archived') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_clients_status (status),
    INDEX idx_clients_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Properties (Immobili)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS properties (
    id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_id             INT UNSIGNED NOT NULL,
    address               VARCHAR(255) NOT NULL,
    city                  VARCHAR(100) NOT NULL,
    cap                   VARCHAR(10)  DEFAULT NULL,
    sqm                   DECIMAL(8,2) DEFAULT NULL,
    rooms                 TINYINT UNSIGNED DEFAULT NULL,
    bathrooms             TINYINT UNSIGNED DEFAULT NULL,
    floor                 VARCHAR(20)  DEFAULT NULL,
    description           TEXT         DEFAULT NULL,
    additional_features   TEXT         DEFAULT NULL,
    internal_notes        TEXT         DEFAULT NULL,
    status                ENUM('available', 'rented', 'sold', 'archived') NOT NULL DEFAULT 'available',
    created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_properties_client
        FOREIGN KEY (client_id) REFERENCES clients(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_properties_client (client_id),
    INDEX idx_properties_city (city),
    INDEX idx_properties_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Tenants / Inquilini (phase 9)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Property media
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS property_media (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_id     INT UNSIGNED NOT NULL,
    media_type      ENUM('photo', 'video', 'floor_plan') NOT NULL DEFAULT 'photo',
    file_path       VARCHAR(500) NOT NULL,
    original_name   VARCHAR(255) NOT NULL,
    mime_type       VARCHAR(100) DEFAULT NULL,
    file_size       INT UNSIGNED DEFAULT NULL,
    sort_order      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_media_property
        FOREIGN KEY (property_id) REFERENCES properties(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_media_property (property_id),
    INDEX idx_media_type (media_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    doc_type        ENUM('invoice', 'contract', 'id', 'other') NOT NULL DEFAULT 'other',
    title           VARCHAR(255) DEFAULT NULL,
    client_id       INT UNSIGNED DEFAULT NULL,
    property_id     INT UNSIGNED DEFAULT NULL,
    file_path       VARCHAR(500) NOT NULL,
    original_name   VARCHAR(255) NOT NULL,
    mime_type       VARCHAR(100) DEFAULT NULL,
    file_size       INT UNSIGNED DEFAULT NULL,
    notes           TEXT         DEFAULT NULL,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_documents_client
        FOREIGN KEY (client_id) REFERENCES clients(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_documents_property
        FOREIGN KEY (property_id) REFERENCES properties(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_documents_client (client_id),
    INDEX idx_documents_property (property_id),
    INDEX idx_documents_type (doc_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Generated PDFs (phase 9)
-- ---------------------------------------------------------------------------
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
    CONSTRAINT fk_pdf_client
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
    CONSTRAINT fk_pdf_property
        FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL,
    CONSTRAINT fk_pdf_tenant
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL,
    INDEX idx_pdf_type (doc_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Communications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS communications (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_id       INT UNSIGNED NOT NULL,
    direction       ENUM('sent', 'received') NOT NULL,
    channel         ENUM('email', 'whatsapp') NOT NULL DEFAULT 'email',
    subject         VARCHAR(255) DEFAULT NULL,
    body            TEXT         NOT NULL,
    from_email      VARCHAR(255) DEFAULT NULL,
    to_email        VARCHAR(255) DEFAULT NULL,
    status          ENUM('draft', 'sent', 'delivered', 'failed', 'received') NOT NULL DEFAULT 'sent',
    external_id     VARCHAR(255) DEFAULT NULL,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_communications_client
        FOREIGN KEY (client_id) REFERENCES clients(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_communications_client (client_id),
    INDEX idx_communications_created (created_at),
    INDEX idx_communications_channel (channel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Reminders
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reminders (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    title           VARCHAR(255) NOT NULL,
    description     TEXT         DEFAULT NULL,
    reminder_date   DATETIME     NOT NULL,
    frequency       ENUM('once', 'weekly', 'monthly', 'yearly') NOT NULL DEFAULT 'once',
    status          ENUM('pending', 'completed', 'cancelled') NOT NULL DEFAULT 'pending',
    client_id       INT UNSIGNED DEFAULT NULL,
    property_id     INT UNSIGNED DEFAULT NULL,
    notify_admin    TINYINT(1)   NOT NULL DEFAULT 1,
    notify_client   TINYINT(1)   NOT NULL DEFAULT 0,
    email_subject   VARCHAR(255) DEFAULT NULL,
    email_body      TEXT         DEFAULT NULL,
    last_notified_at DATETIME    DEFAULT NULL,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_reminders_client
        FOREIGN KEY (client_id) REFERENCES clients(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_reminders_property
        FOREIGN KEY (property_id) REFERENCES properties(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_reminders_date (reminder_date),
    INDEX idx_reminders_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Social media (phase 7 + 9 OAuth columns)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_settings (
    id                      TINYINT UNSIGNED NOT NULL DEFAULT 1 PRIMARY KEY,
    meta_app_id             VARCHAR(100) DEFAULT NULL,
    meta_user_token         VARCHAR(500) DEFAULT NULL,
    meta_refresh_token      VARCHAR(500) DEFAULT NULL,
    facebook_page_id        VARCHAR(100) DEFAULT NULL,
    facebook_page_token     VARCHAR(500) DEFAULT NULL,
    instagram_account_id    VARCHAR(100) DEFAULT NULL,
    token_expires_at        DATETIME     DEFAULT NULL,
    oauth_connected_at      DATETIME     DEFAULT NULL,
    updated_at              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS social_posts (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_id         INT UNSIGNED DEFAULT NULL,
    platform            ENUM('facebook', 'instagram', 'both') NOT NULL DEFAULT 'both',
    caption             TEXT         NOT NULL,
    image_path          VARCHAR(500) DEFAULT NULL,
    scheduled_at        DATETIME     NOT NULL,
    published_at        DATETIME     DEFAULT NULL,
    status              ENUM('draft', 'scheduled', 'published', 'failed') NOT NULL DEFAULT 'draft',
    facebook_post_id    VARCHAR(100) DEFAULT NULL,
    instagram_media_id  VARCHAR(100) DEFAULT NULL,
    error_message       TEXT         DEFAULT NULL,
    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_social_posts_property
        FOREIGN KEY (property_id) REFERENCES properties(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_social_posts_status (status),
    INDEX idx_social_posts_scheduled (scheduled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO social_settings (id) VALUES (1);
