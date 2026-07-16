-- Phase 43 — Appointment requests from the public website (web-orlandi/appuntamento.html)

CREATE TABLE IF NOT EXISTS appointment_requests (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    surname         VARCHAR(100) NOT NULL,
    email           VARCHAR(255) NULL,
    phone           VARCHAR(30)  NOT NULL,
    appointment_type ENUM('valutazione','visita_immobile','vendita','affitto','consulenza','altro') NOT NULL DEFAULT 'valutazione',
    preferred_date  DATE NULL,
    preferred_time  ENUM('mattina','pomeriggio','sera') NULL,
    message         TEXT NULL,
    status          ENUM('new','confirmed','done','cancelled') NOT NULL DEFAULT 'new',
    lead_id         INT UNSIGNED NULL,
    ip_address      VARCHAR(45) NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_apptreq_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL,
    INDEX idx_apptreq_status (status),
    INDEX idx_apptreq_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
