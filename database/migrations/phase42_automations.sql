-- Phase 42 — Automazioni (automation flow definitions)
-- Backs api/automations.php. Idempotent; relies on the connection's current
-- database (no hardcoded USE, so it runs on both `gestione_immobiliare` and the
-- production `default` DB).

CREATE TABLE IF NOT EXISTS `automations` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`         VARCHAR(150) NOT NULL COMMENT 'Nome automazione',
  `description`  TEXT         DEFAULT NULL,
  `trigger_desc` VARCHAR(255) NOT NULL DEFAULT '' COMMENT 'Descrizione trigger (es. Nuovo contratto firmato)',
  `action_desc`  VARCHAR(500) NOT NULL DEFAULT '' COMMENT 'Descrizione azioni (es. Email + WhatsApp)',
  `color`        VARCHAR(16)  DEFAULT NULL COMMENT 'Accento UI (hex)',
  `active`       TINYINT(1)   NOT NULL DEFAULT 1,
  `run_count`    INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Esecuzioni totali',
  `created_by`   INT UNSIGNED DEFAULT NULL,
  `created_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_automations_active` (`active`),
  KEY `fk_automations_created_by` (`created_by`),
  CONSTRAINT `fk_automations_created_by` FOREIGN KEY (`created_by`) REFERENCES `admin_users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
