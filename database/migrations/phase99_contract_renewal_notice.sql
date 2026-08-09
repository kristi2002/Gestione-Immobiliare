-- phase99 — rinnovo, disdetta e preavviso della locazione.
--
-- Il gestionale sapeva quando un contratto SCADE, e nient'altro di quel che
-- succede intorno a quella data. In una locazione italiana la scadenza non e'
-- un evento: e' l'esito di una decisione che va presa mesi prima.
--
--   4+4  →  se nessuno manda la disdetta 6 mesi prima, si rinnova per altri 4
--   3+2  →  stesso meccanismo, 6 mesi di preavviso
--   6+6  →  commerciale, 12 mesi (18 per gli alberghi)
--
-- Conseguenza pratica di non modellarlo: il promemoria di scadenza partiva a
-- 30 giorni dalla fine (config/contract_expirations.php), cioe' arrivava quando
-- la disdetta era gia' impossibile da mandare — e il contratto si rinnovava per
-- altri quattro anni senza che nessuno avesse deciso niente. Un promemoria che
-- avvisa dopo il termine e' peggio di nessun promemoria: sembra che il sistema
-- stia sorvegliando.
--
-- I valori qui sotto sono PREDEFINITI, non verita': si propongono in base al
-- tipo di locazione e restano modificabili sul singolo contratto, perche' e' il
-- contratto firmato a comandare, non questa tabella. (E non e' consulenza
-- legale: la durata di legge la verifica chi redige il contratto.)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Preavviso e rinnovo
-- ─────────────────────────────────────────────────────────────────────────────

-- Mesi di preavviso per la disdetta. NULL = non impostato: chi legge usa il
-- valore predefinito del tipo (leaseTermsFor() in lib/contract_lifecycle.php),
-- cosi' i contratti gia' in archivio non vanno riscritti tutti a mano.
CALL migration_add_column('contracts', 'notice_months',
    'TINYINT UNSIGNED DEFAULT NULL AFTER contract_subtype');

-- Se la mancata disdetta produce un rinnovo tacito.
CALL migration_add_column('contracts', 'auto_renew',
    'TINYINT(1) NOT NULL DEFAULT 0 AFTER notice_months');

-- Durata del rinnovo, in mesi. NULL con auto_renew=1 significa "per un periodo
-- uguale al primo": e' il caso dei contratti per studenti, e lasciarlo nullo
-- evita di scrivere un numero che dipende dalla durata effettiva.
CALL migration_add_column('contracts', 'renewal_months',
    'SMALLINT UNSIGNED DEFAULT NULL AFTER auto_renew');

-- Quante volte e' gia' stato rinnovato. Serve a dire "2° rinnovo" invece di
-- lasciar credere che sia il contratto originale, e a distinguere la prima
-- scadenza (dove il locatore puo' negare il rinnovo solo per i motivi di legge)
-- dalle successive.
CALL migration_add_column('contracts', 'renewal_count',
    'TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER renewal_months');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Disdetta
--
-- Quattro fatti distinti, tutti necessari in una contestazione: CHI ha disdetto,
-- QUANDO ha mandato la comunicazione, PERCHE', e da quando il contratto non e'
-- piu' in vigore. L'ultima non si deduce dalle altre — una disdetta alla
-- scadenza lascia la fine dov'era, un recesso del conduttore la anticipa.
-- ─────────────────────────────────────────────────────────────────────────────

CALL migration_add_column('contracts', 'termination_notice_date',
    'DATE DEFAULT NULL AFTER renewal_count');

CALL migration_add_column('contracts', 'terminated_by',
    "ENUM('locatore','conduttore') DEFAULT NULL AFTER termination_notice_date");

CALL migration_add_column('contracts', 'termination_reason',
    'VARCHAR(255) DEFAULT NULL AFTER terminated_by');

-- La data in cui la locazione finisce davvero. Quando anticipa la scadenza
-- naturale, `end_date` viene portata qui: e' `end_date` che tutto il resto
-- dell'applicazione legge per sapere se un contratto e' in vigore (filtro
-- Attivi, occupazione dell'immobile, scadenzario), e due verita' su "quando
-- finisce" avrebbero significato un immobile che resta occupato da una
-- locazione gia' chiusa. La data originale resta qui sotto.
CALL migration_add_column('contracts', 'termination_effective_date',
    'DATE DEFAULT NULL AFTER termination_reason');

-- La scadenza contrattuale prima che una disdetta la anticipasse. Nulla se
-- `end_date` non e' mai stata spostata.
CALL migration_add_column('contracts', 'original_end_date',
    'DATE DEFAULT NULL AFTER termination_effective_date');

-- Il cron cerca i contratti la cui scadenza di preavviso si avvicina: senza
-- indice e' una scansione dell'intera tabella a ogni giro.
CALL migration_add_index('contracts', 'idx_contract_notice', 'end_date, status');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Valori predefiniti sui contratti gia' in archivio
--
-- Solo dove il tipo di locazione e' noto: senza `contract_subtype` non si puo'
-- indovinare quale regime si applichi, e scrivere un preavviso a caso e'
-- peggio che lasciarlo vuoto (il codice che legge sa gestire il nullo).
-- Si tocca solo cio' che e' ancora NULL, per non sovrascrivere una scelta
-- gia' fatta a mano: la migrazione e' rieseguibile.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE contracts
   SET notice_months  = COALESCE(notice_months, 6),
       renewal_months = COALESCE(renewal_months, 48),
       auto_renew     = 1
 WHERE contract_type = 'locazione' AND contract_subtype = '4+4'
   AND notice_months IS NULL;

UPDATE contracts
   SET notice_months  = COALESCE(notice_months, 6),
       renewal_months = COALESCE(renewal_months, 24),
       auto_renew     = 1
 WHERE contract_type = 'locazione' AND contract_subtype = '3+2'
   AND notice_months IS NULL;

UPDATE contracts
   SET notice_months  = COALESCE(notice_months, 12),
       renewal_months = COALESCE(renewal_months, 72),
       auto_renew     = 1
 WHERE contract_type = 'locazione' AND contract_subtype = 'commerciale'
   AND notice_months IS NULL;

-- Studenti: rinnovo tacito per un periodo uguale al primo, quindi
-- `renewal_months` resta nullo di proposito.
UPDATE contracts
   SET notice_months = COALESCE(notice_months, 3),
       auto_renew    = 1
 WHERE contract_type = 'locazione' AND contract_subtype = 'studenti'
   AND notice_months IS NULL;

-- Transitorio e comodato non si rinnovano da soli: finiscono e basta.
UPDATE contracts
   SET notice_months = COALESCE(notice_months, 0),
       auto_renew    = 0
 WHERE contract_type = 'locazione' AND contract_subtype IN ('transitorio', 'comodato')
   AND notice_months IS NULL;
