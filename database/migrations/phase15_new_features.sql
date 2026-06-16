-- Phase 15: New Features — Insurance, Meters, Suppliers, Inventory, Buildings,
--            Surveys, Commissions, Payment Reminder Log, E-Sign, WhatsApp Inbox,
--            Property Applications, Stripe Payments.
-- All statements are idempotent (CREATE TABLE IF NOT EXISTS / ALTER TABLE ... IF NOT EXISTS via stored procedure).

-- ─── property_insurance ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property_insurance (
    id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_id    INT UNSIGNED NOT NULL,
    client_id      INT UNSIGNED NULL,
    insurer_name   VARCHAR(150) NOT NULL,
    policy_number  VARCHAR(100) NOT NULL,
    policy_type    ENUM('incendio','responsabilita','globale_fabbricato','altro') NOT NULL DEFAULT 'altro',
    premium_annual DECIMAL(10,2) NULL,
    start_date     DATE NULL,
    end_date       DATE NULL,
    notes          TEXT NULL,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pi_property (property_id),
    INDEX idx_pi_end_date (end_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── meter_readings ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meter_readings (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_id   INT UNSIGNED NOT NULL,
    meter_type    ENUM('gas','electricity','water','heating') NOT NULL,
    reading_value DECIMAL(10,2) NOT NULL,
    reading_date  DATE NOT NULL,
    notes         VARCHAR(255) NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_mr_property (property_id),
    INDEX idx_mr_date (reading_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── suppliers ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(150) NOT NULL,
    category   ENUM('idraulico','elettricista','muratore','falegname','imbianchino','giardiniere','pulizie','altro') NOT NULL DEFAULT 'altro',
    phone      VARCHAR(30) NULL,
    email      VARCHAR(150) NULL,
    address    VARCHAR(255) NULL,
    notes      TEXT NULL,
    rating     TINYINT NULL COMMENT '1-5',
    is_active  TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sup_category (category),
    INDEX idx_sup_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── property_inventory ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property_inventory (
    id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_id      INT UNSIGNED NOT NULL,
    item_name        VARCHAR(150) NOT NULL,
    category         ENUM('mobile','elettrodomestico','arredamento','impianto','altro') NOT NULL DEFAULT 'altro',
    quantity         INT NOT NULL DEFAULT 1,
    condition_rating TINYINT NULL COMMENT '1-5',
    notes            VARCHAR(255) NULL,
    check_in_date    DATE NULL,
    check_out_date   DATE NULL,
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_inv_property (property_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── buildings ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS buildings (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(150) NOT NULL,
    address     VARCHAR(255) NOT NULL,
    city        VARCHAR(100) NOT NULL,
    total_units INT NOT NULL DEFAULT 1,
    notes       TEXT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS building_properties (
    building_id INT UNSIGNED NOT NULL,
    property_id INT UNSIGNED NOT NULL,
    PRIMARY KEY (building_id, property_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── tenant_surveys ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_surveys (
    id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id            INT UNSIGNED NULL,
    property_id          INT UNSIGNED NULL,
    overall_rating       TINYINT NULL,
    maintenance_rating   TINYINT NULL,
    communication_rating TINYINT NULL,
    comment              TEXT NULL,
    token                VARCHAR(64) NOT NULL UNIQUE,
    submitted_at         TIMESTAMP NULL,
    created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ts_tenant (tenant_id),
    INDEX idx_ts_token (token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── agent_commissions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_commissions (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    admin_user_id   INT UNSIGNED NOT NULL,
    contract_id     INT UNSIGNED NULL,
    property_id     INT UNSIGNED NULL,
    client_id       INT UNSIGNED NULL,
    amount          DECIMAL(10,2) NOT NULL,
    percentage      DECIMAL(5,2) NULL,
    commission_type ENUM('vendita','locazione','gestione') NOT NULL DEFAULT 'locazione',
    status          ENUM('pending','paid') NOT NULL DEFAULT 'pending',
    notes           TEXT NULL,
    due_date        DATE NULL,
    paid_at         TIMESTAMP NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ac_agent (admin_user_id),
    INDEX idx_ac_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── payment_reminder_log ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_reminder_log (
    id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    payment_id   INT UNSIGNED NOT NULL,
    tenant_id    INT UNSIGNED NULL,
    client_id    INT UNSIGNED NULL,
    channel      ENUM('email','whatsapp') NOT NULL DEFAULT 'email',
    days_overdue INT NOT NULL DEFAULT 0,
    sent_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status       ENUM('sent','failed') NOT NULL DEFAULT 'sent',
    error_msg    VARCHAR(255) NULL,
    INDEX idx_prl_payment (payment_id),
    INDEX idx_prl_sent (sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── esign_requests ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS esign_requests (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    document_id   INT UNSIGNED NULL,
    contract_id   INT UNSIGNED NULL,
    signer_name   VARCHAR(150) NOT NULL,
    signer_email  VARCHAR(150) NOT NULL,
    token         VARCHAR(64) NOT NULL UNIQUE,
    status        ENUM('pending','signed','expired') NOT NULL DEFAULT 'pending',
    signed_at     TIMESTAMP NULL,
    ip_address    VARCHAR(45) NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at    TIMESTAMP NOT NULL,
    INDEX idx_esign_token (token),
    INDEX idx_esign_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── whatsapp_messages ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    direction   ENUM('inbound','outbound') NOT NULL DEFAULT 'inbound',
    from_number VARCHAR(30) NOT NULL,
    to_number   VARCHAR(30) NOT NULL,
    body        TEXT NOT NULL,
    media_url   VARCHAR(500) NULL,
    twilio_sid  VARCHAR(64) NULL,
    client_id   INT UNSIGNED NULL,
    tenant_id   INT UNSIGNED NULL,
    is_read     TINYINT(1) NOT NULL DEFAULT 0,
    received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_wm_from (from_number),
    INDEX idx_wm_direction (direction),
    INDEX idx_wm_read (is_read)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── property_applications ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property_applications (
    id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_id          INT UNSIGNED NOT NULL,
    applicant_name       VARCHAR(150) NOT NULL,
    applicant_email      VARCHAR(150) NOT NULL,
    applicant_phone      VARCHAR(30) NULL,
    application_type     ENUM('affitto','acquisto') NOT NULL DEFAULT 'affitto',
    message              TEXT NULL,
    status               ENUM('new','contacted','approved','rejected') NOT NULL DEFAULT 'new',
    converted_to_lead_id INT UNSIGNED NULL,
    ip_address           VARCHAR(45) NULL,
    created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pa_property (property_id),
    INDEX idx_pa_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── stripe_payments ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stripe_payments (
    id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    payment_id            INT UNSIGNED NOT NULL,
    tenant_id             INT UNSIGNED NOT NULL,
    stripe_session_id     VARCHAR(150) NOT NULL,
    stripe_payment_intent VARCHAR(150) NULL,
    amount                DECIMAL(10,2) NOT NULL,
    currency              VARCHAR(3) NOT NULL DEFAULT 'eur',
    status                ENUM('pending','paid','failed','refunded') NOT NULL DEFAULT 'pending',
    paid_at               TIMESTAMP NULL,
    created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sp_payment (payment_id),
    INDEX idx_sp_session (stripe_session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Add ip_address to property_applications (idempotent via stored procedure) ──
DROP PROCEDURE IF EXISTS phase15_add_ip_col;
DELIMITER $$
CREATE PROCEDURE phase15_add_ip_col()
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'property_applications'
          AND COLUMN_NAME  = 'ip_address'
    ) THEN
        ALTER TABLE property_applications
            ADD COLUMN ip_address VARCHAR(45) NULL AFTER status;
    END IF;
END$$
DELIMITER ;
CALL phase15_add_ip_col();
DROP PROCEDURE IF EXISTS phase15_add_ip_col;
