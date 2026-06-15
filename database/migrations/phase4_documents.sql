-- Phase 4 migration: Documents table
-- Run this if you already imported an earlier schema.

USE gestione_immobiliare;

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
