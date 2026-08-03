-- phase92_automation_trigger_filter.sql
-- Le automazioni a evento imparano a restringersi.
--
-- Perche': "Nuovo lead registrato" e' un evento solo, ma le strade per crearlo
-- non sono equivalenti. Il form del sito e i portali portano qualcuno che ha
-- scritto e aspetta risposta. La stessa riga pero' nasce anche quando l'agente
-- digita a mano il contatto con cui ha appena chiuso una telefonata: a quella
-- persona un «grazie per averci scritto» arriva sbagliato.
--
-- Finora la regola si agganciava all'evento nudo e non c'era modo di dirlo.
--
-- `trigger_filter` e' un oggetto JSON {campo: [valori ammessi]} confrontato con
-- il payload dell'evento (vedi automationRuleMatchesFilter in
-- config/automation_events.php). NULL = nessun vincolo, che e' anche il
-- comportamento di tutte le regole gia' salvate: la colonna non le cambia.
--
-- Idempotente: usa migration_add_column (000_helpers.sql). Niente `USE`, il DB
-- di produzione si chiama `default`.
--
-- Nota per chi tocchera' questo file: niente punto e virgola dentro le
-- stringhe, nemmeno in un COMMENT. Lo splitter del runner taglia li' e la
-- migrazione muore con un 1064 su SQL valido.

CALL migration_add_column('reminders', 'trigger_filter',
    'JSON NULL DEFAULT NULL AFTER recipient_rule');
