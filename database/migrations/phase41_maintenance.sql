-- Phase 41 — Manutenzione (maintenance interventions / work orders)
-- Backs api/maintenance.php. Idempotent (CREATE TABLE IF NOT EXISTS); relies on
-- the connection's current database (no hardcoded USE, so it runs on both the
-- local `gestione_immobiliare` DB and the production `default` DB).

CREATE TABLE IF NOT EXISTS `maintenance_requests` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title`           VARCHAR(200) NOT NULL COMMENT 'Titolo intervento',
  `description`     TEXT         DEFAULT NULL,
  `property_id`     INT UNSIGNED DEFAULT NULL,
  `tenant_id`       INT UNSIGNED DEFAULT NULL,
  `supplier_id`     INT UNSIGNED DEFAULT NULL,
  `status`          ENUM('todo','in_progress','done') NOT NULL DEFAULT 'todo',
  `priority`        ENUM('urgent','normal') NOT NULL DEFAULT 'normal',
  `reported_date`   DATE          DEFAULT NULL COMMENT 'Data segnalazione',
  `eta_date`        DATE          DEFAULT NULL COMMENT 'Data prevista completamento',
  `started_date`    DATE          DEFAULT NULL,
  `completed_date`  DATE          DEFAULT NULL,
  `cost`            DECIMAL(12,2) DEFAULT NULL COMMENT 'Costo intervento (EUR)',
  `rating`          TINYINT       DEFAULT NULL COMMENT 'Valutazione 1-5 (a lavoro concluso)',
  `progress`        TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Avanzamento 0-100',
  `created_by`      INT UNSIGNED  DEFAULT NULL,
  `created_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_maint_status` (`status`),
  KEY `idx_maint_priority` (`priority`),
  KEY `idx_maint_reported` (`reported_date`),
  KEY `fk_maint_property` (`property_id`),
  KEY `fk_maint_tenant` (`tenant_id`),
  KEY `fk_maint_supplier` (`supplier_id`),
  CONSTRAINT `fk_maint_property`   FOREIGN KEY (`property_id`) REFERENCES `properties` (`id`)   ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_maint_tenant`     FOREIGN KEY (`tenant_id`)   REFERENCES `tenants` (`id`)      ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_maint_supplier`   FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`)    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_maint_created_by` FOREIGN KEY (`created_by`)  REFERENCES `admin_users` (`id`)  ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
