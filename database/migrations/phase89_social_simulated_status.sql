-- phase89_social_simulated_status.sql
--
-- Un annuncio mai uscito non puo' restare a registro come "Pubblicato".
--
-- config/meta/scheduler.php scrive status='published' con published_at=NOW()
-- ogni volta che publishSocialPost() risponde success, e a integrazione Meta
-- spenta quella risposta arriva con simulated=true e degli identificativi
-- inventati. Il flag `simulated` veniva restituito al chiamante (riga 61) ma
-- non finiva da nessuna parte: la riga in social_posts diceva "pubblicato".
--
-- Perche' conta: la pagina Social e' l'unico posto dove l'agenzia verifica cosa
-- e' uscito e quando. Con Meta ancora in modalita' di sviluppo — cioe' oggi —
-- lo storico si riempie di annunci che nessuno ha mai visto, e quando la
-- connessione a Meta verra' completata quelle righe resteranno li' a dire il
-- falso, indistinguibili da quelle vere.
--
-- 'simulated' e non 'failed': non e' un guasto da riparare ma un'integrazione
-- spenta di proposito, e distinguerle dice se c'e' da aggiustare qualcosa o
-- solo da configurarla. Stessa scelta gia' fatta per communications (phase86) e
-- payment_reminder_log (phase87).
--
-- Allargamento per APPEND letto da information_schema: due migrazioni che
-- riscrivono lo stesso enum si cancellano a vicenda.

SET @cur := (
    SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'social_posts'
       AND COLUMN_NAME = 'status'
);

SET @sql := IF(@cur IS NULL OR LOCATE("'simulated'", @cur) > 0,
    'SELECT 1',
    CONCAT("ALTER TABLE social_posts MODIFY COLUMN status ",
           REPLACE(@cur, ')', ",'simulated')"),
           " NOT NULL DEFAULT 'draft'"));

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
