-- Phase 11 — Leads, appointments, map, WhatsApp templates, appraisals, invoices, 2FA
-- Idempotent — safe to re-run.

USE gestione_immobiliare;

-- ---------------------------------------------------------------------------
-- Leads / Potenziali clienti
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    surname         VARCHAR(100) NOT NULL,
    phone           VARCHAR(30)  NULL,
    email           VARCHAR(255) NULL,
    interest_type   ENUM('affitto','acquisto','entrambi') NOT NULL DEFAULT 'affitto',
    budget_min      DECIMAL(10,2) NULL,
    budget_max      DECIMAL(10,2) NULL,
    preferred_city  VARCHAR(100) NULL,
    preferred_type  ENUM('appartamento','villa','ufficio','negozio','box','terreno','altro') NULL,
    min_rooms       INT NULL,
    min_sqm         DECIMAL(8,2) NULL,
    status          ENUM('new','contacted','interested','negotiating','converted','lost') NOT NULL DEFAULT 'new',
    source          ENUM('telefono','email','web','passaparola','social','altro') NOT NULL DEFAULT 'altro',
    assigned_to     INT UNSIGNED NULL,
    notes           TEXT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_leads_assigned FOREIGN KEY (assigned_to) REFERENCES admin_users(id) ON DELETE SET NULL,
    INDEX idx_leads_status (status),
    INDEX idx_leads_interest (interest_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lead_property_matches (
    lead_id     INT UNSIGNED NOT NULL,
    property_id INT UNSIGNED NOT NULL,
    PRIMARY KEY (lead_id, property_id),
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Appointments / Visite
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
    id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_id       INT UNSIGNED NOT NULL,
    lead_id           INT UNSIGNED NULL,
    client_id         INT UNSIGNED NULL,
    agent_id          INT UNSIGNED NULL,
    appointment_date  DATETIME NOT NULL,
    duration_minutes  INT NOT NULL DEFAULT 60,
    status            ENUM('scheduled','completed','cancelled','no_show') NOT NULL DEFAULT 'scheduled',
    notes             TEXT NULL,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_appt_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
    CONSTRAINT fk_appt_lead     FOREIGN KEY (lead_id)     REFERENCES leads(id)      ON DELETE SET NULL,
    CONSTRAINT fk_appt_client   FOREIGN KEY (client_id)   REFERENCES clients(id)    ON DELETE SET NULL,
    CONSTRAINT fk_appt_agent    FOREIGN KEY (agent_id)    REFERENCES admin_users(id) ON DELETE SET NULL,
    INDEX idx_appt_date (appointment_date),
    INDEX idx_appt_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- WhatsApp templates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_templates (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    category    ENUM('benvenuto','scadenza','pagamento','visita','generico') NOT NULL DEFAULT 'generico',
    body        TEXT NOT NULL,
    variables   TEXT NULL COMMENT 'JSON array of variable names like ["nome","indirizzo"]',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO whatsapp_templates (name, category, body, variables)
SELECT 'Benvenuto inquilino', 'benvenuto',
       'Gentile {{nome}}, benvenuto/a in {{indirizzo}}. Siamo a disposizione per qualsiasi necessità. Cordiali saluti, {{agenzia}}',
       '["nome","indirizzo","agenzia"]'
WHERE NOT EXISTS (SELECT 1 FROM whatsapp_templates WHERE name = 'Benvenuto inquilino');

INSERT INTO whatsapp_templates (name, category, body, variables)
SELECT 'Scadenza contratto', 'scadenza',
       'Gentile {{nome}}, la informiamo che il contratto relativo all''immobile in {{indirizzo}} scadrà il {{data_scadenza}}. La contatteremo presto per discutere il rinnovo. Cordiali saluti, {{agenzia}}',
       '["nome","indirizzo","data_scadenza","agenzia"]'
WHERE NOT EXISTS (SELECT 1 FROM whatsapp_templates WHERE name = 'Scadenza contratto');

INSERT INTO whatsapp_templates (name, category, body, variables)
SELECT 'Sollecito pagamento', 'pagamento',
       'Gentile {{nome}}, la informiamo che il pagamento del canone di {{importo}}€ per {{mese}} non risulta ancora pervenuto. La preghiamo di provvedere al più presto. Cordiali saluti, {{agenzia}}',
       '["nome","importo","mese","agenzia"]'
WHERE NOT EXISTS (SELECT 1 FROM whatsapp_templates WHERE name = 'Sollecito pagamento');

INSERT INTO whatsapp_templates (name, category, body, variables)
SELECT 'Conferma visita', 'visita',
       'Gentile {{nome}}, confermiamo la visita all''immobile in {{indirizzo}} per il giorno {{data}} alle ore {{ora}}. Cordiali saluti, {{agenzia}}',
       '["nome","indirizzo","data","ora","agenzia"]'
WHERE NOT EXISTS (SELECT 1 FROM whatsapp_templates WHERE name = 'Conferma visita');

-- ---------------------------------------------------------------------------
-- Property appraisals / Valutazioni
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS property_appraisals (
    id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_id          INT UNSIGNED NOT NULL,
    appraised_by         INT UNSIGNED NULL,
    estimated_value      DECIMAL(12,2) NOT NULL,
    estimated_rent       DECIMAL(10,2) NULL,
    condition_rating     ENUM('ottimo','buono','discreto','da_ristrutturare') NOT NULL DEFAULT 'buono',
    notes                TEXT NULL,
    comparable_1_address VARCHAR(255) NULL,
    comparable_1_price   DECIMAL(12,2) NULL,
    comparable_2_address VARCHAR(255) NULL,
    comparable_2_price   DECIMAL(12,2) NULL,
    appraisal_date       DATE NOT NULL,
    created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_appraisal_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
    CONSTRAINT fk_appraisal_by       FOREIGN KEY (appraised_by) REFERENCES admin_users(id) ON DELETE SET NULL,
    INDEX idx_appraisal_property (property_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Agency invoices / Fatture
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    invoice_number  VARCHAR(50) NOT NULL,
    client_id       INT UNSIGNED NULL,
    lead_id         INT UNSIGNED NULL,
    description     TEXT NOT NULL,
    amount          DECIMAL(10,2) NOT NULL,
    vat_rate        DECIMAL(5,2) NOT NULL DEFAULT 22.00,
    vat_amount      DECIMAL(10,2) GENERATED ALWAYS AS (amount * vat_rate / 100) STORED,
    total           DECIMAL(10,2) GENERATED ALWAYS AS (amount + amount * vat_rate / 100) STORED,
    status          ENUM('draft','sent','paid','cancelled') NOT NULL DEFAULT 'draft',
    issue_date      DATE NOT NULL,
    due_date        DATE NULL,
    paid_date       DATE NULL,
    notes           TEXT NULL,
    created_by      INT UNSIGNED NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_invoice_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
    CONSTRAINT fk_invoice_lead   FOREIGN KEY (lead_id)   REFERENCES leads(id)   ON DELETE SET NULL,
    INDEX idx_invoices_status (status),
    INDEX idx_invoices_number (invoice_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Column additions (properties map/pricing + admin 2FA)
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _migration_phase11_features;

DELIMITER //

CREATE PROCEDURE _migration_phase11_features()
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'properties' AND COLUMN_NAME = 'price'
    ) THEN
        ALTER TABLE properties ADD COLUMN price DECIMAL(12,2) NULL AFTER status;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'properties' AND COLUMN_NAME = 'price_type'
    ) THEN
        ALTER TABLE properties ADD COLUMN price_type ENUM('affitto','vendita') NOT NULL DEFAULT 'affitto' AFTER price;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'properties' AND COLUMN_NAME = 'latitude'
    ) THEN
        ALTER TABLE properties ADD COLUMN latitude DECIMAL(10,8) NULL AFTER price_type;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'properties' AND COLUMN_NAME = 'longitude'
    ) THEN
        ALTER TABLE properties ADD COLUMN longitude DECIMAL(11,8) NULL AFTER latitude;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_users' AND COLUMN_NAME = 'totp_secret'
    ) THEN
        ALTER TABLE admin_users ADD COLUMN totp_secret VARCHAR(64) NULL AFTER password_hash;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_users' AND COLUMN_NAME = 'totp_enabled'
    ) THEN
        ALTER TABLE admin_users ADD COLUMN totp_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER totp_secret;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_users' AND COLUMN_NAME = 'totp_backup_codes'
    ) THEN
        ALTER TABLE admin_users ADD COLUMN totp_backup_codes TEXT NULL AFTER totp_enabled;
    END IF;
END //

DELIMITER ;

CALL _migration_phase11_features();
DROP PROCEDURE IF EXISTS _migration_phase11_features;
