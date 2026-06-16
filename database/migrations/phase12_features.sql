-- Phase 12 — Keys, price history, login attempts, bulk support tables
-- Idempotent — safe to re-run.

USE gestione_immobiliare;

CREATE TABLE IF NOT EXISTS property_keys (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_id     INT UNSIGNED NOT NULL,
    holder_id       INT UNSIGNED NULL COMMENT 'admin_users.id — agent holding keys',
    holder_name     VARCHAR(100) NULL COMMENT 'external holder if not an agent',
    location        VARCHAR(255) NULL COMMENT 'office drawer, lockbox, etc.',
    notes           TEXT NULL,
    handed_at       DATE NULL,
    returned_at     DATE NULL,
    status          ENUM('out','in_office','lost') NOT NULL DEFAULT 'in_office',
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_keys_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
    CONSTRAINT fk_keys_holder FOREIGN KEY (holder_id) REFERENCES admin_users(id) ON DELETE SET NULL,
    INDEX idx_keys_property (property_id),
    INDEX idx_keys_holder (holder_id),
    INDEX idx_keys_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS property_price_history (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_id     INT UNSIGNED NOT NULL,
    old_price       DECIMAL(12,2) NULL,
    new_price       DECIMAL(12,2) NULL,
    old_price_type  ENUM('affitto','vendita') NULL,
    new_price_type  ENUM('affitto','vendita') NULL,
    changed_by      INT UNSIGNED NULL,
    changed_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_price_hist_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
    CONSTRAINT fk_price_hist_admin FOREIGN KEY (changed_by) REFERENCES admin_users(id) ON DELETE SET NULL,
    INDEX idx_price_hist_property (property_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_attempts (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ip_address      VARCHAR(45) NOT NULL,
    success         TINYINT(1) NOT NULL DEFAULT 0,
    attempted_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_login_ip_time (ip_address, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Extend pdf_documents for mandato type
ALTER TABLE pdf_documents MODIFY doc_type ENUM('contract','report','invoice','mandato') NOT NULL DEFAULT 'contract';
