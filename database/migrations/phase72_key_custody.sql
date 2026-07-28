-- phase72_key_custody.sql
-- Gestione chiavi: da "campo di testo" a custodia tracciabile.
--
-- Stato precedente (phase63): il detentore era o un agente (holder_id → admin_users)
-- o una stringa libera (holder_name). Nella pratica dell'agenzia le chiavi vanno
-- quasi sempre a un FORNITORE (idraulico, impresa di pulizie) o a un INQUILINO,
-- e con una stringa libera quell'evento non risulta da nessuna parte sulla
-- scheda del fornitore/inquilino: se il tecnico perde le chiavi non esiste modo
-- di sapere quante altre ne ha in mano.
--
-- 1) DETENTORE POLIMORFO
--    Non si introduce una tabella "entità universali": tutto lo schema di questa
--    app usa FK tipizzate nullable (vedi `reminders`, che ha client_id / lead_id /
--    tenant_id / supplier_id affiancate). Si segue lo stesso pattern:
--    holder_type dice QUALE colonna è valorizzata, holder_name resta come
--    etichetta di ripiego per il detentore occasionale ("il vicino del 3°").
--    holder_id (agente) NON viene rinominata: api/agent_portfolio.php conta le
--    chiavi in mano a un agente proprio su quella colonna.
--
-- 2) SCADENZA DI RIENTRO
--    returned_at è la data in cui le chiavi SONO tornate; non esisteva alcuna
--    data ATTESA di rientro, quindi "chiave fuori da tre settimane" non era una
--    condizione esprimibile né sorvegliabile. due_back_at la rende tale.
--    overdue_notified_at evita che il cron rimandi lo stesso avviso ogni giorno.
--
-- 3) REGISTRO EVENTI (property_key_events)
--    La riga property_keys è uno STATO: modificando il detentore si sovrascrive
--    chi aveva le chiavi prima. Per un bene ad alta responsabilità serve lo
--    storico. Il registro è append-only a livello applicativo (nessun percorso
--    di UPDATE/DELETE in api/property_keys.php). Niente TRIGGER di blocco:
--    l'anonimizzazione GDPR (config/gdpr.php) deve poter ripulire le etichette
--    con nomi di persone, e un trigger che vieta l'UPDATE renderebbe la
--    cancellazione un diritto ineseguibile.
--
--    Le FK del registro sono ON DELETE SET NULL, non CASCADE: eliminare la
--    scheda chiavi non deve cancellare la prova di chi le aveva. Per questo ogni
--    evento porta anche le etichette testuali (holder_label, property_label):
--    restano leggibili quando la riga collegata non c'è più.
--
--    appointment_id / reminder_id agganciano la consegna all'evento che l'ha
--    motivata — un appuntamento di visita o un intervento di manutenzione
--    (gli "interventi" in questa app sono righe `reminders` con maintenance_status).
--
-- Idempotente: usa migration_add_column / migration_add_index (000_helpers.sql).

USE gestione_immobiliare;

-- ---------------------------------------------------------------------------
-- 1) Detentore polimorfo
-- ---------------------------------------------------------------------------
CALL migration_add_column('property_keys', 'holder_type',
    "VARCHAR(20) NULL COMMENT 'agente|fornitore|inquilino|proprietario|lead|altro' AFTER key_code");
CALL migration_add_column('property_keys', 'holder_supplier_id', 'INT UNSIGNED NULL AFTER holder_id');
CALL migration_add_column('property_keys', 'holder_tenant_id',   'INT UNSIGNED NULL AFTER holder_supplier_id');
CALL migration_add_column('property_keys', 'holder_client_id',   'INT UNSIGNED NULL AFTER holder_tenant_id');
CALL migration_add_column('property_keys', 'holder_lead_id',     'INT UNSIGNED NULL AFTER holder_client_id');

CALL migration_add_index('property_keys', 'idx_keys_holder_supplier', '`holder_supplier_id`');
CALL migration_add_index('property_keys', 'idx_keys_holder_tenant',   '`holder_tenant_id`');
CALL migration_add_index('property_keys', 'idx_keys_holder_client',   '`holder_client_id`');
CALL migration_add_index('property_keys', 'idx_keys_holder_lead',     '`holder_lead_id`');

SET @fk := (SELECT COUNT(*) FROM information_schema.referential_constraints
            WHERE constraint_schema = DATABASE()
              AND table_name = 'property_keys' AND constraint_name = 'fk_keys_supplier');
SET @sql := IF(@fk = 0,
    'ALTER TABLE property_keys ADD CONSTRAINT fk_keys_supplier FOREIGN KEY (holder_supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL ON UPDATE CASCADE',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @fk := (SELECT COUNT(*) FROM information_schema.referential_constraints
            WHERE constraint_schema = DATABASE()
              AND table_name = 'property_keys' AND constraint_name = 'fk_keys_tenant');
SET @sql := IF(@fk = 0,
    'ALTER TABLE property_keys ADD CONSTRAINT fk_keys_tenant FOREIGN KEY (holder_tenant_id) REFERENCES tenants(id) ON DELETE SET NULL ON UPDATE CASCADE',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @fk := (SELECT COUNT(*) FROM information_schema.referential_constraints
            WHERE constraint_schema = DATABASE()
              AND table_name = 'property_keys' AND constraint_name = 'fk_keys_client');
SET @sql := IF(@fk = 0,
    'ALTER TABLE property_keys ADD CONSTRAINT fk_keys_client FOREIGN KEY (holder_client_id) REFERENCES clients(id) ON DELETE SET NULL ON UPDATE CASCADE',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @fk := (SELECT COUNT(*) FROM information_schema.referential_constraints
            WHERE constraint_schema = DATABASE()
              AND table_name = 'property_keys' AND constraint_name = 'fk_keys_lead');
SET @sql := IF(@fk = 0,
    'ALTER TABLE property_keys ADD CONSTRAINT fk_keys_lead FOREIGN KEY (holder_lead_id) REFERENCES leads(id) ON DELETE SET NULL ON UPDATE CASCADE',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Backfill: le righe esistenti sono agente (holder_id) oppure testo libero.
UPDATE property_keys
   SET holder_type = CASE
       WHEN holder_id IS NOT NULL                              THEN 'agente'
       WHEN holder_name IS NOT NULL AND TRIM(holder_name) <> '' THEN 'altro'
       ELSE NULL
   END
 WHERE holder_type IS NULL;

-- ---------------------------------------------------------------------------
-- 2) Scadenza di rientro
-- ---------------------------------------------------------------------------
CALL migration_add_column('property_keys', 'due_back_at',         'DATE NULL AFTER handed_at');
CALL migration_add_column('property_keys', 'overdue_notified_at', 'DATETIME NULL AFTER returned_at');
-- L'indice serve alla sweep giornaliera del cron (status + scadenza).
CALL migration_add_index('property_keys', 'idx_keys_due_back', '`status`, `due_back_at`');

-- ---------------------------------------------------------------------------
-- 3) Registro eventi append-only
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS property_key_events (
    id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
    key_id         INT UNSIGNED NULL,
    property_id    INT UNSIGNED NULL,
    property_label VARCHAR(255) NULL COMMENT 'snapshot indirizzo: sopravvive alla cancellazione',
    event_type     VARCHAR(20)  NOT NULL COMMENT 'created|handover|return|status_change|lost|overdue|deleted',
    status_before  VARCHAR(20)  NULL,
    status_after   VARCHAR(20)  NULL,
    holder_type    VARCHAR(20)  NULL,
    holder_label   VARCHAR(150) NULL COMMENT 'snapshot nome detentore dopo l evento',
    prev_holder_label VARCHAR(150) NULL,
    holder_admin_id    INT UNSIGNED NULL,
    holder_supplier_id INT UNSIGNED NULL,
    holder_tenant_id   INT UNSIGNED NULL,
    holder_client_id   INT UNSIGNED NULL,
    holder_lead_id     INT UNSIGNED NULL,
    event_date     DATE NULL COMMENT 'data reale consegna/rientro, non quella di sistema',
    due_back_at    DATE NULL,
    appointment_id INT UNSIGNED NULL,
    reminder_id    INT UNSIGNED NULL COMMENT 'intervento di manutenzione collegato',
    notes          VARCHAR(500) NULL,
    admin_user_id  INT UNSIGNED NULL COMMENT 'chi ha autorizzato/registrato',
    admin_username VARCHAR(100) NULL,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_kev_key (key_id, created_at),
    KEY idx_kev_property (property_id),
    KEY idx_kev_supplier (holder_supplier_id),
    KEY idx_kev_tenant (holder_tenant_id),
    KEY idx_kev_client (holder_client_id),
    KEY idx_kev_lead (holder_lead_id),
    KEY idx_kev_admin (holder_admin_id),
    CONSTRAINT fk_kev_key         FOREIGN KEY (key_id)             REFERENCES property_keys(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_kev_property    FOREIGN KEY (property_id)        REFERENCES properties(id)    ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_kev_admin       FOREIGN KEY (holder_admin_id)    REFERENCES admin_users(id)   ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_kev_supplier    FOREIGN KEY (holder_supplier_id) REFERENCES suppliers(id)     ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_kev_tenant      FOREIGN KEY (holder_tenant_id)   REFERENCES tenants(id)       ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_kev_client      FOREIGN KEY (holder_client_id)   REFERENCES clients(id)       ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_kev_lead        FOREIGN KEY (holder_lead_id)     REFERENCES leads(id)         ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_kev_appointment FOREIGN KEY (appointment_id)     REFERENCES appointments(id)  ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_kev_reminder    FOREIGN KEY (reminder_id)        REFERENCES reminders(id)     ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Evento di apertura per le schede già esistenti: senza questo la timeline di
-- una chiave registrata prima di oggi apparirebbe vuota, dando l'impressione
-- (falsa) che non sia mai stata consegnata a nessuno.
INSERT INTO property_key_events
    (key_id, property_id, property_label, event_type, status_after, holder_type,
     holder_label, holder_admin_id, event_date, notes, created_at)
SELECT k.id, k.property_id, CONCAT_WS(', ', p.address, p.city), 'created', k.status, k.holder_type,
       COALESCE(a.username, k.holder_name), k.holder_id, k.handed_at,
       'Registro storico non disponibile: scheda creata prima del registro eventi.', k.created_at
  FROM property_keys k
  LEFT JOIN properties  p ON p.id = k.property_id
  LEFT JOIN admin_users a ON a.id = k.holder_id
 WHERE NOT EXISTS (SELECT 1 FROM property_key_events e WHERE e.key_id = k.id);
