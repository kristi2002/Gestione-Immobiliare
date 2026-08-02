-- phase93_reminder_marketing_consent.sql
--
-- Il registro dei consensi tornava a non fermare niente.
--
-- phase88 ha costruito la porta giusta — lib/marketing_mail.php, che chiede al
-- registro se si puo' scrivere e aggiunge il link di disiscrizione — ma nessuno
-- la attraversava: processSingleReminder() chiamava sendHtmlEmail() diretto.
-- Un'automazione commerciale a un lead che non ha mai dato il consenso partiva
-- lo stesso, e in `consent_records` la revoca restava una riga che nessuno
-- leggeva al momento di spedire.
--
-- Non si puo' pero' mettere OGNI promemoria sotto consenso marketing: la
-- scadenza dell'affitto, il sollecito di pagamento e la notifica all'agente
-- hanno base giuridica contrattuale, e bloccarli significherebbe che chi non ha
-- dato consenso commerciale non riceve piu' nemmeno gli avvisi che gli spettano.
-- Serve distinguere, e la distinzione la puo' fare solo chi scrive il messaggio.
--
--   is_marketing  — 0 (default) = comunicazione di servizio, spedita come prima.
--                   1 = commerciale: passa da sendMarketingEmail(), che verifica
--                   il consenso e mette il link di disiscrizione.
--
--                   Il default 0 tiene fermo il comportamento di tutte le righe
--                   gia' esistenti — che sono promemoria, non campagne. Le
--                   automazioni commerciali gia' create vanno marcate a mano
--                   dalla loro scheda: non c'e' modo di indovinare dal testo
--                   quali lo siano.
--
--                   Il modulo pero' propone "Commerciale" sulle automazioni
--                   nuove, perche' i due errori non si equivalgono: marcare
--                   commerciale cio' che e' di servizio blocca un invio e lo
--                   scrive nel registro, dove si vede e si corregge. Il
--                   contrario manda un'email che non si puo' richiamare.
--
--   status 'blocked' — un invio fermato dal consenso non e' 'failed' (non c'e'
--                   niente da riparare) ne' 'skipped' (che qui vuol dire "il
--                   contatto non ha un indirizzo"). Confonderli significa non
--                   sapere piu' se una campagna e' rotta o solo non consentita.
--
-- Allargamento dell'enum per APPEND letto da information_schema: due migrazioni
-- che riscrivono la stessa lista si cancellano a vicenda.
--
-- Niente punto e virgola dentro le stringhe: lo splitter del runner taglia li'.

CALL migration_add_column('reminders', 'is_marketing',
    'TINYINT(1) NOT NULL DEFAULT 0 AFTER notify_client');

SET @cur := (
    SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'reminder_dispatch_log'
       AND COLUMN_NAME = 'status'
);

SET @sql := IF(@cur IS NULL OR LOCATE("'blocked'", @cur) > 0,
    'SELECT 1',
    CONCAT("ALTER TABLE reminder_dispatch_log MODIFY COLUMN status ",
           REPLACE(@cur, ')', ",'blocked')"),
           " NOT NULL"));

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
