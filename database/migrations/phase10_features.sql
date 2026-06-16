-- Phase 10: property type/price, payments, expenses, activity log, contracts, owner portal
-- Idempotent — safe to re-run.

USE gestione_immobiliare;

DROP PROCEDURE IF EXISTS _migration_phase10_features;

DELIMITER //

CREATE PROCEDURE _migration_phase10_features()
BEGIN
    -- 1. Tipo & Prezzo Immobile
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'properties' AND COLUMN_NAME = 'property_type'
    ) THEN
        ALTER TABLE properties
            ADD COLUMN property_type ENUM('appartamento','villa','ufficio','negozio','box','terreno','altro')
                NOT NULL DEFAULT 'appartamento' AFTER city;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'properties' AND COLUMN_NAME = 'price'
    ) THEN
        ALTER TABLE properties
            ADD COLUMN price DECIMAL(12,2) NULL AFTER property_type;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'properties' AND COLUMN_NAME = 'price_type'
    ) THEN
        ALTER TABLE properties
            ADD COLUMN price_type ENUM('affitto','vendita') NOT NULL DEFAULT 'affitto' AFTER price;
    END IF;

    -- 10. Portale Proprietario
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients' AND COLUMN_NAME = 'portal_password_hash'
    ) THEN
        ALTER TABLE clients
            ADD COLUMN portal_password_hash VARCHAR(255) NULL AFTER internal_notes;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients' AND COLUMN_NAME = 'portal_email'
    ) THEN
        ALTER TABLE clients
            ADD COLUMN portal_email VARCHAR(255) NULL AFTER portal_password_hash;
    END IF;
END //

DELIMITER ;

CALL _migration_phase10_features();
DROP PROCEDURE IF EXISTS _migration_phase10_features;

-- 3. Scadenzario Affitti (Pagamenti)
CREATE TABLE IF NOT EXISTS payments (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id       INT UNSIGNED NOT NULL,
    property_id     INT UNSIGNED NOT NULL,
    amount          DECIMAL(10,2) NOT NULL,
    due_date        DATE NOT NULL,
    paid_date       DATE NULL,
    status          ENUM('pending','paid','late','cancelled') NOT NULL DEFAULT 'pending',
    notes           TEXT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_payments_tenant
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT fk_payments_property
        FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
    INDEX idx_payments_due (due_date),
    INDEX idx_payments_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Gestione Spese
CREATE TABLE IF NOT EXISTS expenses (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_id     INT UNSIGNED NULL,
    client_id       INT UNSIGNED NULL,
    category        ENUM('manutenzione','utenze','tasse','assicurazione','agenzia','altro') NOT NULL DEFAULT 'altro',
    description     VARCHAR(500) NOT NULL,
    amount          DECIMAL(10,2) NOT NULL,
    expense_date    DATE NOT NULL,
    receipt_url     VARCHAR(500) NULL,
    notes           TEXT NULL,
    created_by      INT UNSIGNED NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_expenses_property
        FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL,
    CONSTRAINT fk_expenses_client
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
    INDEX idx_expenses_date (expense_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Log Attività
CREATE TABLE IF NOT EXISTS activity_log (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    admin_user_id   INT UNSIGNED NULL,
    username        VARCHAR(100) NULL,
    action          ENUM('create','update','delete','login','logout') NOT NULL,
    entity_type     VARCHAR(50) NULL,
    entity_id       INT UNSIGNED NULL,
    description     VARCHAR(500) NULL,
    ip_address      VARCHAR(45) NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_activity_admin
        FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL,
    INDEX idx_activity_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Contratti
CREATE TABLE IF NOT EXISTS contracts (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_id     INT UNSIGNED NOT NULL,
    tenant_id       INT UNSIGNED NULL,
    client_id       INT UNSIGNED NULL,
    title           VARCHAR(255) NOT NULL,
    contract_type   ENUM('locazione','compravendita','preliminare','mandato','altro') NOT NULL DEFAULT 'locazione',
    status          ENUM('draft','sent','signed','expired','cancelled') NOT NULL DEFAULT 'draft',
    start_date      DATE NULL,
    end_date        DATE NULL,
    monthly_rent    DECIMAL(10,2) NULL,
    deposit         DECIMAL(10,2) NULL,
    document_id     INT UNSIGNED NULL,
    notes           TEXT NULL,
    created_by      INT UNSIGNED NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_contracts_property
        FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
    CONSTRAINT fk_contracts_tenant
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL,
    CONSTRAINT fk_contracts_client
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
    CONSTRAINT fk_contracts_document
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL,
    INDEX idx_contracts_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
