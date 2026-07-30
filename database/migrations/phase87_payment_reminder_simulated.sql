-- phase87_payment_reminder_simulated.sql
--
-- Un sollecito mai partito non puo' restare a registro come "inviato".
--
-- payment_reminder_log.status era ENUM('sent','failed'). Quando l'invio email e'
-- spento, config/mail.php restituisce success=true con simulated=true, e sia
-- api/payment_reminder_log.php sia cron/send_payment_reminders.php scrivevano
-- 'sent'. Con MAIL_ENABLED a false il registro si riempiva di solleciti che
-- nessun inquilino ha mai ricevuto.
--
-- Non e' un dettaglio: il registro dei solleciti e' cio' che l'agenzia guarda
-- prima di passare alle maniere forti con un inquilino moroso, ed e' cio' che
-- mostrerebbe a un giudice per dire "l'avevamo avvisato il 12". Una riga 'sent'
-- falsa e' peggio di una riga assente.
--
-- Conseguenza silenziosa e piu' subdola: il periodo di attesa di 7 giorni
-- conta solo le righe status='sent'. Finche' le simulazioni si registravano
-- come inviate, ogni sollecito simulato bloccava per una settimana quello vero
-- che sarebbe partito appena riacceso l'invio. 'simulated' esce da quel
-- conteggio, quindi riaccendendo l'email i solleciti ripartono subito.
--
-- 'simulated' e non 'failed', perche' non e' un guasto da riparare ma una
-- funzione spenta di proposito, e distinguerle dice se c'e' da aggiustare
-- qualcosa o solo da configurarla.
--
-- Allargamento per APPEND letto da information_schema. Due migrazioni che
-- riscrivono lo stesso enum si cancellano a vicenda.

SET @cur := (
    SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'payment_reminder_log'
       AND COLUMN_NAME = 'status'
);

SET @sql := IF(@cur IS NULL OR LOCATE("'simulated'", @cur) > 0,
    'SELECT 1',
    CONCAT("ALTER TABLE payment_reminder_log MODIFY COLUMN status ",
           REPLACE(@cur, ')', ",'simulated')"),
           " NOT NULL DEFAULT 'sent'"));

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
