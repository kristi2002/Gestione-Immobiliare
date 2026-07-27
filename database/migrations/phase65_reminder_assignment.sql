-- phase65_reminder_assignment.sql
-- Il promemoria nasceva come "nota legata a un proprietario": una sola FK
-- utile (client_id) e nessuna idea di CHI in agenzia debba occuparsene.
-- Nella pratica il caso più frequente è il richiamo a un ACQUIRENTE (lead), e
-- chi compila il form (segreteria) quasi mai è chi deve eseguire il compito.
--
-- Aggiunge:
--   assigned_agent_id — l'agente incaricato; riceve la notifica interna al
--                       posto dell'indirizzo generico dell'agenzia.
--   series_id         — self-FK: le occorrenze generate da un promemoria
--                       ricorrente puntano alla riga "madre".
--
-- Perché series_id (istanziazione) invece della sola regola di ricorrenza:
-- finora un promemoria ricorrente era UNA riga che il motore spostava avanti
-- a ogni invio. Conseguenze: il calendario mostrava solo la prossima
-- occorrenza, e "Completa" su martedì prossimo chiudeva l'intera serie perché
-- non esisteva nulla da completare se non la regola stessa. Materializzando le
-- occorrenze ogni data diventa una riga completabile/annullabile per conto suo.
--
-- ON DELETE CASCADE sulla self-FK: eliminare la riga madre elimina le
-- occorrenze future generate da essa, che senza la madre sarebbero orfane.
--
-- Le righe esistenti restano valide: series_id NULL = riga autonoma, ed è
-- esattamente ciò che sono. I ricorrenti già in tabella non hanno occorrenze
-- generate e continuano a essere riprogrammati dal motore come prima, finché
-- non vengono risalvati dal form (vedi config/reminders.php).
--
-- Idempotente: usa migration_add_column / migration_add_index (000_helpers.sql).

USE gestione_immobiliare;

-- 1) Agente incaricato.
CALL migration_add_column('reminders', 'assigned_agent_id',
    'INT UNSIGNED NULL AFTER tenant_id');
CALL migration_add_index('reminders', 'idx_rem_agent', '`assigned_agent_id`');

SET @fk_exists := (
    SELECT COUNT(*) FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'reminders' AND constraint_name = 'fk_reminders_agent'
);
SET @sql := IF(@fk_exists = 0,
    'ALTER TABLE reminders ADD CONSTRAINT fk_reminders_agent FOREIGN KEY (assigned_agent_id) REFERENCES admin_users(id) ON DELETE SET NULL ON UPDATE CASCADE',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 2) Serie ricorrente.
CALL migration_add_column('reminders', 'series_id',
    'INT UNSIGNED NULL AFTER assigned_agent_id');
CALL migration_add_index('reminders', 'idx_rem_series', '`series_id`');

SET @fk_exists := (
    SELECT COUNT(*) FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'reminders' AND constraint_name = 'fk_reminders_series'
);
SET @sql := IF(@fk_exists = 0,
    'ALTER TABLE reminders ADD CONSTRAINT fk_reminders_series FOREIGN KEY (series_id) REFERENCES reminders(id) ON DELETE CASCADE ON UPDATE CASCADE',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
