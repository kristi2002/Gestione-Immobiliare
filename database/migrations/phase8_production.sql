-- Phase 8: Production hardening — admin users table
-- Idempotent — creates full table; adds missing columns on older installs.

USE gestione_immobiliare;

CREATE TABLE IF NOT EXISTS admin_users (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username        VARCHAR(50)  NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_admin_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Columns added in phase 9 — apply here idempotently for upgrades from early phase 8
CALL migration_add_column('admin_users', 'role',      "ENUM('super_admin','admin','agent','readonly') NOT NULL DEFAULT 'admin' AFTER password_hash");
CALL migration_add_column('admin_users', 'email',     'VARCHAR(255) DEFAULT NULL AFTER role');
CALL migration_add_column('admin_users', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER email');
CALL migration_add_index('admin_users', 'idx_admin_role', 'role');
