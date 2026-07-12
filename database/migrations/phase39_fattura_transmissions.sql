-- Phase 39 — FatturaPA / SdI transmission lifecycle
-- Run once against the production DB:
--   mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" < database/migrations/phase39_fattura_transmissions.sql
--
-- One row per invoice tracking its electronic-invoice lifecycle:
--   generato -> trasmesso -> consegnato | messa_a_disposizione | scartato | accettato | rifiutato
-- The generated XML is persisted (protected uploads tree) and the SdI receipt
-- (RC/MC/NS/NE/DT/AT) is recorded as it comes back.

CREATE TABLE IF NOT EXISTS `fattura_transmissions` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `invoice_id`       INT UNSIGNED NOT NULL,
  `status`           ENUM('generato','trasmesso','consegnato','messa_a_disposizione',
                          'scartato','accettato','rifiutato','errore_invio')
                       NOT NULL DEFAULT 'generato',
  `progressivo`      VARCHAR(10)  DEFAULT NULL COMMENT 'ProgressivoInvio usato nel file',
  `xml_filename`     VARCHAR(120) DEFAULT NULL COMMENT 'Nome file XML (IT..._nnnnn.xml)',
  `xml_path`         VARCHAR(255) DEFAULT NULL COMMENT 'Percorso XML persistito (uploads/documents/...)',
  `channel`          VARCHAR(30)  DEFAULT NULL COMMENT 'Canale: manuale/aruba/fatturaincloud/...',
  `sdi_identificativo` VARCHAR(30) DEFAULT NULL COMMENT 'Identificativo SdI assegnato',
  `receipt_type`     VARCHAR(5)   DEFAULT NULL COMMENT 'Tipo ricevuta SdI (RC/MC/NS/NE/DT/AT)',
  `receipt_message`  VARCHAR(500) DEFAULT NULL COMMENT 'Descrizione ricevuta/errore',
  `sent_at`          DATETIME     DEFAULT NULL,
  `delivered_at`     DATETIME     DEFAULT NULL,
  `created_by`       INT UNSIGNED DEFAULT NULL,
  `created_at`       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ft_invoice` (`invoice_id`),
  KEY `idx_ft_status` (`status`),
  CONSTRAINT `fk_ft_invoice` FOREIGN KEY (`invoice_id`)
      REFERENCES `invoices` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_ft_created_by` FOREIGN KEY (`created_by`)
      REFERENCES `admin_users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
