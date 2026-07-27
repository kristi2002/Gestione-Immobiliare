-- phase66_automations.sql
-- Automazioni: orario di invio, regola del giorno, token dinamici, registro
-- invii, trigger su eventi.
--
-- Contesto: "Automazione" non è un'entità propria — è una riga `reminders` con
-- notify_client=1 (vedi assets/js/automations.js). phase64/65 hanno unificato
-- appuntamenti, promemoria e automazioni su questa tabella e sul motore serie;
-- questa fase le dà ciò che le mancava per essere una vera automazione, senza
-- forkare un secondo scheduler.
--
-- Cosa aggiunge e perché:
--
--   schedule_time  — l'ORA di invio. Finora il form mandava solo una data, e
--                    DateTime::createFromFormat('Y-m-d', …) eredita l'orologio
--                    corrente: l'email partiva all'ora in cui l'agente aveva
--                    premuto Salva. Verificato: '2026-08-26' → 2026-08-26
--                    14:31:47. Non era mezzanotte, era casuale.
--
--   day_rule       — quale GIORNO. Serve anche a curare una deriva reale:
--                    '+1 month' da 31 gennaio in PHP dà 3 marzo (poi 3 aprile),
--                    quindi una mensile avviata il 29-31 saltava febbraio e si
--                    spostava per sempre. Con una regola il giorno viene
--                    riderivato ogni mese e si auto-corregge (31 → 28 → 31).
--                    Formati: 'dom:<1-31>', 'dom:last', 'nth:<1-4|last>:<1-7>'
--                    (es. nth:1:1 = primo lunedì), 'dow:<1-7>' per le
--                    settimanali. NULL = stesso giorno della data di inizio.
--
--   trigger_type / trigger_event / trigger_delay_minutes / recipient_rule
--                  — automazioni a EVENTO invece che a orologio. La regola non
--                    ha una data propria: quando l'evento accade il dispatcher
--                    materializza un'occorrenza (series_id → regola) e da lì in
--                    poi è il motore promemoria esistente a occuparsene. Zero
--                    duplicazione del pipeline di invio.
--
-- Idempotente: usa migration_add_column / migration_add_index (000_helpers.sql).
-- Nessun `USE`: il runner lo rimuoverebbe comunque, e il DB di produzione si
-- chiama `default`, non `gestione_immobiliare`.

-- ---------------------------------------------------------------------------
-- 1) Programmazione fine
-- ---------------------------------------------------------------------------

CALL migration_add_column('reminders', 'schedule_time',
    'TIME NULL DEFAULT NULL AFTER end_date');

CALL migration_add_column('reminders', 'day_rule',
    'VARCHAR(32) NULL DEFAULT NULL AFTER schedule_time');

-- ---------------------------------------------------------------------------
-- 2) Trigger a evento
-- ---------------------------------------------------------------------------

CALL migration_add_column('reminders', 'trigger_type',
    "ENUM('scheduled','event') NOT NULL DEFAULT 'scheduled' AFTER day_rule");

CALL migration_add_column('reminders', 'trigger_event',
    'VARCHAR(64) NULL DEFAULT NULL AFTER trigger_type');

CALL migration_add_column('reminders', 'trigger_delay_minutes',
    'INT NOT NULL DEFAULT 0 AFTER trigger_event');

CALL migration_add_column('reminders', 'recipient_rule',
    'VARCHAR(32) NULL DEFAULT NULL AFTER trigger_delay_minutes');

-- Il dispatcher cerca "regole vive per questo evento": indice sulla terna.
CALL migration_add_index('reminders', 'idx_rem_trigger',
    '`trigger_type`, `trigger_event`, `status`');

-- ---------------------------------------------------------------------------
-- 3) Coda eventi di sistema
-- ---------------------------------------------------------------------------
--
-- Gli eventi vengono ACCODATI dalle API, non consumati in-request: un invio
-- email dentro il ciclo di una PUT rallenta l'agente e, se fallisce, fa fallire
-- il salvataggio dell'immobile. Il cron li drena.

CREATE TABLE IF NOT EXISTS `automation_events` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_type`   VARCHAR(64)  NOT NULL COMMENT 'es. property.price_reduced',
  `entity_type`  VARCHAR(32)  NOT NULL COMMENT 'property | appointment | lead | …',
  `entity_id`    INT UNSIGNED NOT NULL,
  `payload`      JSON         DEFAULT NULL COMMENT 'FK coinvolte + dati specifici evento',
  `occurred_at`  DATETIME     NOT NULL,
  `processed_at` DATETIME     DEFAULT NULL,
  `status`       ENUM('pending','processed','failed') NOT NULL DEFAULT 'pending',
  `error`        TEXT         DEFAULT NULL,
  `created_at`   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ev_pending` (`status`, `occurred_at`),
  KEY `idx_ev_type` (`event_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4) Registro invii
-- ---------------------------------------------------------------------------
--
-- Finora l'esito di un invio esisteva solo nello stdout del cron: il codice
-- calcolava 'failed' e poi lo buttava via. Gli invii riusciti finivano in
-- `communications`, ma quella tabella ha client_id NOT NULL — quindi le email
-- a un LEAD o a un INQUILINO non lasciavano alcuna traccia. Questo registro non
-- è vincolato a `clients` apposta.
--
-- `automation_id` punta sempre alla REGOLA (la riga madre della serie, o la
-- riga stessa se autonoma): così "ultimo invio di questa automazione" è una
-- sola query indicizzata su tutte le sue occorrenze.

CREATE TABLE IF NOT EXISTS `reminder_dispatch_log` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reminder_id`      INT UNSIGNED NOT NULL COMMENT 'occorrenza che ha generato l''invio',
  `automation_id`    INT UNSIGNED NOT NULL COMMENT 'regola: series_id se occorrenza, altrimenti reminder_id',
  `dispatched_at`    DATETIME     NOT NULL,
  `channel`          ENUM('email') NOT NULL DEFAULT 'email',
  `recipient_type`   ENUM('client','lead','tenant','agent','admin','none') NOT NULL DEFAULT 'none',
  `recipient_email`  VARCHAR(255) DEFAULT NULL,
  `rendered_subject` VARCHAR(255) DEFAULT NULL,
  `rendered_body`    MEDIUMTEXT   DEFAULT NULL,
  -- 'simulated' esiste perché con mail_enabled=false sendClientEmail()
  -- restituisce success=true senza spedire nulla. Registrarlo come 'sent'
  -- farebbe dire alla scheda «Inviato» di un'email mai partita.
  `status`           ENUM('sent','simulated','failed','skipped') NOT NULL,
  `error_details`    TEXT         DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_disp_automation` (`automation_id`, `dispatched_at`),
  KEY `idx_disp_reminder` (`reminder_id`),
  CONSTRAINT `fk_disp_reminder` FOREIGN KEY (`reminder_id`)
      REFERENCES `reminders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
