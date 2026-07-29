-- phase82_sdd_sequence_type.sql
--
-- SeqTp: il campo che decide se un addebito diretto viene accettato o respinto.
--
-- In pain.008 ogni incasso dichiara se e' il PRIMO su quel mandato (`FRST`) o
-- uno dei successivi (`RCUR`). Finora lib/sepa_sdd.php scriveva `RCUR` fisso per
-- tutti. Il risultato non e' un errore di forma — il file passa lo schema XSD
-- senza una parola — ma un rifiuto della banca al primo incasso di ogni nuovo
-- inquilino: "sequenza non coerente con il mandato". Si scopre giorni dopo
-- l'upload, quando l'affitto risulta incassato nel gestionale e non sul conto.
--
-- Il punto e' che FRST/RCUR non e' una proprieta' del pagamento ne' del mandato:
-- e' una proprieta' della STORIA del mandato. Per saperla bisogna ricordarsi che
-- cosa e' gia' stato esportato, e finora l'export non lasciava traccia di se':
-- il file veniva generato, scaricato e dimenticato. Da qui il registro.
--
--   1. `sdd_collections` e' append-only e tiene una riga per PAGAMENTO esportato.
--      La chiave unica su payment_id rende la ri-generazione dello stesso mese
--      idempotente: se l'agente riscarica il file (l'ha perso, l'ha aperto e
--      chiuso, la banca ne chiede una copia) ritrova gli stessi SeqTp e non un
--      FRST che diventa RCUR a sua insaputa.
--
--   2. `frst_key` e' una colonna generata che vale `tenant_id:mandato` SOLO sulle
--      righe FRST e NULL su tutte le altre. L'indice unico su di essa e' quindi
--      un "unique parziale": garantisce a livello di DB che esista al massimo un
--      primo incasso per ciascun mandato, anche se due amministratori generano
--      il file nello stesso istante da due sessioni diverse. La decisione
--      FRST/RCUR e' una lettura seguita da una scrittura, e senza questo vincolo
--      la lettura concorrente le farebbe scrivere FRST a entrambe.
--      Nota: la chiave include tenant_id perche' l'UMR e' univoco per creditore,
--      non nell'universo; e include mandate_ref perche' un mandato NUOVO (nuovo
--      IBAN, nuova firma) riparte legittimamente da FRST.
--
--   3. L'indice su payments(method, status, due_date) e' la query dell'export,
--      parola per parola. Le colonne che la richiesta iniziale voleva indicizzare
--      — data mandato e canone — non entrano in nessuna clausola WHERE: la data
--      del mandato viene letta dalla riga inquilino gia' raggiunta via JOIN, e
--      l'importo e' un valore da stampare, non da cercare. Indicizzarli avrebbe
--      aggiunto due B-tree da mantenere a ogni scrittura senza far risparmiare
--      una sola lettura.

-- ─── 1. Registro degli incassi SDD gia' esportati ────────────────────────────
CREATE TABLE IF NOT EXISTS `sdd_collections` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `payment_id`      INT UNSIGNED NOT NULL,
  `tenant_id`       INT UNSIGNED NOT NULL,
  `mandate_ref`     VARCHAR(35)  NOT NULL COMMENT 'UMR al momento dell-export (il mandato puo- cambiare dopo)',
  `seq_type`        ENUM('FRST','RCUR') NOT NULL,
  `collection_date` DATE         NOT NULL COMMENT 'ReqdColltnDt dichiarata nel file',
  `msg_id`          VARCHAR(35)  NOT NULL COMMENT 'MsgId del file che contiene questo addebito',
  `exported_at`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `exported_by`     INT UNSIGNED DEFAULT NULL,

  -- Unique parziale emulato: valorizzata solo sulle righe FRST, NULL altrove
  -- (e in MySQL i NULL non collidono mai fra loro in un indice unico).
  `frst_key` VARCHAR(64)
      GENERATED ALWAYS AS (IF(`seq_type` = 'FRST', CONCAT(`tenant_id`, ':', `mandate_ref`), NULL)) STORED,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sdd_collections_payment` (`payment_id`),
  UNIQUE KEY `uq_sdd_collections_frst` (`frst_key`),
  KEY `idx_sdd_collections_mandate` (`tenant_id`, `mandate_ref`),
  KEY `idx_sdd_collections_msg` (`msg_id`),

  -- RESTRICT e non CASCADE, per due ragioni che coincidono.
  --
  -- La prima e' un vincolo di MySQL, verificato e non dedotto: una FK sulla
  -- colonna base di una colonna generata non puo' usare CASCADE / SET NULL /
  -- SET DEFAULT (errore 1215, "Cannot add foreign key constraint"). `tenant_id`
  -- e' colonna base di `frst_key`, quindi CASCADE li' e' proprio illegale.
  --
  -- La seconda e' che RESTRICT e' comunque la scelta giusta: questo e' il
  -- registro di cio' che e' stato mandato in banca. Se cancellare un inquilino
  -- portasse via le sue righe, il mandato tornerebbe "mai incassato" e il mese
  -- dopo ripartirebbe da FRST. E' anche il comportamento gia' adottato da
  -- `payments` verso tenants/properties, e da phase48 sulla storia dei
  -- pagamenti. In pratica il caso non si presenta: gli inquilini si archiviano
  -- (status='archived') e la cancellazione GDPR anonimizza la riga sul posto,
  -- non la elimina.
  CONSTRAINT `fk_sdd_collections_payment` FOREIGN KEY (`payment_id`) REFERENCES `payments` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_sdd_collections_tenant`  FOREIGN KEY (`tenant_id`)  REFERENCES `tenants` (`id`)  ON DELETE RESTRICT,
  -- L'amministratore che ha generato il file e' un'attribuzione, non un legame
  -- necessario: se l'account sparisce la riga resta, senza autore.
  CONSTRAINT `fk_sdd_collections_admin`   FOREIGN KEY (`exported_by`) REFERENCES `admin_users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 2. Indice della query di export ─────────────────────────────────────────
CALL migration_add_index('payments', 'idx_payments_sdd_batch', '`method`, `status`, `due_date`');
