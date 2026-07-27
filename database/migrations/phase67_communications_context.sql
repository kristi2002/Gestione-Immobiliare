-- phase67_communications_context.sql
-- Comunicazioni: canale reale, contesto immobile, stato di consegna.
-- Più: chiusura del buco anti-duplicati sull'anagrafica proprietari.
--
-- 1) communications.channel — l'enum copriva solo ('email','whatsapp'), quindi la
--    tab "Registra ricevuta" salvava OGNI annotazione manuale come email in
--    entrata: una telefonata riportata a mano diventava indistinguibile da una
--    mail realmente ricevuta, sia in UI sia nei dati (e quindi anche nell'export
--    GDPR). Aggiunge 'nota', 'sms', 'chiamata'.
--    NB: l'enum va tenuto allineato a COMM_CHANNELS in api/communications.php.
--
-- 2) communications.property_id — una conversazione immobiliare è quasi sempre
--    "su" qualcosa (il tetto di Via Tortona, la valutazione del nuovo immobile).
--    Senza questa colonna il thread è un flusso piatto e l'agente deve ricordare
--    a memoria di cosa si stava parlando. NULL = messaggio generico.
--
-- 3) communications.status 'read' + status_updated_at + indice su external_id —
--    l'enum prevedeva già delivered/failed ma NESSUNO aggiornava mai la riga:
--    non esisteva un endpoint di status callback. L'indice su external_id è ciò
--    che rende possibile la UPDATE ... WHERE external_id = :sid del callback.
--
-- 4) uq_clients_cf — l'indice unico sul codice fiscale esiste in
--    schema_production.sql ma NON è mai stato portato in una migrazione: un DB
--    ricostruito da schema.sql + migrations ne è privo e riapre la porta ai
--    duplicati di anagrafica. Qui viene creato solo se assente e solo se non ci
--    sono già CF duplicati (in quel caso si esce senza rompere il deploy: i
--    duplicati vanno prima uniti da Proprietari → Unisci).
--
-- Idempotente: migration_add_column / migration_add_index (000_helpers.sql) e
-- guardie su information_schema per enum, FK e indice unico.

USE gestione_immobiliare;

-- ── 1) Canali reali ──────────────────────────────────────────────────────────
SET @ch := (
    SELECT COLUMN_TYPE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'communications' AND COLUMN_NAME = 'channel'
);
SET @sql := IF(@ch IS NOT NULL AND @ch NOT LIKE '%chiamata%',
    "ALTER TABLE communications MODIFY channel ENUM('email','whatsapp','sms','chiamata','nota') NOT NULL DEFAULT 'email'",
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── 2) Contesto immobile ─────────────────────────────────────────────────────
CALL migration_add_column('communications', 'property_id', 'INT UNSIGNED NULL AFTER client_id');
CALL migration_add_index('communications', 'idx_comm_property', '`property_id`');

-- FK SET NULL: archiviare/eliminare un immobile non deve cancellare lo storico
-- delle comunicazioni, che è documentazione del rapporto con il proprietario.
SET @fk_exists := (
    SELECT COUNT(*) FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'communications' AND constraint_name = 'fk_comm_property'
);
SET @sql := IF(@fk_exists = 0,
    'ALTER TABLE communications ADD CONSTRAINT fk_comm_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL ON UPDATE CASCADE',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── 3) Stati di consegna ─────────────────────────────────────────────────────
SET @st := (
    SELECT COLUMN_TYPE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'communications' AND COLUMN_NAME = 'status'
);
SET @sql := IF(@st IS NOT NULL AND @st NOT LIKE '%''read''%',
    "ALTER TABLE communications MODIFY status ENUM('draft','queued','sent','delivered','read','failed','received') NOT NULL DEFAULT 'sent'",
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

CALL migration_add_column('communications', 'status_updated_at', 'TIMESTAMP NULL DEFAULT NULL AFTER status');
CALL migration_add_column('communications', 'status_detail', 'VARCHAR(255) NULL AFTER status_updated_at');
CALL migration_add_index('communications', 'idx_comm_external', '`external_id`');

-- Stesso stato sulla tabella dedicata WhatsApp (inbox), che finora registrava
-- solo l'arrivo del messaggio e mai il suo esito in uscita.
CALL migration_add_column('whatsapp_messages', 'status', 'VARCHAR(20) NULL AFTER twilio_sid');
CALL migration_add_index('whatsapp_messages', 'idx_wm_sid', '`twilio_sid`');

-- ── 4) Anagrafica proprietari: unicità del codice fiscale ────────────────────
SET @has_uq := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'clients' AND INDEX_NAME = 'uq_clients_cf'
);
SET @dupes := (
    SELECT COUNT(*) FROM (
        SELECT codice_fiscale FROM clients
        WHERE codice_fiscale IS NOT NULL AND codice_fiscale <> ''
        GROUP BY codice_fiscale HAVING COUNT(*) > 1
    ) d
);
SET @sql := IF(@has_uq = 0 AND @dupes = 0,
    'ALTER TABLE clients ADD UNIQUE INDEX uq_clients_cf (codice_fiscale)',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Indici di supporto alla ricerca duplicati (email/telefono/nominativo) usata da
-- api/clients.php?action=check_duplicate prima di ogni inserimento.
CALL migration_add_index('clients', 'idx_clients_phone', '`phone`');
CALL migration_add_index('clients', 'idx_clients_fullname', '`surname`, `name`');
