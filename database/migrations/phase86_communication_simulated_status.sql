-- phase86_communication_simulated_status.sql
--
-- Un messaggio mai partito non puo' restare in archivio come "inviato".
--
-- config/mail.php:36 e config/whatsapp.php:17, quando l'integrazione e' spenta,
-- restituiscono `['success' => true, 'status' => 'sent', 'simulated' => true]`.
-- Il `success` serve a non bloccare i flussi in sviluppo, e va bene. Il
-- problema e' che api/communications.php:316 e api/whatsapp_send.php leggono
-- solo `status` e ignorano `simulated`: in `communications` finisce una riga
-- "inviata" per un messaggio che nessuno ha mai ricevuto.
--
-- Non e' un dettaglio da sviluppatori. L'archivio Comunicazioni e' quello che
-- l'agente guarda per dire al proprietario "le ho scritto il 14": con MAIL_ENABLED
-- a false — che e' la configurazione attuale — quella frase e' falsa, e nessuno
-- ha modo di accorgersene. api/password_reset.php:105 fa gia' la cosa giusta e
-- restituisce `simulated`; qui mancava il posto dove scriverlo.
--
-- 'simulated' e non 'queued': "in coda" promette che prima o poi parte, e non e'
-- vero — non c'e' nessuna coda dietro. E non 'failed', perche' non e' un guasto:
-- e' una funzione spenta di proposito, e distinguerle serve a capire se c'e' da
-- riparare qualcosa o solo da configurare.
--
-- Allargamento per APPEND letto da information_schema: due migrazioni che
-- riscrivono lo stesso enum si cancellano a vicenda.

USE gestione_immobiliare;

SET @cur := (
    SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'communications'
       AND COLUMN_NAME = 'status'
);

SET @sql := IF(@cur IS NULL OR LOCATE("'simulated'", @cur) > 0,
    'SELECT 1',
    CONCAT("ALTER TABLE communications MODIFY COLUMN status ",
           REPLACE(@cur, ')', ",'simulated')"),
           " NOT NULL DEFAULT 'sent'"));

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
