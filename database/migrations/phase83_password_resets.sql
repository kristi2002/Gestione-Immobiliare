-- phase83_password_resets.sql
--
-- Link di reset password per i portali inquilino e proprietario.
--
-- Finora l'unico modo di dare accesso a un inquilino era che un agente scrivesse
-- una password nel campo "Password portale inquilino" e gliela comunicasse a
-- voce o per messaggio. Tre conseguenze, tutte a carico dell'agenzia:
-- l'agenzia CONOSCE la password di quella persona; la password viaggia su un
-- canale che nessuno controlla (WhatsApp, un post-it); e se il portale — che
-- contiene contratti e documenti d'identita' — viene aperto da qualcun altro,
-- non esiste modo di sostenere che l'agenzia non c'entri. Il link di reset
-- toglie l'agenzia dal mezzo: l'agente invia, l'interessato sceglie, nessuno
-- dei due vede mai la password dell'altro.
--
--   1. IL TOKEN NON E' IN TABELLA. Si salva `token_hash`, lo SHA-256 del token;
--      il token in chiaro esiste solo nell'email. Chi legge il database — un
--      dump, un backup finito nel posto sbagliato, una SQL injection — non
--      ottiene link utilizzabili. (`esign_requests`, phase15, salva invece il
--      token in chiaro: la' il danno massimo e' una firma, qui sarebbe l'accesso
--      completo al portale, e il costo di fare la cosa giusta e' una riga.)
--      SHA-256 nudo e non password_hash(): il token e' gia' 256 bit di entropia
--      da random_bytes, non ha bisogno di un KDF lento, e serve poterlo cercare
--      per indice invece di provare le righe una per una.
--
--   2. SOGGETTO CON FK TIPIZZATE, non (subject_type, subject_id). E' la stessa
--      scelta di phase72 sulle chiavi e di `reminders`: due colonne nullable con
--      vincolo di integrita' vero, invece di un id polimorfo che il database non
--      puo' verificare. Il CHECK impone che ne sia valorizzata esattamente una.
--
--   3. USO SINGOLO E REVOCA. `used_at` chiude il link appena serve; emettere un
--      nuovo link revoca i precedenti ancora aperti (`invalidated_at`), cosi' un
--      link vecchio rimasto in una casella di posta non torna utile mesi dopo.
--
--   4. `request_ip` e' l'IP di chi USA il link, non di chi lo invia: e' l'unico
--      dato che, a contestazione, dice qualcosa su chi ha impostato quella
--      password.

CREATE TABLE IF NOT EXISTS `password_resets` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`      INT UNSIGNED DEFAULT NULL,
  `client_id`      INT UNSIGNED DEFAULT NULL COMMENT 'Proprietario (portale owner)',
  `email`          VARCHAR(255) NOT NULL COMMENT 'Destinatario a cui il link e- stato spedito',
  `token_hash`     CHAR(64)     NOT NULL COMMENT 'SHA-256 esadecimale del token - il token in chiaro non e- mai qui',
  `expires_at`     DATETIME     NOT NULL,
  `used_at`        DATETIME     DEFAULT NULL,
  `invalidated_at` DATETIME     DEFAULT NULL COMMENT 'Revocato da un link piu- recente o da un invio fallito',
  `request_ip`     VARCHAR(45)  DEFAULT NULL COMMENT 'IP di chi ha USATO il link',
  `created_at`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by`     INT UNSIGNED DEFAULT NULL COMMENT 'Admin che ha inviato il link',

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_password_resets_token` (`token_hash`),
  KEY `idx_password_resets_tenant` (`tenant_id`),
  KEY `idx_password_resets_client` (`client_id`),
  KEY `idx_password_resets_expiry` (`expires_at`),

  -- Esattamente un soggetto: ne' zero (riga orfana) ne' due (a chi appartiene?).
  CONSTRAINT `chk_password_resets_subject`
      CHECK ((`tenant_id` IS NOT NULL) XOR (`client_id` IS NOT NULL)),

  -- CASCADE e non RESTRICT: al contrario del registro SDD (phase82) qui non c-e-
  -- nulla da conservare. Un link pendente verso un soggetto che non esiste piu-
  -- e- solo un accesso da chiudere.
  CONSTRAINT `fk_password_resets_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_password_resets_client` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_password_resets_admin`  FOREIGN KEY (`created_by`) REFERENCES `admin_users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
