-- phase84_notifications_and_enums.sql
--
-- Due buchi fra quello che il PHP scrive e quello che il database accetta.
--
--   1. LA TABELLA `notifications` NON ESISTE. api/email_inbound.php:129 e
--      api/whatsapp_webhook.php:114 ci fanno INSERT a ogni email e a ogni
--      messaggio WhatsApp in arrivo, ma nessuna migrazione l'ha mai creata e non
--      c'e' nemmeno in schema_production.sql. Entrambe le INSERT stanno dentro un
--      try/catch che restituisce comunque 200 al fornitore (giusto: Mailgun e
--      Twilio ritentano all'infinito su un errore), quindi il fallimento non si
--      vede da nessuna parte — semplicemente, di ogni contatto in arrivo non
--      resta traccia nella campanella. whatsapp_webhook.php lo dice perfino nel
--      commento del catch: "Notifications table may not exist yet".
--
--      Le colonne qui sotto sono esattamente quelle delle due INSERT, non una
--      di piu'.
--
--      `entity_type` + `entity_id` restano senza foreign key ed e' voluto: il
--      bersaglio e' polimorfo per natura (una riga `communications`, un messaggio
--      WhatsApp) e una notifica deve poter sopravvivere alla cancellazione di
--      cio' che la ha generata — e' un registro di "e' successo questo", non un
--      collegamento. Tutto il resto dello schema usa FK tipizzate perche' li' il
--      collegamento conta; qui no.
--
--   2. `agent_commissions.status` E' enum('pending','paid'). api/commissions.php:19
--      dichiara COMMISSION_STATUSES = ['pending','paid','cancelled'] e lo
--      valida in ingresso: annullare una provvigione passa la validazione PHP e
--      poi viene rifiutata dal database (in sql_mode STRICT, errore 1265). La
--      colonna si allarga ad accogliere il terzo valore che l'applicazione
--      offre gia'.
--
--      Allargamento per APPEND letto da information_schema, non riscrivendo la
--      lista: due migrazioni che riscrivono lo stesso enum si cancellano a
--      vicenda. Stessa forma usata da phase76 su suppliers.category.

USE gestione_immobiliare;

-- ─── 1. notifications ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    type        VARCHAR(50)  NOT NULL COMMENT 'email_inbound, whatsapp_inbound, ...',
    title       VARCHAR(255) NOT NULL,
    body        VARCHAR(255) DEFAULT NULL,
    entity_type VARCHAR(50)  DEFAULT NULL COMMENT 'communication, whatsapp_message, ... (polimorfo di proposito)',
    entity_id   INT UNSIGNED DEFAULT NULL,
    is_read     TINYINT(1)   NOT NULL DEFAULT 0,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at     TIMESTAMP    NULL DEFAULT NULL,
    PRIMARY KEY (id),
    -- La campanella chiede sempre "le non lette, dalla piu' recente".
    KEY idx_notif_unread (is_read, created_at),
    KEY idx_notif_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 2. agent_commissions.status += 'cancelled' ───────────────────────────────
SET @cur := (
    SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'agent_commissions'
       AND COLUMN_NAME = 'status'
);

SET @sql := IF(@cur IS NULL OR LOCATE("'cancelled'", @cur) > 0,
    'SELECT 1',
    CONCAT("ALTER TABLE agent_commissions MODIFY COLUMN status ",
           REPLACE(@cur, ')', ",'cancelled')"),
           " NOT NULL DEFAULT 'pending'"));

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
