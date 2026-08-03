-- phase97 — l'accesso FALLITO entra nel registro attivita'
--
-- Il registro serve quando un dato sparisce, quando due persone si
-- contraddicono, o quando qualcuno chiede conto degli accessi. Registrava gli
-- accessi riusciti (config/auth.php:261) e non quelli falliti: cioe' proprio
-- la meta' che serve per accorgersi di qualcuno che sta provando password.
-- Dieci tentativi andati a vuoto sull'utenza del titolare non lasciavano
-- nessuna traccia consultabile — il blocco a 5 tentativi scattava, ma in
-- silenzio, e nessuna schermata poteva dirlo.
--
-- L'enum si allarga APPENDENDO il valore nuovo a quelli letti da
-- information_schema, non riscrivendo l'elenco a mano: due migrazioni
-- concorrenti che si riscrivono l'un l'altra la lista si cancellano i valori a
-- vicenda (vedi la nota su enum-whitelist-drift). Ed e' idempotente: se
-- 'login_failed' c'e' gia', non si tocca niente.

SET @col := (
    SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'activity_log'
       AND COLUMN_NAME = 'action'
);

SET @needs := (@col IS NOT NULL AND @col NOT LIKE '%''login_failed''%');

-- COLUMN_TYPE arriva come "enum('a','b')": si toglie la parentesi finale e si
-- aggiunge il valore nuovo prima di richiuderla.
SET @sql := IF(@needs,
    CONCAT('ALTER TABLE activity_log MODIFY COLUMN action ',
           LEFT(@col, CHAR_LENGTH(@col) - 1),
           ",'login_failed') NOT NULL"),
    'SELECT 1');

PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- L'accesso fallito non ha un utente: e' un tentativo su un nome, che puo'
-- benissimo non esistere. La colonna era gia' NULL-abile, ma l'indice serve
-- perche' la domanda tipica e' "quanti tentativi falliti nell'ultima ora".
CALL migration_add_index('activity_log', 'idx_activity_action_created', '`action`, `created_at`');
