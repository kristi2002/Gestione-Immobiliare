-- phase101 — il contratto non resta senza locatore, e via il secondo modello
-- delle automazioni.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. contracts.client_id e invoices.client_id: SET NULL -> RESTRICT
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Onesta' su cosa questa migrazione e' e cosa non e': **non sta chiudendo una
-- falla aperta**. Oggi nessun percorso applicativo cancella davvero un
-- proprietario — `deleteClient()` in api/clients.php e' una archiviazione
-- (`status='archived'`) e la cancellazione GDPR ANONIMIZZA la riga sul posto,
-- tenendola apposta «so financial/contractual history stays consistent»
-- (config/gdpr.php). L'unico `DELETE FROM clients` in tutto il repository sta
-- nello script che ripulisce le proprie fixture.
--
-- Quello che si chiude e' la differenza fra "non succede" e "non puo'
-- succedere". Con ON DELETE SET NULL, una cancellazione fatta a mano dalla
-- console, uno script di ripristino, o una funzione futura scritta senza
-- conoscere questa storia, staccano un CONTRATTO dal suo locatore senza un
-- errore: la riga resta, valida a schema, e nessuno sa piu' di chi sia. Un
-- contratto e una fattura sono documenti fiscali; perdere l'intestatario in
-- silenzio e' il tipo di danno che si scopre dal commercialista.
--
-- Che sia una svista e non una scelta lo dice lo schema stesso: verso lo stesso
-- padre, `properties.client_id` e' gia' RESTRICT. E sul lato inquilino la
-- protezione c'e' gia' (payments, sdd_collections e stripe_payments sono
-- RESTRICT verso `tenants`). Mancava solo qui, sul lato proprietario.
--
-- Stessa direzione di phase70 (payments->contracts), phase71 (figlie del
-- contratto) e phase96 (provvigioni->agente): i documenti che valgono soldi
-- trattengono il padre invece di lasciarlo andare.
--
-- Conseguenza voluta: un proprietario con contratti o fatture a registro non si
-- elimina piu' nemmeno da SQL. Si archivia — che e' gia' cio' che fa l'app.
--
-- Le colonne restano NULLABLE: le righe che hanno gia' client_id NULL (qui zero)
-- non vengono toccate, e RESTRICT non ha niente da dire su un riferimento
-- assente. Si vieta di ORFANARE, non si obbliga a compilare.

-- Idempotente: si rifa' il vincolo solo se e' ancora quello vecchio.
SET @fk_rule := (
    SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contracts' AND CONSTRAINT_NAME = 'fk_contracts_client'
);
SET @sql := IF(@fk_rule = 'SET NULL',
    'ALTER TABLE contracts DROP FOREIGN KEY fk_contracts_client', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql := IF(@fk_rule = 'SET NULL',
    'ALTER TABLE contracts
       ADD CONSTRAINT fk_contracts_client
       FOREIGN KEY (client_id) REFERENCES clients(id)
       ON DELETE RESTRICT ON UPDATE CASCADE', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @fk_rule := (
    SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'invoices' AND CONSTRAINT_NAME = 'fk_invoice_client'
);
SET @sql := IF(@fk_rule = 'SET NULL',
    'ALTER TABLE invoices DROP FOREIGN KEY fk_invoice_client', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql := IF(@fk_rule = 'SET NULL',
    'ALTER TABLE invoices
       ADD CONSTRAINT fk_invoice_client
       FOREIGN KEY (client_id) REFERENCES clients(id)
       ON DELETE RESTRICT ON UPDATE CASCADE', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Le tabelle GDPR agganciano `agencies` come tutte le altre
-- ─────────────────────────────────────────────────────────────────────────────
--
-- phase31 ha messo `agency_id INT UNSIGNED NOT NULL DEFAULT 1` + FK RESTRICT su
-- nove tabelle radice. Le quattro tabelle GDPR sono arrivate dopo con la stessa
-- colonna e SENZA il vincolo: hanno il campo ma non la promessa. Finche'
-- l'agenzia e' una sola non cambia niente, ed e' proprio per questo che va
-- sistemato adesso — il giorno in cui `currentAgencyId()` restituira' qualcosa
-- di diverso da 1 (config/agency.php lo prevede) queste quattro sarebbero le
-- uniche a poter puntare a un'agenzia inesistente, e sono quelle che tengono i
-- consensi e le richieste di cancellazione.
--
-- migration_add_fk aggiunge solo se il vincolo manca: rieseguibile.

CALL migration_add_index('consent_records',      'idx_consent_agency',      'agency_id');
CALL migration_add_fk('consent_records',      'fk_consent_agency',      'agency_id', 'agencies', 'id', 'RESTRICT');

CALL migration_add_index('data_export_requests', 'idx_export_agency',       'agency_id');
CALL migration_add_fk('data_export_requests', 'fk_export_agency',       'agency_id', 'agencies', 'id', 'RESTRICT');

CALL migration_add_index('data_processing_log',  'idx_dplog_agency',        'agency_id');
CALL migration_add_fk('data_processing_log',  'fk_dplog_agency',        'agency_id', 'agencies', 'id', 'RESTRICT');

CALL migration_add_index('erasure_requests',     'idx_erasure_agency',      'agency_id');
CALL migration_add_fk('erasure_requests',     'fk_erasure_agency',      'agency_id', 'agencies', 'id', 'RESTRICT');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. `automations` — la stessa trappola di phase100, un giro dopo
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Le automazioni VERE sono righe di `reminders` (phase66): la pagina Automazioni
-- le legge da li', `reminder_dispatch_log.automation_id` ci si riferisce, e
-- config/automation_events.php lavora su quelle. Questa tabella e' il resto di
-- un disegno precedente: zero righe, e — verificato con una scansione di tutte
-- le stringhe SQL del repository — NESSUNA query la nomina, in nessun file.
--
-- E' esattamente cio' che phase100 chiamava il MODELLO DOPPIO: non pesa niente,
-- ma esiste, e chi domani cercasse "dove stanno le automazioni?" trova una
-- tabella con quel nome esatto e ci costruisce sopra. Scriverebbe righe che la
-- bacheca non legge, e se ne accorgerebbe dopo.
--
-- Condizionata al fatto che sia vuota, come phase100: un'installazione che ci
-- avesse dei dati se li tiene, e questa migrazione non decide al posto suo.

SET @tbl_exists := (
    SELECT COUNT(*) FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'automations'
);

SET @rows := 0;
SET @sql := IF(@tbl_exists > 0,
    'SELECT COUNT(*) INTO @rows FROM automations', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(@tbl_exists > 0 AND @rows = 0,
    'DROP TABLE automations', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
