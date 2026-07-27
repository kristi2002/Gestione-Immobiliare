-- phase68_whatsapp_inbox_triage.sql
-- WhatsApp Inbox come banco di triage: riconoscere chi scrive, e poterlo
-- agganciare all'anagrafica senza uscire dalla chat.
--
-- 1) whatsapp_messages.lead_id — il webhook risolveva il numero solo su clients
--    e tenants. Ma il caso tipico dell'inbox è ESATTAMENTE il terzo: uno che ha
--    visto un annuncio e scrive per la prima volta. Senza questa colonna, dopo
--    aver creato il lead dalla chat non c'era dove scrivere il collegamento e la
--    conversazione restava un numero anonimo per sempre.
--
-- 2) idx_wm_to — listThreads/getThread filtrano su (from_number OR to_number),
--    ma solo from_number era indicizzato: metà della condizione faceva scan.
--
-- 3) leads.source += 'whatsapp' — un lead creato dall'inbox arriva da WhatsApp,
--    non "da telefono" né "altro". Senza allargare l'enum l'INSERT verrebbe
--    rifiutato dal DB (vedi la stessa trappola di phase67 sui canali).
--    NB: tenere allineato a LEAD_SOURCES in api/leads.php.

USE gestione_immobiliare;

-- ── 1) Aggancio al lead ──────────────────────────────────────────────────────
CALL migration_add_column('whatsapp_messages', 'lead_id', 'INT UNSIGNED NULL AFTER tenant_id');
CALL migration_add_index('whatsapp_messages', 'idx_wm_lead', '`lead_id`');

-- SET NULL e non CASCADE: cancellare un lead non deve cancellare la prova di
-- cosa ci siamo detti — il messaggio resta, torna semplicemente "non associato".
SET @fk_exists := (
    SELECT COUNT(*) FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'whatsapp_messages' AND constraint_name = 'fk_wm_lead'
);
SET @sql := IF(@fk_exists = 0,
    'ALTER TABLE whatsapp_messages ADD CONSTRAINT fk_wm_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL ON UPDATE CASCADE',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── 2) Indice sul destinatario ───────────────────────────────────────────────
CALL migration_add_index('whatsapp_messages', 'idx_wm_to', '`to_number`');

-- ── 3) Sorgente lead: WhatsApp ───────────────────────────────────────────────
SET @src := (
    SELECT COLUMN_TYPE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'source'
);
SET @sql := IF(@src IS NOT NULL AND @src NOT LIKE '%whatsapp%',
    "ALTER TABLE leads MODIFY source ENUM('telefono','email','web','passaparola','social','immobiliare','idealista','casa','subito','whatsapp','altro') NOT NULL DEFAULT 'altro'",
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
