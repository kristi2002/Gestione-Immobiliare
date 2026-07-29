-- phase81_commission_agent_role.sql
--
-- Una compravendita si divide quasi sempre fra due agenti: chi ha preso il
-- mandato dal proprietario (l'acquisitore) e chi ha portato la parte acquirente
-- (il venditore, o proponente). La provvigione si spacca fra i due, spesso ma
-- non sempre a meta'.
--
-- Il legame fra le due meta' in tabella c'era gia': sono due righe di
-- agent_commissions con lo stesso contract_id e admin_user_id diversi. Quello
-- che mancava era il modo di dire QUALE meta' fosse quale. Senza, due righe da
-- 3.000 su un contratto sono indistinguibili da un compenso raddoppiato per
-- errore, e la scheda agente non puo' dire a cosa quel numero corrisponde.
--
-- 'unico' come default e' il punto: le righe che esistono oggi sono provvigioni
-- intere, non meta' di uno split, e devono continuare a leggersi cosi'. La
-- distinzione acquisitore/venditore si applica solo dove qualcuno la dichiara.
--
-- L'indice su contract_id serve a ricomporre lo split: "dammi le altre righe di
-- questo contratto" oggi e' una scansione, e agent_commissions ha solo
-- idx_ac_agent e idx_ac_status.
--
-- Idempotente: usa migration_add_column / migration_add_index (000_helpers.sql).

CALL migration_add_column('agent_commissions', 'agent_role',
    "ENUM('unico','acquisitore','venditore') NOT NULL DEFAULT 'unico'
     COMMENT 'unico = provvigione intera; acquisitore/venditore = meta di uno split'
     AFTER admin_user_id");

CALL migration_add_index('agent_commissions', 'idx_ac_contract', '`contract_id`');
