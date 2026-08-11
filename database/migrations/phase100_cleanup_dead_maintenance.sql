-- phase100 — via due residui che erano diventati trappole.
--
-- 1. `maintenance_requests`: una SECONDA rappresentazione della manutenzione.
--
--    La bacheca vera lavora su `reminders` con `request_type='maintenance'`
--    (vedi lib/… e api/reminders.php). Questa tabella invece nasceva per la SPA
--    React, abbandonata mesi fa e cancellata dal repository: zero righe, nessun
--    codice che la scrive, e `api/maintenance.php` — l'unico lettore — non era
--    chiamato da nessuna schermata. Il suo stesso commento diceva «and the React
--    page shows its empty states».
--
--    Il problema non e' il codice morto, e' il MODELLO DOPPIO: chi un domani
--    costruisse sull'endpoint scriverebbe righe che la bacheca non legge, e se
--    ne accorgerebbe dopo. Stessa categoria di `api/me.php` e
--    `api/dashboard_prefs.php`, rimossi dall'audit del 3 agosto; questa e'
--    sopravvissuta perche' la tabella esiste per davvero, quindi una ricerca
--    "qualcuno la nomina?" la trova.
--
-- 2. `social_settings.meta_refresh_token`: colonna mai letta ne' scritta.
--
--    Residuo di un rinnovo automatico del token Meta che non e' stato costruito
--    — quello che e' stato consegnato e' l'avviso via email alla scadenza
--    (config/meta/scheduler.php). Una colonna che si chiama "refresh token" e
--    resta perennemente NULL suggerisce un meccanismo che non esiste.
--
-- Entrambe le rimozioni sono CONDIZIONATE al fatto che non ci sia niente
-- dentro: su questa installazione sono vuote (verificato in locale e in
-- produzione prima di scrivere questa migrazione), ma un'installazione che
-- avesse dei dati li tiene. Una migrazione non decide al posto di chi ha dei
-- dati che non si aspettava. La guardia e' provata: con una riga dentro, la
-- tabella resta.
--
-- Su un'installazione NUOVA la tabella viene creata da phase41 e la colonna dal
-- baseline (schema_production.sql), e questa migrazione le toglie subito dopo.
-- Un giro a vuoto, ma corretto: una migrazione gia' applicata non si riscrive
-- mai, ed e' cio' che rende sicuro rieseguire l'intera catena.
--
-- Nota storica: phase78 aveva GIA' annotato che «maintenance_requests di phase41
-- non ha piu' nessun lettore vivo». L'osservazione era scritta e non e' mai
-- diventata un'azione: e' rimasta a fare da esca per due anni di sviluppo.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. maintenance_requests — solo se esiste ED e' vuota
-- ─────────────────────────────────────────────────────────────────────────────

SET @tbl_exists := (
    SELECT COUNT(*) FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maintenance_requests'
);

-- Il conteggio va fatto dinamicamente: se la tabella non c'e', un
-- `SELECT COUNT(*) FROM maintenance_requests` letterale fallirebbe in parsing.
SET @rows := 0;
SET @sql := IF(@tbl_exists > 0,
    'SELECT COUNT(*) INTO @rows FROM maintenance_requests',
    'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(@tbl_exists > 0 AND @rows = 0,
    'DROP TABLE maintenance_requests',
    'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. social_settings.meta_refresh_token — solo se esiste e nessuno l'ha riempita
-- ─────────────────────────────────────────────────────────────────────────────

SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'social_settings' AND COLUMN_NAME = 'meta_refresh_token'
);

SET @filled := 0;
SET @sql := IF(@col_exists > 0,
    'SELECT COUNT(*) INTO @filled FROM social_settings WHERE meta_refresh_token IS NOT NULL',
    'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(@col_exists > 0 AND @filled = 0,
    'ALTER TABLE social_settings DROP COLUMN meta_refresh_token',
    'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
