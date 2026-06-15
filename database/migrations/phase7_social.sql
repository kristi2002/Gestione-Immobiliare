-- Phase 7 migration: Social Media tables
-- Idempotent — safe on re-run. Seed posts only if properties exist.

USE gestione_immobiliare;

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

INSERT IGNORE INTO social_settings (id) VALUES (1);

INSERT INTO social_posts (property_id, platform, caption, scheduled_at, status)
SELECT 1, 'both',
       '🏠 Appartamento luminoso in Via Roma 15, Milano — 85 mq, 3 locali. Contattaci per un sopralluogo!',
       DATE_ADD(NOW(), INTERVAL 2 DAY), 'scheduled'
FROM properties WHERE id = 1
  AND NOT EXISTS (SELECT 1 FROM social_posts WHERE property_id = 1 AND status = 'scheduled');

INSERT INTO social_posts (property_id, platform, caption, scheduled_at, status)
SELECT 2, 'facebook',
       '✨ Attico con terrazzo panoramico in Corso Garibaldi! 120 mq, 4 locali, doppio garage.',
       DATE_ADD(NOW(), INTERVAL 5 DAY), 'draft'
FROM properties WHERE id = 2
  AND NOT EXISTS (SELECT 1 FROM social_posts WHERE property_id = 2 AND status = 'draft');
