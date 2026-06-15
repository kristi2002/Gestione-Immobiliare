-- Phase 5 migration: Communications table
-- Idempotent — safe after schema.sql or on re-run.
-- Seed sample messages: optional block at bottom (dev only).

USE gestione_immobiliare;

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
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    INDEX idx_communications_client (client_id),
    INDEX idx_communications_created (created_at),
    INDEX idx_communications_channel (channel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dev seed (skipped if clients 1–2 do not exist)
INSERT INTO communications (client_id, direction, channel, subject, body, from_email, to_email, status, created_at)
SELECT 1, 'received', 'email', 'Disponibilità sopralluogo',
       'Buongiorno, sono disponibile per un sopralluogo giovedì pomeriggio. Mi confermate l\'orario?',
       'marco.rossi@email.it', 'admin@agenzia.it', 'received', DATE_SUB(NOW(), INTERVAL 3 DAY)
FROM clients WHERE id = 1
  AND NOT EXISTS (SELECT 1 FROM communications WHERE client_id = 1 AND subject = 'Disponibilità sopralluogo');

INSERT INTO communications (client_id, direction, channel, subject, body, from_email, to_email, status, created_at)
SELECT 1, 'sent', 'email', 'Re: Disponibilità sopralluogo',
       'Buongiorno Marco, confermiamo giovedì alle 15:00. A presto!',
       'admin@agenzia.it', 'marco.rossi@email.it', 'sent', DATE_SUB(NOW(), INTERVAL 2 DAY)
FROM clients WHERE id = 1
  AND NOT EXISTS (SELECT 1 FROM communications WHERE client_id = 1 AND subject = 'Re: Disponibilità sopralluogo' AND direction = 'sent');

INSERT INTO communications (client_id, direction, channel, subject, body, from_email, to_email, status, created_at)
SELECT 2, 'sent', 'email', 'Aggiornamento locazione',
       'Gentile Laura, le inviamo un aggiornamento sullo stato della locazione in Piazza Duomo.',
       'admin@agenzia.it', 'laura.bianchi@email.it', 'sent', DATE_SUB(NOW(), INTERVAL 5 DAY)
FROM clients WHERE id = 2
  AND NOT EXISTS (SELECT 1 FROM communications WHERE client_id = 2 AND subject = 'Aggiornamento locazione');
