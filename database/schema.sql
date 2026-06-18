-- Gestionale Agenzia Immobiliare - Phase 1 Schema
-- Run this script to initialize the database.

CREATE DATABASE IF NOT EXISTS gestione_immobiliare
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE gestione_immobiliare;

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
-- Properties (Immobili) — 1-to-many with Clients
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
    cover_media_id        INT UNSIGNED DEFAULT NULL,
    created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_properties_client
        FOREIGN KEY (client_id) REFERENCES clients(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE,

    INDEX idx_properties_client (client_id),
    INDEX idx_properties_city (city),
    INDEX idx_properties_status (status),
    INDEX idx_properties_cover_media (cover_media_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Property Media (Galleria multimediale) — Phase 3
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS property_media (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_id     INT UNSIGNED NOT NULL,
    media_type      ENUM('photo', 'video', 'floor_plan', 'house_map', 'attachment') NOT NULL DEFAULT 'photo',
    file_path       VARCHAR(500) NOT NULL,
    original_name   VARCHAR(255) NOT NULL,
    mime_type       VARCHAR(100) DEFAULT NULL,
    file_size       INT UNSIGNED DEFAULT NULL,
    sort_order      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_media_property
        FOREIGN KEY (property_id) REFERENCES properties(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    INDEX idx_media_property (property_id),
    INDEX idx_media_type (media_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE properties
    ADD CONSTRAINT fk_properties_cover_media
        FOREIGN KEY (cover_media_id) REFERENCES property_media(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Documents (Documenti) — Phase 4
-- Associable to Clients and/or Properties
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    doc_type        ENUM('invoice', 'contract', 'id', 'id_front', 'id_back', 'other') NOT NULL DEFAULT 'other',
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
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    CONSTRAINT fk_documents_property
        FOREIGN KEY (property_id) REFERENCES properties(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    INDEX idx_documents_client (client_id),
    INDEX idx_documents_property (property_id),
    INDEX idx_documents_type (doc_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Communications (Comunicazioni) — Phase 5
-- Email messages (WhatsApp channel prepared for future integration)
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
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    INDEX idx_communications_client (client_id),
    INDEX idx_communications_created (created_at),
    INDEX idx_communications_channel (channel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Reminders (Promemoria) — used by dashboard for expiring reminders
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
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    CONSTRAINT fk_reminders_property
        FOREIGN KEY (property_id) REFERENCES properties(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    INDEX idx_reminders_date (reminder_date),
    INDEX idx_reminders_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Social Media (Meta API) — Phase 7
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_settings (
    id                      TINYINT UNSIGNED NOT NULL DEFAULT 1 PRIMARY KEY,
    meta_app_id             VARCHAR(100) DEFAULT NULL,
    facebook_page_id        VARCHAR(100) DEFAULT NULL,
    facebook_page_token     VARCHAR(500) DEFAULT NULL,
    instagram_account_id    VARCHAR(100) DEFAULT NULL,
    token_expires_at        DATETIME     DEFAULT NULL,
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
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    INDEX idx_social_posts_status (status),
    INDEX idx_social_posts_scheduled (scheduled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Sample seed data (optional — remove in production)
-- ---------------------------------------------------------------------------
INSERT INTO clients (name, surname, phone, email, internal_notes, status) VALUES
    ('Marco', 'Rossi', '+39 333 1234567', 'marco.rossi@email.it', 'Cliente storico, molto collaborativo.', 'active'),
    ('Laura', 'Bianchi', '+39 340 9876543', 'laura.bianchi@email.it', NULL, 'active'),
    ('Giuseppe', 'Verdi', '+39 320 5551234', 'giuseppe.verdi@email.it', 'Preferisce contatto telefonico.', 'inactive');

INSERT INTO properties (client_id, address, city, cap, sqm, rooms, bathrooms, floor, description, additional_features) VALUES
    (1, 'Via Roma 15', 'Milano', '20121', 85.50, 3, 1, '2', 'Appartamento luminoso in zona centrale.', 'Balcone, cantina, ascensore'),
    (1, 'Corso Garibaldi 42', 'Milano', '20121', 120.00, 4, 2, '5', 'Attico con terrazzo panoramico.', 'Terrazzo, doppio garage, climatizzazione'),
    (2, 'Piazza Duomo 8', 'Firenze', '50122', 65.00, 2, 1, '1', 'Monolocale ristrutturato vicino al centro.', 'Arredato, riscaldamento autonomo');

INSERT INTO reminders (title, description, reminder_date, frequency, status, client_id) VALUES
    ('Richiamare Marco Rossi', 'Verificare disponibilità per sopralluogo.', DATE_ADD(NOW(), INTERVAL 2 DAY), 'once', 'pending', 1),
    ('Rinnovo mandato Laura Bianchi', 'Mandato in scadenza tra una settimana.', DATE_ADD(NOW(), INTERVAL 5 DAY), 'once', 'pending', 2),
    ('Report mensile proprietari', 'Inviare report mensile a tutti i clienti attivi.', DATE_ADD(NOW(), INTERVAL 10 DAY), 'monthly', 'pending', NULL);

INSERT INTO communications (client_id, direction, channel, subject, body, from_email, to_email, status, created_at) VALUES
    (1, 'received', 'email', 'Disponibilità sopralluogo', 'Buongiorno, sono disponibile per un sopralluogo giovedì pomeriggio. Mi confermate l\'orario?', 'marco.rossi@email.it', 'admin@agenzia.it', 'received', DATE_SUB(NOW(), INTERVAL 3 DAY)),
    (1, 'sent', 'email', 'Re: Disponibilità sopralluogo', 'Buongiorno Marco, confermiamo giovedì alle 15:00. A presto!', 'admin@agenzia.it', 'marco.rossi@email.it', 'sent', DATE_SUB(NOW(), INTERVAL 2 DAY)),
    (1, 'received', 'email', 'Re: Disponibilità sopralluogo', 'Perfetto, ci vediamo giovedì alle 15:00. Grazie!', 'marco.rossi@email.it', 'admin@agenzia.it', 'received', DATE_SUB(NOW(), INTERVAL 1 DAY)),
    (2, 'sent', 'email', 'Aggiornamento locazione', 'Gentile Laura, le inviamo un aggiornamento sullo stato della locazione in Piazza Duomo.', 'admin@agenzia.it', 'laura.bianchi@email.it', 'sent', DATE_SUB(NOW(), INTERVAL 5 DAY));

INSERT INTO social_settings (id) VALUES (1);

INSERT INTO social_posts (property_id, platform, caption, scheduled_at, status) VALUES
    (1, 'both', '🏠 Appartamento luminoso in Via Roma 15, Milano — 85 mq, 3 locali. Contattaci per un sopralluogo!', DATE_ADD(NOW(), INTERVAL 2 DAY), 'scheduled'),
    (2, 'facebook', '✨ Attico con terrazzo panoramico in Corso Garibaldi! 120 mq, 4 locali, doppio garage.', DATE_ADD(NOW(), INTERVAL 5 DAY), 'draft');
