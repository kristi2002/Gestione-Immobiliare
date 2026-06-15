-- Phase 6 migration: Reminder email notification fields
-- Idempotent — safe to re-run (including after schema.sql).

USE gestione_immobiliare;

DROP PROCEDURE IF EXISTS _migration_phase6_reminder_notifications;

DELIMITER //

CREATE PROCEDURE _migration_phase6_reminder_notifications()
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'reminders'
          AND COLUMN_NAME = 'notify_admin'
    ) THEN
        ALTER TABLE reminders
            ADD COLUMN notify_admin TINYINT(1) NOT NULL DEFAULT 1 AFTER property_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'reminders'
          AND COLUMN_NAME = 'notify_client'
    ) THEN
        ALTER TABLE reminders
            ADD COLUMN notify_client TINYINT(1) NOT NULL DEFAULT 0 AFTER notify_admin;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'reminders'
          AND COLUMN_NAME = 'email_subject'
    ) THEN
        ALTER TABLE reminders
            ADD COLUMN email_subject VARCHAR(255) DEFAULT NULL AFTER notify_client;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'reminders'
          AND COLUMN_NAME = 'email_body'
    ) THEN
        ALTER TABLE reminders
            ADD COLUMN email_body TEXT DEFAULT NULL AFTER email_subject;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'reminders'
          AND COLUMN_NAME = 'last_notified_at'
    ) THEN
        ALTER TABLE reminders
            ADD COLUMN last_notified_at DATETIME DEFAULT NULL AFTER email_body;
    END IF;
END //

DELIMITER ;

CALL _migration_phase6_reminder_notifications();
DROP PROCEDURE IF EXISTS _migration_phase6_reminder_notifications;
