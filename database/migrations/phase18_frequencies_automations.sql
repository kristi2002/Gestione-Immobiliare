-- Phase 18: Add biweekly/quarterly reminder frequencies + end_date for automations
-- Run AFTER 000_helpers.sql (provides idempotent helper procedures).
-- Idempotent / safe to re-run on MySQL 8.
-- Run: mysql -u user -p dbname < phase18_frequencies_automations.sql

-- Extend frequency ENUM to match spec: once, weekly, biweekly (15gg), monthly, quarterly, yearly
ALTER TABLE reminders
    MODIFY COLUMN frequency ENUM('once','weekly','biweekly','monthly','quarterly','yearly')
    NOT NULL DEFAULT 'once';

-- Add end_date for automations ("data fine" from the spec)
CALL migration_add_column('reminders', 'end_date', 'DATE NULL DEFAULT NULL AFTER reminder_date');

-- Index for automation filtering (notify_client=1 reminders)
CALL migration_add_index('reminders', 'idx_notify_client', 'notify_client, status');