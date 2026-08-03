-- phase98 — il portale inquilino smette di essere in sola lettura.
--
-- Cinque tabelle non sapevano cosa fosse un inquilino: appuntamenti, letture
-- dei contatori, richieste di firma e comunicazioni erano tutte agganciate al
-- PROPRIETARIO (`client_id`) o al solo immobile. Finche' il portale mostrava
-- quattro numeri andava bene; per far vedere all'inquilino le SUE cose, e per
-- lasciargliene creare qualcuna, serve che quelle righe sappiano di chi sono.
--
-- Nota sul perimetro: ogni colonna aggiunta qui e' una nuova superficie di
-- lettura per il portale. Il filtro resta quello di sempre — si guarda
-- l'inquilino, l'immobile o il contratto, MAI `client_id`, che e' il padrone
-- di casa. Vedi tenant/lib/portal_data.php.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Appuntamenti: possono riguardare un inquilino
--
-- `appointments` conosceva lead, proprietario e agente. Ma un sopralluogo per
-- una perdita, o la riconsegna delle chiavi, riguardano l'INQUILINO — e finora
-- non c'era modo di dirlo, ne' quindi di mostrarglielo.
-- ─────────────────────────────────────────────────────────────────────────────
CALL migration_add_column('appointments', 'tenant_id',
    'INT UNSIGNED DEFAULT NULL AFTER client_id');

CALL migration_add_index('appointments', 'idx_appt_tenant', 'tenant_id');

-- SET NULL e non CASCADE: cancellato l'inquilino, l'appuntamento resta a
-- calendario (ci sono andate delle persone), perde solo l'aggancio.
CALL migration_add_fk('appointments', 'fk_appt_tenant', 'tenant_id', 'tenants', 'id', 'SET NULL');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Letture dei contatori: chi l'ha presa, e se qualcuno l'ha confermata
--
-- `meter_readings` aveva solo immobile + valore + data: una lettura valeva
-- l'altra. Se l'inquilino puo' mandarne, la differenza diventa sostanziale —
-- una autolettura non confermata NON e' un dato su cui conguagliare.
-- Il valore predefinito 'agency' descrive giustamente le righe gia' presenti:
-- fino a oggi le inseriva solo l'agenzia.
-- ─────────────────────────────────────────────────────────────────────────────
CALL migration_add_column('meter_readings', 'source',
    "ENUM('agency','tenant') NOT NULL DEFAULT 'agency' AFTER notes");

CALL migration_add_column('meter_readings', 'submitted_by_tenant_id',
    'INT UNSIGNED DEFAULT NULL AFTER source');

-- Nullo = non ancora verificata. E' il campo che distingue un numero
-- utilizzabile da un numero soltanto dichiarato.
CALL migration_add_column('meter_readings', 'verified_at',
    'DATETIME DEFAULT NULL AFTER submitted_by_tenant_id');

CALL migration_add_column('meter_readings', 'verified_by',
    'INT UNSIGNED DEFAULT NULL AFTER verified_at');

CALL migration_add_index('meter_readings', 'idx_mr_source', 'source, verified_at');

CALL migration_add_fk('meter_readings', 'fk_mr_tenant', 'submitted_by_tenant_id', 'tenants', 'id', 'SET NULL');

-- Le letture gia' in archivio sono dell'agenzia e vanno considerate buone:
-- senza questo resterebbero "non verificate" per sempre e sparirebbero dai
-- conteggi che filtrano su verified_at.
UPDATE meter_readings
   SET verified_at = created_at
 WHERE source = 'agency' AND verified_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Richieste di firma: a chi appartengono
--
-- `esign_requests` identifica il firmatario per nome ed email. Basta per
-- firmare (il link porta un token), NON basta per elencare: il portale non
-- puo' cercare per email — sarebbe un filtro su un dato modificabile, e due
-- persone possono condividere una casella.
-- ─────────────────────────────────────────────────────────────────────────────
CALL migration_add_column('esign_requests', 'tenant_id',
    'INT UNSIGNED DEFAULT NULL AFTER contract_id');

CALL migration_add_index('esign_requests', 'idx_esign_tenant', 'tenant_id, status');

CALL migration_add_fk('esign_requests', 'fk_esign_tenant', 'tenant_id', 'tenants', 'id', 'SET NULL');

-- Le richieste gia' emesse verso l'email di un inquilino gli appartengono:
-- senza questo, chi ha una firma in sospeso non la vedrebbe mai comparire.
-- Si aggancia solo dove l'email individua UN SOLO inquilino attivo.
UPDATE esign_requests er
  JOIN (
        SELECT LOWER(email) AS em, MIN(id) AS tid
          FROM tenants
         WHERE status = 'active' AND email IS NOT NULL AND email <> ''
         GROUP BY LOWER(email)
        HAVING COUNT(*) = 1
       ) t ON t.em = LOWER(er.signer_email)
   SET er.tenant_id = t.tid
 WHERE er.tenant_id IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Comunicazioni: il filo diretto con l'inquilino
--
-- `communications` era agganciata al solo `client_id`, cioe' al proprietario:
-- l'archivio dei messaggi e' sempre stato "per proprietario". Un filo diretto
-- inquilino-agenzia non aveva dove appoggiarsi.
--
-- La colonna e' aggiuntiva, non sostitutiva: una comunicazione puo' avere
-- entrambi (un messaggio su un immobile che riguarda anche chi ci abita).
-- ─────────────────────────────────────────────────────────────────────────────
CALL migration_add_column('communications', 'tenant_id',
    'INT UNSIGNED DEFAULT NULL AFTER client_id');

CALL migration_add_index('communications', 'idx_comm_tenant', 'tenant_id, created_at');

CALL migration_add_fk('communications', 'fk_comm_tenant', 'tenant_id', 'tenants', 'id', 'SET NULL');

-- Il canale 'portale': un messaggio scritto dentro il portale non e' un'email
-- e non e' una nota interna. Si allarga APPENDENDO in coda, mai riscrivendo la
-- lista: riordinare un enum rinumera i valori gia' salvati.
SET @comm_channel := (
    SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'communications'
       AND COLUMN_NAME = 'channel'
);
SET @sql := IF(
    @comm_channel IS NOT NULL AND LOCATE("'portale'", @comm_channel) = 0,
    "ALTER TABLE communications MODIFY channel ENUM('email','whatsapp','sms','chiamata','nota','portale') NOT NULL DEFAULT 'email'",
    'DO 0'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Risposta dell'agenzia dentro la richiesta
--
-- La coda lasciata aperta dalla fase 2: l'inquilino vedeva l'AVANZAMENTO della
-- propria richiesta ("in lavorazione") ma non poteva mai leggere una risposta,
-- perche' in `reminders` non c'era un posto dove scriverla.
-- ─────────────────────────────────────────────────────────────────────────────
CALL migration_add_column('reminders', 'reply_text',
    'TEXT DEFAULT NULL AFTER description');

CALL migration_add_column('reminders', 'replied_at',
    'DATETIME DEFAULT NULL AFTER reply_text');

CALL migration_add_column('reminders', 'replied_by',
    'INT UNSIGNED DEFAULT NULL AFTER replied_at');

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Foto allegate a una richiesta
--
-- L'altra coda della fase 2. Le foto vivono in `documents` come ogni altro
-- file (stesso albero protetto, stesso download_document.php, stesso
-- controllo di accesso): qui serve solo sapere a quale richiesta appartengono.
-- ─────────────────────────────────────────────────────────────────────────────
CALL migration_add_column('documents', 'reminder_id',
    'INT UNSIGNED DEFAULT NULL AFTER contract_id');

CALL migration_add_index('documents', 'idx_doc_reminder', 'reminder_id');

-- CASCADE qui e' voluto, al contrario delle altre: la foto di una segnalazione
-- non ha vita propria: sparita la richiesta, non significa piu' niente.
CALL migration_add_fk('documents', 'fk_doc_reminder', 'reminder_id', 'reminders', 'id', 'CASCADE');
