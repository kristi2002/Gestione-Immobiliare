-- phase64_appointment_context.sql
-- "Visite" diventa "Appuntamenti": il record catturava solo immobile + data +
-- durata, cioè presupponeva che ogni appuntamento fosse un sopralluogo. Nella
-- pratica dell'agenzia lo stesso slot di agenda può essere una visita, una
-- acquisizione, un atto o una semplice chiamata, e non sempre si svolge presso
-- l'immobile. Senza queste due informazioni l'agenda non è filtrabile e la
-- scheda appuntamento non può dire all'agente dove deve presentarsi.
--
-- Aggiunge:
--   appointment_type  — visita | acquisizione | atto | chiamata
--   location_type     — immobile | agenzia | virtuale
--   location_detail   — indirizzo alternativo (agenzia) o link alla call
--   notify_client     — flag "invia promemoria al cliente"
--   reminder_id       — promemoria generato dal flag, per poterlo aggiornare
--                       o cancellare insieme all'appuntamento
--
-- Tutte NULLABLE o con DEFAULT: le righe esistenti restano valide e vengono
-- lette come "visita presso l'immobile", che è ciò che erano.
--
-- reminders.lead_id: il motore promemoria (config/reminders.php) risolveva il
-- destinatario solo via clients, quindi un promemoria per un LEAD — il caso
-- normale di una visita — non aveva un indirizzo a cui scrivere e finiva in
-- 'skipped_no_email'. La colonna chiude quel buco.
--
-- Idempotente: usa migration_add_column / migration_add_index (000_helpers.sql).

USE gestione_immobiliare;

-- 1) Contesto dell'appuntamento.
CALL migration_add_column('appointments', 'appointment_type',
    "ENUM('visita','acquisizione','atto','chiamata') NOT NULL DEFAULT 'visita' AFTER agent_id");
CALL migration_add_column('appointments', 'location_type',
    "ENUM('immobile','agenzia','virtuale') NOT NULL DEFAULT 'immobile' AFTER duration_minutes");
CALL migration_add_column('appointments', 'location_detail',
    'VARCHAR(500) NULL AFTER location_type');

-- 2) Promemoria al cliente.
CALL migration_add_column('appointments', 'notify_client',
    'TINYINT(1) NOT NULL DEFAULT 0 AFTER location_detail');
CALL migration_add_column('appointments', 'reminder_id',
    'INT UNSIGNED NULL AFTER notify_client');

CALL migration_add_index('appointments', 'idx_appt_type', '`appointment_type`');
CALL migration_add_index('appointments', 'idx_appt_reminder', '`reminder_id`');

-- FK appointments.reminder_id -> reminders.id (SET NULL: cancellare il
-- promemoria non deve cancellare l'appuntamento).
SET @fk_exists := (
    SELECT COUNT(*) FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'appointments' AND constraint_name = 'fk_appt_reminder'
);
SET @sql := IF(@fk_exists = 0,
    'ALTER TABLE appointments ADD CONSTRAINT fk_appt_reminder FOREIGN KEY (reminder_id) REFERENCES reminders(id) ON DELETE SET NULL ON UPDATE CASCADE',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 3) Destinatario "lead" per il motore promemoria.
CALL migration_add_column('reminders', 'lead_id',
    'INT UNSIGNED NULL AFTER client_id');
CALL migration_add_index('reminders', 'idx_rem_lead', '`lead_id`');

SET @fk_exists := (
    SELECT COUNT(*) FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'reminders' AND constraint_name = 'fk_reminders_lead'
);
SET @sql := IF(@fk_exists = 0,
    'ALTER TABLE reminders ADD CONSTRAINT fk_reminders_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL ON UPDATE CASCADE',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
